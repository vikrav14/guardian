"""Real local FTP transfers through two TCP proxies; no watch/cloud access."""
import ftplib
import io
import json
from pathlib import Path
import socket
import socketserver
import tempfile
import threading
import time
from PIL import Image
from photo_ftp_receiver import MAX_BYTES, make_server, new_session, probe, read_session


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def tunnel(target):
    class Relay(socketserver.BaseRequestHandler):
        def handle(self):
            with socket.create_connection(("127.0.0.1", target), timeout=5) as upstream:
                upstream.settimeout(None)

                def copy(src, dst):
                    try:
                        while data := src.recv(8192):
                            dst.sendall(data)
                    except OSError:
                        pass
                    finally:
                        try:
                            dst.shutdown(socket.SHUT_WR)
                        except OSError:
                            pass
                thread = threading.Thread(target=copy, args=(self.request, upstream), daemon=True)
                thread.start()
                copy(upstream, self.request)
                thread.join(2)
    class Server(socketserver.ThreadingTCPServer):
        daemon_threads = True
        allow_reuse_address = True
    server = Server(("127.0.0.1", 0), Relay)
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True)
    thread.start()
    return server, thread


def self_test():
    checks, events = [], []
    with tempfile.TemporaryDirectory(prefix="guardian-ftp-check-") as directory:
        session_path = new_session(Path(directory) / "trial", "861397052547492", "9705254749")
        root, session = read_session(session_path)
        try:
            new_session(root, session["imei"], session["protocolId"])
            raise AssertionError("existing_directory_reused")
        except FileExistsError:
            checks.append("new_private_directory_only")
        control, data = free_port(), free_port()
        while data == control:
            data = free_port()
        control_tunnel, ct = tunnel(control)
        data_tunnel, dt = tunnel(data)
        server, state = make_server(session_path, control, data, "127.0.0.1",
                                    data_tunnel.server_address[1], report=lambda name, **kw: events.append((name, kw)))
        stopped = threading.Event()

        def serve():
            while not stopped.is_set():
                server.serve_forever(timeout=0.02, blocking=False, handle_exit=False)
            server.close_all()
        worker = threading.Thread(target=serve, daemon=True)
        worker.start()

        def connect(password=None):
            ftp = ftplib.FTP(timeout=5)
            ftp.connect("127.0.0.1", control_tunnel.server_address[1])
            ftp.login(session["username"], password or session["password"])
            ftp.trust_server_pasv_ipv4_address = True
            return ftp

        try:
            assert probe(session_path, "127.0.0.1", control_tunnel.server_address[1])["bytesVerified"] == 1024
            checks.append("control_and_passive_data_forwarding_byte_exact")
            with ftplib.FTP(timeout=5) as bad:
                bad.connect("127.0.0.1", control_tunnel.server_address[1])
                try:
                    bad.login("anonymous", "invalid")
                    raise AssertionError("anonymous_allowed")
                except ftplib.error_perm:
                    checks.append("anonymous_rejected")
            image = io.BytesIO()
            Image.new("RGB", (32, 24), (40, 170, 110)).save(image, "JPEG")
            jpeg = image.getvalue()
            filename = "9705254749_20260924223000.JPG"
            with connect() as ftp:
                response = ftp.sendcmd("EPSV")
                assert f"|||{data_tunnel.server_address[1]}|" in response
                checks.append("epsv_advertises_public_data_port")
                ftp.storbinary("STOR " + filename, io.BytesIO(jpeg))
                for _ in range(100):
                    if state["accepted"]:
                        break
                    time.sleep(0.01)
                assert state["accepted"][0]["width"] == 32
                assert (root / "incoming" / filename).read_bytes() == jpeg
                checks.append("jpeg_fully_decoded_and_receipt_written")
                for command in ["RETR " + filename, "DELE " + filename, "LIST", "PORT 127,0,0,1,12,34",
                                "STOR ../escape.JPG", "STOR 9999999999_20260924223000.JPG",
                                "STOR " + filename]:
                    try:
                        ftp.sendcmd(command)
                        raise AssertionError("unsafe_command_accepted: " + command)
                    except ftplib.error_perm:
                        pass
                checks.append("read_delete_list_active_traversal_wrong_identity_overwrite_denied")
                ftp.storbinary("STOR 9705254749_20260924223001.JPG", io.BytesIO(b"not a photo"))
                for _ in range(100):
                    if state["rejected"]:
                        break
                    time.sleep(0.01)
                assert not (root / "incoming" / "9705254749_20260924223001.JPG").exists()
                checks.append("invalid_image_removed_despite_ftp_transfer_completion")
            with connect() as ftp:
                try:
                    ftp.storbinary("STOR 9705254749_20260924223002.JPG", io.BytesIO(b"x" * (MAX_BYTES + 1)))
                except (ftplib.Error, OSError):
                    pass
            for _ in range(100):
                if not (root / "incoming" / "9705254749_20260924223002.JPG").exists():
                    break
                time.sleep(0.01)
            assert not (root / "incoming" / "9705254749_20260924223002.JPG").exists()
            checks.append("oversize_upload_removed")
            logged = json.dumps(events)
            assert session["password"] not in logged and session["username"] not in logged
            checks.append("credentials_excluded_from_events")
        finally:
            stopped.set()
            worker.join(5)
            server.close_all()
            for proxy, thread in [(control_tunnel, ct), (data_tunnel, dt)]:
                proxy.shutdown()
                proxy.server_close()
                thread.join(2)
    return {"event": "ftp_self_test_passed", "checks": checks, "watchCommandsSent": False,
            "firebaseWrites": 0, "ngrokChanges": 0}


if __name__ == "__main__":
    print(json.dumps(self_test()))
