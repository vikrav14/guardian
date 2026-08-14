# Guardian V52 real-device acceptance

**Status:** Release gate
**Device under test:** One production-equivalent V52 watch and SIM
**Rule:** Unit tests prove code paths. This runbook proves what the real watch, carrier and configured notification providers actually do.

## Evidence semantics

Guardian must not collapse different forms of evidence into one green label:

| Evidence | What it proves | What it does not prove |
|---|---|---|
| Fresh backend heartbeat | The watch has a live data session with the gateway. | GPS freshness, voice service or alert delivery. |
| `gps=A` retained satellite observation | The V52 reported a valid satellite fix. | A numerical metre-level accuracy when the packet supplies no accuracy radius. |
| `deviceCommands.status=sent`, channel `tcp` | Guardian handed the command to the live watch socket. | The wearer saw, heard or acknowledged it. |
| `alerts.notifyStatus=sent` | Gateway notification work completed. | That a recipient read it; inspect channel outcomes as well. |
| Successful carrier call | Audio worked for that real call in both directions. | Anything in Guardian's backend; normal carrier calls bypass it. |

The read-only collector is:

```powershell
cd "C:\Users\MSI\repos\guardian\gateway"
node .\scripts\inspect-device-acceptance.js --imei YOUR_DEVICE_IMEI --since 24h
```

Use a precise UTC start time for a formal run:

```powershell
node .\scripts\inspect-device-acceptance.js `
  --imei YOUR_DEVICE_IMEI `
  --since "2026-08-15T08:00:00Z"
```

The collector reads Firestore and prints a redacted JSON verdict. It sends no watch command, writes no production data and never makes a release decision by itself.

## Prerequisites

1. Start `ngrok tcp 9000`.
2. Start the gateway with `npm start`.
3. If ngrok changed, send the new `ip,{host},{port}#` SMS to the watch.
4. Wait for the gateway to log a TCP connection and fresh heartbeat.
5. Start the Flutter app and confirm the watch check-in clock is current.
6. Record the acceptance start time in UTC and plan under test.
7. Use a dedicated test contact and inform everyone who may receive an alert.

## Test 1 — location and indoor retention

1. Take the watch outdoors and request a fresh fix with `send-cr.js`.
2. Require gateway evidence `source=gps gps=A`.
3. Return indoors and request another update.
4. Require a newer WiFi/LBS observation with its estimated radius, while the prior satellite fix remains separately retained.
5. Confirm the UI says it is showing the last satellite fix and discloses the newer approximate observation.

Pass: backend inspector `ok:true`, no inherited WiFi radius on the satellite record, and honest UI wording. Numerical satellite precision remains unproven until measured against a known reference point.

## Test 2 — SOS

This is a controlled test, not an emergency-services test. Tell recipients first. Do not imply Guardian contacted emergency services.

1. Trigger SOS on the physical watch exactly once.
2. Confirm one backend `sos` alert appears with critical severity.
3. Confirm `notifyStatus=sent` and inspect notification-log channel outcomes.
4. Confirm every configured Essential channel receives the expected message once.
5. Confirm no duplicate arrives during the suppression window.

Pass: one real device event, completed configured fan-out and no duplicate. A plan-excluded WhatsApp channel may be skipped for Essential only when an advertised Essential channel is configured and delivered.

## Test 3 — calls

1. From the Guardian app, call the watch and hold a short two-way conversation.
2. From the watch, call the configured guardian/SOS number and hold a short two-way conversation.
3. Repeat once with the gateway stopped. Voice should remain a carrier function when cellular voice coverage is available.
4. Record date, direction, ring result, two-way audio and any carrier charge.

Pass: both directions work on the target SIM/carrier and failure copy is accurate. These calls do not use the watch's 500MB data allowance; normal carrier voice charges may apply.

## Test 4 — safe zones

1. Use a real zone large enough for current location-source uncertainty.
2. Begin clearly inside it, then walk well outside the boundary.
3. Wait for a `geofence_exit` alert and delivery.
4. Return clearly inside and wait for `geofence_enter` and delivery.
5. Remain near the boundary long enough to ensure jitter does not create repeated transitions.
6. Repeat an exit while the gateway is unavailable, reconnect, and document what is recoverable.

Pass: one real exit and enter, completed notification handling, bounded jitter and honest offline behavior.

## Test 5 — battery alert

1. Record a fresh battery percentage from the real watch.
2. Let the watch cross the configured low-battery threshold naturally; do not edit Firestore to fake acceptance.
3. Confirm one `low_battery` alert, its freshness and notification outcome.
4. Keep the device below threshold through multiple heartbeats and confirm policy-window suppression.

Pass: a real threshold crossing, one alert per policy window, and no stale percentage described as current.

## Test 6 — fall detection

Only perform a manufacturer-approved safe test. Never ask a person to fall.

1. On Guardian Care, enable fall detection and choose the intended sensitivity.
2. Confirm the related command is `sent` over TCP while the watch is connected.
3. Use the vendor-approved method with the watch secured to an object, not a wearer.
4. Confirm one real `fall` alert and configured delivery outcomes.
5. Confirm ordinary handling does not create repeated false alarms during observation.

Pass: configuration dispatch plus a real device fall event and delivery. Command `sent` alone is insufficient because this flow has no read-back acknowledgement.

## Test 7 — medication reminder

Medication reminders are Guardian Care only.

1. Create a reminder two or more minutes ahead using the app or confirmed WhatsApp action.
2. Confirm one canonical `medicationReminders` record and one `set_medication_reminder` command.
3. Confirm the command reaches `sent` over TCP.
4. Observe whether the watch displays/sounds the reminder at the expected local time.
5. Confirm the guardian reminder's actual delivery outcome.

Pass for the current product: canonical record, TCP dispatch, watch presentation and guardian delivery. Wearer acknowledgement is **not implemented/proven** by the current V52 protocol, so marketing must not promise it until a separate end-to-end mechanism exists.

## Final collection

Rerun the collector with the recorded UTC start time. The evidence pack includes collector JSON, factual UI screenshots, redacted gateway excerpts, the manual call table, carrier/SIM and firmware versions, failures, retries and exact timestamps.

`releaseReady` remains false in the collector by design. Release also requires PR checks, Meta acceptance, Android smoke testing, billing lifecycle, privacy/retention review and resolution or rewording of every Partial/Not implemented promise in the service matrix.
