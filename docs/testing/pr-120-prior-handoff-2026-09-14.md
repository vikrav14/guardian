# Historical PR #120 handoff

Archived before the 14 September shared Wellness implementation. This preserves
previous device evidence; its older edition split and trial status are historical,
not current instructions. The current contract is
[Shared Wellness editions](../design/wellness-editions-2026-09-14.md).

---

## Purpose

Complete the disabled backend and Flutter path for **Guardian Care wellbeing readings** while keeping all customer and device-request surfaces off until exact-device acceptance is complete.

## Implemented

- confirmed upload normalization for `oxygen,type,value` and `bphrt,systolic,diastolic,heartRate,...`
- consent-gated Firestore persistence with deterministic deduplication and 30-day default retention
- revocation helper that deletes retained wellbeing readings
- strict-admin, pilot-only heart-rate/blood-pressure request path
- Care-only deterministic WhatsApp reply path
- Care app model, query service and readings panel with an independent compile-time gate
- Firestore rules and index for linked Care users, current consent and displayable readings only
- exact-device acceptance reporting and operating scripts
- non-medical wording, explicit freshness and no normal/abnormal/safe classification

## Protocol evidence and current boundary

- The V52 datasheet lists heart rate/blood pressure, steps, skin temperature and SpO2 capabilities.
- The supplied protocol material confirms the upload shapes used here for `bphrt` and `oxygen`.
- Supplier guidance says the V46 and V52 use the same implementation. That supports a guarded `hrtstart,1` pilot.
- The example document labels `hrtstart,1` as V46, so a matching packet from the exact V52 is still required before acceptance.
- No confirmed V52 oxygen-request or temperature packet shape is available. Those requests and all temperature display paths remain blocked.

## Default-off controls

- `CARE_WELLBEING_INGEST_ENABLED=false`
- `CARE_WELLBEING_DEVICE_MODE=unverified`
- `CARE_WELLBEING_CUSTOMER_ENABLED=false`
- `CARE_WELLBEING_REQUEST_ENABLED=false`
- Flutter: `GUARDIAN_CARE_WELLBEING_ENABLED=false`

Unverified packets may only be retained as protected, non-displayable acceptance evidence when ingestion is deliberately enabled.

## Privacy and authorization

- wearer acknowledgement is recorded by the backend before any pilot request
- the recording administrator must be present in `ADMIN_EMAILS`
- customer reads require an active Care plan, linked device, current consent and `displayable=true`
- client writes to readings and consent are denied
- revocation removes retained readings
- real device identifiers were removed from changed test fixtures before publication

## Validation

- [x] Gateway suite: **587/587 passed**
- [x] Privacy-sanitization regression subset: **39/39 passed**
- [x] JavaScript syntax checks and `git diff --check`
- [x] Synced with merged `main` through `db32452`
- [x] GitHub release gates on updated head `78f4311`
- [x] Flutter analyze, tests and Web release build
- [x] Firestore emulator authorization suite

## Exact-device acceptance still required

- [x] record explicit wearer consent
- [x] capture wearer-initiated heart/BP and SpO2 packets and compare them with the watch display
- [x] send `hrtstart,1`: exact V52 acknowledged it but did not start measurement automatically
- [ ] complete 24-hour hourly reliability/battery trial plus missing, malformed, stale and reboot/reset cases
- [ ] complete privacy/product acceptance
- [ ] revoke consent and confirm retained readings are removed
- [ ] keep temperature unavailable until its exact V52 packet is documented and captured

## Draft status

This PR must remain **draft, open and unmerged**. Do not enable customer display or advertise the feature until the exact-device and privacy gates above have evidence attached.

## Exact-device pilot update — 23 August 2026

- the pilot V52 acknowledged `hrtstart,1`, but automatic one-time measurement did not start
- one wearer-initiated heart/BP/SpO2 result matched the protected Guardian fields exactly
- `hrtstart,300` produced two autonomous heart/BP and SpO2 cycles approximately five minutes apart without wearer interaction
- the backend now supports consent-gated `--schedule-seconds 300..65535` and `--stop`
- Guardian's intended service interval is `3600` seconds; `300` is acceptance-only
- consent revocation attempts `hrtstart,0` before deleting retained readings and reports an unreachable watch honestly
- the acceptance inspector now preserves multiple timestamps and reports observed recurrence
- the hidden Guardian Care panel is now titled **Latest wellbeing**, shows exact watch estimates and freshness, and explicitly marks stale/missing readings
- no IMEI, administrator identity or health values are published in this PR evidence
- customer display, device acceptance state and public marketing remain disabled pending the 24-hour trial


## Current handoff — hourly trial

- the pilot watch accepted `hrtstart,3600` on one live TCP session
- the 24-hour hourly reliability and battery trial is now in progress
- do not manually start health measurements during the trial
- next evidence command: `npm run acceptance:v52 -- --imei YOUR_15_DIGIT_IMEI --since 25h`
- verify hourly pairing, missed/delayed cycles, reconnect survival and battery impact
- emergency/pilot stop: `npm run wellbeing:request -- --imei YOUR_15_DIGIT_IMEI --stop`
- keep `CARE_WELLBEING_CUSTOMER_ENABLED=false` and `GUARDIAN_CARE_WELLBEING_ENABLED=false`

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

### Follow-up owned by PR #120

- [ ] Implement Care's combined Wellness dashboard card and detail screen, including Family activity capabilities from [PR #119](https://github.com/vikrav14/guardian/pull/119).
- [ ] Show each accepted wellbeing metric with its own time and explicit missing/stale state; put blood-pressure estimates and fuller history on the detail screen.
- [ ] Include the Skin temperature unavailable placeholder; keep real temperature values and requests blocked until exact-device verification.
- [ ] Verify Care-only access, consent/revocation behavior and mobile/desktop integration.
- [ ] Complete the existing exact-device, reliability/battery and privacy/product acceptance before customer exposure.

Coordinate the new Essential basic-steps entitlement and Family activity history with PR #119. This follow-up updates PR documentation only; code, branch commits, gates and draft status are unchanged.

