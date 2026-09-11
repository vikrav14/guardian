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
