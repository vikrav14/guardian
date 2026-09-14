# Wellness pilot resume — 14 September 2026

PR #119 implements steps; PR #120 includes #119 and adds watch readings.
Both now include the merged journey durability fix from #124. Shared screens
and edition windows are implemented; physical acceptance is still outstanding.
Merge #119 first, then #120 after their respective acceptance evidence is complete.

## Start with current evidence

From `gateway`, with the existing Firebase configuration:

```powershell
npm run wellness:check
```

This uses the watch already selected by `WIFI_HOME_PILOT_IMEI`. To inspect another
authorized pilot, pass `-- --imei <15 digits>`. The command reads Firestore only:
no writes, watchers, pedometer activation, consent changes or measurement requests.
It omits identity, coordinates, secrets and numerical health readings by default.

For an explicit comparison with the watch display, use:

```powershell
npm run wellness:check -- --include-reading-values
```

This adds the three latest stored readings per supported metric, with their
times, quality and displayability. It still requires current consent and only
prints the known numerical heart/BP/oxygen fields. Treat this optional output
as private acceptance evidence; do not copy personal readings into public PRs.
Matching a watch display verifies transport, not physical sensor accuracy.

The report includes local configuration flags, the backend heartbeat and its age,
the last raw step counter and its age, today/yesterday's daily records, current
wellbeing consent and up to 500 uploads from the last 25 hours. It reports upload
counts, freshness and maximum gaps separately for heart/BP and oxygen. Missing
consent prevents reading health history. A consent recheck suppresses results
if consent changed during collection. Truncation is explicit.

Configuration is loaded by this command, not queried from the running gateway.
Restart the gateway after pulling code or changing its environment. A stored
online flag alone does not prove a live session; check heartbeat age. Uploads
do not establish that a schedule is currently active, and transport evidence
does not establish sensor accuracy. Do not enable customer flags from this report.

## Physical acceptance sequence

| Stage | Capture | Pass evidence still needed |
|---|---|---|
| Baseline | Read-only report and on-watch step count | Recent telemetry; raw value matches watch after delayed updates settle |
| Stationary | 30 minutes flat/untouched indoors, then outdoors | Measure false increments without carrying or handling the watch |
| Controlled walks | Three 100-step walks worn normally, then a longer measured walk | Record actual steps, watch/backend deltas and agreed tolerance; repeat on another V52 |
| Restarts | Watch reboot and gateway restart as separate tests | No invented steps, lost accepted total or incorrectly hidden reset |
| Midnight | Samples on each side of midnight in Mauritius | Exact-device reset semantics; yesterday never presented as today |
| Wellbeing baseline | Verify current wearer consent before requests | Match wearer-initiated values with the confirmed `bphrt`/`oxygen` uploads |
| Hourly trial | Explicitly authorized `hrtstart,3600` trial for 24 hours | Per-metric reliability, missing uploads, battery/data impact and failure/reboot behavior |
| Privacy/display | Consent revocation and deletion; Essential/Family/Care views | Current consent enforced, date windows correct, stale/missing readings honest |

Keep step ingestion in `unverified` mode and customer surfaces off during
acceptance. Wellbeing ingestion also requires current backend-owned consent.
Previous scheduled uploads were observed on one pilot in August; they do not
prove a schedule is still active today. Review current status before starting
or stopping a trial. The existing strict-admin controls remain unchanged.

## Scope and regression protection

- Shared contract: Essential today, Family seven calendar days, Care retained
  history. Weekly WhatsApp reports, AI comparisons and optional pattern notices
  remain separate follow-up work.
- Skin temperature remains "Not available yet" pending exact-device validation.
- Supplementary step writes are serialized per watch and do not block live GPS
  or SOS. Failed writes do not consume counter resets in memory.
- Historical GPS follows #124's durable recovery path and cannot contribute an
  old counter to today's activity or trigger retrospective live alerts.
- Existing journey recovery, SOS, Firestore authorization and Flutter release
  gates must remain green alongside these physical tests.

The earlier August handoff files are historical evidence, not the current
edition contract or confirmation of today's watch configuration.

## Evening pilot checkpoint

The latest operator check confirms a daily shadow activity record and one
heart/BP plus one oxygen upload. Customer visibility remains disabled and
device modes remain unverified. The watch display and uploaded step counter
both increased by 14 between the supplied before/after readings, but their
absolute totals differ. A different reset baseline is possible, not yet
established. No known counted distance or
controlled step count was supplied, so this is not an accuracy acceptance.

Determine display versus upload reset behavior at midnight and on watch reboot
before accepting a daily-total counter mode. Do not subtract a fixed observed
offset or equate the uploaded counter with today's total. Temperature was
reported on the watch; its network payload has not been supplied or validated.
