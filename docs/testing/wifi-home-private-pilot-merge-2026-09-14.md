# PR #116 private Home pilot merge scope — 14 September 2026

## Scope and decision

Merge the established private Home Wi-Fi observation/display pilot and its
source/expiry/history, diagnostics and journey presentation corrections.
Keep unaccepted walk recovery behind its own default-off experiment flag.
Broader near-Home walking is follow-up work coordinated with #119, and customer
activation remains behind the existing release gates.

The operator approved this closeout boundary after reviewing the latest walking
evidence. The decision does not turn missing physical acceptance into a pass.

## Feature controls

| Control | Default | Meaning |
| --- | --- | --- |
| `WIFI_HOME_OBSERVE_ENABLED` | false | Private observer for the explicitly configured watch and enrolled radio. |
| `WIFI_HOME_DISPLAY_PILOT_ENABLED` | false | Separately opted-in Home presentation, requiring the verified pilot binding. |
| `WIFI_HOME_WALK_RECOVERY_EXPERIMENT_ENABLED` | false | Unaccepted recovery experiment; requires both existing pilot controls, a publisher and the recovery callback. |

Existing setup and Home display opt-in do not enable the recovery experiment.
With its flag absent/false, no recovery buffer or timer is allocated, even
though the server supplies a recovery callback. The protected read-only checker
reports `walkRecoveryEnabled` and `walkRecoveryActive` so a configured flag is
not confused with a running experiment or a successful recovery.
If the running gateway predates these fields, the checker prints `null` (unknown)
instead of claiming recovery is off. Pulling the script alone does not update
the running process; restart the gateway to use the new default-off behavior.

The experiment's existing source, age, binding, scope and cancellation rules
continue to apply when explicitly enabled. Disabling it and restarting empties
pending state; late callbacks cannot revive the old batch. This flag does not
send a watch command or change router enrollment, Home expiry, zone radius,
SOS behavior, ordinary live GPS processing or reporting intervals.

## Evidence supporting the private pilot

- Repeated enrolled-radio recognition and acknowledged fresh Home publication
  were observed on the configured watch/router.
- The supplied app and ordinary WhatsApp screenshots show Home Wi-Fi evidence
  separately from retained satellite evidence.
- Expiry clears fresh eligibility; historical Home retains its original source
  age. The supplied retention checkpoint covers historical app presentation and
  restoration of the same historical timestamp after gateway restart.
- A genuine earlier GPS outing is saved, and the operator confirmed it appears
  in the browser after the polyline decoding fix.
- Later marked tests document both successful Home requalification and missing
  near-Home journeys. Their absence is not silently marked as walking acceptance.

These observations are limited to the supplied pilot evidence. They do not
establish every post-restart UI surface, network-failure case, firmware variant,
continuous Home availability or battery impact. Historical WhatsApp/details
agreement and the broader failure/revocation matrix remain release work.

## Software merge checks

- Default configuration and Home display alone must not allocate or run recovery.
- Explicit opt-in must preserve pilot scoping and all existing prerequisites.
- Restarting with the experiment off must stop its timer and discard pending work
  while leaving Home display available.
- Protected diagnostics must distinguish opt-in from active recovery, with no
  identifier exposure and no added command path.
- Existing recovery, Home, GPS/geofence/journey, SOS, reporting, authorization,
  Flutter/Chrome/Web-build and dashboard checks must remain green.

Final commit and CI results are recorded in the current PR description. This
document states the gate; it does not predeclare its result before CI completes.

## Remaining work and ownership

| Follow-up | Acceptance boundary |
| --- | --- |
| Experimental pre-expiry GPS recovery | Obtain a qualifying real-device recovery and saved journey, with false-trip and lifecycle checks, before broader enablement. The latest retest did not exercise that timing case. |
| Near-Home movement, coordinated with #119 | Introduce private candidates and useful rejection diagnostics; validate GPS plus aligned motion/step corroboration. Preserve zone alerts and avoid duplicate routes or unintended outing/reporting side effects. |
| Early report acquisition | Review bounded triggers and battery/manual/SOS interactions. Expired Home alone must not become repeated CR polling. |
| #119 activity | Verify counter/reset/timing semantics and implement the approved edition layouts/access. A daily aggregate cannot corroborate a particular GPS window. |
| #120 wellbeing | Continue its independent consent, device-reading and presentation work. It is not a prerequisite for walking evidence. |
| Customer Home release | Owner enrollment/removal, wider authorization/firmware/radio coverage, router loss/restart and failure/revocation acceptance, historical surface agreement, reporting availability and battery impact remain gated. |
| Native Wi-Fi fencing | Supplier syntax/persistence/rollback and physical native events remain unaccepted. Passive enrolled-router matching is not native fence acceptance. |

See the [walking review](near-home-walking-logic-review-2026-09-14.md) and
[recovery experiment specification](home-wifi-short-walk-recovery-2026-09-14.md).
The full [earlier PR description](wifi-home-pr116-checkpoints-through-2026-09-14.md)
is preserved for traceability; its old merge/next-test wording is historical.

## Operator after merge

Pull `main` and restart the gateway when ready. Existing Home enrollment remains
usable. Leave the new experiment setting absent or false for the standard pilot.
`npm run wifi-home:check` should then show both recovery fields false while Home
observation/display use their existing controls. This closeout does not require
another walk or a native watch-setting change.
