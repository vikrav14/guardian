# Near-Home walking logic review — 14 September 2026

Review of PR #116 at runtime `58232104ff34a35f554a47c47e8abf6d45100052`.
This records findings and a recommended design. It changes no runtime, device
commands, thresholds, feature gates, journey data or hardware acceptance.

## Conclusion

Guardian needs to distinguish a recorded movement from a confirmed safe-zone
exit. The existing near-zone start restriction explains the latest missing walk
under the previously supplied Home geometry. The expiry buffer solves a different
timing case and does not implement general near-Home walking support.

A bounded window of GPS evidence is a useful foundation, but geometry alone is
not enough to promise reliable walking recognition: an explicitly constructed
smooth-drift sequence passes the proposed geometry checks. Recommend a private
candidate/diagnostic stage first, then corroboration from verified, time-aligned
step changes before enabling near-Home walk confirmation for customers. Steps
can support movement; they cannot supply missing route coordinates or distance.

## Findings in the current code

| Area | Current behavior | Consequence and recommendation |
| --- | --- | --- |
| Home priority | `wifi-home-tracking.js` holds movement while verified Home evidence is fresh. On loss/expiry it still requires fresh valid GPS newer than the held Home observation. | Preserve this separation. Expiry, a heartbeat or a missing/weak router is not departure evidence. |
| Radio meaning | Home Wi-Fi is evidence of router proximity, not proof that the wearer is motionless. | Activity can happen within router range. Preserve truthful Home location labels while distinguishing activity evidence from a claim that the wearer left Home. |
| Zone boundary | `geofence.js` uses the saved radius plus the observation's uncertainty. V52 GPS with no horizontal accuracy gets the existing 30m policy margin. | With the previously supplied 50m Home zone, exit requires distance greater than 80m. The margin is a policy allowance, not measured GPS accuracy. |
| Journey start | `journey-builder.js` permits a valid GPS exit to start a journey. Generic movement is blocked when any active zone is inside or uncertain. | A near-Home movement record needs its own qualified start reason. Removing this guard globally would restore drift-generated journeys and could affect other zones. |
| Slow movement baseline | After Home, `journeyResumeReference` is replaced by each incoming GPS sample. With no reported speed of at least 1km/h, the movement fallback compares adjacent samples against the default 50m write-gate distance. | Reproduced 100m of cumulative movement in six 20m increments with zero reported speed and no zone restriction: zero journeys. A bounded window must assess displacement over time without reviving the old indoor baseline. This is an additional limitation, not the established cause of the latest walk; its packet speed values are not in the supplied console. |
| GPS acquisition | Packet-silence recovery is separate from location freshness. The independent location probe and the faster outing policy depend on an already active journey. Heartbeats postpone packet-silence recovery. | There is a gap before journey recognition: the watch can start supplying usable GPS after much of a short walk. A classifier cannot reconstruct samples never received. |
| Active journey side effects | `server.js` uses `isJourneyActive` for reporting context; `sessions.js` uses outing status for location probing; the Defi Media exposure matcher also consults active journeys. | Neither provisional movement nor a near-Home history entry should automatically become evidence that the wearer is away. Audit these consumers explicitly. |
| Closure | Fresh Home closes an active journey at its last actual GPS point. Generic idle closure normally needs later input; the configured default is 15 minutes. | A new near-Home path needs bounded finalization even if no further packet arrives, without claiming an arrival from silence. Preserve source times and avoid a synthetic segment to the Home pin. |
| Display filters | App and ordinary WhatsApp journey selection require aligned satellite evidence; non-confirmed-return records use a 20m connected GPS distance minimum. Confirmed-return records also require a real route start anchor. | There is no general multi-minute minimum hiding this test. Backend qualification and app/chat presentation must agree on any new record type. Do not manufacture a Home exit, anchored departure or confirmed GPS return just to pass a display filter. |
| Diagnostics | Saved journey diagnostics inspect completed documents. Existing capture has radio/timing evidence but no per-sample journey decision. | Add bounded, redacted reasons for pending, rejected, qualified, superseded, saved and failed states, plus active-versus-saved status. Absence from saved diagnostics alone cannot explain every processing failure. |

Relevant sources: `gateway/src/journey-builder.js`, `live-cache.js`,
`wifi-home-tracking.js`, `home-wifi-walk-buffer.js`, `home-wifi-walk-recovery.js`,
`geofence.js`, `sessions.js`, `adaptive-reporting.js`, `server.js`,
`context/defiMediaExposureMatcher.js`, `assistant/tools.js`, and
`apps/mobile/lib/journey/journey_models.dart` / `journey_v2_data.dart`.

## Latest physical evidence

The marked retest ran on `5823210`. Capture `c5333d19b3e34c2b5006fd11`
retained all 46 entries: 31 fresh reports, eight GPS-valid reports, six heartbeats,
22 Home-radio sightings, three CR handoffs/responses and three markers. No drops,
stale/repeated reports, native fence events or UPLOAD handoffs were recorded.

All times below are Mauritius time (UTC+04:00), 14 September 2026.

| Event | Time | Interpretation |
| --- | --- | --- |
| Departure marker | 16:47:24.218 | Operator marker; does not create a trip. |
| Home radio expiry / acknowledged clear | 16:47:39 / 16:47:39.202 | Last Home source was 16:45:39. |
| CR handoff | 16:48:43.407 | The supplied console explicitly identifies automatic packet-silence recovery. |
| First GPS source / receipt | 16:49:06 / 16:49:09.786 | Receipt is 105.568s after departure, and after Home expiry. |
| Fourth GPS source / receipt | 16:50:09 / 16:50:15.961 | First four fixes span 63s; see the exploratory geometry check below. |
| Weak Home radio | Source 16:50:30; receipt 16:50:33.840 | -80dBm fails the existing -75dBm minimum. |
| Return marker | 16:50:48.828 | Marked excursion duration is 204.610s. |
| Third subsequent strong Home radio | Source 16:51:33; receipt 16:51:39.915 | Three -43dBm reports qualify; a separate checker confirms fresh Home publication. This receipt is not an exact first publication time. |
| Capture stopped | Approximately 16:54:17 | Derived from rounded elapsed seconds, not the scheduled 17:06:56 end. Only about 3m28s after return. |

There were five GPS-valid receipts before the return marker and three after it.
Every receipt was after Home expiry, so departure did not exercise pre-expiry
buffer recovery. In source order, their distances from the previously supplied
Home pin are 59.7, 40.4, 26.7, 28.1, 11.4, 21.4, 23.4 and 21.5 metres.
The console supplies GPS validity and coordinates but no horizontal accuracy.
There is no new zone snapshot; the calculation uses the earlier saved pin and
50m radius. Under that geometry, seven fixes classify uncertain and one inside.

An offline replay through the actual geofence and journey functions, starting
from confirmed Home presence, yields zero transitions and zero journeys even
with a positive walking speed supplied. This isolates the zone restriction; it
does not recreate historical asynchronous database timing or measured speed.
The console contains no recovery, geofence or journey event lines in the marked
window. The latest-five saved diagnostic still contains only the earlier 13:13
walk for this day. Raw write-gate persistence is not proof of journey creation.

The eight coordinates connect to 125.6m, but this sum is not accepted physical
travel distance and includes post-return samples. The first GPS arrived late;
an earlier or farther part of the physical walk may be unobserved. The later
console extends past 16:58, without a journey event, but does not independently
establish physical stationarity or a saved-journey check at that later time.

## Exploratory GPS window: useful but insufficient

For review only, evaluated a candidate rule with at least four GPS points over
60 seconds, a window shorter than 120 seconds, adjacent gaps at most 60 seconds,
coordinate-derived speed at most 3m/s, endpoint displacement at least 60m for
two unknown-accuracy margins, and displacement/path-length ratio at least 0.75.
The last ratio is an exploratory directness filter, not a validated confidence
measure. These numbers are not approved production thresholds.

The first four actual fixes span 63s, have 62.4m endpoint displacement and 63.5m
connected length, directness 0.982 and maximum segment speed 1.415m/s. This is
movement-shaped evidence that the zone gate currently rejects. It is close to
the provisional displacement threshold; one walk cannot calibrate that cutoff.

| Offline example | Geometry-rule result | Meaning |
| --- | --- | --- |
| First four observed fixes | Pass | A window can retain useful movement-shaped evidence near Home. |
| First five observed fixes | Pass | The fifth fix is confidently inside; a corroborated incoming segment should not be lost merely because it ends inside. |
| Small stationary jitter | Reject | Basic scatter is excluded in this example. |
| One distant outlier followed by return | Reject | An isolated spike is excluded in this example. |
| Coherent Wi-Fi/LBS coordinates | Reject | Network estimates are excluded by source, regardless of apparent movement. |
| GPS increments of 20m every 20s with reported speed zero | Pass | Window displacement can address the rolling-baseline limitation. |
| Smooth stationary GPS drift: 0m, 21m, 42m, 63m over 63s | Pass | Critical counterexample: geometry alone cannot distinguish this input from real movement. |

Do not weaken the global radius, uncertainty allowance, RSSI limit, source gate
or Home expiry to force this recording to pass. Requiring an outside-zone fix
would avoid this specific ambiguity but also defeat the near-Home requirement.
GPS speed, satellite count and path smoothness are not independent motion proof.
Likewise, loss and return of Home Wi-Fi can occur during stationary report gaps.

## Recommended design and user behavior

Initial implementation scope should be the post-Home GPS case demonstrated by
this retest. GPS received under fresh Home priority continues through the
existing protected buffer. Movement entirely within sustained Home coverage
can still contribute verified activity/steps through #119, but this initial
near-Home route proposal does not promise to map every such walk.

1. Keep a private bounded movement candidate separate from confirmed outings.
   It requires the existing enrolled-pilot and verified binding gates, ordered
   fresh GPS and a sustained window. Expiry alone never creates a candidate.
   Use a moving window/subsegment so an eventual loop back does not erase an
   already corroborated segment. Do not compare with an old indoor GPS anchor.
2. Keep qualification distinct from the safe-zone transition state. A near-Home
   record has its own start/evidence type. It creates no Home exit alert or
   invented departure timestamp. Actual later GPS exit can promote the same
   record into the normal outing path, with source-point deduplication and no
   second copy of the route.
3. Initially keep geometry-only candidates in private diagnostics. Customer
   confirmation needs additional validated corroboration, such as an aligned
   plausible step increase plus the GPS window. Name a GPS-only observation
   "Movement near Home" if an explicitly provisional display is later chosen;
   do not silently count it as a confirmed walk or mix it into confirmed totals.
4. For a qualified record, append only accepted GPS segments and preserve the
   original source times. On fresh Home confirmation, retain the actual last
   qualifying endpoint. On a bounded reporting gap, finalize only already
   qualified evidence as partial; silence cannot establish Home arrival. There
   must be no dependence on another heartbeat to terminate pending state.
5. Define cancellation and concurrency before wiring the new path: binding
   revocation/change, stale/future/duplicate/backlog input, new Home evidence,
   a normal journey taking ownership, restart and slow writes. Borrow the
   existing buffer's bounded/cancellable approach, but avoid a second recorder
   that can replay the same GPS batch. Confirmed and candidate states need
   explicit handoff rather than simply calling the existing start function.
6. Treat recording, safety context and report acquisition as separate decisions.
   A candidate must not trigger outing upload overrides, context exposure or
   departure notifications. Preserve SOS priority, manual reporting choices,
   critical-battery behavior and existing proven outings. Any additional probe
   needs a separately tested, capped trigger based on supporting evidence;
   Home expiry on its own must not become continuous CR polling.

Illustrative timeline for equivalent input after that design is implemented:

| Stage | Customer behavior |
| --- | --- |
| Home evidence expires | Show existing truthful location freshness/fallback; no departure or trip. |
| First valid GPS arrives | Begin private candidate; no customer claim of a walk. |
| Sustained GPS window is available | Evaluate coherence and supporting motion evidence. With GPS alone, remain unconfirmed. |
| GPS plus validated corroboration qualifies | Retain one near-Home movement record from its first accepted GPS source time. No "Left Home" alert unless the separate zone rules prove an exit. |
| Real zone exit occurs later | Continue/promote the same route into an outing; preserve the actual later exit time. |
| Home returns or evidence ends | Save only the observed, qualified segment with honest coverage and closure labels. |

The latest capture has no usable time-aligned step series, so this review cannot
promise it would become a confirmed walk under the recommended combined rule.

## PR #119 / #120 integration and acceptance

Reviewed #119 at `778477b3dc8df224723bd26d6a214042a13787d0` and #120 at
`78f4311ad8290f91463cfd4bf8b9526cd8885b51`. Both change `server.js` and shared
assistant/configuration surfaces. Preserve all existing Home/SOS/authorization
hooks during integration.

#119 already ingests raw step counters, but its default counter semantics and
customer gates remain unverified/disabled. Its daily aggregation is based on
receipt time and uses throttled persistence. A day-total difference cannot
prove steps happened during this particular GPS window. A walking corroborator
needs two suitably aligned observations from the same verified counter epoch,
freshness/backlog checks, reset/day-rollover handling and a plausible increment;
counter increases from delayed reports or watch shaking need negative tests.
Keep the approved Essential daily steps / Family history / Care wellbeing plan
split separate from any tracking evidence capability. No entitlement bypass or
customer activation follows from this review. Zero/missing steps must not veto
existing GPS-proven journeys, including wheelchair or vehicle movement.

#120's medical-style sensor readings do not establish walking and add no required
dependency to this design. Preserve its Care/consent gates and unavailable
temperature behavior. A near-Home history record must not introduce a new health
inference or change those readings' permissions.

Before customer activation, require meaningful regression coverage for:

- True short movements with zero reported GPS speed, loops and partial coverage.
- Stationary router/report gaps with both scattered and smoothly drifting GPS,
  single spikes, network estimates and stale/reordered/duplicate packets.
- Correct step-to-GPS alignment, resets, midnight, backlog, disabled/unverified
  counters and non-walking movement.
- Candidate-to-outing handoff, overlapping zones, fresh Home during async work,
  no duplicate journey or exit notification, independent closure and write failure.
- Existing GPS outings, Home expiry buffer, app/browser/WhatsApp evidence and
  source labels, SOS/ACK behavior, manual/battery reporting and context exposure.

Review validation comprised source tracing, replay through existing geofence and
journey functions, a synthetic rolling-baseline reproduction, and exploratory
geometry examples including a counterexample. No runtime changed, so this is
not a new software-test or physical-acceptance pass. PR #116 remains draft, its
existing buffer acceptance stays open, and this review requests no further walk.
