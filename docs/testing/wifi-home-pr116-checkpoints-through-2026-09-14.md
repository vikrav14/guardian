# PR #116 historical checkpoints through 14 September 2026

Archived from the PR description before the merge closeout. These are historical
checkpoints; earlier next steps, pending merge wording and runtime numbers are
superseded by [the current merge scope](wifi-home-private-pilot-merge-2026-09-14.md).
Experimental walk recovery now has a separate default-off flag. No hardware
acceptance is granted by preserving this history.

---

## Implemented: recover corroborated short walks after Home expiry

Commits `435490d` and `5823210` fix the case where every usable GPS sample arrives while Home Wi-Fi still has priority, then no GPS arrives after radio expiry. PR #116 remains **draft and unmerged**, pending physical acceptance of the new behavior.

### Remaining walking logic reviewed — documentation only

Review `f16f1a5` preserves runtime `5823210`. [Findings, physical evidence, proposed timeline and integration boundaries](https://github.com/vikrav14/guardian/blob/f16f1a58185d7de0e8e22bc74c568e94c432a106/docs/testing/near-home-walking-logic-review-2026-09-14.md).

- Latest retest: eight GPS fixes arrived after expiry, 11–60m from the earlier Home pin. None proves exit under the 50m zone plus 30m margin. Actual zone/journey functions reproduce no journey; pre-expiry recovery was not exercised.
- A synthetic post-Home replay also misses 100m in six 20m increments with reported speed zero and no zone restriction: the movement baseline rolls forward.
- First GPS arrived 1m46s after leaving. Automatic packet-silence CR is confirmed. Acquisition and journey qualification need separate work.
- An exploratory four-point/60s GPS rule admits both the observed segment and smooth stationary drift. It is not customer-ready confirmation.
- Recommend private near-Home candidates separate from exit alerts and reporting state. Confirmation needs validated corroboration, such as aligned step changes from #119; daily totals are insufficient. #120 readings are not required.

Preserve Home/SOS/source/zone protections, actual GPS coverage and single route ownership. No runtime, threshold or watch-command change follows from this review. No new walk requested. PR remains draft; recovery hardware acceptance and near-Home qualification remain open.

### New behavior

- Keep Home presentation and suppress movement while its enrolled-router evidence remains fresh. Privately retain a bounded GPS candidate batch; this creates no immediate departure.
- After the same radio observation expires, a one-second check may recover a corroborated walk without another GPS packet. Revalidate the Home/owner/plan binding and current zone snapshot, then apply the existing geofence and journey rules using original GPS times.
- Require at least two ordered, fresh valid GPS samples, the first outside Home, at least 20 seconds of span, gaps no greater than 60 seconds and coordinate-derived speed no greater than 3m/s. Displacement must cover both endpoint uncertainty margins (normally at least 60m when V52 supplies no accuracy). A confidently inside sample cancels the candidate.
- Bound retention to 16 samples and 120 seconds of freshness, with a five-second cancellable zone read. Renewed Home, a revoked/changed/expired binding, newer live GPS, stale samples and stop/restart cancel recovery. Duplicates and older delayed fixes cannot erase newer corroboration.
- Keep raw telemetry, ordinary location selection, normal live GPS tracking, dwell, SOS/ACKs, entitlement gates and reporting commands on their existing paths. New Home evidence closes the recovered journey at its last GPS endpoint; no Home coordinate is invented.

### Timeline for equivalent input to the earlier 14:56 marked walk

| Mauritius time | Expected behavior on the new code |
| --- | --- |
| 14:56:39 departure marker | Marker alone creates no journey. |
| 14:57:05 Home radio source | Existing Home evidence remains valid until 14:59:05. |
| GPS 14:58:13, received 14:58:17 | Retain outside-Home GPS provisionally; keep Home priority. |
| GPS 14:58:58, received 14:59:01 | Retain corroboration: about 69.4m between the two observed positions. |
| From 14:59:05, after checks/read | Recover the GPS-proven exit and active journey with original start 14:58:13; no further GPS required. |
| When Home qualifies again | Existing closure saves the observed segment. If no other GPS arrives, the route is about 0.069km / 45s, not the full physical walk. |

This does not backfill the previous missing record or fix the watch's return-reporting delay. The completed Journey view becomes eligible after closure. A short walk entirely inside/uncertain near Home, insufficient GPS, or a confidently inside return before candidate qualification can still remain unconfirmed.

[Full recovery rules, timeline and operator check](https://github.com/vikrav14/guardian/blob/feat/v52-wifi-home/docs/testing/home-wifi-short-walk-recovery-2026-09-14.md) · [Preserved pre-implementation physical evidence](https://github.com/vikrav14/guardian/blob/feat/v52-wifi-home/docs/testing/home-wifi-short-walk-evidence-2026-09-14.md)

### Verification and integration

**All 896 gateway tests pass locally on the committed file tree**, including 13 new buffer/recovery/lifecycle cases plus real dispatcher coverage and the existing GPS/Home/geofence/SOS/entitlement/reporting regressions. The tree uploaded through GitHub was verified identical to the tested local tree. Slow alert/flush delivery is isolated from tracking; a pending write cannot block the next recovery, and failed delivery is logged separately. **All four GitHub checks passed at `5823210`**: gateway, Firestore authorization, dashboard layouts/review images, and Flutter analysis/native tests/Chrome regression/Web release build. [Release gates](https://github.com/vikrav14/guardian/actions/runs/34841329173) · [Dashboard review](https://github.com/vikrav14/guardian/actions/runs/34841329171).

The earlier `19ed4ec` browser decoder fix remains: the operator confirmed the first saved 0.122km / four-point walk appears after reload. That screenshot is not acceptance of this new recovery path. The later logs put the second walk's samples 21–34m from Home, with no proven exit, while the third walk's first GPS was 107m away and held by still-fresh Home. Automatic packet-silence CR recovery is now confirmed in the console; reporting gaps remain.

Both #119 and #120 modify `gateway/src/server.js`. Preserve the new location hook and startup recovery callback when merging their integrations. Their gates, telemetry/consent rules and agreed edition split are unchanged.

**Operator update:** pull `feat/v52-wifi-home` and restart the gateway. No new router enrollment, watch provisioning or report interval is required. New physical acceptance and remaining PR #116 release gates are still open.

---

## Physical walk checkpoint — 14 September 2026 (Mauritius, UTC+04:00)

The operator supplied two redacted capture reports and a return dashboard screenshot while testing runtime `e9cad97` on `feat/v52-wifi-home`. Remote head `ebb4739` adds documentation only. This section records the new evidence; it does not change runtime, gates, draft status or the acceptance boundary.

### Second walk: departure and return are both captured

Capture `352cfbe420218f4428076c49` started at **13:30:13.463 MUT**, was stopped after the reported 960 seconds, and retained **all 35 timeline entries with zero drops**. Totals: 23 fresh/non-repeated location reports, including 4 GPS-valid reports; 12 Home-router sightings; 4 heartbeats; 2 CR handoffs and 2 CR responses; 4 operator markers; zero UPLOAD/WIFIFENCE handoffs and zero native fence bits.

| Event | Time on 14 September, MUT | Interpretation |
| --- | --- | --- |
| Departure marker | 13:36:06.274 | Operator marker, not independently verified physical movement |
| First subsequent GPS-valid report received | 13:36:47.997 | 41.723 seconds after departure marker; source time 13:36:41 |
| Fresh Home cleared | 13:36:48.956 | 42.682 seconds after departure marker; `signal_weak`, corroborated by the separately supplied checker; that GPS-valid packet still saw the enrolled router at -89 dBm |
| Return marker | 13:38:59.110 | 172.836 seconds after departure marker |
| First Home-router report received after return | 13:40:04.216 | 65.106 seconds after return marker; -70 dBm, source time 13:40:02 |
| Later sustained strong Home-router reports received | 13:44:58.838, 13:45:16.746, 13:45:40.721 | Three -70 dBm reports. They meet the radio count/span/gap thresholds by the third receipt, 401.611 seconds after return. This is packet-derived qualification evidence, not a recorded first publication time. |
| Latest acknowledged Home publication in the final checker | 13:47:03.846 | A usable Home publication is established by this time, 484.736 seconds after the return marker. The diagnostic retains only the latest publication, so this is NOT a measurement of the first return-to-Home publication. Its source is 13:45:57. |
| Final expiry/clear | Scheduled 13:47:57; clear 13:47:57.880 | `observation_expired`; history retains the original 13:45:57 source time |

The CLI transcript includes an attempted duplicate `--start`, rejected as `capture_already_running`; the original capture ID and timeline remained intact. An extra `at_home` marker at 13:38:46.572 precedes `returned_home` by 12.538 seconds. A further `left_home` command was cancelled; the report contains only one departure marker. Use the explicit departure/return markers for the timing above; do not infer another journey from the extra Home marker.

### Return delay: observed limitation requiring review

After the first post-return Home sighting, the next location report arrived 187 seconds later. Later scans were empty or weak (-77 dBm) before the sustained strong sequence at 13:44:58–13:45:40. Current `wifi-home-observer.js` policy requires at least three qualifying reports, signal at least -75 dBm, at least 20 seconds of source/receipt span and gaps no greater than 60 seconds. An isolated Home sighting therefore did not immediately restore fresh Home.

The trace explains why one early sighting was insufficient and identifies a multi-minute return acquisition delay. It does not establish a normal service latency, an exact first Home-publication time, or the physical/firmware cause of missing/weak scans. Inspect the existing recovery/request and publication timelines before choosing a change; do not relax evidence quality, increase the Home radius or introduce continuous polling solely from this one trial.

CR handoffs occurred at **13:34:12.886** (113.388 seconds before departure) and **13:43:06.274** (247.164 seconds after return). The first GPS result fell within the documented temporary-burst window of the earlier CR. The capture does not identify request origin/reason; automatic versus manual origin must be verified from gateway logs. The measured departure timing is not an unassisted-reporting benchmark.

### App evidence and final status

The supplied return screenshot (`2026-09-14_13h47_32.png`) shows **Home Wi-Fi detected · 1m ago**, Home-labelled map/avatar, the retained **GPS fix 10m ago** described separately, watch connected and battery 98%. This supports return Home presentation on the dashboard; the filename is not used as a precise acceptance clock.

The subsequent checker shows `publishedHomeFresh=false` after the original expiry, with `lastHomeDetection.observedAt` retained. `homeBindingReady=true`, `sessionConnected=true`, `bindingTimeouts=1`, `phase=home_binding_read`, `pendingSeconds=0`. The zero-second read is not evidence of a new hung operation; the unchanged cumulative timeout count does not supply a timeout/recovery timeline.

### First walk: useful partial evidence

The earlier capture `2de0967e5eb5a632fc9d3577` retained all 51 entries (35 reports, 6 GPS-valid reports, 23 Home-router sightings, 7 heartbeats, 3 CR handoffs/responses and 3 markers). Rav explicitly confirmed **13:11:37 MUT** as the actual departure, resolving the earlier 13:02:33.923 departure marker ambiguity. GPS-valid receipt at 13:12:26.771 was 49.694 seconds after the matching 13:11:37.077 marker; fresh Home cleared at 13:12:46.046 with `router_not_seen`, 68.969 seconds after that marker. The 30-minute window ended at 13:14:49.957. The return marker was rejected and actual return time was not remembered, so that first run cannot establish return latency. A CR handoff at 13:10:12.489 also limits unassisted departure-timing claims.

### Acceptance and next step

- [x] Recover both reports and verify counts, retained entries, UTC-to-MUT conversions and marker-relative arithmetic.
- [x] Capture GPS-valid reports and fresh Home clearing following the departure markers on this pilot.
- [x] Capture post-return Home-radio evidence, a later acknowledged Home publication and the returned-Home dashboard presentation.
- [x] Confirm final radio expiry preserves historical source age.
- [x] Capture **View journey** screenshot: Today has no eligible trip and displays the unconfirmed-record explanation; source review is recorded above.
- [ ] Diagnose the relevant stored journey and verify zone events and away-map/location-details evidence. GPS-valid packets and native fence-bit counts alone do not prove accepted GPS presentation, journey creation or server exit/entry alerts.
- [ ] Review delayed Home reacquisition and CR origins/request timing; obtain first-publication timing if needed to isolate any additional publishing delay.
- [ ] Complete remaining applicable acceptance from the runbook, including ordinary WhatsApp/location-details consistency across transitions and timestamped binding timeout/recovery evidence.
- [ ] Assess remaining device/reporting/battery, native fence and broader customer-enrollment gates separately; no general customer activation or native-fence acceptance is claimed.

The Journey screenshot and recent-record diagnostic have now been supplied; the next requested user evidence is the **targeted read-only JSON for the stored first walk** to check why it is omitted from today's trip display. Do not repeat the physical walk merely to obtain that diagnostic. Sources are the user-supplied `Pasted text(20260914-091759).txt`, `Pasted text(20260914-094856).txt`, the intervening checker/marker transcript and the return screenshot. Raw screenshot coordinates, device/network identifiers and private configuration are not reproduced here.

This is a **PR-description evidence update only**. No commits, runtime tests, configuration changes, watch commands or merge are performed by this update.

---

## Saved physical checkpoint — 13 September UTC / 14 September Mauritius

All implementation work through `e9cad97` is pushed. Documentation commit `ebb4739` preserves the operator's subsequent stationary checks and the remaining work. The operator has paused testing for the night; this PR remains draft.

| Check | Evidence and result |
| --- | --- |
| Fresh Home | Repeated enrolled-router reports selected `home_wifi_detected`; the app screenshot showed **Home Wi-Fi detected · Just now**. |
| Expiry | `publishedHomeFresh: false` and `homeEvidenceEligible: false`; historical source time stayed **2026-09-13T21:15:08.000Z**. Fresh lease expiry was 21:17:08 UTC; the checker recorded clearing at 21:17:09.132 UTC. |
| Historical app presentation | Screenshot showed **Last detected at Home · 4m ago**, the retained Home pin and **Current presence at Home is unconfirmed**. |
| Gateway restart | Ready binding restored the same historical timestamp, with no fresh Home publication or observation. Watch session was disconnected at that check; post-restart reconnection/app presentation are still unverified. |

[Redacted physical evidence](https://github.com/vikrav14/guardian/blob/feat/v52-wifi-home/docs/testing/wifi-home-retention-2026-09-13.json) · [Acceptance ledger](https://github.com/vikrav14/guardian/blob/feat/v52-wifi-home/docs/GUARDIAN_V52_REAL_DEVICE_ACCEPTANCE.md#private-home-wi-fi-observation--pr-116) · [Resume checklist](https://github.com/vikrav14/guardian/blob/feat/v52-wifi-home/docs/services/wifi-home.md#next-device-check-for-remembered-home)

The run followed the update instructions for `e9cad97`; new diagnostics are visible, but no new `git HEAD` output accompanied the physical run. The screenshots are transcribed in the evidence record; raw device identifiers, coordinates and screenshots are not committed.

**Still pending:** actual departure/return and first usable GPS timing, displayed GPS precedence and journey/zone behavior; ordinary WhatsApp/location-details agreement; post-restart watch reconnection/app presentation; and a real binding timeout/recovery. This run recorded zero timeouts. Continuous reporting, native fencing and battery impact remain unaccepted.

This checkpoint changes documentation only. JSON structure, retained timestamps, lease/clear timing, redaction and diff checks passed. The implementation's 883 gateway tests and both CI workflows passed on `e9cad97`; no new runtime test pass is claimed for this documentation commit. No merge or device operation is part of this save.

---

## Implementation: remembered Home and binding-read recovery

A stationary watch could be recognised at Home during a reporting burst, then lose that place after the two-minute radio expiry and revert to a day-old GPS label. A separate Home binding read remained pending for 70,431 seconds.

Commit `0ba0d2b` adds a separate backend-owned historical Home detection. After fresh evidence expires, the app/map/details and ordinary WhatsApp show **Last detected at Home · age**, with current presence explicitly unconfirmed. Newer accepted GPS takes precedence. Historical evidence cannot acquire tracking priority, create a journey/zone transition or change SOS selection. Startup restores history only against the same verified Home/owner/plan binding; legacy records are not promoted.

Home binding reads now use cancellable first-snapshot listeners with a 15-second deadline and the existing 30-second retry schedule. A failed read cannot renew fresh Home or become stuck on an offline clearing write. Existing leased evidence expires locally. The checker includes timeout counts and a redacted historical source time.

**Implementation verification on `e9cad97` (unchanged runtime in the later documentation checkpoint):** all **883 gateway tests pass**, and [Guardian release gates](https://github.com/vikrav14/guardian/actions/runs/34781997234) pass, including Firestore authorization, Flutter analysis, the full app test suite and the Web release build. [Dashboard layout and preview checks](https://github.com/vikrav14/guardian/actions/runs/34781997182) pass, including mobile/desktop/dark/doubled-text history cases and working call actions. The rendered remembered-Home mobile, desktop and dark previews were visually reviewed. The 23 shared app/chat history cases cover expiry, source age, newer GPS, malformed evidence and legacy migration; publisher tests cover cancellation, late callbacks, retry, historical restart and binding changes. Local Flutter dependency setup was blocked by automatic approval review after a metadata-endpoint attempt; Flutter validation was completed in the existing GitHub CI workflow.

Repository QA/service documentation and the schema are updated. Automatic approval review rejected the separate Wiki push because that destination was not explicitly authorised for operator/device timing and implementation details. No Wiki publication is claimed; the repository runbook is the available review reference.

[Current runbook and device check](https://github.com/vikrav14/guardian/blob/feat/v52-wifi-home/docs/services/wifi-home.md#next-device-check-for-remembered-home) · [Redacted operator evidence](https://github.com/vikrav14/guardian/blob/feat/v52-wifi-home/docs/testing/wifi-home-expiry-2026-09-13.json)

The later physical checkpoint above accepts stationary historical app display and gateway restoration only. Physical binding failure recovery and genuine departure/return acceptance remain open. The PR stays draft. No reporting interval, Home radius, native command or continuous CR loop was added. A separately hung presence write remains diagnosable under its existing write path; the new recovery addresses binding reads.

---

## Previous checkpoint: Home radio takes priority over GPS A/V

The operator rejected the v3 conflict screen. Revision `8e083ca` publishes a new v4 contract: a fresh qualified enrolled Home-router match and verified saved Home binding select **Home · Home Wi-Fi detected**, regardless of GPS A/V. The app, ordinary WhatsApp location, assistant Home checks and location-derived AI warnings use this priority.

Tracking reads the same qualified decision without waiting for Firestore. While Home is active, GPS/network readings cannot create dwell, journeys or Home/School transitions. Existing routes are preserved at their last recorded endpoint with `home_wifi_detected`; no Home coordinate or measured return is invented. Home quietly seeds a baseline. Expiry/loss alone creates no departure: fresh valid GPS after the last Home sighting resumes normal evaluation, with a new journey baseline. Pending geofence reads recheck Home before producing a late GPS exit.

Radio qualification, Home/owner/plan leases and expiry remain bounded. Cached v1/v2/v3 keep their old contracts; new v4 publications do not create GPS conflicts. Raw telemetry/history, SOS/fall ACKs and frozen incident handling stay intact. No native WIFIFENCE retry, automatic CR loop, report interval or radius change is included. Native fencing and continuous stationary reporting remain unaccepted.

**Verification on final head `1453738`:** all **853 gateway tests** pass. [Guardian release gates](https://github.com/vikrav14/guardian/actions/runs/34652984390) passed: gateway, Firestore authorization, Flutter analysis, full app tests and Web release build. [Dashboard layout and formatting gates](https://github.com/vikrav14/guardian/actions/runs/34652984473) also passed, including Home priority over outside GPS at narrow/wide widths with enlarged text and intact call actions.

The shared app/chat fixture set has 64 cases covering v4 priority, expiry and legacy migration. Regression tests exercise the real event dispatcher, Home/School coexistence, existing-route preservation, post-Home GPS recovery and clock skew, pending database reads, raw telemetry, ordinary chat/AI and existing SOS isolation. The final follow-up changes only test formatting and documentation; physical v4 acceptance remains open.

**Next:** update/restart both gateway and Flutter from this branch, reuse enrollment, then perform the [v4 device check](https://github.com/vikrav14/guardian/blob/8e083ca0895bf2f46ca1545101a0d74b33c00134/docs/services/wifi-home-supplier-validation.md#next-device-check-for-v4). Physical Home display, loss/expiry, genuine departure/return and native fence acceptance remain open. PR #116 stays draft.

Repository QA/service documentation and schema are updated. The separate Wiki push remains blocked by the previously reported automatic approval decision; no Wiki publication is claimed.

---

## Historical checkpoints (superseded where the v4 policy above differs)

## Fresh Home Wi-Fi / GPS disagreement — current correction

The operator confirmed the saved Home pin is the actual house: Home has a 50 m radius and School is a separate 150 m zone. School/list order does not affect Home binding. A usable Home renewal was cleared with `gps_outside_home` before its scheduled expiry; the old presentation then hid the fresh router evidence and showed GPS alone.

Revision `50a514c` adds a bounded v3 conflict state. The app/map/location details and ordinary WhatsApp reply show **Location uncertain**, the fresh Home Wi-Fi detection age and **Current position unconfirmed**. The recorded map position remains a reference; a conflict cannot select Home. A stored conflict cannot become Home because GPS is missing/older or ages out. State changes bypass renewal throttling; pending or failed writes cannot count as successful publications.

The checker separates `publishedHomeFresh` and `publishedConflictFresh`, and returns `home_gps_conflict` without another CR. Existing radio/owner/plan leases, raw GPS, geofence/Journey decisions, SOS snapshots, saved boundaries and hardware settings retain their contracts. This fixes misleading omission of conflicting evidence; it does not establish continuous Home, remove all possible GPS false alerts or accept native fencing.

**Verification:** all 827 gateway tests passed locally, including the shared 47-case app/chat contract, Home/School selection, expiry, delayed writes and existing SOS/Journey regressions. The final Flutter/style follow-up is `cfc92ae`. [All release gates passed](https://github.com/vikrav14/guardian/actions/runs/34649623038): gateway, Firestore authorization, Flutter analysis, full tests and Web release build. [Dashboard layout and review checks passed](https://github.com/vikrav14/guardian/actions/runs/34649622962), including the new mobile/desktop conflict-warning cases with enlarged text. PR #116 remains draft; physical conflict display/expiry and departure/return acceptance remain open.

[Current evidence and device check](https://github.com/vikrav14/guardian/blob/50a514c037fa4566fbaf7734ca9697a934c5bcfb/docs/services/wifi-home-supplier-validation.md#fresh-routergps-disagreement--11-september-2026-utc).

The repository's QA/service documentation and schema are updated. Automatic approval blocked the separate Wiki push because its destination was unverified; no Wiki publication is claimed.

---

## Home/GPS correction — 11 September 2026

The physical log shows fresh Home Wi-Fi being cleared as soon as a GPS-valid packet arrives, including a packet evaluated inside the saved Home zone. The observer, backend reader and app each applied GPS priority, so changing only one would leave contradictory displays.

Implementation `74226cf`, with Flutter lint/timestamp follow-ups through `f88922a`, keeps router evidence separate from GPS and aligns the publisher, ordinary WhatsApp reader and Flutter through a versioned Home/GPS contract. GPS that agrees with the Home area preserves fresh radio evidence. Outside, boundary-uncertain or invalid fresh GPS prevents Home selection. Declared Wi-Fi scans in GPS packets are read privately without rewriting location/alarm events or ACKs.

- Home still requires repeated fresh enrolled-router observations, a verified saved Home/owner/plan and private pilot opt-in.
- The latest GPS less than two minutes old must fit inside the saved radius capped at 150 m, including a minimum 30 m presentation margin or supplied GPS accuracy. This is a guard, not a measured accuracy claim.
- GPS, heartbeats and missing/zero scans cannot renew the original radio time or two-minute expiry. Different/weak/malformed scans clear it.
- V2 records include the verified radius; cached v1 retains its old conservative behavior. Both gateway and app need this branch.
- Diagnostics expose match, selection and last-clear reasons. Late database writes are rechecked before reporting Home success.
- Raw GPS/network telemetry, journeys, geofence transitions, SOS snapshots, battery/reporting intervals and native hardware settings are unchanged.

Local verification: **810/810 gateway tests passed**, including shared app/chat cases, real decoder/runtime scan plumbing, outside GPS during a delayed write, expiry, existing SOS and journey tests. **All checks passed on final head `f88922a`:** [Gateway tests, Firestore authorization, Flutter analysis/tests and release Web build](https://github.com/vikrav14/guardian/actions/runs/34646187363), plus [dashboard layouts and review images](https://github.com/vikrav14/guardian/actions/runs/34646187273). The app regression also covers equally recent conflicting GPS fixes represented as local time versus UTC; comparison uses the actual instant.

Physical acceptance remains open. This fixes the reproduced source-priority issue; report gaps still expire Home honestly. It does not establish continuous Home or native WIFIFENCE acceptance. The updated runbook requires fresh app/map/hero/WhatsApp agreement, then expiry and separate departure/return checks. No native reprovisioning is requested. PR remains draft. Repository QA docs and schema are updated. The separate Wiki update is prepared locally, but Wiki publishing could not authenticate in this environment; the linked repository runbook remains the review reference.

See [updated service contract](https://github.com/vikrav14/guardian/blob/feat/v52-wifi-home/docs/services/wifi-home.md) and [physical check](https://github.com/vikrav14/guardian/blob/feat/v52-wifi-home/docs/services/wifi-home-supplier-validation.md#next-physical-check-after-the-update).

---

## Home clearing traced to GPS priority — 11 September 2026 UTC

The uploaded gateway log establishes the clearing reason: **`satellite_observation` at 19:51:48.868 UTC**, followed by GPS A and the same publisher clearing reason. The successful clear in the previous checker follows 0.851 seconds later. The sequence repeats at **20:02:11.259 UTC**; that second sequence also logs a **server Home-zone entry** while withdrawing the Home Wi-Fi overlay. This is server geofence evaluation, not native Wi-Fi-fence acceptance.

The current observer clears Home as soon as a fresh GPS-valid report arrives, before considering radio evidence or distance/accuracy relative to Home. Gateway and Flutter readers also suppress Home for newer/equal GPS observations. A future selection change must therefore be coordinated across those paths. Seven GPS summaries supply no accuracy radius; the ordinary log does not prove those coordinates wrong or show whether the same packets still contained the enrolled router.

The previous six-second interval measured the **last publication renewal → clear**, not the full Home-active duration; Home was logged active earlier. Between the GPS switches, Home requalifies and then expires normally from its last radio source time at 19:59:50 UTC. Three CR handoffs/replies have automatic recovery reasons (one packet_silence, two location_stale). These are separate GPS-priority and radio-reporting-gap issues.

The attachment hash and **72 redacted, source-linked entries** are preserved in `docs/testing/wifi-home-gps-priority-2026-09-11.json`. The initial status evidence is unchanged; its assessment now links to the confirmed cause. Timestamp arithmetic, source fields, redaction and diff checks passed. This is a documentation-only checkpoint; no runtime tests were rerun or hardware settings changed.

**Next:** use the existing version-1 capture to inspect the radio fields in a fresh GPS-valid packet while the watch remains near the enrolled router. The bounded procedure is documented in `docs/services/wifi-home-supplier-validation.md`. Preserve independent source evidence; evaluate GPS/Home together before enabling any selection change. Continuous Home, live app/map/WhatsApp agreement and native fencing remain open. PR remains draft.

---

## Home publication cleared early — 11 September 2026 UTC

The follow-up read-only checker confirms a successful Home publication at **19:51:43.682 UTC**, sourced at 19:51:22, followed by a clear at **19:51:49.719 UTC**. That is **6.037 seconds after publication and 36.702 seconds before its published expiry**. This is a later window than the previous capture and does not prove publication during that capture.

Backend publication is demonstrated; the cause of the early withdrawal is unknown. The current summary omits the observer reason and retains no historical clear reason. Fresh GPS priority, contradictory radio evidence and a Home binding change/failure are possible code paths, not confirmed diagnoses. Current binding readiness and connectivity do not identify their state when Home was cleared.

Next: preserve the running gateway's `[wifi-home]` and `[wifi-home-display]` lines around **19:51:43–19:51:50 UTC / 23:51:43–23:51:50 Mauritius**, especially the first `displayingHome: false` reason after `home_wifi_detected`, before another physical comparison. No new CR, restart or repeat native setting is required to read those logs.

The operator's complete redacted status is in `docs/testing/wifi-home-publication-cleared-2026-09-11.json`; the acceptance ledger, service matrix and supplier validation record are aligned. JSON, all 14 status fields, timing calculations and diff checks were verified. This commit changes documentation only; no runtime tests were rerun. Continuous Home, app/map/WhatsApp agreement and native fencing remain open. PR remains draft.

---

## Fresh Home-router baseline — 11 September 2026

The updated capture completed with **nine fresh enrolled-router sightings at reported -30 dBm**, one explicit zero-entry scan, one CR handoff/reply and ten fresh non-GPS reports. All 16 timeline entries are preserved in `docs/testing/wifi-home-strong-router-baseline-2026-09-11.json`. This validates the named/empty non-GPS scan layout on the pilot; no GPS-valid report occurred, so the new GPS path still needs physical evidence.

A replay of the reported timing/signal qualifies Home after the third sighting. Actual publication/UI state is not part of this capture. The last source observation expires at 19:46:18 UTC, just before the recorded stop bound; an expired current status does not disprove recognition during the CR burst. Native fence acceptance and continuous Home remain open; no radio/physical transition was marked and no new WIFIFENCE/UPLOAD was sent.

Next: read the running publisher's `lastHomePublication` before selecting the planned marked radio comparison. This checkpoint changes documentation only. All CI checks for the associated diagnostic code commit `20c6144` passed.

---

## Scan diagnostics update — 11 September 2026

GPS-valid reports previously exposed no Wi-Fi scan to the private capture. The capture now reads the original Appendix I scan section for both A and V reports, using declared cell/radio counts and named or supported nameless entries. Zero, missing and malformed scans are distinguished; MAC-shaped SSIDs cannot create a router sighting. New captures expose `scanDiagnosticsVersion: 1`.

The extraction remains inside the existing bounded admin capture. Production location/alarm events, GPS/Home priority, SOS/Journey selection, geolocation requests, battery intervals and native-command sending are unchanged. Output retains only counts, status, Home match and signal; no raw identifiers or coordinates are exposed. Native fencing and continuous Home still require real-device acceptance.

Validation: **780/780 gateway tests passed locally**, including five new runtime/parser regressions for GPS radio evidence, unchanged SOS ACKs/GPS priority, privacy, malformed layouts, replay and freshness. Updated QA instructions and the stationary five-minute capture runbook are in `docs/services/wifi-home-supplier-validation.md`; the repository acceptance ledger and service matrix are aligned. Wiki write access remains unavailable through the current connector.

Next hardware step: pull this branch, restart only the gateway, keep the router on and collect one stationary scan capture with the existing protected CR checker. Account for any automatic recovery requests in the timeline; do not repeat native provisioning.

---

## Latest hardware checkpoint — 11 September 2026

The stopped 8m38s CR baseline has been preserved in `docs/testing/wifi-home-cr-baseline-2026-09-11.json`: 14 fresh reports, four heartbeats, two CR handoffs/replies, no enrolled-router sighting or fence event, and only an `at_home` marker. All 23 entries and the source hash were checked. The second CR is consistent with packet-silence recovery; its caller is not recorded.

The supplier/decoder audit found that GPS-valid reports omit Wi-Fi metadata from diagnostics. A local synthetic packet confirms the difference between A and V decoding. The protocol does not state a China-only restriction on 2.4 GHz MAC fencing; the datasheet's Amap-based Wi-Fi accuracy and Guardian's Google-provider eligibility are separate from direct Home-router recognition. The entered router BSSID matches the operator's earlier 2.4 GHz scan; the new Intel properties screenshot identifies the PC adapter.

Next: correct privacy-safe scan observability and review provider eligibility, then establish fresh router evidence before another marked comparison. Native-setting acceptance and continuous Home remain unconfirmed. This commit changes documentation only; it sends no watch command and changes no runtime policy. PR remains draft.

---

## Stationary radio cycle recorded — 11 September 2026 UTC

The operator completed the marked radio on/off/on capture starting **18:18:01.469 UTC / 22:18:01.469 MUT**. It was manually stopped after 734 whole seconds (12m14s); `endsAt` remains the scheduled 30-minute ceiling. All 14 entries were retained, with none dropped. The capture does not identify the running-process revision.

| Phase | Duration | Heartbeats | Location/radio reports | Fence events |
|---|---|---|---|---|
| Initial radio on | 2m22s from capture start; 2m09s after at_home | 3 | 0 | 0 |
| Radio off | 5m02.875s | 4 | 0 | 0 |
| Radio restored | Approximately 4m49s | 4 | 0 | 0 |

Ten LK packets arrived roughly 73 seconds apart, plus one TKQ. **No CR, UPLOAD or WIFIFENCE handoff or command response was captured.** The original morning native attempt is still a separate, uncertain `queued` record; it was not resent. The at_home snapshot reported a disconnected session, with later marker/final snapshots connected. Heartbeats in every phase do not prove uninterrupted transport, and no fresh router baseline was received. Physical markers are operator observations.

**Result: no reported fence transition during this cycle.** This does not distinguish an unapplied setting from internal scanning/reporting behaviour or prove the feature unsupported. Home/customer acceptance, radio expiry and battery policy remain unchanged.

**Next:** one protected CR attempt with the radio on; require a fresh enrolled-router baseline within the first minute, then mark a 60-second radio loss/restoration to fit within the documented temporary reporting burst. A second Checks terminal prevents the publication checker from blocking those markers. Verify the actual CR handoff/reply and source times, including any automatic commands. A short quiet result is not a guaranteed detection test. Supplier clarification continues in parallel; no repeat native setting is needed.

[Complete redacted evidence](https://github.com/vikrav14/guardian/blob/07cb3502239be6ee82e01234822bd95ff2deddef/docs/testing/wifi-home-radio-cycle-2026-09-11.json) · [Runnable next comparison](https://github.com/vikrav14/guardian/blob/07cb3502239be6ee82e01234822bd95ff2deddef/docs/services/wifi-home-supplier-validation.md#next-test-one-cr-with-a-short-radio-cycle)

Commit `07cb350` changes documentation only. Verified all 14 entries/counters, phase durations, the connection limitation, 27 local links and the six existing capture CLI flag forms. Diff checks passed; no runtime test rerun or hardware command was needed for this evidence update. The green software checks below belong to `4f9cbc9`. No pull or gateway restart is required to run the existing next-test commands. PR #116 remains draft; the existing Wiki write-access limitation is unchanged.

---

## Main UI integrated and CI verified — 11 September 2026

The operator merged main `b89be756` (UI PR #123) into this branch and pushed merge commit `3956877`. The new dashboard, login and Safe zones UI are now included in PR #116.

The combined UI check exposed Dart formatting in `map_dashboard_page.dart`. Follow-up `4f9cbc9` applies the exact formatter output from CI (resulting blob `9fbe5464ef0e68caf5d25a2f17981781a8bea05f`); this is a formatting-only change. The existing Home display selection, retained GPS, radio expiry and gateway/watch policies are preserved.

**All four CI jobs pass on `4f9cbc9`:**

- Gateway tests and Firestore authorization.
- Flutter analysis, the full test suite and Web release build.
- Dashboard UI review: 23 files require no formatting changes, all 110 targeted UI tests pass, and dashboard/login/Safe zones preview generation passes.

[Release gates](https://github.com/vikrav14/guardian/actions/runs/34624602518) · [UI review](https://github.com/vikrav14/guardian/actions/runs/34624602520)

At this UI checkpoint, the operator had paused the radio-loss/restoration exercise. The completed result and next comparison are now recorded above. PR remains draft; native fence acceptance remains inconclusive. The UI merge and formatting fix do not require a gateway restart.

---

## Continue controlled experiments — operator direction, 11 September 2026

The operator reaffirmed the exploratory test plan. **Supplier clarification proceeds in parallel; it does not block the next observation experiment.** The first inconclusive capture remains preserved below.

Next, keep the watch stationary and observe the enrolled **2.4 GHz radio on → off → on**, with the gateway connected through 5 GHz or Ethernet. The runbook uses the existing capture and physical markers: two minutes on, five off, five restored, then stop/report. These are observation windows, not guaranteed firmware detection times.

If needed, compare a temporary CR reporting burst and a separately marked physical departure/return. Existing automatic CR/UPLOAD activity must be accounted for in the timeline. A further command interpretation needs its own explicit payload and bounded trial implementation; the present single-router sender is not an arbitrary-variant tool. The already-attempted setting must not be blindly repeated by restarting the attempt guard.

[Runnable continuation sequence](https://github.com/vikrav14/guardian/blob/89591deba250fcb4599b817fa132a5af82206e76/docs/services/wifi-home-supplier-validation.md#next-test-radio-on-off-on-with-the-watch-stationary)

Commit `89591de` updates the runbook and acceptance ledger only. All six documented CLI flag forms were checked against the existing parser without network or hardware commands; diff formatting passed. No new hardware result or customer acceptance is claimed. No gateway restart is required.

---

## Completed first native trial — 11 September 2026

The operator attempted the single-router setting once. The completed capture covers **09:48:56.797–10:18:56.797 UTC / 13:48:56.797–14:18:56.797 MUT**, with all 39 timeline entries retained and none dropped. Operator checkout was `d59f4f9`; the capture does not identify the running-process commit.

| Evidence | Result |
|---|---|
| Native command | One `WIFIFENCE` handoff; zero `WIFIFENCE` replies |
| Other commands | Two `CR` handoffs and two `CR` replies; no `UPLOAD` handoffs |
| Watch reports | 21 heartbeats, 13 fresh reports, one enrolled-router sighting |
| Fence transitions | Zero captured entry/exit bits; no physical markers |

**Native-setting acceptance remains inconclusive.** Both recorded replies were to CR. Reports followed those requests after approximately 3.6 seconds; their caller was not recorded, although the timing is consistent with existing packet-silence recovery. This establishes the CR response/report path, not native fence acceptance or continuous Home. Lack of a fence event without a marked departure/return does not prove the feature unsupported.

**Do not repeat provisioning on this pilot or restart to reset the attempt guard.** The setting may persist; readback/removal remain unknown. Supplier questions cover one-entry support, the expected response, readback/removal and current-state recovery. A later supervised transition capture needs no repeat setting. PR remains draft and customer acceptance stays open.

[Redacted completed evidence](https://github.com/vikrav14/guardian/blob/e5958634e3062298566fa7acd2a326a1d7933668/docs/testing/wifi-home-native-trial-2026-09-11.json) · [Interpretation and prepared supplier questions](https://github.com/vikrav14/guardian/blob/e5958634e3062298566fa7acd2a326a1d7933668/docs/services/wifi-home-supplier-validation.md#completed-first-native-attempt--11-september-2026)

Documentation-only commit `e595863`: verified the saved report against the original, all 39 entries, counter/response classification, local documentation links and diff formatting. No runtime code or watch setting changed; the software-test results below belong to the preceding implementation revision.

---

## Earlier checkpoint — one-router experiment implementation

The operator explicitly asked to test an anticipated interpretation of section II.35. Revision `d59f4f9` adds **`npm run wifi-home:fence-trial`**: default/`--preview` is offline; explicit **`--send`** attempts **`WIFIFENCE,1,<enrolled-radio>`** on the configured pilot. This is an inferred 29-byte (`001D`) single-entry form, **not supplier-confirmed syntax or a hardware pass**. It supersedes the earlier supplier-first pause only for this private experiment.

The dedicated strict-admin endpoint checks the pilot, enrolled-radio fingerprint, current capture and exactly one writable session with the actual device/protocol binding. Input is limited to a 512-byte body, never a MAC-bearing URL. A synchronous attempt guard prevents concurrent/repeated sends in the gateway process, including after a new capture; uncertain writes and HTTP failures never retry. The CLI uses authenticated loopback, hidden router input and redacted output. It sends no CR/UPLOAD, padding, guessed deletion, SMS fallback or automatic rollback.

**Material limits:** the setting may persist or replace other fence settings; readback/removal are unknown. Capture stop, display disable or gateway restart does not undo it, and restart must not be used to retry an uncertain send. Native fence alarms continue through the existing alert/notification path. `queued` means socket buffering; a WIFIFENCE response alone proves neither stored settings nor Home detection. Existing SOS, GPS, Journey and normal reporting code is unchanged. The regular device-command dispatcher still rejects `set_wifi_fence`, and customer activation remains disabled.

**Validation:** all **775 gateway tests passed locally**; **18 targeted checks passed again** after final request-size/capture-clock guards. Tests include real loopback HTTP/CLI, concurrent posts, uncertain writes, enrollment/capture/session rejection, private output and existing SOS/fence decoding. No real watch command was sent from the development workspace. [All release gates passed for this commit](https://github.com/vikrav14/guardian/actions/runs/34280524942): gateway tests, Firestore authorization, Flutter analysis/tests and the Web release build.

[Exact Windows runbook and evidence rules](https://github.com/vikrav14/guardian/blob/d59f4f9c5a20cabd2a137f16ab7d1b5c8db8076f/docs/services/wifi-home-supplier-validation.md#run-the-experiment-on-windows). First inspect the response and stationary behaviour with `wifi-home:fence -- --report`; later test physical departure/return and router loss before changing Home display or normal policy. PR #116 stays draft. Supplier questions remain prepared and unsent; the existing Wiki write-access limitation is unchanged.

## Earlier checkpoints (superseded where the experiment above changes the next step)

## Watch status received — after the stationary baseline

The operator's `ts#` response reports **upload: 300 seconds, battery: 44%**, firmware **C403H_RFHZ_V52_EN_04R6_V1.3_2025.03.10_18.29.29**. This agrees with Guardian's ordinary 30–59% battery band. Exact read time was not supplied: it establishes the watch-reported setting at readback, not the setting throughout the earlier capture or delivery every five minutes. The corroborating gateway excerpt still recorded zero observer reports over approximately 36m42s.

A separate Guardian timing incompatibility is confirmed: the passive observer requires three strong reports, gaps no greater than 60 seconds and a span of at least 20 seconds; evidence expires after 120 seconds. A read-only synthetic replay reached `matched` at ten-second gaps, but isolated 300-second and 600-second reports repeatedly restarted at one-match `candidate`. A matched burst expired at its existing deadline. Thus a ten-minute normal interval alone cannot repair Home continuity or the separate missing-report gap.

Documentation-only revision `2dde374` preserves the original capture and adds the relevant status fields, interpretation and firmware-specific supplier question. Device identifiers, phone numbers and server details are omitted. Runtime remains `6528501`; no settings, commands, expiry, GPS/SOS/Journey policy or hardware acceptance changed. The existing runtime release gates remain the applicable software verification.

**Next:** obtain supplier stationary/screen-off reporting semantics for this firmware, exact one-router/removal forms and native-fence current-state recovery. The supplier questions are prepared in [the validation note](https://github.com/vikrav14/guardian/blob/2dde374aded67841671d834f5254110f9a753144/docs/services/wifi-home-supplier-validation.md); no supplier message has been sent. Keep PR #116 draft while those hardware questions remain open.

## Stationary baseline recorded — 8 September 2026 UTC

The operator completed the full 30-minute capture, 20:02:06–20:32:06 UTC (00:02–00:32 MUT on 9 September). It recorded **9 LK + 1 TKQ**, with successive LK packets approximately **218 seconds apart**, and **zero decoded location/radio reports, router sightings, fence packets, CR/UPLOAD/WIFIFENCE handoffs or command responses**. All 11 entries, including the at_home marker, were retained. The session was connected when status was retrieved.

This establishes the stationary reporting gap in the current integration. It does not establish the watch's current upload setting, a particular sleep mode, or native-fence success/failure. Heartbeats postpone packet-silence recovery; the independent location-freshness probe remains outing-only. The capture runs before geolocation and write gating.

Documentation-only revision `572ae01` records the [redacted evidence](https://github.com/vikrav14/guardian/blob/572ae010fb6d6202b3951db5f01574464276c0cb/docs/testing/wifi-home-stationary-2026-09-08.json), interpretation and next checks. Counts, duration and timestamps were verified. Runtime remains `6528501`, whose [release gates all passed](https://github.com/vikrav14/guardian/actions/runs/34272126944).

**Update:** the subsequent `ts#` response has been received; see the newest checkpoint above. Supplier clarification is still needed for one-router/unused-slot provisioning, removal/restore, stationary UPLOAD behaviour and native fence events. No further identical baseline, timing change or watch provisioning is requested by this record.

## Supplier-led validation checkpoint — 8 September 2026

The Home publication burst succeeded, then expired while the watch remained connected. The supplier documents native Wi-Fi fencing and a temporary three-minute `CR` GPS burst. The operator confirmed that the shared V46/V48/V52 documents apply to this V52. This revises the next step: validate native fencing before recurring Home polling or normal battery-band changes.

Revision `6528501` adds:

- `npm run wifi-home:fence`: strict-admin diagnostics of the running pilot. `--start` records a bounded 30-minute window; `--report` returns a redacted timeline. Optional fixed markers distinguish operator observations from device evidence.
- Separate report/heartbeat timing, router sightings, buffered/stale/repeated reports, command handoffs/responses and fixed-position fence bits, including combined SOS/fence packets. Capture cannot change ACKs, Home, alerts, GPS, journeys or reporting.
- An offline, redacted `--preview` of the documented three-slot command. **No native provisioning route or send/apply option:** the supplied documents do not define single-router/unused-slot and removal/restore forms; the guide also describes two zones.
- Supplier source hashes, protocol findings and the staged acceptance plan in [the validation note](https://github.com/vikrav14/guardian/blob/6528501821a39b2e122161ce7d9acff05fbb9db9/docs/services/wifi-home-supplier-validation.md).

**Verification:** 767 gateway tests passed locally; targeted validation tests passed after final input hardening. [All release gates for runtime commit `6528501`](https://github.com/vikrav14/guardian/actions/runs/34272126944) passed. Native hardware behaviour and new Home display acceptance are not claimed.

The first stationary baseline is complete; see the latest record above. Battery policy, SOS/outing overrides and evidence expiry remain unchanged. Native fence absence remains inconclusive until it is provisioned and exercised.

## Why this change

The V52 pilot now repeatedly recognises the operator-selected Home router, but its observation stayed only in gateway memory. The app and ordinary WhatsApp location reply could not use it. This PR adds the documented **Home · Home Wi-Fi detected** presentation as a separate, opt-in private pilot.

## What changes

- Keep passive V52 router matching synchronous, private and independent of provider geolocation, write gating and SOS dispatch. One configured watch/radio uses a keyed, watch-scoped fingerprint; no Wi-Fi password is requested.
- Require three distinct strong reports spanning at least 20 seconds. Reject replay, backlog, weak/unknown-router scans, malformed or contradictory fields and stale/future input. Canonical cellular-only frames preserve recent router evidence without adding matches or changing its observation time/expiry. Heartbeats cannot refresh a match; fresh GPS ends it.
- Add `npm run wifi-home:setup -- --display-pilot` to reuse the existing private enrollment. The separate display flag defaults off; ordinary re-enrollment resets it, and `--disable` removes the managed block.
- Validate exactly one active saved Home zone owned by a linked Family/Care service owner. Recheck ownership, plan and pin every 30 seconds, with a lease of at most 60 seconds. Changed or invalid bindings require fresh radio confirmation.
- Publish only the backend-owned `homeWifiPresence` field, with a saved Home anchor, source time and absolute expiry. The background publisher never updates raw location, heartbeat, `updatedAt`, journey, geofence, intelligence or alert data.
- Show the saved Home pin and consistent Home Wi-Fi source/time labels across map, hero, location tile and Guardian interpretation. Keep the last GPS fix and age separately visible. A newer GPS fix overrides a cached Home record.
- Render ordinary `location?` replies deterministically: **at or near your saved Home location**, detection age and one Home map link. Existing caller, wearer and plan authorization still runs first.
- Expire cached evidence in both app and chat without requiring another Firestore event. A failed/stopped gateway cannot indefinitely keep an old Home display alive.

The observer's `observeOnly: true`, `customerActive: false` and `homeClaim: false` diagnostics still describe the raw observer. Separate `[wifi-home-display]` lines describe display publication. Seeing a radio is not proof of association or exact indoor presence. Missing radio evidence creates no trip or departure. The accepted GPS/approximate SOS snapshot selection and delivery remain unchanged.

## Documentation alignment

The existing [Home Wi-Fi specification](https://github.com/vikrav14/guardian/blob/09cea2f36beb68b963b47f03706987def8e78a12/docs/services/wifi-home.md) already required a saved Home pin and separate source/time labels. The [WhatsApp location spec](https://github.com/vikrav14/guardian/blob/09cea2f36beb68b963b47f03706987def8e78a12/docs/services/whatsapp-location.md) recorded the corresponding at-or-near-Home wording. PR #122 requires map/hero agreement; PR #109 supplies the accepted GPS, SOS and journey contracts. The service notes, Firestore schema, promise matrix and [acceptance ledger](https://github.com/vikrav14/guardian/blob/09cea2f36beb68b963b47f03706987def8e78a12/docs/GUARDIAN_V52_REAL_DEVICE_ACCEPTANCE.md) now describe this private display implementation and remaining gates.

## Runtime correction after the display pilot

The 21:08–21:13 UTC runtime trace showed display activation and a valid Home binding, but alternating Home Wi-Fi sightings and cellular-only packets continually reset the observer. The first isolated report correctly expired during a three-minute pause; subsequent positive radio sightings should have survived the intervening packets without a scan.

Revision `818808766183180fc2649445c7a2762f0e5b1542` distinguishes canonical LBS-only frames from conflicting Wi-Fi/GPS evidence. They neither create nor refresh Home evidence. A real decoder → observer → publisher → ordinary location reply replay also identified a brief display gap between otherwise valid radio reports. Revalidated owner/Home/plan leases may now extend only within the original radio expiry, keeping the source timestamp unchanged. Revocation, failed binding reads, weak/different-router scans, new GPS and absolute expiry still apply.

The three new replay tests failed before the correction and pass afterward. Existing configured operators need only pull this branch and restart the gateway; **no router re-entry, display re-enrollment or Flutter change is required for this correction**. Live Home display acceptance remains pending.

## Publication diagnostics — 8 September 2026

The next live trace passed Home-router recognition at -68 dBm: eight qualifying sightings, with the last radio observation at 18:10:01 UTC expiring at 18:12:01. A later read confirmed display opt-in and a valid saved Home/owner/Family-Care binding, but found no current Home record. That does **not** distinguish normal expiry from a publisher that never published. Earlier network/Firestore failures remain context, not a proven cause.

Revision `02fabb4841b00ae43337ee64a886f0627512771f` adds a strict-admin, read-only `GET /ops/wifi-home` view of the **running** observer and publisher. It exposes binding eligibility, pending read/write phase and age, current publication freshness, and the last acknowledged usable Home publication retained in memory after clearing. Pending/failed writes never count as publication. Status reads add no Firestore operations or persistent history.

`npm run wifi-home:check` reads that live state. With the explicit `--request-location` option, it checks the active pilot, binding and session, sends at most one existing proven `CR`, then observes publication for up to two minutes. It authenticates to loopback, rejects a different running pilot, limits each HTTP request to eight seconds, and never retries an uncertain handoff. It prints no router identifiers, keys, coordinates or command frames.

The private observer/publisher still dispatches no automatic watch command. Evidence expiry and GPS/SOS/Journey policies remain intact. A 15-second pending operation is reported, not presumed permanently failed; shared SDK operations are not cancelled or duplicated. Continuous Home report acquisition and its battery impact remain unaccepted.

For an already configured operator: stop the gateway, pull this branch, restart it, then run `npm run wifi-home:check -- --request-location` in a second terminal in `gateway`. A `home_ready` result is the point to open the app and ask `location?`; it proves a usable publisher acknowledgment, **not** that the UI rendered correctly.

## Backend publication and post-expiry fallback — 8 September 2026

On software revision `02fabb4`, the operator's one-CR check passed preflight and produced fresh enrolled-router reports at -68 dBm. The third qualifying observation was followed by `displayingHome: true` / `home_wifi_detected`, confirming at least one acknowledged, unexpired backend Home publication. Recognition continued to nine qualifying sightings; the final counters have ten reports, nine router sightings and zero ignored-time reports or duplicates. The display line has no independent timestamp, so no exact write time is asserted.

The final logged radio evidence expired at **18:51:13.854 UTC / 22:51:13.854 MUT**. The subsequent **22:52 MUT** ordinary WhatsApp reply showed retained GPS, a three-minute-old approximate Wi-Fi reading and a sub-minute watch check-in. The app screenshot likewise showed retained GPS and a connected watch. These are post-expiry fallback screenshots; they do **not** accept fresh Home map/hero/WhatsApp presentation. There is no simultaneous runtime status read establishing the exact clearing time.

This exposes the stationary acquisition gap: heartbeats postpone packet-silence recovery, while automatic location-freshness probes run only during an outing. The Home pilot itself requests no automatic reports, and the operator check sends one CR. A short publication burst therefore does not establish continuous Home presence. The trace does not prove why the firmware stopped scanning or reporting.

**Next implementation work:** bounded stationary report acquisition with rate limits and battery-impact validation, preserving radio expiry and GPS/SOS/Journey contracts. Router enrollment does not need repeating. This documentation checkpoint changes no running code, configuration or watch commands.

## Verification

This evidence update is documentation-only. Runtime verification remains for the following software revision:

Software revision: `02fabb4841b00ae43337ee64a886f0627512771f`.

- **756 gateway tests passed locally.** The new tests cover publication then normal clearing, observable pending reads/writes, late expired writes, recovery requiring fresh evidence, strict-admin rejection and the bounded checker.
- A real loopback CLI test sends one authenticated `CR` and verifies redacted output. A candidate or socket handoff alone cannot pass the publication check. The default command is read-only.
- Existing GPS selection, SOS delivery, entitlement, Firestore-shaped location and mixed-frame Journey/Home regressions pass.
- **[All release gates passed for this revision](https://github.com/vikrav14/guardian/actions/runs/34263898422):** gateway tests, Firestore authorization, Flutter analysis/tests and the Web release build. Live Home-map/hero/WhatsApp acceptance is still pending.
- Previous revision `8188087` passed [all release gates](https://github.com/vikrav14/guardian/actions/runs/34162879759): gateway tests, Firestore authorization, Flutter analysis/tests and the Web release build.

## Accepted hardware checkpoint

On 7 September 2026 UTC, the configured V52 matched the operator-selected 2.4 GHz Home radio: candidate at 20:18:41, matched at 20:19:23, then seven consecutive qualifying readings by 20:20:44, at -48 dBm with observation ages of 0–1 seconds. Ten reports, eight router sightings and eight qualifying sightings; no ignored-time reports or duplicates. Earlier cellular-only reports interrupted the initial sequence. The separate provider estimate remained approximately 519 m.

This passes near-router recognition for that watch/radio pair. The sample predates display activation and is not Home-map acceptance. No extra watch command or Wi-Fi password was needed.

## Run the private display pilot

From `gateway`, after stopping its running process:

```powershell
git pull --ff-only origin feat/v52-wifi-home
npm run wifi-home:setup -- --display-pilot
npm start
```

Restart/rebuild the Flutter app as well. Keep the watch near the enrolled router; new qualifying reports should put the avatar on the existing Home safe-zone pin, with **Home Wi-Fi detected**. Ask `location?` to check the corresponding ordinary reply. No new Meta template or BSSID entry is needed. Share only redacted diagnostic lines or the resulting screen.

No special nighttime outing is required for this private display check.

## Remaining gates

- [x] Private observer, hidden setup/removal, source/time/privacy regressions and SOS failure isolation
- [x] Near-router recognition on one real V52 and selected Home radio
- [x] Separately opt-in display, protected bounded backend evidence and app/chat expiry logic
- [x] Strict-admin running-publisher diagnostics and bounded one-CR check
- [x] Usable backend Home publication on the configured V52 (8 September 2026)
- [ ] Fresh Home map/hero/WhatsApp display acceptance (post-expiry GPS fallback observed)
- [x] Bounded strict-admin supplier-validation capture and redacted command preview
- [x] Complete 30-minute stationary baseline: heartbeats with no captured location/radio reports
- [ ] Native fence and stationary reporting acceptance, followed by normal battery-policy review
- [ ] Customer enrollment/removal UI and broader owner authorization workflow
- [ ] Physical loss/return, unknown-router, router restart, revocation and stale-GPS return acceptance
- [ ] Split/combined-radio and wider firmware acceptance
- [ ] Supplier single-router/unused-slot and removal instructions, plus native event acceptance; the one-entry setting was attempted once and the marked radio cycle is recorded, but acceptance remains unconfirmed
- [ ] General customer activation

PR #109 remains merged as `0afd652`. PR #116 stays **draft**; general customer Home activation remains disabled.

Repository QA documentation and the service promise matrix are updated. Wiki publication remains unavailable through the previously established wiki Git write-access limitation.
