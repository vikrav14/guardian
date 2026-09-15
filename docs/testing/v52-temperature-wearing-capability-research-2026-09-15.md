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
  particular V52. Customer routine builders retain the original V52 protocol's
  lowercase command; a separately selected strict-admin uppercase comparison
  is available as described below, with no automatic fallback.
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

### Supervised removal trial result, 2026-09-15 18:53 UTC

The operator ran the REMOVE enable test and reported the following. No new
hardware command was sent remotely while recording this result.

| Evidence | Observation | Meaning |
| --- | --- | --- |
| Enable reply | Bare REMOVE received at 18:44:26.739 UTC | Command reply observed; no setting readback. |
| Worn baseline | Seven UD_LTE packets through 18:46:01 UTC, all status `00000000` | No positive wearing bit in the baseline. |
| First off-watch capture | Captured at 18:50:04.149 UTC; 13 UD_LTE packets, all zero | No removal bit had appeared in that capture yet. |
| Subsequent removal alarm | AL_LTE observed at 18:50:43 UTC, received at 18:50:47.073 UTC; status `00100000`, bit 20 true, bit 3 false | First direct exact-watch removal-alarm packet in this trial. |
| SMS reported by operator | Two messages saying the device had been removed | Existing device alert configuration also generated SMS. This does not establish two distinct removals; only one AL_LTE packet is retained here. |
| Worn-again capture | Captured at 18:53:03.557 UTC, latest packet still the alarm received at 18:50:47.073 UTC | No later observation to demonstrate restoration; latest packet receipt is about 136 seconds old. |
| Initial cleanup attempt | Disable helper returned "One connected pilot watch session is required; nothing sent." Read-only status then showed connected false. | OFF was not sent or queued at this attempt. See the subsequent cleanup exchange below. |

All times above are UTC; add four hours for Mauritius (alarm at 22:50:43).
The exact physical removal and put-back times and any vibration remain to be
provided. Therefore detection latency and repeatability cannot be established.

Conclusion: the exact watch can emit the documented removal-alarm bit. This is
stronger evidence than the earlier all-zero snapshots and must not be described
as "no removal signal." Reliable positive worn/restored detection, a persistent
current wearing state, and automatic measurement gating remain unverified.
The runtime correctly retains unknown rather than treating an old removal alarm
or its absence as current worn evidence.

### Cleanup exchange and connection issue, 2026-09-15 19:01 UTC

The operator reported repeated "Watch reconnecting" messages during this trial.
The 22:56:29 Mauritius screenshot showed a last check-in about five minutes old;
the runtime had independently reported no connected session. The timing makes
the trial a possible contributor, but does not establish why the session ended.

The next read-only `wear:trial` showed `connected: true`. One disable request was
then handed off as `REMOVE,0` at **19:01:35.448 UTC** (23:01:35 Mauritius). The
subsequent inspection showed one bare `REMOVE` reply received at
**19:01:36.300 UTC**, 852 milliseconds later, and `connected: true`.

The cleanup command exchange is now observed. A bare reply does not read back
the applied setting, so `settingsConfirmed` remains false. Current wearing
status remains unknown. There is no need to repeat the disable command solely
because these acceptance fields remain false.

The subsequent supplied logs establish an initial stable observation window,
described below. Keep this removal trial paused. Stability after the disable
exchange does not alone prove causation or the stored setting.

Do not change REMOVESMS, SOS numbers or global alarm mode based solely on the
two SMS messages. Future removal trials must explicitly account for both the
observed SMS side effect and the reported connection instability.

### Gateway log review through 19:09:13 UTC

Reviewed the operator's `Pasted text(20260915-190931).txt` export (933 lines),
including the gateway session started at approximately 18:43:40 UTC. This source
includes several earlier gateway starts and recovery probes; they must not all
be attributed to the later removal test.

- The first `REMOVE,1` in this trial is followed by its bare reply at
  18:44:26.739 UTC. The gateway recognizes it without sending another ACK.
- Three short unidentified TCP connections occur around 18:46–18:47 UTC, with
  two parse-error events. They use different socket endpoints from the watch
  connection. The identified watch continues to deliver location packets after
  these connections close. Their origin is unknown; these are not three proven
  watch reconnects.
- The identified watch connection closes after the alarm received at
  18:50:47.073 UTC and before the next timestamped background poll at
  18:53:41.069 UTC. The old close line has no timestamp, error status or end-event
  evidence, so the exact close time and initiator cannot be recovered from it.
- There is no logged socket error, idle-timeout destroy or gateway restart
  around that close. Background schedulers continue through the gap. This
  argues against a gateway process crash or the logged idle-destroy path; it
  does not identify the watch firmware, carrier, tunnel or another cause.
- A new identified session has a packet by 19:01:05.110 UTC. `REMOVE,0` is sent
  once, followed by the bare reply at 19:01:36.300 UTC.
- Eight location packets arrive from 19:02:00.652 through 19:09:13.906 UTC,
  approximately 62 seconds apart. There is no further disconnect, recovery
  probe or socket error in this portion of the supplied log. The operator's
  accompanying read-only check still reports connected. This is about 7 minutes
  38 seconds of evidence after the OFF reply, not a long-term reliability test.

The observed connection gap overlaps the removal-alarm trial. A causal link
remains unproven. The earlier packet-silence probes predate `REMOVE,1` and cannot
be presented as effects of that command. The Wi-Fi Home candidate/expiry states
continue while packets are arriving, so they also must not be equated with TCP
disconnection.

Additive connection diagnostics now timestamp connect/error/close logs and
include the last received-data time, peer end-event time, socket error code,
close error flag and byte totals. The existing idle-destroy path marks its own
reason and request time. An observed peer end can originate from the local
tunnel agent and is not proof that the physical watch initiated the failure.
Absent cause evidence remains null rather than being guessed. This changes no
timeout, retry, ACK, device command or connection-state policy. It becomes active
on the next gateway restart; a restart is not required to preserve the current
post-disable observation window.

### 1. Establish remote temperature separately from scheduling

The protocol distinguishes:

| Mechanism | Documented condition | Proof needed |
| --- | --- | --- |
| `bodytemp2` | BT=2 | One request with no manual button press, reply if provided, a new `btemp2` upload, and a watch-display comparison. Repeat under controlled conditions. |
| `bodytemp,1,hours` | BT=2; hours 1–12 | Multiple unattended readings at the requested interval, timestamps, reboot/reconnect behavior, battery impact and a proven stop procedure. |
| `BTTIMESET,...` | TM=1; separate timing mode | Exact-device mode and daily/once behavior before introducing an alternative scheduler. |

The follow-up review distinguishes the BT=2 firmware variant from receiving a
CONFIG handshake first. The original documentation does not require that
handshake before a single measurement. The operator requested further supervised
engineering tests before supplier contact. The known manual `btemp2` upload is a
reason for a bounded experiment, not proof of remote measurement or a schedule.
Do not repeatedly reboot to solicit CONFIG or issue a guessed CONFIG query.

The existing `wellness:routine -- --request-temperature` and automatic routines
retain their BT=2 checks. A separate strict-admin `temperature:trial` sends only
one documented lowercase `bodytemp2` by default. A separately selected uppercase
comparison sends only `BODYTEMP2`. Both require pilot/request/ingestion flags,
current consent, one unchanged connected session with a packet received within
three minutes, no selected automatic routine or known possibly running schedule,
and an explicit operator report that the watch is worn. Missing BT permits this
experiment. A reported incompatible BT remains blocking even if a later partial
CONFIG omits BT. No mode, wearing state or customer acceptance is promoted.

After pulling the branch and restarting the gateway, wear the watch normally
and do not press its temperature button. In the gateway directory run:

```powershell
npm run temperature:trial -- --once --worn --include-values
```

The helper sends once and polls for up to two minutes. Record whether the watch
starts measuring or vibrates, the physical time and its displayed result. The
capture separates a bare command reply from a subsequent temperature upload;
temporal proximity alone does not prove the request caused the measurement.
No native schedule, SMS or REMOVE command is sent, and there is no retry.

After a timeout or uncertain handoff, inspect without sending another request:

```powershell
npm run temperature:trial -- --include-values
```

At most ten packet records are retained, with bounded numeric fields including
sentinels marked unverified. Values require explicit opt-in and a fresh consent
check; they expire ten minutes after the two-minute capture window. Metadata
remains until the next trial/process restart. Capture is tied to the original
session. Existing temperature ingestion still rejects unvalidated shapes and
sentinels. A manual control after the capture window can distinguish a failed
remote command from a sensor/upload failure. Do not enable unattended cycles
from one successful comparison or automatically try another command casing.

### First supervised remote temperature result, 2026-09-15 19:42 UTC

The operator ran `temperature:trial -- --once --worn --include-values` using the
new single-request tool. The capture reported:

| Event | UTC receipt/request time | Evidence |
| --- | --- | --- |
| One `bodytemp2` request handed off | 19:41:57.700 | The current session had no reported BT mode. |
| Bare `bodytemp2` reply | 19:41:59.750 | Acknowledgement arrived 2.050 seconds after the request. |
| `btemp2,1,36.68` upload | 19:42:20.834 | Numeric upload arrived 23.134 seconds after the request, in the same session. |

The final inspection still showed connected, with one reply, one upload, zero
rejected packets, zero duplicates and zero dropped entries. Mauritius local
times are 23:41:57.700, 23:41:59.750 and 23:42:20.834 respectively.

This is direct evidence of a remote command acknowledgement followed by a
temperature upload without a CONFIG prerequisite. At approximately 23:49 local,
the operator reported that the watch did **not** vibrate and its history still
showed **36.68 at 18:53:31**, with no new history entry from the 23:42 request.
The returned value therefore matched a history entry about 4 hours 49 minutes
old. The operator-worn CLI flag is manual test context, not sensor-confirmed
contact.

Conclusion: **fresh measurement not demonstrated; consistent with a cached
upload**. This does not establish that remote measurements are impossible or
that a silent background measurement must appear in local history. The packet
has no measurement timestamp, so its new receipt time cannot establish a new
measurement. Keep temperature labelled as received, with measurement time and
freshness unknown; do not use it to verify a schedule or current skin contact.
The experiment's
`measurementConfirmed`, `requestCausedUpload`, `wearingConfirmed` and
`scheduleVerified` fields are deliberately false until separately evaluated;
they are not failure flags supplied by the watch.

### Next supervised comparison: explicit uppercase command

The original protocol spells the one-shot command `bodytemp2`, while flespi's
ReachFar V48 changelog spells it `BODYTEMP2`. This supports testing case as one
variable, not assuming support on this V52 or changing production routines.

After pulling the update and restarting the gateway once, wait for a connected
pilot session with a fresh packet. Keep the watch worn normally, record its
latest history entry, and do not take a new manual temperature immediately
beforehand: that would make a cached response harder to distinguish. Run:

```powershell
npm run temperature:trial -- --once --worn --uppercase --include-values
```

The helper sends exactly one `BODYTEMP2`; it never retries with lowercase.
Uppercase and lowercase share the two-minute cooldown and the same consent,
session, mode and routine checks. The parser recognizes both command replies
without acknowledging them; the capture records the selected command, actual
reply spelling and whether they match. It never interprets either reply as a
successful measurement. Health-value capture limits and expiry are unchanged.

Watch for an automatic measurement screen, progress, result or vibration, and
then inspect history without pressing the measurement button. Compare the
uploaded value and any new history time after the two-minute window. A reply
or upload alone remains insufficient. If history is unchanged again, record
that result rather than enabling a native schedule or repeatedly probing.
An off-wrist comparison and full removal/restoration trace remain separate
tests. No native schedule, SMS, removal-alarm or night-mode setting is changed.

### Uppercase comparison result, 2026-09-15 19:58 UTC

The operator ran `temperature:trial -- --once --worn --uppercase --include-values`.
Trial `d824a8ec-9c33-43bf-b742-cd33edb53e74` recorded:

| Event | UTC request/receipt time | Evidence |
| --- | --- | --- |
| One `BODYTEMP2` request handed off | 19:57:52.846 | Missing BT mode; explicitly supervised worn context. |
| Bare `BODYTEMP2` reply | 19:57:53.727 | Exact requested spelling, 0.881 seconds after dispatch. |
| `btemp2,1,36.73` upload | 19:58:15.001 | 22.155 seconds after dispatch; different from the earlier 36.68 value. |

The same session remained connected, with one reply, one upload and no rejected,
duplicate or dropped entries. The upload receipt corresponds to **23:58:15.001
Mauritius time on 15 September**. The operator subsequently confirmed that
history still showed the 18:53 entry, there was no vibration, and **no manual
temperature measurement was taken between the two remote tests**.

This strengthens the evidence for remote measurement: the response was not
identical to the previously observed value. However, a changed value alone
does not establish measurement time or exclude a refreshed internal reading,
or prove that uppercase is required. Both trials returned uploads approximately
22–23 seconds after dispatch. The earlier lack of vibration/history change was
consistent with caching but did not prove it; silent background measurements
remain another possibility to investigate. The operator confirmation rules out
an intervening manual measurement as the explanation for 36.73. It is too strong
to call the first result a proven cached replay. Neither vibration nor a local
history entry is documented as required for a remote measurement on this build.

The diagnostic confirmation flags remain false by design; neither a schedule
nor worn/restored detection is accepted by this result.

### Controlled wrist / removed / wrist comparison

The next comparison uses **the same uppercase command in each position**, no
manual temperature measurement between stages and no settings changes. Reuse
the 36.73 worn trial as baseline while its operator context is clear.

1. Remove the watch and rest it on its strap/side on an ordinary room-temperature
   table, leaving the sensor back uncovered and away from skin. Wait five minutes.
   This is a consistent experimental interval, not a validated firmware settling
   requirement. Do not heat, chill or immerse the device.
2. Run one explicitly labelled removed trial:

   ```powershell
   npm run temperature:trial -- --once --removed --uppercase --include-values
   ```

3. Refit normally, wait the same five minutes, then run one worn trial:

   ```powershell
   npm run temperature:trial -- --once --worn --uppercase --include-values
   ```

Preserve both outputs and physical transition times. Operator labels remain
manual test context and never set customer wearing status. Numeric results
while removed mean temperature responses alone cannot establish wearing. An
off-wrist failure/sentinel followed by worn recovery is a candidate rejection
signal, not validated contact detection. A value decrease off-wrist and increase
after refitting supports sensor responsiveness; an unchanged value or absent
upload is inconclusive. We do not fit a medical threshold or infer removal from
silence. Local vibration/history is supplementary observation, not a mandatory
success condition.

Before a removed request can be dispatched, a local per-pilot exclusion marker
is saved under `gateway/data/temperature-trials`. Incoming pilot temperature
events are marked at receipt and rejected by the wellbeing store, independently
of evidence-capture limits/errors. The marker contains no health values. It
survives reconnects and restarts on the same gateway data directory, and remains
after timeout until an explicit worn trial is successfully handed off. Failed
or uncertain worn sends do not release it; cleanup failure remains visible and
keeps intake blocked. Moving to another gateway without that data directory is
not supported during this diagnostic sequence. The read-only trial status
exposes `temperatureIngestionSuppressed` even when no capture survives restart.

Other metrics and ACKs are unchanged. No native schedule or removal/SMS command
is sent. Resume is an operator declaration of the test position, not proof of
contact or the measurement time of a subsequent packet; delayed uploads still
lack a request ID/timestamp and cannot be promoted to verified readings.

### Removed / worn comparison results, 2026-09-15 20:20–20:27 UTC

The operator supplied both labelled outputs from the comparison:

| Operator position | Request UTC | Bare uppercase reply UTC | Upload UTC | Raw fields | Request-to-upload | Intake exclusion reported |
| --- | --- | --- | --- | --- | --- | --- |
| Removed | 20:20:15.371 | 20:20:16.293 | 20:20:37.323 | `1,36.53` | 21.952 seconds | true |
| Worn again | 20:26:45.195 | 20:26:46.692 | 20:27:07.534 | `1,36.64` | 22.339 seconds | false |

These correspond to **00:20 and 00:27 on 16 September in Mauritius**. Each
capture stayed on its original connected session, with one matching-case reply,
one numeric upload and zero rejected, duplicate or dropped entries. Trial IDs
were `9b325fe4-e95f-43a6-ae1b-9d2856084b4f` and
`914b1dc3-c319-4775-84e8-572e10816a71` respectively. The removed trial was explicitly
labelled engineering-only. Its intake exclusion was reported active; the worn
handoff reported the exclusion released. This records the diagnostic states,
not a separate audit of live Firestore writes.

Together with the earlier 36.73 worn response, the values changed 36.73 → 36.53
→ 36.64. That is consistent with a responsive sensor or changing internal
estimate, but this single sequence does not establish which, measurement
accuracy, or freshness of every response. The 0.11-degree increase after
refitting is not a defensible contact threshold. Exact physical transition
times and settling durations were not independently captured.

The concrete finding is that this remote command repeatedly produces a reply
and temperature upload about 22 seconds later, **including while removed**.
The removed response contains the same leading `1`, not an explicit failure or
rejection. Neither that field nor a numeric temperature can qualify wearing.
No customer wearing acceptance, BT/TM mode or unattended schedule is promoted.

The operator also cited protocol sections 32–34. Those match page 9 of the
supplied Communication Protocol PDF: one request (`bodytemp2`), a BT=2 hourly
cycle (`bodytemp,enabled,hours`, 1–12 hours), and a separate TM=1 clock-time
schedule (`BTTIMESET`). The existing code maps Gentle to 12 hours and Balanced
to 8 hours. The document establishes an automation mechanism; the returned
values do not establish contact gating or operation of an unattended cycle.
The lowercase cycle builder is not changed on the strength of uppercase
single-command trials, and TM=1 is not inferred from temperature uploads.

Next, obtain the already-collected status trace for this same physical
comparison without changing watch settings or repeating temperature requests:

```powershell
npm run wear:check -- --save=temperature-wear-comparison
```

Inspect `receivedStatusTrace` around 20:20 and 20:27 UTC, including full bitmaps,
changed bits, receipt/device times and session boundaries. This is a bounded
120-entry trace, so coverage must be checked before interpreting an absent
transition. The save label marks inspection time, not a physical removal time.
REMOVE was last requested OFF after the earlier supervised trial; no removal
alarm in this window would not establish that the hardware lacks detection.
Reliable restoration evidence remains separate from the observed removal alarm.

### Status trace across the temperature comparison, 2026-09-15 20:34 UTC

The operator saved `temperature-wear-comparison` at 20:34:14.854 UTC (00:34 on
16 September in Mauritius). The persisted gateway update was 20:33:52.934 UTC.
The trace contained one session-start marker at 20:20:12.971 UTC and **13 live
UD_LTE status samples**, from device time 20:20:36 to 20:33:49 UTC. All samples
reported `00000000`, empty `setBits` and empty `changedBits`; zero trace entries
were dropped. All 13 were classified as live samples, not stale/history rejects.

This covers packets near the removed temperature upload (20:20:37) and the worn
request/upload (20:26:45–20:27:07), plus subsequent worn observations. No bit in
these reported status fields differentiated the labelled positions. The first
sample was after removal, so the trace does not include the initial worn-to-
removed transition. It does cover the later labelled removed/worn comparison.
The exact physical put-back time remains operator context, not a watch event.

This rules out retention drops or stale-sample filtering as explanations for a
missing difference within the 13 received packets. It does not prove that all
device packets were delivered or that the hardware lacks a removal detector.
REMOVE was last requested OFF at 19:01:35.448 UTC, with a bare reply; applied
configuration is not read back. The earlier enabled trial did produce an
AL_LTE bit-20 removal alarm and reported SMS. That trial's missing fresh
post-return packets and connection gap still leave restoration unresolved.

The next useful test is a bounded repeat with REMOVE enabled, fresh baseline
and post-return packets, and the new receipt/connection diagnostics. The
temperature requests are not repeated for this purpose. Current evidence of a
continuous session and 13 fresh samples supports a supervised retry, not a claim
that the earlier disconnect cause is fixed. Existing removal SMS may recur;
no REMOVESMS, recipient, global alarm or native temperature-cycle setting is
changed. Do not label zero as worn or promote acceptance from an enable reply.

Start while wearing the watch: send `npm run wear:trial -- --enable` once,
wait two minutes, then save `npm run wear:check -- --save=enabled-worn-baseline`
and inspect `npm run wear:trial`. Review that baseline and connectivity before
removing the watch. For the subsequent off/return comparison, record physical
transition times immediately, allow a bounded observation period in each state,
and ensure fresh packets after return. Retain an off-wrist interval after any
alarm to see whether its bit clears while the watch is still removed. Cleanup
remains `npm run wear:trial -- --disable` followed by a read-only reply check;
if disconnected, finish cleanup on reconnection. An alarm clearing is not a
positive worn-restoration signal.

### Enabled repeat and second connection gap, 2026-09-15 20:43–20:59 UTC

The operator supplied `Pasted text(20260915-204525).txt`,
`Pasted text(20260915-205143).txt` and
`Pasted text(20260915-205925).txt` for the supervised repeat. Times below are
UTC; Mauritius times are four hours later, on 16 September.

| Evidence | Observation | Meaning |
| --- | --- | --- |
| Enable handoff/reply | `REMOVE,1` handed off at 20:43:36.322; bare `REMOVE` reply at 20:43:37.254 | Command exchange observed, without applied-setting readback. |
| Initial baseline | Inspection at 20:44:06.303 still ended with a packet received at 20:43:10.013 | This capture preceded the enable at the packet level; it cannot establish post-enable wearing status. |
| Fresh worn baseline | Five live UD_LTE packets at device times 20:44:08, 20:45:10, 20:46:12, 20:47:14 and 20:48:16, all `00000000`; read-only runtime connected | Positive wearing bit still absent while operator reports worn after enable. |
| Removal alarm | AL_LTE at device time 20:55:00, received 20:55:03.658, status `00100000`; set/changed bits both `[20]` | Second observed exact-watch bit-20 removal alarm across these supervised trials. |
| Connection boundary | `session_disconnected` recorded at 20:57:37.320 | Connection ended 153.662 seconds after the alarm receipt; the trace does not record who initiated it. |
| Removed inspection | At 20:58:54.144, 34 status packets in the trace, zero dropped entries, no status after the alarm; runtime `connected: false` | Neither an alarm-clear observation nor a fresh restored/worn observation is available. |
| Operator SMS | Removal SMS reported at approximately 00:58 Mauritius | Reported SMS receipt follows the platform alarm by about three minutes. Exact SMS dispatch/delivery timestamps and physical removal time were not supplied. |

`gatewayUpdatedAt` at 20:57:37 reflects the disconnect update, not a new wearing
sample. Empty current-session command replies after disconnect do not undo the
previously captured REMOVE reply. The exact removal time requested with
`Get-Date -Format o` is absent from the supplied export, so sensor detection
latency cannot be calculated from this capture.

This repeats the sequence of an observed removal alarm followed by a connection
gap. It strengthens the reason to investigate that sequence, without proving
that REMOVE, SMS, the watch, carrier, tunnel or gateway caused the disconnect.
The document's I.4 requires a bare `AL` response for AL_LTE. The current decoder
constructs that response and the server writes ACKs before asynchronous event
handling; there is no removal-specific socket-close branch. Source inspection
does not prove that an ACK reached or was accepted by the physical watch.

Before repeating removal cycles, preserve the gateway console around
20:54–20:59 UTC, especially the timestamped `[tcp] disconnected` JSON and any
preceding error, silent/recovery or idle-timeout line. The added fields
`lastDataAt`, `peerEndAt`, `hadError`, `socketErrorCode`, `localCloseReason` and
`localCloseRequestedAt` distinguish recorded transport events and a local idle
destroy. A peer end can originate from the tunnel agent and does not identify
the physical cause. Returning the watch to the wrist may be recorded with an
immediate physical timestamp, but requires fresh packets after reconnection
before making any restoration claim. Finish the chosen REMOVE-OFF cleanup
once connected. No SMS/alarm-mode setting, acceptance flag or automatic
temperature routine was changed while recording this result.

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

`wear:check` now includes `receivedStatusTrace`: full 32-bit status, changed/set
bits, receipt/device times, session boundaries and filter reasons recorded before
the freshness/order filters. This includes same-timestamp, late, out-of-order and
buffered status evidence omitted by the old sample list. It retains at most 120
entries per device across socket reconnects, with a 128-device memory cap; process
restart starts a new in-memory trace. Original accepted samples remain separate.
A fresh removal signal at the same timestamp as the latest accepted packet now
immediately cancels worn eligibility; it cannot establish positive wear, and
older history cannot override newer proof.

The removal enable test was paused during the initial connection investigation
and temperature experiments. The 20:34 trace supported a bounded supervised
retry with the updated diagnostics. That repeat also ended without a post-alarm
status packet before disconnect, as recorded above. Inspect the captured close
diagnostics before repeating removal cycles. Any continuation of the worn/off/
worn comparison must record physical transition times and fresh packets in
every stage; restoration remains untested. An alarm clearing while the watch
is still on a table would establish that clearing is not a current positive
contact indication.

The companion example declares `000b` for both `REMOVESMS,1` and bare `REMOVESMS`,
although the latter is nine characters (`0009`). Use the frame builder rather
than literal sample envelopes. The original documents disagree on the takeoff
switch's command name; another manufacturer's protocol separates detector and
SMS switches, but that is not exact-watch proof. The REMOVE test already produced
AL and SMS, so changing REMOVESMS is unnecessary merely to inspect restoration.

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
