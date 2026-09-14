# Short-walk review — 14 September 2026

Review of PR #116 runtime e9cad97 / documentation head ebb4739, following two physical pilot walks. No private coordinates, device identifiers or Home binding IDs are included.

**Implementation update:** the original review below is historical. The browser
fix was confirmed by the operator at `19ed4ec`. Subsequent gateway logs put the
second walk's four samples 21–34m from the shared Home pin (no proven exit), and
the third walk's first GPS 107m away while Home priority was still active.
Bounded recovery of corroborated GPS retained during Home priority is now
implemented on this branch. See [the current rules, timeline and acceptance
limits](home-wifi-short-walk-recovery-2026-09-14.md). Other proposals below remain
unimplemented, including within-Home movement and report-frequency changes.

## Finding: the saved first walk is already eligible

The supplied read-only record contains four aligned satellite observations (evidence version 3), 138 seconds of recorded movement, connected GPS distance 0.122 km, a GPS Home exit, a GPS Home entry, and closure by `home_wifi_detected`. Its point intervals are 12, 72 and 54 seconds. Its missing route-start anchor does not disqualify this close reason.

The current app and ordinary WhatsApp journey selector use a 20-metre connected-GPS minimum for records without a confirmed return. There is no general minimum journey duration or requirement to travel at vehicle speed. Reducing the distance threshold does not explain or solve this first walk's zero-trip browser display.

### Browser decoder defect and scoped correction

`apps/mobile/lib/journey/journey_utils.dart::decodePolyline` used `~(result >> 1)` to recover negative deltas. Dart web bitwise results can be unsigned 32-bit values. Negative latitude or longitude deltas then produce implausible coordinates, which are excluded by the distance calculation. Reproducing these documented semantics on the supplied record gives zero plausible points and zero distance; signed arithmetic gives four plausible points and 0.122 km.

The correction uses `-((result >> 1) + 1)` for both latitude and longitude. It changes coordinate decoding, not the movement, source-evidence, geofence or Home-radio policies. It does not rewrite stored routes or synthesize a Home-to-first-GPS segment.

A new platform regression uses synthetic geometry, checks negative initial coordinates and negative deltas, verifies that a roughly 122-metre Home-closed GPS walk is selected, and verifies that network-only observations remain excluded. Run it both natively and in Chrome; a release web build alone cannot catch a runtime platform difference. The release workflow now includes this focused Chrome run.

Reference: [Dart number representation and bitwise platform differences](https://dart.dev/resources/language/number-representation#bitwise-operations).

## Where short walks can still be missed

| Rule | Current behavior and implication |
| --- | --- |
| Fresh Home Wi-Fi | Qualified enrolled-router observations suspend GPS-derived journeys/dwell/geofence transitions, and preserve raw telemetry separately. This prevents indoor drift but also suppresses motion still within usable Home-radio coverage. |
| Home evidence loss | Expiry, missing router or weak signal does not prove departure. Tracking resumes only with acceptable, fresh satellite evidence newer than the Home observation. |
| Safe-zone boundary | With this pilot's 50-metre Home radius and default 30-metre GPS uncertainty margin, an exit requires a GPS position more than 80 metres from the Home pin. This is radial displacement, not walked path length. A short loop can travel over 100 metres while staying inside that boundary. Actual accuracy can increase the margin. |
| Generic start | Inside/uncertain active zones prevent a generic journey. Outside all zones, GPS speed at least 1 km/h can start one; otherwise the distance fallback uses `writeGateMinMetres` (default 50 metres). After Home, the fresh GPS baseline advances, which can miss cumulative slow movement when speed is missing and individual hops remain below the fallback. |
| Sparse route | The builder needs at least two accepted points to save a journey. The second walk's four raw GPS-valid reports do not establish four accepted route points; no completed second-walk record appeared in the supplied latest-record query. |
| Return classification | `return_to_origin` records without a trusted route-start anchor are excluded in both app and ordinary WhatsApp, even if they contain otherwise usable GPS movement. A `home_wifi_detected` closure does not require that anchor. Changing this requires a shared evidence contract, not just removing an app check. |
| Sampling | Automatic reporting is normally 60/300/600/900 seconds by battery band; a known active outing requests 60 seconds, or 300 seconds below 15% battery. Manual mode, actual applied interval and recovery/burst behavior also matter. A walk may finish before sparse reporting identifies it as an outing. |

The second walk's missing completed record remains undiagnosed. Do not assert it was too short, entirely inside Home, or blocked by radio suppression without accepted-point and boundary diagnostics.

## Recommended enhancement, separate from the decoder fix

Treat short walks as a core Guardian use case for older adults, children and teenagers. Evaluate evidence quality rather than assuming driving speed or distance.

1. Retain a bounded provisional buffer of fresh plausible GPS points after Home evidence becomes unavailable. Radio loss alone must not produce an exit, trip, alert or distance. Promote movement only after a reviewed rule establishes repeated coherent displacement beyond uncertainty; expire stationary/noisy candidates.
2. Separate observed movement, confirmed safe-zone crossing, and route completeness. A valid short recorded segment may be shown as an incomplete route without claiming a Home departure or inventing the missing route. Walks entirely within a configured zone require this explicit separation; do not quietly shrink the alert boundary.
3. Review unanchored but otherwise supported return records as partial routes. Preserve trusted departure/return evidence requirements and label missing coverage; update the shared app/WhatsApp contract and regression fixtures together.
4. Use a bounded transition/recovery request if needed to capture brief walks. Respect manual reporting, battery limits, command cooldowns and SOS priority. Measure command origin, applied interval, first accepted GPS and first Home publication before tuning radio qualification or report frequency.
5. Keep within-Home activity available through verified daily steps in #119. Step increments can support activity context but cannot supply GPS coordinates, prove a safe-zone exit, or fabricate a route. Care readings in #120 do not prove movement.
6. Improve omission diagnostics: distinguish source quality, boundary uncertainty, insufficient points, incomplete start, too little connected movement, and invalid decoded geometry. The generic approximate-update explanation is misleading for other causes.

This is a proposed policy direction, not an enabled feature or a claim of reliable detection of every short walk. Native watch WIFIFENCE behavior remains unaccepted: current useful Home evidence is the server's enrolled-router observation policy.

## Compatibility and regression boundary

Keep indoor GPS/network drift suppression, stale/out-of-order/future rejection, original observation age, Home binding validity, safe-zone uncertainty, no bridging of missing route segments, and existing SOS/offline/battery behavior. Preserve journey/stop/leg/replay semantics for longer outings and normal behavior when Home Wi-Fi is not enrolled.

Required cases for a later policy change: short and slow GPS walks; loops near Home; departure/return with sparse GPS; renewed radio while an outing is active; indoor router loss; indoor GPS jitter; the historical 44-point network-only false outing; gateway restart and delayed packets; overlapping Home/School zones; critical battery and manual reporting; SOS during a candidate walk; and app/ordinary WhatsApp agreement.

The pending #119 and #120 file lists do not modify the journey decoder or journey policy modules. They do share integration files such as gateway `server.js`/`config.js`, assistant tools and Flutter `guardian_services.dart` with the broader feature work. A decoder-only patch has narrow overlap; later sampling/state changes must recheck those shared integrations. Their release gates and approved edition split remain in place.

## Validation status

The initial saved-record calculation was a read-only reproduction of documented native/web arithmetic semantics, not a live run of the operator's browser. Actual platform checks and release-gate outcomes are recorded in the PR after execution. A user refresh on the corrected app build is still needed to confirm the pilot screenshot is resolved.
