# Watch SMS alerts: fixed-off policy

Guardian keeps the watch's carrier SMS alert switch off. There is no app toggle
or configurable on value. This does not change Guardian WhatsApp notifications,
platform SOS/fall processing, contacts, or call settings.

## Supplier reference, 6 October 2026

An operator-controlled AnyTracking comparison on the selected V52 watch used a
transparent relay. The app initially displayed Off; the operator selected On,
saved, then selected Off and saved. That initial display was not watch readback.
Times below are Mauritius time (UTC+4). Identifiers and other payloads are omitted.

| Time | Direction | Prefix | Command | Actual payload bytes |
| --- | --- | --- | --- | --- |
| 14:04:59.967 | Supplier to watch | SG | `SMSONOFF,1` | 10 |
| 14:05:01.228 | Watch to supplier | 3G | `SMSONOFF` | 8 |
| 14:05:12.306 | Supplier to watch | SG | `SMSONOFF,0` | 10 |
| 14:05:12.650 | Watch to supplier | 3G | `SMSONOFF` | 8 |

Supplier protocol section 16 documents this switch, and the communication
examples show the same command. Some generic protocol examples have incorrect
length fields. Guardian computes the length: `000A` for the ten-byte off command,
`0008` for the bare reply, matching the actual traffic.

The operator restored Guardian. The supplier session ended at 14:09:10.937 and
fresh identified Guardian traffic arrived at 14:10:10.480. The relay and its sleep
helper were stopped; only the temporary relay tunnel was removed.

## Runtime behavior

- A new identified connection must provide a valid heartbeat or non-buffered
  location packet. Required replies and alarm processing run independently.
- One fixed `SMSONOFF,0` intent is created for that connection. It is handed to
  the shared command coordinator, with a five-minute expiry and a 30-second
  freshness requirement. Camera work can defer it. CR, calls, emergency handling,
  and explicit stops retain their existing priority.
- Each deferred attempt rechecks identity, expiry, fresh telemetry, and one
  unambiguous matching session. It cannot migrate to another socket. A disconnect
  cancels the pending work; a new connection gets its own freshly evaluated intent.
- After a socket handoff or an uncertain write there is no automatic retry on
  that connection. An expired deferred intent stays expired until reconnect.
  There is no persisted action queue to replay after a process restart.
- The shared sender rejects attempts to enable `SMSONOFF`, including malformed
  variants, even when a caller marks the command as an emergency. Other alert
  switches (`MOD`, `SOSSMS`, `LOWBAT`, etc.) are not guessed or rewritten.
- Admin command-coordination status and metadata-only logs distinguish pending,
  deferred, expired, uncertain, handed-off and reply-observed outcomes. Photo
  command timelines retain the switch's command name without its payload.

## Evidence limits and acceptance

The trace establishes the AnyTracking switch mapping and a bare watch reply.
Neither a write nor that reply proves future suppression, persistence across a
watch reboot, absence of carrier charges, or suppression of every possible SMS
category. The old `MOD,0` trial did not suppress SMS and is not reused as a fix.

During the next operator-triggered SOS/fall check on Guardian, record carrier SMS
receipt separately from platform alarm receipt, initial WhatsApp delivery, calls,
and photo/AI results. Do not generate an alarm just to validate this setting.
No changes to contacts or emergency notification delivery are part of this work.

## Guardian rollout, 6 October 2026

All 1,722 gateway tests passed. With no active or queued incident work and no
remaining ingress observation, the combined local gateway loaded commit
`76aecf2` at 14:24:21 MUT. The original working directory, private environment
and ngrok process/endpoints were preserved, including the photo availability
changes from PR #147.

Fresh watch telemetry created the session intent at 14:24:42.689. The fixed off
command was handed off at 14:24:42.695; its bare reply was observed at
14:24:43.026. Only one SMS-switch downlink was recorded. Further telemetry
arrived and photo/AI worker cycles completed. This verifies the Guardian sender
and reply path, not carrier SMS suppression or reboot persistence. No test alarm,
call or capture was generated during rollout.
