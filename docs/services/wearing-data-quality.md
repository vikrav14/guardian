# Wearing evidence and Wellness data quality

## Dashboard wearing line (16 September 2026)

The family overview places a separate wearing row below connection/check-in and
battery. Connection still describes transport. Wearing uses the following
display policy, available to linked members on every active edition:

| Evidence | Dashboard wording |
| --- | --- |
| No verified current evidence | Wearing not confirmed |
| Fresh AL bit-20 removal event | Removal reported; age; wearing now is unconfirmed |
| Family member checks the wrist | Last checked on/off wrist; Family check; age |
| Exact-device accepted, fresh sensor evidence, live connection | Wearing detected / Watch off wrist; Watch sensor; age |
| Read/access failure | Wearing status unavailable; retry |

Only fresh, accepted positive sensor evidence can produce green wearing detection.
A manual check remains neutral and historical at every age. It never changes the
wearing eligibility contract, validates readings, enables a watch command or
sends a notification. Newer removal reports supersede earlier family checks;
newer family observations supersede older reports in the display. Older or
equal-time positive sensor observations cannot override a contradictory check
or removal report. Sensor evidence expires locally even without new Firestore
updates and is reevaluated after app resume. Switching device/unlink/sign-out or
read failure clears the affected data.

Manual checks use a separate `wearChecks/current` document and online transaction.
Rules enforce linked membership, an active edition, recorder identity, exact
fields, server recording time and an observation within 60 seconds of server
time. This 60-second allowance is a clock/transport bound, not a claim that the
person remains wearing the watch for 60 seconds. Offline saves fail; pending
local writes cannot display a saved check.

`lastRemovalReportedAt` is independent, dated history in the gateway-owned
`wearStatus/current` summary. The gateway only advances it for timestamp-valid
AL removal reports received within the existing two-minute freshness window.
Duplicate/older reports cannot advance it. Zero bits, disconnection, coalesced
writes and restart preserve it. Existing alerts are not backfilled, and the
dashboard never reads the private raw diagnostics.

### Exact-watch limitation and rollout

The [16 September field checkpoint](../testing/v52-removal-ack-capture-2026-09-16.md)
remains authoritative: bit 20 reported removal; zero-bit packets were received
while the watch was still off; positive restoration is unverified. Physical
removal trials remain paused and the last requested setting remains REMOVE,0.
No enable/disable commands are part of this dashboard change.

The [V52 manufacturer page](https://www.reachfargps.com/products/GPS-watch/v52.html)
does not establish a positive-wearing packet contract for the tested firmware.
[Flespi's V52 integration](https://flespi.com/devices/reachfar-v52) lists separate
wristband-connected status and takeoff-alarm parameters; this is an integration
lead, not proof of what this exact watch emits. Obtain the vendor's positive
contact/restoration definition before accepting a firmware or using sensor
values, steps or motion to infer wearing. No confidence score is invented.

Rollout order: deploy `firestore/rules.example` through the existing Firestore
configuration, restart the updated gateway once, then build/release the Flutter
app through its existing release process. Until the new rules are deployed,
the row fails closed as unavailable. Until a new removal report or family check
exists, this unverified watch shows “Wearing not confirmed.” This code change
does not itself deploy rules, publish the app, or alter device acceptance.


Status: software implemented; exact V52 firmware interpretation remains **unverified**.

**15 September source correction:** the original companion Communication Example
p5 calls bit 3 unused, whereas Protocol p13 labels it wearing status. PR #112
and the constant-zero physical test do not resolve that conflict. Automatic
routine start now requires the same fresh accepted wearing evidence; this pilot
stays paused. See the [routine contract](../testing/wellness-routines-2026-09-15.md).

The passive observer runs when activity, wellbeing or removal ingestion is enabled.
It sends no downlink, changes no measurement schedule, and does not deliver alerts.
It reads only Annex I tracker field 15 from live UD/AL positioning packets. Bit 3
is the documented wearing-status field; bit 20 is a removal alarm. Neither the
bit-3 polarity nor dependable off-wrist behaviour is accepted on the pilot yet.
`WEAR_EVIDENCE_DEVICE_MODE` defaults to `unverified`. The future accepted mapping
`v52_bit3_worn` also requires the exact IMEI in `WEAR_EVIDENCE_ACCEPTED_IMEIS`.
Do not set these acceptance values until the physical tests below pass.

## Behaviour

| Evidence | Current wearing status | Use in Wellness/reporting |
|---|---|---|
| Unverified firmware, missing/invalid status, silence, reconnect | Unknown | New values remain diagnostic |
| Distinct accepted worn observations spanning 60 seconds | Worn | New qualified intervals/readings may be used |
| First contradictory observation | Unknown, confirming | Stop qualifying new data immediately |
| Distinct accepted removed observations spanning 60 seconds | Removed | Exclude new values |
| Alarm flag clears without positive wearing evidence | Removed or unknown | Never treat alarm-clear as restored |
| Fresh positive wearing evidence after removal | Worn after confirmation | Start a new step baseline; no catch-up credit |

Freshness expires 120 seconds after the packet's device timestamp. Heartbeats,
GPS validity, Wi-Fi Home, step increases and plausible health values do not renew
wearing evidence. UD2, delayed, duplicate and future status packets do not renew
it. Contradictory bit-3/bit-20 combinations are unknown. Every process/session
starts without wearing proof. Wearing evidence is captured before remote awaits;
its receipt-time snapshot cannot borrow proof from a later packet.

The activity ledger keeps `recordedSteps` for controlled counter/midnight tests.
`wearQualifiedSteps` counts only otherwise-valid deltas whose endpoints belong
to the same uninterrupted wearing-evidence period. Customer `reportedSteps`
uses that qualified total. Removal/restoration entirely between counter uploads
still breaks continuity. Unqualified increments are `wearExcludedSteps`, never
added back after restoration. `lastWearQualifiedAt` dates the accepted total;
later raw updates do not make it look fresh. Existing diagnostic totals are not
backfilled. Coverage stays partial, including quiet gaps; missing data is not
zero activity. Legacy `daily_reset` totals remain private because a whole raw
daily count cannot assign increments to wearing intervals.

The safe `devices/{imei}/wearStatus/current` summary is readable by linked users
on every active edition. Clients expire it locally; it is not a permanent claim.
The backend-only `wearDiagnostics/current` holds at most 120 raw status samples
and contains the running gateway configuration. Slow writes are coalesced and
isolated from ACKs, SOS and live tracking. Diagnostics are a bounded latest
capture, not an authoritative historical wearing log.

Wellness consumers retain earlier eligible readings with their original age.
Wearing status never establishes medical accuracy. No reading obtained without
wearing proof may trigger a personal health conclusion, inactivity alert or AI
trend. Removal notifications remain a separate opt-in Family/Care service.

## Passive exact-watch test

Keep the existing customer and device acceptance flags unverified/off. Pull the
updated branch and restart the gateway **before** the midnight counter baseline.
Activity diagnostic counting continues even while wearing status is unknown.

1. Wear the watch normally for 2–3 minutes, then run
   `npm run wear:check -- --save=worn-before`.
2. Remove it, place it still on a table, immediately run
   `npm run wear:check -- --save=removed`, wait 2–3 minutes, then run
   `npm run wear:check -- --save=removed-after`.
3. Put it back on, run `npm run wear:check -- --save=worn-again`, wait 2–3 minutes,
   then run `npm run wear:check -- --save=worn-after`.
4. Separately compare charging, still-but-worn and loosely fitted states. Capture
   reboot/reconnect with the watch off the wrist. Do not perform a reboot across
   the midnight test unless it is explicitly the reboot test being measured.

Labels mark the time the command is run, so run transition labels immediately
after the physical action. Reports save under `gateway/data/wear-checks` and
exclude device identity, coordinates and health values. No command is sent to
the watch. If no fresh status samples arrive, report that limitation; do not
infer removal from a missed reading or enable `REMOVESMS` to guess its syntax.

Before accepting the mapping, verify repeated worn/removed transitions, charging,
immobility, loose fit, timestamp behaviour and reboot on this exact firmware.
Then verify health uploads at removal/restoration, step interval exclusion,
app freshness and separate notification debounce. A reliable sensor/contact
flag or supplier clarification is required if bit 3 is not dependable.
The private routine controller attempts connected stops after evidence changes.
Physical stopping while offline is not guaranteed. Customer use of data remains
independently gated; full automatic scheduling acceptance is still outstanding.
