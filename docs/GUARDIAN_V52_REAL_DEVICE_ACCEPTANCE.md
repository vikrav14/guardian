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
| Meta API `wamid` / `deliveryStatus=accepted` | Meta accepted Guardian's request. | Handset delivery or reading. |
| Meta webhook `deliveryStatus=delivered` | Meta confirmed delivery to the recipient device. | That the recipient read or acted on it. |
| Meta webhook `deliveryStatus=read` | Meta reported the message read. | That the recipient acted on it. |
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
3. Confirm the alert is persisted and its notification log contains a Meta `wamid`.
4. Require a signed Meta webhook receipt with `deliveryStatus=delivered` or `read` for every configured WhatsApp recipient.
5. Confirm no duplicate arrives during the 90-second wearer-SOS incident
   window. A new press after that window must still create a new incident.

Pass: one real device event and no duplicate. Essential requires
Meta-confirmed WhatsApp delivery to its one primary emergency contact. Family
and Care require delivery to every configured WhatsApp recipient. API
acceptance alone is Partial, not Passed. Essential does not inherit fall,
routine, assistant, AI, or command WhatsApp capabilities from this SOS gate.

### Test 2B — no-call SOS callback pilot

This test changes emergency behaviour. Tell every recipient first, keep the
watch and guardian phone together, and choose a documented restoration mode
before starting. The protocol has no mode read-back, so if the current mode is
unknown, confirm the intended restore value with the supplier before testing.

1. With a live V52 TCP session, enqueue `set_alarm_mode` with mode `0`
   (platform only). Mode `3` is the separate platform+backup-SMS, no-call
   option. The guarded operator command is:

   ```powershell
   npm run sos:alarm-mode -- --imei <15-digit-hardware-imei> --mode 0 --confirm CHANGE_SOS_MODE
   ```
2. Treat `deviceCommands.status=sent` only as socket handoff. Press SOS once
   and confirm the V52 actually sends one Guardian `sos` event without placing
   a carrier call. For mode `0`, also confirm it sends no carrier SMS.
3. Photograph or record the exact watch screen. The protocol has no display
   text command, so do not claim Guardian changed `Calling...` to `SOS sent`
   unless the real firmware shows it.
4. Require the approved callback WhatsApp template, signed Meta delivery, and
   a `Call watch` button that rings this watch - never another device. Essential
   now includes SOS-only WhatsApp, but the callback template still requires the
   exact private pilot IMEI and SIM match because Meta fixes the phone number in
   the approved button.
5. For fresh/last-known location, require the map button at template index 1
   and verify it opens the correct event location.
6. Hold one short two-way call initiated by the guardian. Record ring, answer,
   two-way audio and carrier charge behaviour.
7. Stop the gateway and document the failure mode. Platform-only SOS cannot be
   marketed as an offline voice fallback.
8. Restore the previous alarm mode immediately if any event, notification,
   button destination or call result is wrong.

Pass: the physical V52 emits one SOS event, makes no automatic call, the correct
guardian receives one Meta-confirmed notification, `Call watch` reaches the
same V52, and all screen/offline limitations are disclosed. Only after this
pass may the private pilot IMEI and SIM settings be enabled in deployment.

## Test 3 — approved incoming family calls

Guardian's current Machine 500 MB SIM does not permit outbound carrier calls.
The supported direction is an approved guardian calling the watch; after the
wearer answers, audio is two-way.

1. Provision an approved number through `npm run phonebook:provision`.
2. Confirm the entry appears, then reboot and confirm it persists.
3. Call the watch from the approved number and hold a short conversation.
4. Call from an unknown number and confirm the watch does not ring.
5. Repeat the approved call with the gateway stopped. Voice should remain a
   carrier function when cellular voice coverage is available.
6. Record date, firmware, SIM package, ring result, two-way audio and carrier
   charging without recording the contact number in GitHub.

Pass: approved incoming call rings, unknown caller is blocked, and both sides
can hear and speak clearly after answer. Outbound `CALL`, watch dial-pad calls
and wearer-originated phonebook calls are not part of the Guardian promise.

Pilot result, 22 August 2026: passed on one physical V52, including persistence
after reboot. Repeat on a second production-equivalent watch/SIM before
customer activation.

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
4. Confirm one real `fall` alert with a versioned event-time
   `payload.locationSnapshot` and configured delivery outcomes.
5. Move the watch after the event and confirm the alert/template still uses the
   frozen event-time coordinates, place and freshness classification.
6. Confirm Meta selects `guardian_fall_alert_v1`,
   `guardian_fall_last_location_v1`, or `guardian_fall_unavailable_v1` from
   that snapshot. Only the first two may contain a dynamic map button.
7. Require a signed Meta `delivered` or `read` receipt for every configured
   WhatsApp recipient.
8. Confirm ordinary handling does not create repeated false alarms during observation.

Pass: configuration dispatch, one real V52 fall event, immutable event-time
location evidence, honest template selection, and Meta-confirmed delivery.
Command `sent` alone is insufficient because this flow has no read-back
acknowledgement.

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
