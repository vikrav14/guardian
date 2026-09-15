# V52 temperature and wearing capability investigation

Date: 2026-09-15. Status: documented paths identified; exact-watch automatic
temperature and wearing detection are not accepted. No hardware command was sent
as part of this investigation.

## What the original documents establish

The original supplied PDFs were reopened and their relevant pages rendered and
checked. These hashes match the source inventory already recorded in
`docs/services/wifi-home-supplier-validation.md`.

| Source | SHA-256 | Relevant evidence |
| --- | --- | --- |
| `2. V46-V48-V52 Communication Protocol(1).pdf` | `8f01881b9773f9ee762ceb2cc4dff9aa037abfa7a5540d6a723e1f4dd9161dbf` | Page 6, II.18: `REMOVE,1` enables the removal alarm; `REMOVE,0` disables it; reply is bare `REMOVE`. Page 9, II.32–34: single temperature, interval temperature, and a separate timing mode. Page 13: bit 3 is described as wearing status; bit 20 is the removal alarm. |
| `3. V46-V48-V52 Communication Example(1).pdf` | `976b5721fbde52959a62d9f8975b9faf4bf6263e4b057d1eaa72950820e73e2b` | Page 2 instead illustrates `REMOVESMS,1`; page 5 explicitly calls bit 3 unused and bit 20 a removal alarm. This contradicts using bit 3 as universally reliable wearing status. |
| `V52-DataSheet(2).pdf` | `503c0f4f8efebbb78893f28c654f29fcf7d7e3b6dbcc374b9ba54d8285a374fd` | Page 3 lists skin temperature, removal-alarm settings and removal alerts for V52. It does not specify a sensor chip, a worn-again message, accuracy or supported firmware revisions. |

The presence of an enable switch is a reason to test whether removal reporting
was disabled during the earlier passive comparison. It is not evidence that it
was disabled, or that enabling the switch will produce a positive worn signal.

## Independent implementation and manufacturer cross-checks

- [Flespi's ReachFar implementation changelog](https://forum.flespi.com/d/432-changelog-reachfar-protocol)
  explicitly describes V48 temperature data in `btemp2`, triggered by `BODYTEMP2`.
  Its [V52 integration page](https://flespi.com/devices/reachfar-v52) lists temperature
  and wristband status/alarm parameters. This supports the protocol-family lead;
  it does not validate the command casing, BT mode or wearing polarity on this
  particular V52. Keep the original V52 protocol's lowercase command builders;
  an uppercase trial would require a separately recorded comparison.
- [4P-Touch's manufacturer protocol, II.18 and temperature section](https://www.4p-touch.com/beesure-gps-setracker-server-protocol.html)
  distinguishes `REMOVE` from `REMOVESMS` and says removal alerts require suitable
  light-sensor/firmware support. It also documents the temperature command family.
  These are another manufacturer's devices, so their field meanings, sensor
  prerequisites and timing restrictions must not be silently imported into V52
  acceptance rules.
- [ReachFar's V52 product page](https://www.reachfargps.com/products/GPS-watch/v52.html)
  and [V52 user-guide listing](https://www.reachfargps.com/support/down/V52_User_Guide_PDF_849.html)
  identify the official supplier resources. They did not provide an exact-build
  capability readback or resolve the conflicting status-bit definitions.

## Exact-watch observations

Firmware labels, in received order, from the operator's VERNO reply:

- `C403H_RFHZ_V52_EN_750_V1.3_2025.03.10_18.29.29`
- `C403H_RFHZ_V52_EN_04R6_V1.3_2025.03.10_18.29.29`

The parser now accepts this two-label reply without assigning undocumented roles
to either label. A firmware string alone does not establish BT/TM capabilities.

The operator's wrist measurement produced `btemp2,1,36.68` at
2026-09-15T14:53:33.336Z, matching the displayed value at approximately 18:53
Mauritius time. This proves an observed manual upload path. It does not prove
that a remote request, a native cycle, or a worn detector works.

During the worn → removed → worn-again comparison, all 14 retained fresh UD_LTE
samples had `00000000` status. No CONFIG BT/TM report was observed in the supplied
routine diagnostics. Thus neither flipping bit polarity nor setting BT=2 from a
firmware name would be justified.

## Concrete next hardware tests

### 1. Establish remote temperature separately from scheduling

The protocol distinguishes:

| Mechanism | Documented condition | Proof needed |
| --- | --- | --- |
| `bodytemp2` | BT=2 | One request with no manual button press, reply if provided, a new `btemp2` upload, and a watch-display comparison. Repeat under controlled conditions. |
| `bodytemp,1,hours` | BT=2; hours 1–12 | Multiple unattended readings at the requested interval, timestamps, reboot/reconnect behavior, battery impact and a proven stop procedure. |
| `BTTIMESET,...` | TM=1; separate timing mode | Exact-device mode and daily/once behavior before introducing an alternative scheduler. |

First obtain current CONFIG BT/TM evidence or the supplier's exact-build support
confirmation and readback method. Do not repeatedly reboot to solicit CONFIG;
that already failed to produce it. Do not issue a guessed CONFIG query.

The existing `npm run wellness:routine -- --request-temperature` remains a
single-request test guarded by current-session BT=2 and consent. A supplier-
approved exploratory test for firmware that never reports CONFIG should be a
separate bounded operator trial with raw reply/upload comparison, not a change
to the routine's capability gate. There is no new bypass flag in this change.

### 2. Test the documented removal-alarm switch

The operator has now requested this supervised test. `npm run wear:trial`
reads current-session diagnostics. `npm run wear:trial -- --enable` sends
exactly one `REMOVE,1`; `npm run wear:trial -- --disable` sends `REMOVE,0`.
The strict-admin runtime targets its configured pilot, rechecks that exactly one
session is connected immediately before dispatch, and rejects arbitrary payloads.
Repeated enable requests have a two-minute cooldown; disabling remains available.
An HTTP timeout is an uncertain handoff and never causes an automatic retry.
These commands do not select a routine, accept a wearing bit or enable SMS.

Prepare a supervised test of `REMOVE,1`, recording the previous setting and how
to restore it. `REMOVE,0` is a documented disable command, but a bare reply does
not report the previous/current setting or prove restoration. Settings may
persist. Do not enable REMOVESMS or change notification destinations for this
test; existing device alert behavior must be known before enabling an alarm.

After the enable reply, collect fresh status/alarm packets while the watch is
securely worn, removed and stationary, then worn again. Repeat the transition
sequence. Preserve physical transition times, device observation times and
receipt times. Compare all status bits; do not fit a polarity rule to one trace.
Use the existing `wear:check -- --save=<marker>` captures for each stage.

Operator sequence (PowerShell, in the gateway directory):

1. Pull this feature branch and restart the gateway process to load the new
   strict-admin action and reply parser. Keep the watch and ngrok running.
2. Wear the watch securely. Run `npm run wear:trial -- --enable` once. If it
   fails or reports an uncertain handoff, inspect the output before continuing.
3. Request fresh observations with
   `npm run wifi-home:check -- --request-location`. This location request does
   not prove wearing. Wait 60 seconds, then run
   `npm run wear:check -- --save=removal-enabled-worn` and
   `npm run wear:trial` to save/inspect the baseline and command reply.
4. Remove the watch, put it on a table and record the physical removal time.
   After 90 seconds, save `npm run wear:check -- --save=removal-enabled-off`.
   If all sample timestamps precede removal, request another location observation
   and wait for fresh samples; do not interpret an unchanged old capture.
5. Wear it again, record the time, wait 90 seconds and save
   `npm run wear:check -- --save=removal-enabled-on-again`.
6. Request OFF with `npm run wear:trial -- --disable`, then inspect
   `npm run wear:trial` for a subsequent reply. OFF is the chosen cleanup state,
   not proof of restoring an unknown original state. A disconnected watch needs
   cleanup after reconnection; a bare reply alone does not prove applied OFF.

Complete the first comparison before repeating cycles or attempting a
temperature schedule. Preserve all three captures even if the bits stay zero.

The change in this investigation makes `REMOVE` replies recognizable command
echoes with no extra ACK. `wellness:routine` also exposes bounded
`commandReplyEvidence` summaries for REMOVE, REMOVESMS and the documented
temperature commands. These summaries contain command, count, time and argument
count only. They reset on a new session/process, send nothing, and cannot mark a
setting, wearing state or schedule as verified.

Acceptance requires a repeatable positive worn signal as well as removal,
including lying on a table, held in a hand, charging, reconnect and stale-data
cases. A removal alarm alone can support “removal detected”; the alarm clearing
cannot establish “worn again.” If bit 3 remains unused, obtain the supported
contact-status packet or exact-device firmware update from ReachFar. If the
hardware cannot expose that evidence, reliable automatic wearing detection
requires a different validated device or an explicitly manual wearer check-in.

## Recommended automatic behavior once capability is proven

Prefer gateway-scheduled single readings, if the watch supports them, when
wearing confirmation must control each measurement. For each Gentle/Balanced
due time, check current consent, battery/connectivity and fresh accepted wearing
evidence before dispatch. If removed or unknown, skip/defer with a recorded
reason; never fill a missing value with zero or replay a backlog of measurements
on reconnect. Persist due slots and dispatch state so a gateway restart does not
duplicate requests. Match each metric upload to its own request window and
retain the distinction between receipt time and proven measurement time.

Native watch cycles can continue while the gateway is disconnected or cannot
deliver a stop command. They should only be chosen if exact-watch testing proves
the required local contact gating and stop behavior. Selecting Manual in the UI
must distinguish a stop request from a confirmed stop.

This recommendation does not change current routines, pilot permissions,
customer availability, wear acceptance, native settings or stored readings.
