# V52 removal: connection control and acknowledgement capture

This follows the [wearing investigation](v52-temperature-wearing-capability-research-2026-09-15.md).
PR #120 remains draft and unmerged. Wearing interpretation remains unverified.
No device command, customer flag, measurement schedule or acceptance changes.

## Field checkpoint (16 September, Mauritius UTC+4)

| Observation | Evidence and limit |
| --- | --- |
| Alarm received 00:55:03.658 | Bit 20; disconnect 00:57:37.320, 153.662 seconds later |
| Alarm received 01:10:50.621 | Bit 20; disconnect 01:13:24.518, 153.897 seconds later; operator confirmed still off wrist at device time 01:10:47 |
| Both console close records | Peer end, no socket error or local close reason; local peer is the tunnel agent, so watch/carrier/tunnel origin is unresolved |
| Cleanup | `REMOVE,0` sent; bare `REMOVE` reply at 01:21:54.787; this is not an applied-setting readback |
| Overnight | Session ended 03:43:29.944; reconnect 15:36:59.952 matches laptop wake around 15:37; host sleep/network availability confounds the gap |
| Refit | 16:14:52.656; fresh worn packets remain `00000000` |
| OFF-request control removal | 16:47:52.4339287; sensor uncovered, laptop awake |
| Control capture | 16:58:31.576; 11 fresh post-removal `UD_LTE` packets, all `00000000`; no disconnect in retained test window; live helper connected |
| Trace capacity | 12 old entries evicted; the control window is retained |
| Recovery | CR around 16:51:58 and 16:59:58; replies then reports at 16:52:01.858 and 17:00:01.968; reports through 17:02:49.637; no disconnect in console through 17:04:57 |

The control did not reproduce the earlier closure. The alarm-related sequence
remains a candidate cause, not a demonstrated watch or gateway fault. Reporting
pauses occurred both worn and off wrist; they are not TCP disconnections. No
affirmative SMS report was supplied for the OFF control.

Bit 20 is already decoded. The companion example calls bit 3 unused. A removal
alarm establishes a reported event; clearing it cannot establish current wearing.

## Enabled trial with ACK capture (16 September, Mauritius UTC+4)

The operator confirmed the watch remained off wrist throughout the capture.
The supplied private JSONL contains 44 incoming packets, three ACK write records,
and the old socket's end/close records. The Alerts screenshot also shows the
17:47 `bracelet_removed` event. Times below are gateway receipt times except
the operator's removal and OFF request.

| Time | Observation |
| --- | --- |
| 17:46:19.213 | Operator recorded physical removal |
| 17:47:21.277 | Session 1 received `AL_LTE`, state `00100000`, bit 20 set |
| 17:47:21.278 | Bare `AL` ACK local write completed, 1 ms after receipt; no error or backpressure; identity and payload lengths matched |
| 17:47:46.469 | Session 2 was already receiving a heartbeat, 25.192 seconds after the alarm |
| 17:47:49.640 | Session 2 received `UD_LTE`, state `00000000`, while the watch remained off wrist |
| 17:49:54.937 | Session 1 closed after peer end, 153.660 seconds after the alarm; no recorded local close request or socket error |
| 18:00:46.368 | Operator requested `REMOVE,0` cleanup |
| 18:00:48.062 | Session 2 received a bare `REMOVE` reply; helper reported connected |
| 18:01:38.487 | Last supplied packet: session 2 `UD_LTE`, state `00000000` |

This confirms that the gateway attempted and locally completed the expected
ACK; it does not confirm the watch received or accepted it. The later close was
of the **old** socket. A replacement was already reporting, with 128.468 seconds
of overlap in the gateway registry. The trace therefore does not show a
154-second total outage. The reason for the replacement connection remains
unresolved, and the local tunnel peer does not identify who initiated it.

Bit 20 cleared while the operator still had the watch off wrist, across this
session change. Zero cannot mean worn or restored. The app can report the
removal event while present wearing remains unknown. OFF cleanup was requested
and replied to; the bare reply is still not a setting readback. No additional
physical removal cycle is needed to establish these findings.

Review found a separate gateway defect: each socket close unconditionally
cleared the device's live cache, ran disconnect journey/dwell cleanup and, for
a previously live session, scheduled an offline write. An older socket could
therefore invalidate newer live data. The existing connecting grace may suppress
the eventual offline write in this particular trace; its effect on the observed
UI is not established.

The close handler now unregisters the closed socket and retains per-socket
diagnostics and session-scoped wear cleanup. Device-wide disconnect handling
runs only when no other non-destroyed session for the same IMEI remains. Existing
last-session and live-packet threshold behavior is preserved. This fix addresses
the cleanup defect; it does not claim to prevent watch/carrier/tunnel reconnects.

Verification: four overlap regressions failed before the fix. All nine targeted
cases pass after it, including last-session cleanup, connecting replacements,
reverse close order, and destroyed/unidentified/other-device sockets. The focused
gateway run passes 82 tests, including ACK capture, decoding, recovery, trial
command restrictions, SOS dispatch and Home priority.

## Capture behavior

`npm run wear:capture` replaces `npm start` for one diagnostic run. It starts the
normal gateway with a process-local observer for the existing exact
`WIFI_HOME_PILOT_IMEI`. It does not edit `.env` or send an additional command.
Normal ACK, recovery, ingestion and notification behavior remains in place.

Capture expires after 30 minutes or 1,200 event records. Start/end metadata is
additional. Expiry stops capture only: the gateway continues, and no alarm
setting is changed or cleaned up. Private JSONL files are written under
`gateway/data/wear-captures/`; no diagnostic Firestore writes are made.

The trace records:

- Pilot command, receipt/device times, frame lengths, identity match, raw
  tracker-state bits and a session/packet sequence. No wearing inference.
- The actual bare AL ACK frame, write attempt, native return/backpressure,
  write callback result, and synchronous write failure. Bytes are unchanged;
  diagnostics never retry a write or create another ACK.
- Peer end, socket error code, close metadata, byte counts, last incoming data
  and the local idle-close reason. Reconnected sessions remain distinct.

The private file includes the protocol identifier in bare AL ACK frames. It
omits coordinates, cell/Wi-Fi identifiers, SIM and phone data, raw configuration
and health values. Other incoming command names may be recorded as metadata.
This is not a general raw packet dump.

`localWriteCompleted: true` means the local socket write completed.
`deliveryConfirmed` always stays false: this does not prove acceptance by the
tunnel, mobile network or watch. Missing records after expiry, capacity limit,
file failure or abrupt termination mean incomplete evidence. File/logging
failures cannot retry or block the original acknowledgement.

## Operator setup (PowerShell)

Keep ngrok running and the laptop awake; wear the watch. Preserve the previous
console if needed, then stop only the gateway with Ctrl+C. Count this restart as
intentional, not a spontaneous device disconnect. In the existing gateway
directory on `feat/v52-care-wellbeing`:

```powershell
git pull --ff-only
npm run wear:capture
```

The console must show `[wear-capture]` with `status: armed`, `expiresAt`, and
`savedTo`. Keep it running. In a second terminal in the same gateway directory:

```powershell
npm run wear:trial
```

Review the armed line, expiry and connected pilot before the next enabled
trial. Setup sends no REMOVE or REMOVESMS command. Do not run a second gateway
on the same port. A new session can have an empty command-reply history even
though the earlier OFF reply was previously captured.

## Next supervised trial

Proceed step by step once capture is active and the operator is ready. The
comparison is one `REMOVE,1` request, a fresh worn baseline, recorded physical
removal, and the ensuing alarm/ACK/close sequence. Use the existing
`wear:check -- --save=<marker>` alongside capture. Retain physical transition
times separately from device/receipt times. Do not change REMOVESMS, SOS,
recipient settings, reporting intervals or wearing interpretation.

After an alarm, retain the following three minutes of transport evidence: prior
closures occurred about 154 seconds later. Do not exceed ten minutes removed
just to provoke an event. Then refit and request `wear:trial -- --disable` once
a single pilot session is connected. Preserve the reply; it is not proof of
applied OFF. If disconnected, preserve trace/console and complete OFF cleanup
after reconnection. Capture expiry never performs this cleanup.

Review the file together with console recovery/downlink messages and physical
removal/SMS times. A reliable worn-again signal and customer acceptance remain
separate, unresolved requirements.
