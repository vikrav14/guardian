"""Standalone acceptance receiver. No watch commands or Firebase credentials.

Plain FTP is used only for the supplier's documented PIC trial. Credentials
are random per run, never logged, and unrelated to Firebase credentials.
"""
import argparse
import errno
import ftplib
import hashlib
import io
import json
import logging
import os
from pathlib import Path
import re
import secrets
import socket
import time
import warnings
from urllib.parse import urlparse

MAX_BYTES = 512 * 1024
MAX_FILES = 4
MAX_ATTEMPTS = 12


def emit(event, **fields):
    print(json.dumps({"event": event, **fields}), flush=True)


def new_session(directory, imei, protocol_id):
    root = Path(directory)
    if not root.is_absolute() or not re.fullmatch(r"\d{15}", imei) or not re.fullmatch(r"\d{10}", protocol_id):
        raise ValueError("invalid_session_arguments")
    root.mkdir(mode=0o700)  # never reuse another trial's directory
    (root / "incoming").mkdir(mode=0o700)
    data = {"version": 1, "imei": imei, "protocolId": protocol_id,
            "username": "g" + secrets.token_hex(4), "password": secrets.token_hex(12)}
    session = root / "session.json"
    with session.open("x", encoding="utf8") as output:
        json.dump(data, output)
    session.chmod(0o600)
    return session


def read_session(path):
    path = Path(path)
    if not path.is_absolute() or path.is_symlink() or path.stat().st_size > 4096:
        raise ValueError("invalid_session_file")
    data = json.loads(path.read_text(encoding="utf8"))
    if (data.get("version") != 1 or not re.fullmatch(r"\d{15}", data.get("imei", ""))
            or not re.fullmatch(r"\d{10}", data.get("protocolId", ""))
            or not re.fullmatch(r"g[0-9a-f]{8}", data.get("username", ""))
            or not re.fullmatch(r"[0-9a-f]{24}", data.get("password", ""))):
        raise ValueError("invalid_session_file")
    return path.parent, data


def validate_jpeg(path):
    from PIL import Image
    path = Path(path)
    if path.is_symlink() or not path.is_file() or not 4 <= path.stat().st_size <= MAX_BYTES:
        raise ValueError("image_size_invalid")
    raw = path.read_bytes()
    if not raw.startswith(b"\xff\xd8") or not raw.endswith(b"\xff\xd9"):
        raise ValueError("jpeg_boundary_invalid")
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        with Image.open(io.BytesIO(raw)) as image:
            if image.format != "JPEG" or not all(0 < n <= 1024 for n in image.size):
                raise ValueError("unsupported_image")
            width, height = image.size
            image.verify()
        with Image.open(io.BytesIO(raw)) as image:
            image.load()  # entropy decode, not merely SOI/EOI inspection
    return {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(),
            "width": width, "height": height, "contentType": "image/jpeg",
            "validation": "pillow_full_decode", "remoteCaptureVerified": False}


def endpoint(value):
    url = urlparse(value)
    if (url.scheme != "tcp" or not url.hostname or url.username or url.password
            or url.query or url.fragment or url.path not in ("", "/")
            or not url.port or not 1024 <= url.port <= 65535):
        raise ValueError("invalid_tcp_endpoint")
    return url.hostname, url.port


def make_server(session_path, control_port, data_port, public_ip=None, public_port=None,
                epsv_allowed=True, report=emit):
    from pyftpdlib.authorizers import DummyAuthorizer
    from pyftpdlib.filesystems import AbstractedFS
    from pyftpdlib.handlers import FTPHandler
    from pyftpdlib.handlers.ftp.dispatchers import PassiveDTP
    from pyftpdlib.ioloop import IOLoop
    from pyftpdlib.servers import FTPServer
    logging.getLogger("pyftpdlib").disabled = True  # no FTP arguments or passwords
    root, session = read_session(session_path)
    incoming = root / "incoming"
    if incoming.is_symlink() or any(incoming.iterdir()):
        raise ValueError("incoming_directory_must_be_empty")
    state = {"attempts": 0, "accepted": [], "rejected": 0}
    photo_name = re.compile(r"(?:" + session["imei"] + "|" + session["protocolId"] + r")_\d{14}\.jpg", re.I)
    probe_name = re.compile(r"guardian-probe-[0-9a-f]{16}\.bin")

    class BoundedFile:
        def __init__(self, file, path):
            self.file, self.count = file, 0
            self.name = str(path)

        def write(self, data):
            if self.count + len(data) > MAX_BYTES:
                raise OSError(errno.EFBIG, "upload_limit")
            self.count += len(data)
            return self.file.write(data)

        def __getattr__(self, attr):
            return getattr(self.file, attr)

    class PrivateFS(AbstractedFS):
        def open(self, filename, mode):
            path = Path(filename)
            if (mode != "wb" or path.parent != incoming or path.is_symlink()
                    or not (photo_name.fullmatch(path.name) or probe_name.fullmatch(path.name))):
                raise OSError(errno.EACCES, "unsupported_upload_name")
            if state["attempts"] >= MAX_ATTEMPTS or len(state["accepted"]) >= MAX_FILES:
                raise OSError(errno.ENOSPC, "trial_upload_limit")
            state["attempts"] += 1
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            return BoundedFile(os.fdopen(fd, "wb"), path)

    class FixedPassive(PassiveDTP):
        timeout = 25

        def bind(self, address):
            # pyftpdlib otherwise falls back to a random port when occupied,
            # which cannot work through the advertised tunnel.
            if address[1] != data_port:
                raise OSError(errno.EADDRINUSE, "passive_port_unavailable")
            return super().bind(address)

    class Handler(FTPHandler):
        abstracted_fs = PrivateFS
        passive_dtp = FixedPassive
        passive_ports = [data_port]
        timeout = 90
        auth_failed_timeout = 0.2
        max_login_attempts = 3
        banner = "Guardian photo acceptance receiver"
        permit_foreign_addresses = False
        proto_cmds = {key: value for key, value in FTPHandler.proto_cmds.items()
                      if key in {"USER", "PASS", "QUIT", "SYST", "PWD", "XPWD", "TYPE", "STRU",
                                 "MODE", "NOOP", "FEAT", "OPTS", "PASV", "EPSV", "CWD", "CDUP",
                                 "STOR", "ALLO", "ABOR"}}

        def log(self, *args, **kwargs):
            pass

        def logline(self, *args, **kwargs):
            pass

        def log_exception(self, *args, **kwargs):
            report("ftp_error", reason="receiver_error")

        def respond(self, response, *args, **kwargs):
            if public_port and response.startswith("227 "):
                response = "227 Entering passive mode (%s,%d,%d)." % (
                    public_ip.replace(".", ","), public_port // 256, public_port % 256)
            elif public_port and response.startswith("229 "):
                response = f"229 Entering extended passive mode (|||{public_port}|)."
            return super().respond(response, *args, **kwargs)

        def ftp_EPSV(self, line):
            if not epsv_allowed:
                self.respond("522 Use PASV for separate public hostnames.")
                return
            return super().ftp_EPSV(line)

        def pre_process_command(self, line, cmd, arg):
            # Reject path traversal before the library normalizes it.
            if cmd == "STOR" and ("/" in arg or "\\" in arg or ".." in arg):
                self.respond("550 Upload a basename only.")
                return
            return super().pre_process_command(line, cmd, arg)

        def on_connect(self):
            report("ftp_control_connected")

        def on_login(self, username):
            report("ftp_login_ok")

        def on_login_failed(self, username, password):
            report("ftp_login_failed")

        def on_file_received(self, filename):
            path = Path(filename)
            if probe_name.fullmatch(path.name):
                report("ftp_probe_received", bytes=path.stat().st_size)
                return
            try:
                metadata = validate_jpeg(path)
                metadata.update({"version": 1, "imei": session["imei"], "protocolId": session["protocolId"],
                                 "source": "ftp_trial", "receivedAt": time.time(), "fileName": path.name})
                receipt = root / ("receipt-" + secrets.token_hex(8) + ".json")
                with receipt.open("x", encoding="utf8") as output:
                    json.dump(metadata, output)
                receipt.chmod(0o600)
                state["accepted"].append(metadata)
                report("ftp_photo_validated", bytes=metadata["bytes"], width=metadata["width"],
                       height=metadata["height"], receiptFile=str(receipt), remoteCaptureVerified=False)
            except Exception:
                path.unlink(missing_ok=True)
                state["rejected"] += 1
                report("ftp_photo_rejected", reason="invalid_or_unsupported_jpeg")

        def on_incomplete_file_received(self, filename):
            Path(filename).unlink(missing_ok=True)
            state["rejected"] += 1
            report("ftp_upload_incomplete")

    authorizer = DummyAuthorizer()
    authorizer.add_user(session["username"], session["password"], str(incoming), perm="ew")
    Handler.authorizer = authorizer
    server = FTPServer(("127.0.0.1", control_port), Handler, ioloop=IOLoop())
    server.max_cons = 6
    server.max_cons_per_ip = 6
    return server, state


def probe(session_path, host, port):
    root, session = read_session(session_path)
    name = "guardian-probe-" + secrets.token_hex(8) + ".bin"
    payload = secrets.token_bytes(1024)
    with ftplib.FTP() as ftp:
        ftp.connect(host, port, timeout=15)
        ftp.login(session["username"], session["password"])
        ftp.trust_server_pasv_ipv4_address = True  # exercise advertised PASV address
        ftp.storbinary("STOR " + name, io.BytesIO(payload))
    path = root / "incoming" / name
    if not path.is_file() or path.read_bytes() != payload:
        raise ValueError("probe_bytes_not_received")
    path.unlink()
    return {"event": "ftp_probe_passed", "bytesVerified": len(payload), "watchCommandsSent": False}


def run_server(args):
    public_ip = public_port = None
    epsv = True
    if bool(args.control_url) != bool(args.data_url):
        raise ValueError("both_public_endpoints_required")
    if args.data_url:
        chost, _ = endpoint(args.control_url)
        dhost, public_port = endpoint(args.data_url)
        public_ip = socket.gethostbyname(dhost)
        epsv = chost == dhost
    server, _ = make_server(args.session, args.control_port, args.data_port, public_ip, public_port, epsv)
    server.ioloop.call_later(args.minutes * 60, server.close_all)
    emit("ftp_listening", controlPort=args.control_port, dataPort=args.data_port,
         minutes=args.minutes, watchCommandsSent=False, firebaseUploadEnabled=False)
    try:
        server.serve_forever(timeout=0.1, handle_exit=False)
    finally:
        server.close_all()
        emit("ftp_stopped", watchSettingsRestored=False)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--init-dir")
    action.add_argument("--run", action="store_true")
    action.add_argument("--probe", action="store_true")
    action.add_argument("--validate")
    parser.add_argument("--session")
    parser.add_argument("--imei")
    parser.add_argument("--protocol-id")
    parser.add_argument("--control-port", type=int, default=2121)
    parser.add_argument("--data-port", type=int, default=2122)
    parser.add_argument("--control-url")
    parser.add_argument("--data-url")
    parser.add_argument("--minutes", type=int, default=15)
    args = parser.parse_args()
    if args.init_dir:
        emit("ftp_session_prepared", sessionFile=str(new_session(args.init_dir, args.imei or "", args.protocol_id or "")),
             watchCommandsSent=False, networkOpened=False)
    elif args.validate:
        if not Path(args.validate).is_absolute():
            raise ValueError("absolute_image_path_required")
        print(json.dumps(validate_jpeg(args.validate)))
    elif args.probe:
        host, port = endpoint(args.control_url)
        print(json.dumps(probe(args.session, host, port)))
    else:
        if (not 1 <= args.minutes <= 20 or args.control_port == args.data_port
                or any(not 1024 <= p <= 65535 or p in (9000, 9001, 9002, 4040)
                       for p in (args.control_port, args.data_port))):
            raise ValueError("invalid_trial_ports_or_duration")
        run_server(args)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
    except Exception as error:
        emit("ftp_trial_failed", reason=type(error).__name__,
             note="Check dependencies, arguments, new session directory and free ports. No credentials are logged.")
        raise SystemExit(1)
