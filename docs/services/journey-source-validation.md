# Journey source validation

## Confirmed failure

A wearer reported remaining at home while Journey displayed a 4.039 km,
44-point trip lasting about 25 minutes. A read-only Firestore inspection found
40 Wi-Fi estimates, four LBS estimates, no valid GPS fixes, no points reporting
movement, no departure/return event, a generic-movement start and an idle close.
The old diagnostic nevertheless reported `ok`.

The generic movement fallback treated displacement between network estimates
as movement. Journey distance summed those changes, and aligned version-3
metadata alone allowed the app to present the record as a trip. A long-duration,
low-distance legacy drift heuristic did not match this record.

The shared regression fixture in `docs/testing/journey-source-evidence.json`
reproduces the reported source counts, timing and recorded total with synthetic
coordinates. It contains no wearer, device, SIM or actual home coordinates.

## Current behavior

- Only an explicit GPS source with `gpsValid: true` can start a journey or
  refresh its movement timer. A network estimate cannot be a displacement
  baseline for starting a GPS journey, even if it carries nonzero speed.
- Provider Wi-Fi/LBS estimates cannot confirm a geofence entry or exit. The last
  confirmed presence is retained while the observation is uncertain. The
  separate enrolled-Wi-Fi inside-presence contract remains intact.
- A pending return requires another satellite observation and certain safe-zone
  classification. Network updates cannot finish the return confirmation.
- Approximate points received during a genuine journey remain in raw evidence.
  Only consecutive valid GPS points contribute distance. There is no straight
  line across an approximate observation or a tracking gap over five minutes.
- Mixed-source clusters do not produce stop or leg claims. This also applies
  when reading older records that already contain approximate stop clusters.
- The app and assistant exclude stored records lacking aligned version-3 source
  evidence with at least two valid GPS observations. Eligible records retain the
  existing 20 m minimum for generic trips and the anchored-return exception for
  sparse confirmed outings. Read paths recompute distance from GPS evidence
  instead of trusting old mixed-source totals.
- An excluded record is preserved in Firestore. It contributes no trip, distance,
  duration or point total and cannot be selected for replay. The app explains
  that updates were received but a trip could not be confirmed.
- A generic journey begins at “First recorded”; it does not invent a safe-zone
  departure. The “evidence-backed” wording and verified badge are removed.

## Relationship to earlier and future PRs

Reviewed before implementation:

| PR | Scope | Relationship |
| --- | --- | --- |
| [#106](https://github.com/vikrav14/guardian/pull/106) | Existing journey guards, source metadata, diagnostics | Extended the source checks while preserving GPS boundary, restart and sparse-return behavior |
| [#108](https://github.com/vikrav14/guardian/pull/108) | Hybrid route display and nearby-place presentation | Presentation geometry does not establish movement or replace source evidence |
| [#122](https://github.com/vikrav14/guardian/pull/122) | Retained GPS versus approximate Home location | Compatible with keeping the last satellite fix and latest network observation separate |
| [#116](https://github.com/vikrav14/guardian/pull/116) | Draft Home Wi-Fi contract | Scaffold only at review; its future enrolled presence must remain distinct from provider coordinates |
| [#119](https://github.com/vikrav14/guardian/pull/119) | Draft activity/steps work | Does not currently corroborate trips; zero steps is not evidence against vehicle travel |

The Home Wi-Fi and activity PRs were unmerged at review. This change does not
enable them or invent watch commands.

## Verification and acceptance

Automated regressions cover the exact 40 Wi-Fi / four LBS source pattern,
nonzero-speed network packets, uncertainty circles wholly outside Home,
GPS journey preservation, mixed-source distance, idle closure, return
confirmation, existing-record filtering, assistant totals and the empty Journey
screen at mobile and desktop widths. The shared source fixture is exercised by
both Node and Flutter.

Release gates run the complete gateway suite, Flutter analysis/tests/Web build,
and Firestore authorization tests. SOS selection and delivery tests remain part
of those gates; this change does not alter the approved SOS templates.

After pulling the change, restart the gateway and Flutter app. The reported
network-only record should disappear from customer trip totals without deleting
it. On 7 September 2026, the operator reported staying indoors that day with no
trip shown. This accepts the observed stationary-indoor result; it does not
assert deletion of the raw historical record. A new genuine outdoor
departure/return on this revision remains unrecorded. See the
[recorded pilot evidence](../GUARDIAN_V52_REAL_DEVICE_ACCEPTANCE.md#recorded-callback-sos-evidence--7-september-2026).

This fixes the demonstrated network-source error. Two GPS points are an
eligibility condition, not a universal proof of travel: GPS drift and sparse
coverage still require existing plausibility rules and real-device acceptance.
