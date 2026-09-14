# Historical PR #119 handoff

Archived before the 14 September shared Wellness implementation. This preserves
previous device evidence; its older edition split and trial status are historical,
not current instructions. The current contract is
[Shared Wellness editions](../design/wellness-editions-2026-09-14.md).

---

## Purpose

Complete the backend and frontend backbone for **Steps and daily activity** while keeping it disabled until the exact V52 counter semantics pass physical acceptance.

## Implemented

- passive ingestion from the raw V52 step value already present in `LK` and positioning traffic
- Mauritius-local daily aggregation with restart recovery
- stale-packet rejection, reset handling, implausible-jump fail-closed behavior and throttled writes
- protected `devices/{imei}/activityDays/{localDate}` storage, retention cleanup, rules and index
- Family/Care entitlement in gateway and Flutter; Essential receives an upgrade boundary
- disabled Flutter day/seven-day card with freshness, missing-data and non-medical wording
- deterministic Family WhatsApp today/seven-day activity answer with no LLM-derived calories, distance, fitness or medical claims
- acceptance collector evidence and a physical V52 test procedure
- strict-admin, audited new-watch pedometer provisioning with explicit `--enable`/`--disable`
- updated protocol ledger, schema and service promise matrix

## Protocol conclusion

The vendor documents passive raw steps in `LK,steps,rolls,battery` and the full positioning field at index 13. `PEDO` toggles counting and `WALKTIME` configures counting windows; neither is the upload mechanism.

Passive ingestion sends **no device command**. When a new watch presents an inactive pedometer, a technician may explicitly run:

```bash
npm run activity:provision -- --imei YOUR_DEVICE_IMEI --enable
```

The dedicated strict-admin path applies the documented full-day time sheet before `PEDO,1`, records audit evidence, reports partial handoffs safely and still requires physical watch verification.

## Live V52 evidence — 23 August 2026

- the watch initially displayed “Activate pedometer” and did not respond to touch
- the documented full-day `WALKTIME` plus `PEDO,1` sequence activated counting
- watch display `103` matched backend raw `103`
- a controlled 100-step walk advanced the backend raw counter by 99
- the physical counter subsequently continued from 202 to 312 without another configuration command
- Firestore recorded 13 bounded samples with zero resets and zero anomalies
- records remained `displayable: false` with `quality: unverified`

This is initial evidence from one V52, not fleet or release acceptance.

## Release gates — all default off

- `ACTIVITY_STEPS_INGEST_ENABLED=false`
- `ACTIVITY_STEPS_COUNTER_MODE=unverified`
- `ACTIVITY_STEPS_CUSTOMER_ENABLED=false`
- Flutter `GUARDIAN_ACTIVITY_STEPS_ENABLED=false`

In unverified shadow mode, no record is customer-displayable.

## Validation

- [x] synchronized with current `main`
- [x] 595/595 gateway tests passed locally
- [x] feature remains customer-hidden and disabled
- [x] GitHub Flutter analyze/test/Web build on the prior implementation commit
- [x] GitHub Firestore emulator authorization suite on the prior implementation commit
- [x] exact first-device V52 shadow counter evidence
- [x] first controlled 100-step comparison: backend delta 99
- [x] GitHub release gates passed for the pedometer-provisioning commit (run #55)
- [ ] longer controlled walks and a second V52
- [ ] midnight, reboot and reset semantics
- [ ] representative battery/data impact
- [ ] privacy/product acceptance
- [ ] customer gates enabled

## Next physical test

Keep ingestion in `unverified` shadow mode and both customer gates off. Record the final sample before Mauritius midnight and the first samples after midnight, then test watch reboot and gateway restart separately.

This PR must remain draft and must not be merged or enabled until the remaining acceptance evidence is attached.

## Approved Activity / Wellness design — 13 September 2026

Rav approved a shared mobile-first design across Essential, Family and Care, with useful content matched to each edition. This records the product/UI decision; implementation and release acceptance remain pending.

| Edition | Dashboard card | Detail screen |
| --- | --- | --- |
| Essential | **Activity**: today's steps and their update time | Basic daily activity for today |
| Family | **Activity**: today's steps, update time and a short factual activity summary | Seven-day activity history, plus activity questions through WhatsApp |
| Care | **Wellness**: today's steps and the latest available wellbeing readings, with a separate age for each reading | Family activity capabilities plus heart rate, blood-pressure estimates, blood oxygen, reading history and skin temperature once verified |

### Shared layout and presentation

- Keep the approved rounded cards, restrained green palette and clear typography consistent across editions.
- On mobile, place Activity / Wellness after the location card and before Safe zones. Keep calling and SOS prominent and reserve space for bottom navigation.
- On desktop, use the space proposed for replacing the repetitive Guardian insight card below Safe zones; keep location explanations with the map.
- Essential and Family use a compact Activity summary with a clear link to activity details. Care uses a Wellness summary with **View wellness**.
- Care's dashboard concept includes steps, heart rate, blood oxygen and skin temperature; blood-pressure estimates and the fuller reading history live on the detail screen.
- Each metric has its own measurement/update time. Watch connectivity must not imply a fresh measurement. Show stale or missing data explicitly; use **No reading yet** for a supported reading with no data.
- Include the **Skin temperature** tile in the Care design as **Not available yet** until the exact V52 temperature packet and Guardian data path are verified. The placeholder is not permission to display an unverified value.
- Keep charts and fuller history on the detail screen. Keep upgrade information inside details or the plan screen, so the dashboard stays focused on the current edition's useful information.
- The approved images use illustrative sample values only. Do not ship those values as live data or infer normal/abnormal/safe medical classifications.

### Implementation boundaries

- Basic steps in Essential are an **approved target entitlement change**, not an existing capability. The current activity branch limits steps to Family/Care.
- Essential gets today's basic activity; Family/Care get seven-day activity history and the activity WhatsApp experience. This does not change Essential's separate SOS WhatsApp entitlement.
- Wellbeing readings stay Care-only and retain existing consent, linked-device authorization, freshness and displayability requirements.
- Design approval does not satisfy device acceptance, enable feature flags, authorize customer measurement requests, or establish clinical accuracy.
- Integrate with the dashboard delivered by [PR #123](https://github.com/vikrav14/guardian/pull/123), preserving existing calling, SOS, location and Safe zones behavior.

Source: Rav's approved Essential / Family / Care concepts and follow-up request in the [design conversation](https://chatgpt.com/c/6aa6fcf5-fdc8-83ea-b433-6f45ad3bbe83). The written requirements above were recovered from the transcript supplied for this follow-up.

### Follow-up owned by PR #119

- [ ] Implement today's basic steps for Essential consistently across gateway, Flutter and Firestore authorization; preserve the Family/Care boundary for history.
- [ ] Implement the Essential and Family Activity dashboard/detail layouts and provide the shared activity data for Care.
- [ ] Add the Family/Care seven-day summary and activity WhatsApp entry point using the existing deterministic answer path.
- [ ] Verify edition access, today's versus seven-day data, stale/missing states and mobile/desktop integration.
- [ ] Complete the existing physical step-counter and product acceptance before customer exposure.

Coordinate Care's combined Wellness surface with [PR #120](https://github.com/vikrav14/guardian/pull/120). This follow-up updates PR documentation only; code, branch commits, gates and draft status are unchanged.


## Tracking follow-up from PR #116 closeout

[PR #116](https://github.com/vikrav14/guardian/pull/116) merged into main as `da975ade`. Its scope is the private Home Wi-Fi pilot. Its unaccepted GPS recovery is separately gated by `WIFI_HOME_WALK_RECOVERY_EXPERIMENT_ENABLED=false`.

The [near-Home walking review](https://github.com/vikrav14/guardian/blob/5112199ebed75717ca2134916a04c5752ab20e35/docs/testing/near-home-walking-logic-review-2026-09-14.md) records a separate tracking follow-up:
- Preserve timestamped raw-step observations and validate counter/reset/backlog semantics before using changes to corroborate a GPS window.
- Daily totals alone cannot prove movement during a particular walk; steps cannot invent GPS coordinates or distance.
- Near-Home candidates must remain separate from safe-zone exit alerts, outing reporting controls and confirmed journey totals until qualification is validated.
- Keep this tracking work separate from completion of the approved activity layouts and edition access. Zero or unavailable steps must not block existing GPS-proven wheelchair/vehicle journeys.

This records the integration dependency. It does not enable activity, alter its accepted edition design, or require #120 wellbeing readings.

