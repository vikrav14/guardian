# V52 captured Auto/Manual trial through Guardian

Status: **operator-only draft PR #115; physical Guardian acceptance pending**.

## What changed on 23 September 2026

The operator supplied all six private records from the successful 21:04 Auto /
21:05 Manual reference run. The hex bytes were decoded and their lengths,
directions, target and order checked. The Auto argument is the configured
guardian number in international `00…` format, matching the previously
reported center/SOS1. The private number and its encoded frame are deliberately
absent from this repository.

| Selection | Exact captured transport and payload structure |
| --- | --- |
| Auto | 3G prefix, length `0013`, `ACALL,<captured guardian number>` (13 ASCII number bytes in this capture) |
| Manual, first | 3G prefix, length `000c`, `APPLOCK,JT-0` |
| Manual, second | 3G prefix, length `0007`, `ACALL,0` |

The Auto call answered with two-way audio; the Manual call kept ringing.
These are operator-confirmed reference-platform results. Bare replies do not
prove applied settings. Auto was tested from the existing reference Manual
configuration, not from a factory-reset watch. The number-bearing argument
suggests caller-specific behavior but does not establish that other callers
cannot auto-connect. Neither a timeout nor an SOS-only selector was captured.

## Implementation boundary

`trial-captured-answer-mode.js` reads the existing six-record private JSONL
file. Preview is read-only. With `--send`, it posts a bounded body to the local
gateway's strictly authenticated `POST /admin/watch-answer-trial` endpoint.
The endpoint is disabled without an administrator credential; it never uses
development-open authentication.

Both sides validate the six-record capture, exact known frame shapes, lengths,
directions, order and one protocol ID. This is a narrow replay for this
capture format, not a raw-command API. The Auto number comes from the file;
it is never supplied on the command line, reconstructed from a guessed mapping
or placed in a query string. No private file is committed or uploaded by the
script.

The gateway requires a live session whose reported full IMEI and protocol ID
match the request and capture. It requires a packet within two minutes and
chooses the freshest eligible socket. It does not infer protocol ID from IMEI
or broadcast the transition over duplicate sessions. Manual's two frames are
written together, in the captured order, without inventing an inter-command
delay. TCP write completion is not device execution or an atomic firmware
transaction; uncertainty is never automatically retried.

Responses contain a sequence digest for local byte verification, not the
frames or number. CLI output, routine logs and audit data exclude the private
argument and frame hex. ACALL replies are recognized without another ACK,
preventing an echo loop, and generic downlink log formatting redacts ACALL.

No Flutter control, queued customer command, contact provisioning, SMS fallback,
SOS automation or automatic expiry is added. The older APPLOCK-only
`trial-answer-mode.js` remains a historical diagnostic; **do not use it to
restore Manual after this trial**.

## Windows: update and test on the Guardian route

Leave ngrok running. Keep the watch on the current working Guardian route;
another AnyTracking comparison is not required. Use the watch beside the
operator and the same approved caller used in the reference test.

In a separate PowerShell window:

```powershell
cd C:\Users\MSI\repos\guardian
git status --short
git switch feat/v52-watch-modes
if ($LASTEXITCODE -ne 0) { throw 'Branch switch failed; stop here.' }
git pull --ff-only origin feat/v52-watch-modes
if ($LASTEXITCODE -ne 0) { throw 'Pull failed; stop here.' }
```

Preserve the unrelated untracked `gateway/defimedia-news-review.txt`.
Stop the existing gateway with Ctrl+C in its own window and restart it:

```powershell
cd C:\Users\MSI\repos\guardian\gateway
npm start
```

Wait for fresh identified watch telemetry. In the separate PowerShell window,
preview the capture; this sends nothing:

```powershell
cd C:\Users\MSI\repos\guardian\gateway
node scripts/trial-captured-answer-mode.js --imei 861397052547492 --mode auto --capture-file "$env:TEMP\guardian-answer-private-20260923-210251-301.jsonl"
```

Then request Auto:

```powershell
node scripts/trial-captured-answer-mode.js --imei 861397052547492 --mode auto --capture-file "$env:TEMP\guardian-answer-private-20260923-210251-301.jsonl" --send
```

If the result is `socket_handoff`, call from the same approved number, leave
the watch untouched, and record automatic answering and audio both ways.
End the call before requesting Manual:

```powershell
node scripts/trial-captured-answer-mode.js --imei 861397052547492 --mode manual --capture-file "$env:TEMP\guardian-answer-private-20260923-210251-301.jsonl" --send
```

Call again. Verify it waits for a tap and that audio works after answering.
Record both mode results and times, including any watch indication. Leave it
in physically verified Manual after the trial. Do not re-enable Auto if Manual
restoration fails. The existing reference-platform Manual sequence remains the
known restoration path if Guardian cannot perform it.

- `preview`: nothing sent.
- `not_sent / no_fresh_identified_session`: wait for a fresh identified gateway
  session; no command was queued.
- `capture_device_mismatch`: stop and check device identity.
- `handoff_unknown`: the setting may have reached the watch; do not blindly
  repeat Auto. Inspect the watch and restore/test Manual deliberately.
- `appliedStateVerified:false`: expected even after a handoff. Record the
  physical result separately; software does not observe the voice call.

If the file is unavailable, preserve any other private capture copies and
report that result. Do not guess the number or fabricate a replacement JSONL.

## Validation and next gates

The full gateway suite passes **1,306/1,306**, including nine new tests covering
exact bytes through authenticated HTTP and real TCP, wrong/malformed captures,
session identity and freshness, duplicate sessions, no retry after uncertainty,
privacy, preview and ACALL reply handling. Existing APPLOCK framing remains
unchanged.

Still required: physical Auto and Manual transitions generated by Guardian;
caller exclusivity and existing unknown-caller rejection; persistence/restart
behavior; eventual supervised SOS callback and offline restoration tests.
The [app/SOS proposal](../services/watch-answer-sos-design.md) remains a
separate design. Do not market guaranteed SOS-only automatic answering yet.

