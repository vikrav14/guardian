# V52 worn-only capture before protocol decoding

## Why this is needed

The operator asked whether every incoming packet was being checked while the
watch is currently on the wrist. The previous receipt census records every
**successfully decoded command**, but skips decoder errors and does not retain
complete payloads. The sensor capture retains only `bphrt` and `oxygen`. Neither
alone is a complete raw receive trace. The repeat's 1,727-byte closed-session
accounting covers that session only; the uploaded copy ended at 21:39 Mauritius.

`npm run wear:wire-capture` adds an opt-in observer at the start of the gateway's
TCP data callback, before `extractFrames` and `decodeFrame`. It retains bytes
that the parser may discard or reject, unknown commands and their arguments,
binary bytes, coalesced frames and unfinished fragments. The observer adds no
watch requests, settings changes, ACKs, customer-state writes or wearing claims.
Existing gateway behaviour continues, including its normal ACKs and schedules.

This closes a diagnostic coverage gap. It does not yet establish a positive
wearing signal or prove the dashboard requirement complete.

## Field result: 16 September, 22:30:59–22:35:59 Mauritius

The operator supplied the capture and accompanying gateway console after reporting
the watch on the wrist. This is the requested worn-only baseline; the file does
not itself prove physical skin contact. The last requested removal setting was
OFF, with no setting readback established and no new command requested for this run.

Independent review decoded every base64 chunk, validated its byte length and
contiguous offset, rebuilt the session stream, then parsed each frame using its
header's declared payload length. This reconstruction did not call Guardian's
production `extractFrames` or `decodeFrame`. It consumed all 732 bytes, including
the two initial handshake frames, and matched the capture and socket counters.

| Check | Result |
| --- | --- |
| Window UTC | 18:30:59.828–18:35:59.832; timed window complete |
| First received data UTC | 18:31:18.061; socket byte count starts at 0 |
| Observed / saved / socket bytes | 732 / 732 / 732 |
| Chunks / independently reconstructed frames | 7 / 7 |
| Commands | 2 LK, 1 TKQ, 4 UD_LTE |
| Capture drops / unobserved socket bytes | 0 / 0 |
| Unidentified / excluded / untracked sessions | 0 / 0 / 0 |
| Invalid headers or lengths / unconsumed bytes | 0 / 0 |
| Disconnect or identity change in the window | None recorded |
| All four fixed-field tracker states | `00000000`; no set status/alarm bits |

The four UD_LTE packets were received at **22:31:55.848, 22:32:57.721,
22:33:59.612 and 22:35:01.557 Mauritius**. Their device observation times were
22:31:53, 22:32:55, 22:33:57 and 22:34:59. Each is 160 bytes, declares a 139-byte
payload and has 28 arguments. The state is at argument 15, not an inferred tail
position. Arguments 16–27 fit the existing cell/Wi-Fi/accuracy layout; no extra
trailing field or separate unhandled command appears. LK has three arguments;
TKQ has none. No optical measurement or CONFIG packet arrived in this window.

**Conclusion:** for this complete baseline, the gateway did not lose or filter
out an incoming bit-3 wearing report. The watch sent zero in that bit in every
status packet received while the operator reported wearing it. Every received
frame is accounted for; no additional contact message was hidden by decoding.
This does not prove that the firmware cannot expose contact under a different
supported setting/query, or that no such message could arrive outside this
window. It also cannot observe packets that never reached the gateway.

The next useful step is the [exact-firmware contact question](v52-current-contact-firmware-request-2026-09-16.md),
now including this result, asking whether bit 3 is implemented and what supported
configuration/query provides current contact and restoration. Another unchanged
passive capture or identical removal-alarm trial has no defined new hypothesis.
The gateway continued reporting after capture expiry; no cleanup command or
restart is needed. Automatic current-wearing acceptance remains open.

Private source references (raw payloads are not committed):

- `1789583459828-63be5b34-84c8-4ea1-b9a3-10106177ca3c.jsonl`
- `Pasted text(20260916-183751).txt`
- Capture file SHA-256:
  `cddc8f1006ce1503c794db48c972b4178412fb914bf30751f9046999fe206bd1`
- Reconstructed stream SHA-256:
  `b4d9cc0464b47ca861548a0c6925cf9d5c543e31f53d8a680066021396e4e0cf`

## Run procedure (completed for the baseline above)

Keep the watch fastened on the wrist for the capture. Keep the laptop awake and
ngrok running. Leave the removal setting at its last requested OFF state; do not
run another removal trial for this investigation.

1. In the terminal running the gateway, press **Ctrl+C once**. This capture is a
   replacement gateway process, not a second program alongside `npm start`.
2. Update and start that one gateway:

   ```powershell
   cd C:\Users\MSI\repos\guardian
   git pull --ff-only
   cd gateway
   npm run wear:wire-capture
   ```

3. Keep wearing the watch until `[wear-wire-capture]` reports `status:"finished"`
   after five minutes. Capture ends automatically; **the gateway continues**.
4. Send the `.jsonl` file at the `savedTo` path printed for this run, plus the
   completion line. It is under `gateway/data/wear-wire-captures/`. No separate
   `wear:trial`, enable/disable command, manual sensor request or Flutter restart
   is needed for this passive baseline.

Do not remove the journey-journal lock or kill unrelated Node processes. If
another gateway owns the lock, stop its terminal before starting the capture.
An `armed` line followed by a startup error is not a successful capture.

## Scope, identity, consent and limits

- Captures incoming bytes **received by this gateway**, not radio traffic or
  packets that never reach the tunnel/gateway. TCP chunks are not individual
  protocol packets. Reassemble by session and byte offset before decoding.
- A bounded in-memory prefix preserves the first fragment before the existing
  gateway has resolved the device identity. Only the configured exact
  `WIFI_HOME_PILOT_IMEI` can have raw bytes written. Unidentified/other-device
  prefixes are discarded. Identity changes exclude queued and subsequent raw
  writes for that socket. Identity attribution uses the existing gateway
  session mapping; it does not introduce device authentication.
- Requires existing wellbeing ingestion, Firestore and backend-managed wearer
  consent. Consent is checked before every raw write, including after an async
  read. Missing/revoked/expired consent saves no raw bytes; the summary records
  the gap. A read has a three-second timeout and never blocks the TCP callback.
- Five-minute input window; at most 256 KiB retained input, 512 chunks and 16
  candidate sessions across the run. These bounds include queued work and
  unidentified prefixes. Limit drops are counted; no silent truncation occurs.
- Each `tcp_chunk` stores receipt time, session, stream offset, byte length and
  lossless base64 bytes. Raw data can include location, health, device IDs and
  other complete payloads. It stays in a private local file (mode 0600 where
  supported), under the existing ignored `gateway/data/` directory. Do not add
  the file to GitHub or ordinary gateway logs. No raw data is written to Firestore.
- The final `capture_finished` record contains counters, gap reasons and socket
  byte reconciliation per identified pilot session. It also reports unidentified,
  excluded and untracked sessions. `completeForIdentifiedSessions` is scoped to
  those identified sessions, not an assertion that no other device traffic or
  unidentifiable watch connection existed. A missing final record means an
  incomplete file, even when its last saved chunk looks normal.
- `windowComplete` describes whether the timed window finished; byte coverage
  is separate. Inspect `completeForIdentifiedSessions`, all session drop reasons,
  unidentified/untracked session counts and socket byte differences before
  interpreting silence. No identified pilot session is an inconclusive run.

## Review and validation

Reconstruct the stream without relying on the production frame parser, enumerate
valid and rejected frames, and inspect full payloads for an unhandled current
contact or return-to-wrist field. Preserve uncertainty about undocumented fields.
Any candidate needs an exact-watch on/off comparison before enabling a customer
wearing claim. The earlier zero-state counterexample still rules out treating
the absence of a removal event as current wearing.

Local validation: 64 focused tests pass across byte capture, existing receipt
capture, optical capture, wearing evidence, V52 LTE parsing and session overlap.
New tests reconstruct the original bytes across fragmentation, coalescing,
malformed length, unknown commands, binary noise and an incomplete frame. They
compare normal decoded events/ACKs with capture disabled, cover prefix identity,
consent revocation and failure, resource limits, expiry, immutable buffers, file
permissions, socket byte gaps and multiple sessions. Synthetic inputs do not
establish a real hardware wearing signal.

QA/Wiki mirror: document the new diagnostic command and the remaining automatic
wearing gap. Direct Wiki editing is unavailable in this workspace; this repository
runbook is the reviewable source for the pending mirror update.
