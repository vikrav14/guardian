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

### Retained Home and gateway restart passed on one pilot — 13 September 2026 UTC

- [x] Fresh repeated Home-router observations selected Home in the actual app.
- [x] Fresh evidence expired while `lastHomeDetection.observedAt` remained
  `2026-09-13T21:15:08.000Z`.
- [x] The app showed **Last detected at Home · 4m ago**, retained the Home pin
  and explicitly marked current presence unconfirmed.
- [x] After a gateway restart, a ready binding restored the same historical
  timestamp with `publishedHomeFresh: false` and no new observation.
- [ ] Confirm watch reconnection and app presentation after restart; the supplied
  checker still had `sessionConnected: false` and no post-restart screenshot.
- [ ] Perform actual departure/return and measure the first usable GPS report,
  displayed GPS precedence, and journey/zone behavior.
- [ ] Verify ordinary WhatsApp and location-details historical presentation.
- [ ] Exercise a real binding-read timeout/recovery; this run had zero timeouts.

Evidence is operator-supplied from the post-update run instructed against `e9cad97`;
new diagnostics are present, but a new `git HEAD` output was not supplied.
[Redacted checker and screenshot record](testing/wifi-home-retention-2026-09-13.json).
The operator deferred outdoor testing because it was late. PR #116 remains draft;
continuous reporting, native fencing and battery impact are not accepted.

### Stationary Home display and expiry reproduced — 13 September 2026 UTC

The operator remained at Home on checkout `1453738`. A pending Home binding read
lasted 70,431 seconds. Restart plus one requested reporting burst restored the
Home label in the actual app. Seven qualified router sightings (latest -48 dBm)
were recorded; the last source time was 20:11:49 UTC with radio expiry 20:13:49 UTC.
The subsequent untimestamped clear reports `observation_expired`, and the app
returned to a day-old GPS label. This passes fresh Home recognition/display for
one watch/router window and reproduces the stationary continuity defect.

This earlier capture predates the historical Home update. The later checkpoint
above accepts stationary historical display and gateway restoration only; real
binding failure recovery remains open. Follow the [current check](services/wifi-home.md#next-device-check-for-remembered-home).
Continuous fresh Home, actual departure/return, native fence semantics and battery
impact remain unaccepted. [Redacted evidence](testing/wifi-home-expiry-2026-09-13.json).

Earlier checkpoints below retain their original scope.


**Current v4 correction:** the operator rejected the v3 conflict screenshot and
requested Home-router priority over GPS A/V. Fresh qualified radio plus the
verified saved Home binding now selects Home across the app and ordinary chat.
The same decision holds GPS-derived dwell, journeys and Home/School transitions.
An open route stops at its last measured endpoint without an invented GPS return;
Home seeds a quiet baseline. Expiry alone creates no departure; new fresh GPS
resumes normal movement evaluation without an indoor-to-outdoor route bridge.
The Home/School pins and radii, raw history, incident snapshots, reporting
intervals and hardware settings retain their existing contracts.

Home remains bounded by radio freshness and the verified owner/plan lease.
Stationary reporting gaps and native WIFIFENCE acceptance are still open.
Software gates do not establish physical presence or fence acceptance. Follow
the [v4 device check](services/wifi-home-supplier-validation.md#next-device-check-for-v4)
with both gateway and Flutter updated. PR #116 remains a private draft pilot.

**Historical v3 correction (superseded by v4):** the operator confirmed the saved Home pin is correct
(Home 50 m; School 150 m). A usable Home renewal at 20:56:44.931 UTC on 11 September
was cleared at 20:56:47.979 with `gps_outside_home`, before its 20:57:26.672 expiry.
The later radio expiry is separate. V3 preserves fresh router evidence as a
bounded conflict with **Location uncertain** across app and ordinary WhatsApp;
it cannot select Home or create a geofence/Journey event. Both zones coexist;
no boundary or hardware setting is changed. The actual GPS error/distance was
not provided. See the [current evidence and next check](services/wifi-home-supplier-validation.md#fresh-routergps-disagreement--11-september-2026-utc).
Live conflict display, expiry, departure/return and continuous Home remain open.


**Historical v2 software checkpoint, 11 September 2026 UTC:** the operator-authorized
v2 Home/GPS integration is implemented. GPS at the saved Home area no longer
erases fresh radio evidence; conflicting/uncertain fresh GPS prevents the Home
pin. GPS/heartbeats/empty scans cannot renew radio expiry. Both gateway/chat and
Flutter use the versioned contract with shared fixtures. The local gateway suite
passes **810/810**, including decoder/runtime, delayed-write, SOS and journey
regressions. Release gates on the published commit and physical app/map/chat,
departure/return and expiry acceptance remain required. Follow the
[updated physical check](services/wifi-home-supplier-validation.md#next-physical-check-after-the-update)
after updating both gateway and app from PR #116. This software result does not
upgrade native fencing or continuous Home to accepted.

The entries below preserve the earlier hardware and software checkpoints; their
old GPS-priority behavior and next-step instructions are historical.

Status: near-router recognition and a usable backend Home publication passed
on one configured V52 pilot and one owner-selected radio. Subsequent app and
WhatsApp screenshots show retained GPS after the reported radio evidence expired.
Stationary report acquisition is an observed gap; fresh Home visual agreement
and wider Home-presence acceptance remain pending.
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

### Display diagnosis — 7 September 2026, 21:08–21:13 UTC

The operator enabled the display pilot on revision `4815f5a`. Both the app and
ordinary WhatsApp reply still showed retained GPS. Gateway diagnostics confirmed
`displayEnabled: true` with the saved Home binding passing. One initial -48 dBm
router observation expired during a three-minute packet gap, as intended.

Subsequent -48 dBm Home sightings alternated with cellular-only packets. The
observer reset the candidate on each `no_wifi_evidence` packet, so repeated
positive sightings never reached the display threshold. This was a policy bug:
an LBS-only frame carries no new router observation, not a conflicting scan.

The correction preserves recent router evidence across canonical cellular-only
frames without adding matches or refreshing radio time/expiry. A synthetic
replay through the real decoder, observer, publisher and ordinary location
formatter also exposed and corrected a brief display lease gap between valid
reports. Verified Home/owner/plan leases may renew within the original radio
lifetime; they cannot extend that lifetime. Unknown/weak Wi-Fi and newer GPS
still clear Home, and old evidence still expires.

This records the reproduced failure and software correction, not successful
live Home display acceptance. The next check is the running pilot showing
`displayingHome: true` and consistent Home labels in the app and `location?`.
Existing enrollment and display settings can be reused after pulling and
restarting only the gateway; this patch changes no Flutter code.

**Later physical gate:** during a normal outing, keep the gateway running and
observe loss of the selected radio, then renewed evidence after returning.
Record only redacted diagnostics. Missing radio evidence must not be described
as a confirmed departure by itself. Expiry without new packets, router restart,
unknown-router, revocation and stale-GPS return still need acceptance.

Before customer activation, validate true departure/return, router restart,
stale-GPS return, revocation and
unknown-router cases. Actual identifier values, keys and coordinates must not
appear in public evidence. If the passive report is insufficient, investigate
the documented command route without guessing `WIFIFENCE` syntax.

### Publication diagnosis — 8 September 2026 UTC

The operator's gateway log contained earlier DNS/network failures and Firestore
watcher errors. After reconnecting, the Home observer rejected 25 reports on its
timestamp checks. Those reports' original timestamps are absent from the shared
log, so the exact reason (old, future, missing or clock conflict) is not proven.
This record does not accept any arrival/departure produced during that reconnect.

An explicit authenticated `CR` request returned HTTP 200/socket handoff. Fresh
radio observations then qualified on the already configured watch/radio:

| UTC time | Match state | Consecutive qualifying reports | Signal | Observation time / age |
| --- | --- | --- | --- | --- |
| 18:07:22.075 | `candidate` | 1 | -68 dBm | 18:07:22 / 0 s |
| 18:07:58.465 | `candidate` | 2 | -68 dBm | 18:07:55 / 3 s |
| 18:09:43.434 | `matched` | 7 | -68 dBm | 18:09:40 / 3 s |
| 18:11:22.531 | `matched` | 8 | -68 dBm | 18:10:01 / 81 s |

Intervening canonical cellular-only packets did not reset the sequence. The last
radio evidence expired at 18:12:01 UTC; later heartbeats do not renew it. Provider
geolocation remained a separate approximate estimate of about 517 m.

A subsequent fresh-process check returned `displayEnabled: true` and a ready
saved Home/owner/Family-Care binding, but no current `homeWifiPresence` record.
The supplied excerpts contain no display publication confirmation. A missing
record after expiry does not prove a write failure; fresh-process settings also
cannot establish the running publisher's state. Router recognition and the
mixed-report correction pass for this sample. Live map/hero/WhatsApp publication
acceptance is still pending; do not claim that a hung SDK operation caused this
specific missing record without runtime evidence.

The added [running-publisher check](services/wifi-home.md#inspect-the-running-publisher)
retains the last confirmed usable Home publication in memory and exposes pending
I/O through a strict-admin, read-only endpoint. Its optional one-CR check observes
the publication window automatically. It adds no automatic polling of the watch,
changes no matching/expiry policy and makes no new customer activation claim.

### Backend Home publication passed — 8 September 2026 UTC

After updating to `02fabb4` and restarting the gateway, the operator ran
`npm run wifi-home:check -- --request-location`. Preflight showed an active
publisher, a ready Home binding and a connected watch. The log records one `CR`
handoff, its command echo, then fresh radio observations:

| UTC time | Match state | Qualifying sequence | Signal | Source time / age |
| --- | --- | --- | --- | --- |
| 18:46:26.242 | `candidate` | 1 | -68 dBm | 18:46:26 / 0 s |
| 18:47:11.023 | `matched` | 3 | -68 dBm | 18:47:08 / 3 s |
| 18:47:52.965 | `matched` | 5 | -68 dBm | 18:47:50 / 2 s |
| 18:48:34.926 | `matched` | 7 | -68 dBm | 18:48:32 / 2 s |
| 18:49:13.854 | `matched` | 9 | -68 dBm | 18:49:14 / 0 s |

After the third qualifying observation, the publisher explicitly logged
`displayingHome: true` with `reason: home_wifi_detected`. Under this revision,
that message follows acknowledgment of a usable Home write. The display log
has no independent timestamp, so an exact write time is not asserted.

**Passed:** repeated enrolled-radio recognition, continuity across the
intervening canonical cellular-only packet, and at least one acknowledged,
unexpired backend Home publication. The final observer sample has ten reports,
nine router sightings/qualifying reports, and zero ignored-time reports or
duplicates. The separate provider estimate remains approximately 517 m; its
radius is not the Home match's precision. The final source time is 146 ms ahead
of receipt, within the observer's existing skew allowance; the radio expiry is
bounded by the earlier receipt time, at 18:51:13.854 UTC.

The CLI's final `outcome` was not included, and continuous publication beyond
this excerpt is not established. This checkpoint does not prove continuous
report acquisition, a physical departure/return or router restart, and does not
change the general rollout gate.

### Post-expiry screenshots and stationary reporting gap — same run

The operator then supplied an app/dashboard screenshot and an ordinary
`location?` reply. Both show retained GPS rather than the saved Home pin:

- The last enrolled-radio observation in the log expires at **18:51:13.854 UTC
  / 22:51:13.854 MUT**. A Home display lease cannot extend beyond that time
  without new qualifying radio evidence.
- The WhatsApp reply at **22:52 MUT** labels the GPS fix as last known,
  recorded at 22:26 MUT, with current position unconfirmed. It separately
  reports an approximate Wi-Fi reading three minutes old (517 m radius),
  while watch check-in and battery reports are less than a minute old.
- The app screenshot also shows the last GPS fix, age 26 minutes, with a
  connected watch and a recent check-in. It does not show a Home Wi-Fi label.

The timing and separate ages are consistent with normal radio expiry despite
continued heartbeats. They demonstrate a retained-GPS fallback on both customer
surfaces, not fresh Home visual acceptance. No fresh status read at the screenshot
time was supplied, so the exact clearing time and any intermediate publication
are not asserted.

The acquisition limitation is present in the code: packet activity postpones
packet-silence recovery, while the separate location-freshness probe in
`gateway/src/sessions.js` runs only during an outing. The Home observer and
publisher do not request reports automatically; the operator checker sends
at most one `CR`. Thus a connected stationary watch can outlast its Home radio
evidence after a report burst. The raw evidence does not establish why the
firmware stopped scanning or reporting.

**Revised direction after supplier review, 8 September 2026:** validate native
Wi-Fi fencing before automatic stationary refresh or normal battery-policy
changes. The shared V46/V48/V52 documents apply to this V52 per operator
confirmation. II.2 documents a temporary `CR` GPS burst; II.35 documents native
router fence provisioning, but not single-router/unused-slot or removal forms.
The guide's two zones also differ from the three-slot command example.

A 30-minute strict-admin, in-memory observation capture and redacted command
preview are now implemented (`npm run wifi-home:fence`). Software tests verify
fixed-position fence bits alongside SOS, unchanged ACK/events, freshness,
privacy, bounded retention, auth and diagnostic failure isolation. No native
setting, reporting interval or expiry is changed. See the
[supplier sources, initial baseline and subsequent native trial](services/wifi-home-supplier-validation.md).

No new real-device result is claimed by that software checkpoint. Its initial
plan waited for supplier single-router/removal instructions before a setting.
The subsequent operator-requested private experiment below supersedes that pause
for the inferred one-entry form only. Repeating enrollment, treating heartbeats
as sightings or lengthening a stale Home claim does not resolve continuity.
Fresh Home map/hero/WhatsApp agreement still needs a live result.

### Completed stationary baseline — 8 September 2026 UTC

The operator supplied a completed `wifi-home:fence --report` capture covering
**20:02:06.005–20:32:06.005 UTC on 8 September**, or **00:02–00:32 MUT on
9 September**. The gateway recorded the operator's `at_home` marker. This is
reported ground truth, not a physical location independently verified by the
capture. The capture implementation was introduced in `6528501`; the report
itself does not include a running revision or firmware version.

| Observation | Result |
|---|---|
| Window | Completed, 1,800 seconds |
| Heartbeats | 9 `LK` + 1 `TKQ` |
| Successive `LK` gaps | 217.900–218.062 seconds; mean 217.986 seconds |
| Decoded location/alarm reports recorded | 0 |
| Fresh router sightings / fence packets | 0 / 0 |
| `CR` / `UPLOAD` / `WIFIFENCE` handoffs during capture | 0 / 0 / 0 |
| Command responses | 0 |
| Retention | All 11 entries retained; none dropped |
| Session at report retrieval | Connected |

**Accepted finding:** a complete stationary observation window contained
heartbeats but no decoded location/radio reports. The packet-level hook runs
before geolocation and Firestore/write gating. Those downstream stages cannot
explain the zero captured reports. The current packet-silence recovery timer is
postponed by packet activity; the independent location-freshness probe remains
outing-only. This is consistent with the observed no-`CR` window and explains
why passive Home evidence can expire while check-ins remain recent.

**Not established by this capture:** the watch's actual stored upload interval, whether firmware
suppresses stationary reporting/scanning, commands before the window, or native
fence behaviour. No `UPLOAD` during the window does not mean no interval was
configured earlier. Native provisioning is unavailable in this pilot, so zero
fence packets is inconclusive for that feature. `homeClaim: false` and
`nativeFenceAccepted: false` are diagnostic safeguards, not watch measurements.

The subsequent `ts#` readback below supplies the current upload interval and
firmware. Keep reporting/SOS/expiry settings unchanged pending the supplier's
stationary-reporting and native-fence configuration/removal instructions. No
repeat 30-minute baseline is required for the same unchanged setup.

The [redacted capture](testing/wifi-home-stationary-2026-09-08.json) preserves
counts and timestamps, omitting the random capture ID. Software release gates
for `6528501` all passed in
[run 34272126944](https://github.com/vikrav14/guardian/actions/runs/34272126944).
This checkpoint does not accept native fencing or continuous Home display.

### Subsequent watch status and Home timing mismatch

After the baseline and its corroborating gateway log, the operator supplied a
`ts#` response with `upload:300S`, `bat level:44` and firmware
`C403H_RFHZ_V52_EN_04R6_V1.3_2025.03.10_18.29.29`. Exact read time was not supplied.
The [redacted evidence](testing/wifi-home-stationary-2026-09-08.json) records only
those relevant fields separately from the unchanged capture. Device identifiers,
phone numbers and server configuration are omitted.

**Accepted finding:** the watch reports a 300-second/five-minute upload setting
at readback. This agrees with Guardian's ordinary 30-59% battery band at 44%.
It does not prove automatic mode, the origin of the setting, that it held for
the entire preceding capture, or that reports are delivered every five minutes.
The longer supplied log still had `reports: 0` from 20:02:09.928 to 20:38:51.875
UTC (36 minutes 41.947 seconds). The missing-report cause remains unconfirmed.

**Separate software finding:** the passive Home observer requires three strong
reports with gaps no greater than 60 seconds, spanning at least 20 seconds, and
expires evidence after 120 seconds. A read-only synthetic replay against the
current observer confirmed that three fresh strong reports at ten-second gaps
reach `matched`; at 300-second or 600-second gaps each report remains a new
one-match `candidate`. The burst match also expires 120 seconds after its last
observation. These are software results, not additional watch observations.

Consequently, even punctual single reports every five minutes cannot establish
or sustain the present Home match. Moving the ordinary interval to ten minutes
alone would not fix it. This incompatibility is independent of the observed
absence of reports. Do not lengthen evidence expiry or use heartbeat freshness
to conceal either gap. Native fence transitions and current-state recovery must
be validated before selecting continuous Home acquisition or replacing the
normal reporting policy. No runtime code, watch settings or hardware acceptance
state changes with this record.

### Operator-requested one-router experiment prepared

Following the status readback and review of section II.35, the operator asked
to test an anticipated interpretation. The separate `wifi-home:fence-trial`
tool now offers an offline preview and explicit `--send` of
`WIFIFENCE,1,<enrolled-radio>` (29-byte payload, `001D`). This is an experimental
single-entry hypothesis, not a newly documented command or a hardware pass.

The server checks strict admin authentication, the current pilot/router
fingerprint, a fresh capture and exactly one writable, correctly bound session.
One synchronous attempt guard survives new captures within the gateway process.
Concurrent attempts and failures never retry. The ordinary device-command
dispatcher still rejects `set_wifi_fence`. GPS selection, the Home observer,
SOS classification/dispatch and reporting policy are not modified.

The watch setting may persist or replace other fence settings; removal/readback
are still unknown. Native fence alarms can use the existing alert/notification
path. Neither capture stop nor gateway restart undoes the setting. The memory
guard resets on gateway restart, so do not restart to repeat an uncertain send.

Unit and real loopback HTTP/CLI tests cover framing, private input/output,
authentication, enrollment/capture/session rejection, concurrent and uncertain
sends, and capture-failure isolation. All 775 gateway tests passed locally; the
18 targeted checks passed again after final request-size/capture-clock guards.
No real watch command was sent from the
development workspace. Follow the [Windows runbook](services/wifi-home-supplier-validation.md#run-the-experiment-on-windows)
and record response, behaviour and limitations before accepting native Home.

### First native fence attempt completed — 11 September 2026 UTC

The operator confirmed checkout `d59f4f9` and then performed one
single-router trial. The [redacted report](testing/wifi-home-native-trial-2026-09-11.json)
covers the full 30 minutes, 09:48:56.797–10:18:56.797 UTC / 13:48:56.797–14:18:56.797
MUT, with all 39 timeline entries retained and no dropped entries. The capture
does not report a runtime commit or independently verify physical presence.

- One `WIFIFENCE` socket handoff was recorded; the attempt stayed `queued`.
- Both recorded command responses were `CR`, not `WIFIFENCE`.
- There were 21 heartbeats, 13 fresh reports (eight GPS-valid and five non-GPS),
  one enrolled-router sighting at -57 dBm, zero fence-bit reports and no markers.
- Two `CR` handoffs were followed by responses and reports after 3.609 and
  3.664 seconds respectively. Ten reports followed the first request and three
  followed the second. There were no `UPLOAD` handoffs during capture.
- The initial wait for a report was about 21m23s; the largest gap between
  subsequent reports was 312 seconds. CR caller identity was not captured.

**Result:** CR response/report transport is demonstrated, but the native setting
and continuous Home behaviour remain unconfirmed. Zero fence events without a
marked departure/return does not prove an unsupported feature. Keep this
experiment out of customer acceptance and preserve the existing source/expiry
and safety policies. Do not repeat the native send or use a gateway restart to
reset its attempt guard: setting persistence and removal are still unknown.
Use the [completed trial interpretation and supplier questions](services/wifi-home-supplier-validation.md#completed-first-native-attempt--11-september-2026)
for the next step. This evidence update changes no runtime code or watch setting.

### Further experiments planned — 11 September 2026 UTC

The operator reaffirmed exploration after the inconclusive first trial. Supplier
clarification can proceed in parallel with further controlled observations. The
next planned test keeps the watch stationary and changes only the enrolled
2.4 GHz radio on/off/on while preserving gateway connectivity. It uses the
existing capture and `at_home`, `router_off`, `router_on` markers, without a new
native setting or a deliberate reporting-policy change. Subsequent comparisons
can examine a temporary CR burst and independently marked physical departure/
return. An alternate command hypothesis requires a separately defined trial;
the current sender does not expose arbitrary variants. These are plans only;
no new hardware evidence or customer acceptance is claimed. See the
[continuation sequence](services/wifi-home-supplier-validation.md#continue-controlled-experiments--operator-direction-11-september-2026).

### Stationary radio off/on capture completed — 11 September 2026 UTC

The operator supplied the start, three physical-marker statuses and the stopped
[radio-cycle report](testing/wifi-home-radio-cycle-2026-09-11.json). Capture began
at 18:18:01.469 UTC / 22:18:01.469 MUT and lasted 734 whole seconds. All 14
entries were retained; none were dropped. `endsAt` is the scheduled ceiling,
not the stop time, and no runtime commit was reported.

The `at_home` → `router_off` baseline was 2m09s. The radio-off markers were
5m02.875s apart, followed by approximately 4m49s restored. These phases contained
3, 4 and 4 heartbeats respectively (ten `LK`, one `TKQ` overall), with zero
decoded reports, enrolled-router sightings or fence events throughout. There
were no CR/UPLOAD/WIFIFENCE handoffs or command responses. The morning native
trial remained separately recorded as `queued` / `settingsApplied: null`.

The at_home snapshot was disconnected; the subsequent marker/final snapshots
were connected. Heartbeats in all phases do not establish continuous transport.
Markers report operator observations, and no fresh router baseline was captured.
**Result:** no reported fence transition in this cycle; native setting acceptance,
internal scanning and continuous Home remain unconfirmed. This does not prove
the firmware unsupported or justify a battery-policy/expiry change.

The next planned comparison was [one CR with a short radio cycle](services/wifi-home-supplier-validation.md#next-test-one-cr-with-a-short-radio-cycle):
establish a fresh enrolled-router baseline, then mark a one-minute radio loss and
restoration within the observed reporting burst. Preserve the earlier setting;
verify the actual command handoff/reply and account for any automatic commands.
The shorter window is a diagnostic comparison, not a detection deadline or an
equal-duration repeat. This record changes documentation only.

### CR baseline and scan audit — 11 September 2026 UTC

The [redacted baseline](testing/wifi-home-cr-baseline-2026-09-11.json) began at
18:55:50.704 UTC and stopped after 518 whole seconds. All 23 entries were retained:
14 fresh non-repeated reports, four heartbeats, two CR handoffs and two CR replies.
There were no enrolled-router sightings, fence events or UPLOAD/WIFIFENCE handoffs.
Only `at_home` was marked; the short radio cycle was not performed. The second CR
was about three minutes after a heartbeat, consistent with recovery, but its
caller is not recorded. No continuous-connection or native-setting pass is claimed.

One non-GPS report exposed one AP that did not match Home; eight exposed none.
Five GPS reports exposed no scan data. A synthetic decoder check confirms that
the current GPS-valid path omits Wi-Fi fields even when the same supplied tail
is decoded successfully by the non-GPS path. This is a diagnostic limitation;
it does not establish which radios were present in the five real GPS packets.

The preceding Home binding read had stalled for 4,527 seconds, blocking that
checker request. After a gateway restart the binding was ready and publisher idle.
The reset native-attempt flag does not prove hardware rollback. The operator's
latest setup is PC Ethernet with both router bands on; exact change timing during
the capture is unknown. Their entered BSSID matches the earlier 2.4 GHz scan, while
the new Intel properties screenshot identifies the PC adapter.

**Assessment:** CR/report path observed; enrolled-router baseline, native fence
acceptance and continuous Home remain open. The supplier protocol states no
China-only restriction on MAC fencing. See the [protocol and provider audit](services/wifi-home-supplier-validation.md#cr-baseline-and-protocol-audit--11-september-2026-utc)
for radio compatibility, decoder limitations and the next diagnostic work.
This checkpoint changes documentation only; no hardware command or policy change.

### GPS scan diagnostics implemented — 11 September 2026 UTC

The private capture now inspects original GPS/non-GPS packet fields for a
declared Wi-Fi section, preserving normal location/alarm events. New captures
include `scanDiagnosticsVersion: 1` and report scan source/status/layout,
declared/rejected radio counts and the redacted enrolled-radio match. Missing
or malformed scan sections remain unavailable rather than becoming a zero scan.
This does not change Home qualification, GPS selection, SOS or Journey behaviour.

All **780 gateway tests passed locally**. New regressions exercise the runtime
hook with real decoding of synthetic frames, unchanged GPS priority/SOS ACKs,
privacy, malformed/empty scans and freshness/replay rules. No live request or
native setting was sent by this implementation. The old captures are preserved
with their original limitations; they are not retroactively reinterpreted as
complete GPS scans. Native fencing and continuous Home remain unaccepted.

Next, run the [stationary scan capture](services/wifi-home-supplier-validation.md#next-capture-stationary-scan-evidence)
with the updated gateway and router on. A GPS report's diagnostic Home match
alone does not change the app's location or prove native fence entry/exit.

### Fresh non-GPS router baseline — 11 September 2026 UTC

The [reported capture](testing/wifi-home-strong-router-baseline-2026-09-11.json)
has scan diagnostics version 1 and lasts 467 whole seconds from 19:38:31.204 UTC.
All 16 entries were retained: ten fresh non-GPS reports, three heartbeats, one
CR handoff/reply and one at_home marker. Nine named scan sections match the enrolled
radio at reported -30 dBm; one section explicitly declares zero radios. There are
no rejected entries, stale/repeated reports, fence events or native/UPLOAD handoffs.

**Accepted observation:** the pilot watch reports its enrolled Home radio and
the new diagnostic extractor decodes the named/empty non-GPS layout. No GPS-valid
packet occurred, so physical coverage of that new path remains open. Native fence
acceptance, publication/UI agreement and continuous Home remain unconfirmed.

A replay of the reported timing/signals through the unchanged observer first
matches at 19:42:17.393 UTC. Actual publisher writes are not included in this
capture. The last source observation (19:44:18 UTC) expires at 19:46:18 UTC,
slightly before the earliest stop time derived from elapsedSeconds. Thus an
expired status after this run does not disprove recognition during the burst.
Next read the running publisher's lastHomePublication before the next physical
comparison. No new runtime or hardware change is made by recording this result.

### Home published then cleared early — 11 September 2026 UTC

The [subsequent read-only status](testing/wifi-home-publication-cleared-2026-09-11.json)
confirms backend publication at 19:51:43.682 UTC from a 19:51:22 source observation.
The publisher cleared it at 19:51:49.719 UTC, **6.037 seconds after confirmation**
and **36.702 seconds before its published expiry** of 19:52:26.421 UTC. This is a
later observation window; it does not prove publication during the earlier capture.

**Accepted observation:** the backend published Home evidence. The early clearing
trigger remains unknown because this CLI summary omits the observer reason and
does not expose a historical clear reason. Current binding readiness/connectivity
cannot rule out a transient problem at the earlier time. The shorter published
lease can be explained by the binding-validity cap; it does not explain a clear
before that lease expires.

Preserve the `[wifi-home]` and `[wifi-home-display]` reasons at 19:51:43–19:51:50 UTC
before another comparison. Do not infer GPS priority, radio loss or a binding
change from this summary alone. App/map/WhatsApp agreement, continuous Home,
GPS-path physical scan coverage and native fence acceptance remain open. No
runtime, expiry, reporting-policy or hardware setting changes accompany this
evidence checkpoint.

### Early clear traced to GPS selection — 11 September 2026 UTC

The [follow-up gateway log](testing/wifi-home-gps-priority-2026-09-11.json) establishes
`satellite_observation` at 19:51:48.868 UTC, followed by a GPS A location and the
same publisher clearing reason. It precedes the earlier checker's successful
clear by 0.851 seconds. A second GPS-triggered clear occurs at 20:02:11.259 UTC.
The same sequence includes a server `geofence_enter` for Home: this is distinct
from native Wi-Fi fencing and does not verify physical movement.

**Accepted observation:** the early clearing is caused by the existing GPS-priority
rule. Recognition and backend publication both work in these reporting bursts.
The prior six-second interval is from the latest publication renewal to clearing;
the log shows Home was already active before that renewal. Total Home-active
duration is not precisely timestamped in the ordinary display log.

Between the two GPS switches Home requalifies and then expires normally at
19:59:50 UTC from its 19:57:50 radio observation. Three CR handoffs/replies are
accounted for by automatic recovery logs (one packet_silence, two location_stale).
Seven GPS summaries have no reported accuracy. The ordinary log cannot tell
whether the enrolled radio was also scanned in those GPS packets or whether
their coordinates are physically wrong. The fresh GPS radio-field capture in
the supplier validation runbook is next, before changing selection rules or
performing the radio-loss comparison. Native acceptance and continuous Home
remain open. This checkpoint preserves 72 redacted entries and changes no runtime.

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
2. Confirm the separate fall-alert switch, detector setting and sensitivity
   commands (`FON,1`, `FALLDOWN,1,0`, `LSSET,<level>+6`) are `sent` over TCP
   while the watch is connected. Auto-dial remains off for this acceptance.
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

### Recorded fall delivery evidence — 21 September 2026 (Mauritius)

The operator supplied the read-only acceptance output and screenshots from a
physical V52 test on PR #137, after the decoder compatibility update:

- Event time: **20 September 2026, 20:46:40 UTC / 21 September, 00:46:40 MUT**.
- The persisted alert is `type: fall`, `severity: critical`.
- Guardian's Alerts screen shows **Possible fall detected** at 00:46 MUT.
- The recipient's WhatsApp screenshot shows the matching possible-fall message
  at 00:46 MUT. Its location is explicitly described as approximate cell-tower
  positioning; the screenshot does not establish GPS accuracy or map-pin accuracy.
- The inspector records one contact and Meta API acceptance. At inspection time
  `deliveredAt` and `readAt` are null, so machine acceptance remains `partial`.
  The screenshot supplies manual handset-receipt evidence, not a signed webhook
  receipt. SMS was skipped because no sender was configured.

This establishes app presentation and manual WhatsApp receipt for this pilot
event. It does not establish automatic delivery receipts, location immutability
after later movement, repeatability, or the false-alarm rate. No raw tracker-state
value accompanies this result, so it does not identify whether bit 21 or bit 22
was set. Earlier generic `other` alerts remain historical records and are not
reclassified from screenshots.

## Test 7 — medication reminder

Medication reminders are available on Guardian Family and Guardian Care.

1. Create a reminder two or more minutes ahead using the app or confirmed WhatsApp action.
2. Confirm one canonical `medicationReminders` record and one `set_medication_reminder` command.
3. Confirm the command reaches `sent` over TCP.
4. Observe whether the watch displays/sounds the reminder at the expected local time.
5. Confirm the guardian reminder's actual delivery outcome.

Pass for the current product: canonical record, TCP dispatch, watch presentation and guardian delivery. Wearer acknowledgement is **not implemented/proven** by the current V52 protocol, so marketing must not promise it until a separate end-to-end mechanism exists.

## Test 8 — steps and daily activity

This is passive telemetry testing. Do not send `PEDO` or `WALKTIME` during an
ordinary accuracy run. If a new watch displays an inactive pedometer, use the
strict-admin `activity:provision` workflow once and physically verify the
result before continuing.

1. Keep `ACTIVITY_STEPS_CUSTOMER_ENABLED=false` and compile the app without
   `GUARDIAN_ACTIVITY_STEPS_ENABLED`.
2. Set `ACTIVITY_STEPS_INGEST_ENABLED=true` and keep
   `ACTIVITY_STEPS_COUNTER_MODE=unverified` for the first shadow run.
3. Record the watch-displayed count, take a controlled walk with a manually
   counted step range, and record the watch count again.
4. Run `npm run acceptance:v52 -- --imei YOUR_DEVICE_IMEI --since 24h` and
   compare its bounded `activitySteps.days` evidence with the watch.
5. Observe the final sample before local midnight and the first samples after
   midnight. Record whether the raw counter resets and when.
6. Repeat around a watch reboot and a gateway restart. Confirm stale packets do
   not inflate the day and a gateway restart restores the stored day.
7. Observe data use and battery behaviour over at least one representative day.
8. Only after the semantics are accepted, set counter mode to `daily_reset`,
   keep both customer surfaces off, and verify at least one clean stored day.

First-device evidence collected on 23 August 2026: the documented full-day
`WALKTIME` followed by `PEDO,1` activated the watch counter, and its displayed
103 matched the backend raw 103. A subsequent controlled 100-step walk advanced
the backend raw counter by 99, with no reset or anomaly; record the corresponding
final watch display before closing the run. This is initial evidence on one
device, not fleet acceptance.

Pass: controlled walk difference is within the recorded tolerance, midnight
and reboot/reset semantics are repeatable, anomalous or out-of-order packets
fail closed, restart recovery preserves the day, and data/battery impact is
acceptable. Then—and only then—enable WhatsApp and app customer surfaces.

## Test 9 — Care wellbeing readings

This test records watch estimates, not medical accuracy. Obtain explicit wearer consent first. Do not use it to diagnose, clear an emergency, or decide that a person is safe.

1. Keep `CARE_WELLBEING_DEVICE_MODE=unverified` and `CARE_WELLBEING_CUSTOMER_ENABLED=false`.
2. Record consent with `npm run wellbeing:consent -- --grant --wearer-confirmed --imei YOUR_15_DIGIT_IMEI --recorded-by YOUR_ADMIN_EMAIL`.
3. Enable ingestion only, restart the gateway, take a heart/BP reading on the watch, and note the watch display and exact local time.
4. Enable the schedule pilot for the acceptance minimum with `npm run wellbeing:request -- --imei YOUR_15_DIGIT_IMEI --schedule-seconds 300`. Do not touch the health screen.
5. Require at least two protected `bphrt` and `oxygen` pairs at approximately five-minute intervals, with `displayable` remaining false.
6. Compare one wearer-initiated reading with the exact watch display values. Never classify the results as normal or abnormal.
7. Repeat malformed-value, deduplication, freshness and retention checks.
8. Run the acceptance inspector and attach only redacted evidence to the pull request.
9. Change to the intended hourly interval with `npm run wellbeing:request -- --imei YOUR_15_DIGIT_IMEI --schedule-seconds 3600` and complete a 24-hour reliability/battery run.
10. Stop explicitly with `npm run wellbeing:request -- --imei YOUR_15_DIGIT_IMEI --stop`, or revoke consent with `npm run wellbeing:consent -- --revoke --imei YOUR_15_DIGIT_IMEI --recorded-by YOUR_ADMIN_EMAIL`. Revocation attempts the stop before deleting retained readings and reports when the watch was unreachable.

Pilot evidence, 23 August 2026: one exact V52 acknowledged `hrtstart,1` but did not start a visible measurement. Its manually initiated values matched the stored `bphrt` and `oxygen` fields exactly. The same watch then produced two autonomous protected reading pairs under `hrtstart,300`, approximately five minutes apart. Identifiers and health values are intentionally omitted here. Hourly reliability and battery impact remain pending.

Temperature remains blocked until the exact V52 upload shape is captured. Passing this test permits an engineering evidence update; it does not turn on customer flags or establish medical accuracy.

## Final collection

Rerun the collector with the recorded UTC start time. The evidence pack includes collector JSON, factual UI screenshots, redacted gateway excerpts, the manual call table, carrier/SIM and firmware versions, failures, retries and exact timestamps.

`releaseReady` remains false in the collector by design. Release also requires PR checks, Meta acceptance, Android smoke testing, billing lifecycle, privacy/retention review and resolution or rewording of every Partial/Not implemented promise in the service matrix.

## 2026-09-21 — Call-answer investigation, still incomplete

The pilot's `APPLOCK,JT-0` command was handed to one live TCP session and an APPLOCK
response was logged, but the incoming call kept ringing. The operator subsequently
confirmed that the watch's SMS `ts#` SOS1 readback matches the calling number.
Manual answering was observed after the requested restoration; a matching JT-1
downlink was not supplied. Auto-answer remains **not passed**.

Correction to earlier PR wording: the existing parser discarded APPLOCK parameters,
so the historical log does not prove the response was bare. The diagnostic added in
draft PR #115 records a timestamp and bounded, redacted reply details without asserting
applied state or sending another ACK. It requires a new supervised capture before
drawing conclusions about the watch's actual response.

The successful vibration-only test has a fresh `profile,3` downlink and an
operator-confirmed physical outcome; the profile reply's exact shape is likewise
not established by the old logger. Sound-only was reported working on retest, without
a supplied fresh mode-2 downlink. Silent, expiry and reboot behavior remain unverified.

See [watch modes](services/watch-modes.md) for supplier mappings, exact firmware
labels, evidence limits and the next enable/call/restore trial. No real phone
numbers or raw SOS status messages are included.

## Instrumented follow-up — 21 September 2026, 19:08 UTC

The operator supplied `Pasted text(20260921-191154).txt` (100 lines) after running
the diagnostic gateway. It records one `APPLOCK,JT-0` downlink to one live session,
followed by an APPLOCK reply at `2026-09-21T19:08:32.909Z` (23:08:32.909 MUT):

```json
{"kind":"bare","argumentCount":0,"arguments":[],"truncated":false,"appliedStateVerified":false}
```

This capture establishes that **this reply was bare**, matching the supplied
communication example. It contains no returned mode or error detail; it still
does not establish that automatic answering was applied. The earlier captures
remain uninterpretable as to argument shape.

The operator reported that the call from the confirmed on-watch SOS1 number,
left untouched for the instructed 15–20 seconds, **kept ringing**. Auto-answer
therefore remains **not passed**. The exact call timestamp/ring count is not
present in the log. The excerpt contains no JT-1 downlink or verified manual
restoration after this final Auto trial. Earlier helper outputs reported
Auto -> Manual -> Auto socket handoffs; their exact timestamps were not supplied.

Next action: end the call, restore `APPLOCK,JT-1`, capture the reply, and confirm
manual answering. Ask the supplier to confirm support and prerequisites for
`JT-0` on the two recorded firmware labels, including any caller-number format
requirements and a supported way to read back answer mode. Keep caller
restrictions unchanged. Do not infer unsupported firmware or change JT mappings
from this result. Repeating the same enable/call trial without new information
would not resolve the remaining uncertainty.

The diagnostic commit `3eabb7d` passed Guardian release gates run
[35641384531](https://github.com/vikrav14/guardian/actions/runs/35641384531).
CI success validates the software checks, not physical auto-answer behavior.

## 2026-09-21 — Exact-example answer-mode comparison prepared

Further audit found a single byte difference between the prior APPLOCK frame and
the supplied example: uppercase 000C versus lowercase 000c in the hexadecimal
length. Both mean 12; causation is unproven. An opt-in exact-example sender and
passive, redacted CONFIG JT observation are now available in draft PR #115.

The script and HTTP/TCP path were verified using synthetic local sessions.
No live watch command was sent by this investigation and no new physical success
is claimed. Next compare the supplier frame while idle, observe incoming
caller-ID recognition, and restore/verify manual answering. See
[watch modes](services/watch-modes.md#deeper-protocol-audit--21-september-2026)
for the audit, exact commands, limits and controlled trial procedure.

Subsequent operator helper output reports a Manual (APPLOCK,JT-1) socket handoff to one session after the failed Auto test. A new Manual reply and untouched-call result have not yet been supplied.

## Exact supplier-frame result — 21 September 2026, 19:37 UTC

The operator ran the exact-example Auto trial at `2026-09-21T19:37:28.514Z`.
Its output reported one live session and the expected 33-byte frame with a
12-byte payload and lowercase `000c`. The subsequent attachment
`Pasted text(20260921-194115).txt` independently contains:

```text
[downlink] sent APPLOCK,JT-0 to 9705254749 (1 session(s)): [SG*9705254749*000c*APPLOCK,JT-0]
[gateway] 9705254749 echoed back APPLOCK receivedAt=2026-09-21T19:37:28.889Z replyEvidence={"kind":"bare","argumentCount":0,"arguments":[],"truncated":false,"appliedStateVerified":false} (dropped, not re-acking)
```

The operator reports that automatic answering **did not work**. This is a failed
physical Auto test despite the exact supplier framing and a matching bare reply.
Both uppercase and lowercase trials have now failed to produce automatic answering;
the header-case change is not a demonstrated fix. The reply contains no applied
mode or error information, so the reason for failure remains unknown.

This excerpt contains no `answer-mode-config` observation and no subsequent
`APPLOCK,JT-1` restoration. Neither absence establishes unsupported firmware.
A later TCP connection at `19:39:56.078Z` does not establish why the call failed.
The operator subsequently confirmed that the incoming screen displayed the saved
contact. Combined with the prior SOS1 readback confirmation, this supplies evidence
of visible caller recognition. It does not establish that the firmware uses the same
internal matching rule for automatic answering. The precise call time, duration and
ring count were not provided; do not infer them from the instructed test procedure.

Next: end the call and restore Manual using the same supplier framing, capture
its reply, then verify that a fresh untouched call waits for manual answering.
The already-confirmed SMS SOS1 match and visible saved-contact recognition need
not be repeated. The evidence does not yet distinguish ignored mode application,
additional firmware prerequisites or an implementation defect; none is established
as the cause. No documented V52 applied-mode readback has been identified.

Do not repeat Auto without a new diagnostic reason or change contacts, caller
restrictions or undocumented command values. PR #115 remains draft; automatic
answering is not accepted.

The diagnostic runtime commit `d1d37b4` passed
[Guardian release gates run 35645517019](https://github.com/vikrav14/guardian/actions/runs/35645517019).
That software result does not change the failed physical outcome.

## Reboot comparison prepared — 21 September 2026

After the request to restore Manual and verify a call, the operator reported
"done". No new command output or detailed call observation accompanied that
completion report. The operator then asked what else could be tried.

The supplied Communication Protocol, section 43, documents `RESET` as a
device restart. Section 42 separately documents `FACTORY`; this trial never
sends FACTORY. The V52 user guide also documents remote reboot, but does **not**
say that answering-mode changes require it. Testing behavior across a restart
is a new diagnostic condition, not a known remedy or an established prerequisite.

The existing `gateway/scripts/send-reset.js` did not attach the admin header
required by the current gateway. The helper now:

- Requires an explicit device identifier and previews unless `--send` is present.
- Uses the configured HTTP port and admin key with one authenticated loopback POST.
- Sends only the documented RESET command; it cannot override the command or host.
- Bounds the request to ten seconds, rejects redirects, and never retries automatically.
- Verifies the returned command/frame and keeps `watchRestartVerified: false`.
- Requires the operator to observe a reboot and subsequent live telemetry.

This changes the helper CLI: prior no-argument sends and --host/--port overrides
are removed; explicit positional 10/15-digit identifiers remain supported.
No runtime server change or gateway restart is required for this helper update.
The assistant has not sent a live watch command.

### Supervised comparison

Keep the watch beside the informed operator; end any call and keep gateway and
ngrok running. Pull the draft branch in a second terminal.

1. Send Auto once with `trial-answer-mode.js --imei <pilot-imei> --mode auto --framing supplier --send`.
2. Capture the APPLOCK reply and leave the watch idle for 30 seconds.
3. Send `node scripts/send-reset.js --imei <pilot-imei> --send` once.
4. Observe whether the watch visibly restarts; wait for its new identified TCP
   session and fresh heartbeat. A socket-handoff result alone is not a reboot.
   If handoff is uncertain or no restart is observed, inspect logs and stop this
   comparison rather than retrying automatically.
5. After reconnection, leave the watch idle for a minute, then call from the same
   confirmed SOS1 contact and leave it untouched for up to 30 seconds. Record
   local time, ring count, answer behavior and two-way audio if it answers.
   Do not resend Auto after reboot: that would change what this test measures.
6. End the call, send Manual using the same supplier framing, capture the reply,
   wait 30 seconds and restart once with the same RESET helper. Wait for the new
   session/heartbeat and verify that a call requires a manual answer. If it
   answers automatically, report that result rather than claiming restoration.

Retain APPLOCK, RESET, TCP connection and any `answer-mode-config` lines,
without publishing contact data. This tests the requested modes across reboot;
it cannot directly read the stored mode. A failure does not establish unsupported
firmware. No caller-list, safe-mode, SOS-slot or server-setting change is part of
the comparison. Auto-answer remains unaccepted and PR #115 stays draft.

## Reboot trial result — 21 September 2026, 20:02–20:08 UTC

Source: operator attachment `Pasted text(20260921-200849).txt` and the report
"did not work" following the supervised Auto/reboot/call procedure. Automatic
answering remains **not passed**.

| Observed event | Evidence |
| --- | --- |
| Auto request | Exact supplier `APPLOCK,JT-0` frame with `000c`, handed to one session |
| Auto response | Bare APPLOCK reply at `2026-09-21T20:02:37.767Z`; no returned mode/error |
| Restart request | One `RESET` downlink to one session, after Auto; its exact send time is not printed |
| New startup traffic | TCP connection at `20:04:11.795Z`, followed by configuration, full pilot IMEI and fresh persistence |
| New configuration evidence | At `20:04:11.834Z`: `jtField: valid`, `reportedJt: 0`, `meaningVerified: false`, `appliedStateVerified: false` |
| Manual request | Exact supplier `APPLOCK,JT-1` frame, handed to two registered sessions |
| Manual response | Bare APPLOCK reply at `20:06:23.059Z` |
| Post-Manual restart/configuration | Not present in the supplied excerpt |

The startup sequence after RESET is consistent with a device restart. The
operator did not separately describe the visible boot sequence, exact call time,
ring count or post-restoration call outcome. The reported failure must not be
turned into a claim that the stored answer mode has been read back.

This is the **first captured JT configuration value from the pilot** in this
investigation. Parser review confirms it is extracted from a received `JT:0`
field, not a default substituted for missing data. Its meaning remains unknown:
it could describe a setting or another firmware property. The same-named field
in the mixed-family supplier example does not establish the V52 meaning.

Next complete the already-planned **Manual/reboot** half of the comparison.
Manual has already been handed off and replied to; do not resend Auto. If a
restart after that Manual reply has already happened, obtain its configuration
line instead of requesting another restart. Otherwise, with no call active,
send RESET once using the updated helper, observe the watch startup and wait
for identified reconnection/fresh telemetry. Retain the next
`[answer-mode-config]` line and verify an incoming call waits for a manual answer.

If JT changes to 1, that supplies evidence of a relationship between the request
and startup configuration on this pilot; it still does not prove successful
automatic answering. If it remains 0, that does not by itself distinguish a
static field, ignored setting or a setting that does not persist. If no field
arrives, record that absence without inferring a firmware capability.

The excerpt also logs unhandled `appcontacttel`, `APPANDFNREPORT` and `eicard`
during startup. It does not establish their semantics or a causal link to the
failed call; do not fabricate server responses. The multiple registered TCP
sessions likewise do not establish a cause of the Auto failure.

No runtime change or live command is made by this evidence update. PR #115
remains draft. The helper/runtime head `bc38754` passed
[Guardian release gates run 35648407320](https://github.com/vikrav14/guardian/actions/runs/35648407320);
software CI does not validate the physical answer-mode behavior.

## Manual reboot comparison — 21 September 2026, 20:16 UTC

The operator supplied the Manual helper output, the subsequent RESET helper
output and startup logs. The Manual request was made at
`2026-09-21T20:06:21.456Z`, handed to two sessions and replied to at
`20:06:23.059Z` in the earlier capture. RESET was requested at
`20:13:49.251Z` and handed to one session with the documented frame.

The watch then connected at `20:16:11.009Z`, supplied its full pilot IMEI and
fresh telemetry, and emitted this configuration evidence at `20:16:11.061Z`:

```json
{"jtField":"valid","reportedJt":0,"meaningVerified":false,"appliedStateVerified":false}
```

| Requested mode before RESET | Startup configuration (UTC) | Reported JT |
| --- | --- | --- |
| Auto, APPLOCK,JT-0 | 20:04:11.834 | 0 |
| Manual, APPLOCK,JT-1 | 20:16:11.061 | 0 |

The field is unchanged across the two requested modes. This comparison does
**not validate JT as an applied answer-mode readback**. It does not prove that
Auto is active, that Manual was ignored, or that the firmware lacks auto-answer.
A static/default field and a setting that is ignored or does not persist remain
possible explanations; these observations do not distinguish them.

The startup socket ended at `20:16:40.619Z` without a socket error or logged
gateway-initiated close, and a new connection arrived at `20:17:01.015Z` with
fresh session persistence. This is connection evidence, not evidence of an
answer-mode change or the cause of the failed automatic call.

Manual is the last requested mode. The physical incoming-call result after this
latest restart has not yet been supplied, so final Manual restoration remains
awaiting that observation. No additional Auto, Manual or RESET command is
needed merely to repeat this comparison.

Auto-answer remains not passed. The documented mapping, exact frame, bare replies,
stored SOS1 match, visible caller recognition and reboot comparison are now
recorded. Further command variations require new V52-specific evidence; there
is no demonstrated formatting fix or supported applied-state query to implement.
Keep customer auto-answer controls disabled and PR #115 draft. This update
changes evidence documentation only and sends no live device command.

## Official app investigation — 21 September 2026

Static inspection of the official AnyTracking 5.2.94 APK found an ANS
app-to-server request. Its translation to a watch command and the pilot's app
model branch are not established; this is not evidence for changing JT semantics
or transmitting ANS over TCP/SMS. Guardian's unknown startup commands already get
bare same-command ACKs. No missing handshake or wire correction was demonstrated.

See [the source record and proposed reference-platform comparison](services/watch-answer-reference-comparison.md).
A same-watch/SIM/caller test through the supplier platform is prepared but not
executed. Owner agreement is required before temporarily sending watch telemetry
to that platform; the procedure preserves contacts/restrictions and prepares the
return server SMS first. A physical pass, both-direction audio and manual/routing
restoration remain required. **Auto-answer is not passed; PR #115 remains draft.**

## PR #115 paused — 22 September 2026

The operator paused watch-modes/auto-answer work and selected PR #118 next after
reporting a supplier reply. The [full resume checkpoint](services/watch-modes-paused-handoff.md)
preserves all trial outcomes, diagnostic code, CI provenance, the AnyTracking
analysis, known unknowns and the proposed native-platform comparison.

Latest correction: **the watch works normally with Guardian; the access/connection
problem concerns AnyTracking.** Login/server failure versus an offline-device
screen has not been clarified. The supplied AnyTracking screenshot exposes Press
to answer and Handsfree auto answer, with Press selected; this is UI evidence,
not a fresh watch-state readback. No reference-platform test has occurred.

Auto-answer remains not passed. Manual was last requested, but the final physical
Manual result after the latest reboot was not separately supplied. JT:0 after
both requested modes remains unverified as applied state. No device command,
routing, caller restriction, routine or runtime change accompanies this pause.
PR #115 stays open as a draft, with customer answer-mode controls disabled. Earlier
next-test instructions are suspended. The supplier reply for #118 is reported
received by the operator, but its contents have not yet been provided here.
