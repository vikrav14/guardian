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

### Test 2B — callback notification and frozen location pilot

**Recorded firmware result, 24 August 2026:** acknowledged `MOD,0` still
produced the stock **Calling...** screen and a carrier SMS. No call completed,
but the pilot SIM already blocks outbound calls. The watch was restored to
`MOD,1` with acknowledgement. The intended platform-only/no-dialing behavior
is rejected for this firmware; a bare command echo does not prove it.

Do not repeat the old `MOD,0` experiment or try another mode combination as
part of the location test. Custom screen wording/no dialing requires supplier
confirmation and a separate firmware acceptance plan.

The next test is limited to the Guardian notification and callback path:

1. Run the verified callback-SOS PR head with existing watch settings. Confirm
   the gateway and TCP/Meta webhook tunnels are healthy.
2. Privately revalidate the Meta token, approved standard/callback templates,
   intended primary contact and exact callback pilot IMEI/SIM guard. Tell the
   wearer and recipient the test objective and known Calling/SMS limitation.
3. With retained GPS followed by a newer WiFi/LBS observation, press SOS once.
   Confirm one backend critical alert with a top-level `sosLocationSnapshot`.
4. Confirm app receipt and signed Meta `delivered` or `read` evidence. API
   acceptance alone does not prove handset receipt.
5. Confirm the WhatsApp map matches the retained GPS, its wording states the
   GPS age relative to SOS receipt, and the newer estimate is separate.
   The standard map button uses index 0; the callback map button uses index 1.
6. If callback templates are selected, verify **Call watch** reaches the same
   watch. Record ring, answer, two-way audio, carrier charging and any delay
   caused by the stock Calling screen.
7. Obtain a later observation and confirm the prior incident's snapshot/link
   stays unchanged. After the 90-second window, a separate SOS must capture a
   new incident. Repeated packets inside that window must not create duplicates.

Keep PR #109 draft until this evidence is recorded. This test does not accept
platform-only routing or guarantee delivery while the gateway is offline.
See [SOS location details](services/sos-location.md) for the software contract.

#### Recorded callback-SOS evidence — 7 September 2026

Source: operator-supplied output from the read-only pilot inspector, correlated
by alert ID and Meta message ID. Public evidence omits wearer identities, watch
identifiers, phone numbers, message IDs and coordinates. The inspector did not
send a message, issue a watch command or change Firestore.

| SOS event (UTC, 6 September) | Gap from previous listed event | Valid frozen GPS / last known | Stored notification map matches | Notification logs / Meta outcomes | Log delivery and matching delivered/read receipt |
| --- | --- | --- | --- | --- | --- |
| 18:33:38.227 | First listed event | Yes | Yes | 1 / 1 | Yes |
| 18:55:10.883 | 1292.656 seconds | Yes | Yes | 1 / 1 | Yes |
| 19:07:02.569 | 711.686 seconds | Yes | Yes | 1 / 1 | Yes |

All three incidents have a later device observation while their stored GPS map
still agrees with the original notification log. Both later incidents are more
than 90 seconds apart. The matching Meta delivery events are persisted by the
signature-checked webhook path; these results establish more than API acceptance.
There is one recorded notification attempt for each of these three incidents.
This single read does not establish that repeated watch packets were received
and suppressed inside a 90-second window.

Previously accepted on the same private pilot, by the operator's 6 September
handset evidence: app/push receipt, the correct Call watch destination, ringing,
answering, two-way audio and opening the retained GPS map. Preserve those passes;
do not repeat them merely to replace existing evidence.

The fresh-process location check selected retained GPS with an age of 241
minutes, with Wi-Fi recorded separately as the latest observation source. This
verifies the tool's selection on real data. It does not identify the running
gateway revision or prove the text currently received in WhatsApp.

Additional operator evidence supplied on 7 September:

- The SOS screenshot with event time 22:34 shows last-known GPS recorded
  4 hours 9 minutes before SOS receipt, current position unconfirmed, and a
  separate approximate network observation aged one minute with a 519 m radius.
  Call watch and View last known location are visible.
- The ordinary WhatsApp location reply at 22:38 identifies last-known GPS with
  its own recording time and four-hour age, explicitly leaves current position
  unconfirmed, and shows the newer approximate cellular observation separately
  with a one-minute age and 519 m radius. There is one GPS-labelled map link;
  watch check-in and battery-report ages are separate. This accepts the received
  text without claiming a new GPS fix or independently establishing pin accuracy.
- The operator reports staying indoors today with no trip shown. This accepts
  the observed stationary-indoor Journey result. It does not assert deletion of
  the historical raw record or accept a new outdoor departure/return test.
- The gateway excerpt contains two alarm notification blocks with distinct
  outbound message IDs, each with matching delivered/read entries, and an
  ordinary location-query reply between them. No `duplicate packet collapsed`
  entry is present. Surrounding timestamped scheduler entries are at 18:34 and
  18:39 UTC, but the alarm lines themselves have no timestamps. The excerpt does
  not establish the exact interval between physical SOS presses or receipt of
  two SOS packets inside the 90-second window.

Final controlled-pilot follow-up: in response to the question about pressing
SOS twice approximately ten seconds apart and receiving one or two WhatsApp
messages, the operator confirmed **one**. Accept the observed notification-count
result for that controlled test. No `duplicate packet collapsed` trace was
supplied, so this is operator-observed acceptance, not a packet-level capture
proving the number of packets received by the gateway. It does not prove
suppression across gateway restarts or multiple gateway processes.

The requested pilot acceptance checks are now recorded. Preserve the accepted
presentation, indoor Journey, delivery, callback/audio and map results above.
PR #109 can proceed through its final release gates under the operator's
existing merge authorization. The suppression map remains process-local: a
watch reconnect does not clear it, while a gateway restart does.
The stock Calling-screen/carrier-SMS, callback timing, carrier charging and
gateway-offline limitations remain subject to the existing activation gates.
Merging these software changes does not complete customer activation or accept
unrecorded hardware capabilities.

## Private Home Wi-Fi observation — PR #116

Status: near-router recognition passed on one configured V52 pilot and one
owner-selected radio; wider Home-presence acceptance remains pending.
Customer Home presence remains disabled. This adds no new SOS acceptance gate.

After this checkpoint, the operator requested seeing the matched Home radio on
the existing map and location reply while staying near the router. A separately
opt-in private display pilot is implemented in this branch; see
[setup and expiry behavior](services/wifi-home.md#enable-the-private-home-display).
The map, hero and `location?` should agree on the saved Home pin and fresh Home
Wi-Fi evidence, with retained GPS age shown separately. Actual display acceptance
is pending. No nighttime outing is required for this step, and the earlier
observe-only logs below must not be relabelled as display acceptance.

Follow [the private router setup](services/wifi-home.md#run-the-private-check)
with the owner-confirmed 2.4 GHz radio BSSID. No Wi-Fi password is required.
Observe several ordinary report cycles near the router, then record the
redacted `[wifi-home]` lines. A `matched` result means only that the provisional
repeated-router policy passed; it does not establish indoor presence or change
the map. Record weak/missing observations and expiry without describing a
departure that was not verified.

### Recorded near-router result — 7 September 2026 UTC

The operator selected the Home radio from a Windows scan explicitly showing
the 2.4 GHz band, completed private setup, restarted the gateway and supplied
the runtime diagnostics below. Software revision: `8f10265`. Identifiers, keys,
network names and coordinates are omitted from this record.

| UTC time | Match state | Consecutive qualifying reports | Selected-radio signal | Observation age | Total reports / router seen / qualified |
| --- | --- | --- | --- | --- | --- |
| 20:18:41.977 | `candidate` | 1 | -48 dBm | 1 s | 4 / 2 / 2 |
| 20:19:23.945 | `matched` | 3 | -48 dBm | 1 s | 6 / 4 / 4 |
| 20:20:03.039 | `matched` | 5 | -48 dBm | 0 s | 8 / 6 / 6 |
| 20:20:44.924 | `matched` | 7 | -48 dBm | 0 s | 10 / 8 / 8 |

All four snapshots report `configured: true`, `enabled: true`,
`observeOnly: true`, `customerActive: false` and `homeClaim: false`, with zero
ignored-time reports or duplicates. Earlier cellular-only reports interrupted
the first candidate sequence; subsequent repeated Wi-Fi reports reached and
maintained the provisional match. Provider geolocation continued to report an
approximate 519 m radius separately; that radius is not evidence of the radio
match's distance or indoor precision.

**Passed for this sample:** the real pilot watch repeatedly reports the
operator-selected radio with a qualifying signal, and the watch-scoped
fingerprint matches it. No extra Home command or Wi-Fi password was needed for
this passive recognition checkpoint. A radio sighting is not proof of Wi-Fi
association, physical indoor presence, a departure or a return. This record
does not enable the Home map or establish multi-router/firmware reliability.

**Next physical gate:** during a normal outing, keep the gateway running and
observe loss of the selected radio, then renewed evidence after returning.
Record only redacted diagnostics. Missing radio evidence must not be described
as a confirmed departure by itself. Expiry without new packets, router restart,
unknown-router, revocation and stale-GPS return still need acceptance.

Before customer activation, validate true departure/return, router restart,
stale-GPS return, revocation and
unknown-router cases. Actual identifier values, keys and coordinates must not
appear in public evidence. If the passive report is insufficient, investigate
the documented command route without guessing `WIFIFENCE` syntax.

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
