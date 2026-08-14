# Guardian service promise and entitlement contract

**Status:** Release contract — evidence reviewed 14 August 2026
**Applies to:** Guardian Essential, Guardian Family, Guardian Care
**Release rule:** A feature is not launch-ready merely because a screen or code path exists.

This document is the source of truth between Guardian's pricing promises, plan enforcement, product behaviour, automated evidence and release testing. When code and marketing disagree, access must fail closed and the discrepancy must be resolved before release.

## Evidence states

| State | Meaning |
|---|---|
| Proven | The implementation, backend entitlement, client behaviour and automated tests agree. Device-dependent promises also passed the named real-device acceptance test. |
| Partial | Useful implementation exists, but at least one required proof layer is missing. It must not be described more strongly than the evidence allows. |
| Not implemented | The advertised outcome does not exist end to end. Implement it or remove/reword the promise. |
| Operational | Delivery depends on a human process, provider configuration or SLA that must be documented and exercised. |

## Canonical plan inheritance

Plans inherit upward. A Care family receives Family and Essential services; a Family family receives Essential services. A caregiver invited into a family circle inherits the purchaser's effective family plan and does not need a separate subscription.

| Plan | Included capability group | Caregiver limit | Location-history window |
|---|---|---:|---:|
| Essential | Core watch safety | 1 | 7 rolling days |
| Family | Essential + Guardian AI, WhatsApp and smart notifications | 5 | No product time limit; retention/fair-use policy required |
| Care | Family + medication, wellbeing, reports and routine care | 5 | No product time limit; retention/fair-use policy required |

The versioned backend catalogue is implemented in `gateway/src/entitlements.js`. UI labels are not authorization. All backend writes, reads, notification fan-out and assistant tools must check the same effective entitlement.

## Advertised promise matrix

### Guardian Essential

| Advertised promise | Current proof | State | Required release evidence |
|---|---|---|---|
| Live GPS | Gateway distinguishes `gps=A` satellite fixes from `gps=V` WiFi/LBS estimates, retains both independently, separates watch and location clocks, and labels approximate uncertainty. | Partial | Complete the outdoor-to-indoor V52 sequence in `GUARDIAN_LOCATION_PROVENANCE.md`, then separately measure satellite error before advertising a numerical precision. |
| SOS alerts | Device/app alert ingestion, deterministic safety messaging and notification fan-out exist. | Partial | End-to-end V52 SOS test through every enabled Essential channel; delivery and duplicate-suppression evidence. |
| 7-day location history | Locations, segments and compressed journeys exist. Flutter date controls and service calls reject older days, and Firestore rules reject records older than seven rolling days. | Partial | Run the emulator boundary suite and retention/downgrade acceptance test against the release candidate. |
| Two-way calls | Mobile can launch a carrier voice call to the saved watch SIM. Desktop presents the number, voice/data distinction and an explicit handoff. | Partial | V52 incoming/outgoing call acceptance, per-minute carrier charging, failure copy and carrier/SIM prerequisites. |
| Home and school safe zones | Geofence storage, transitions and alerts exist. | Partial | Real entry/exit, boundary jitter, offline recovery and duplicate-alert field tests. |
| Battery alerts | Persist-on-change, freshness-aware status and low-battery alert routing exist. | Partial | V52 threshold and stale-reading test; one alert per policy window. |
| 1 family caregiver | Gateway transactions, Firestore invite rules, Flutter service checks and adaptive account UI enforce the active owner's one-caregiver limit. Clients cannot grant membership or service ownership. | Partial | Concurrent two-account live acceptance test and revocation lifecycle. |

Essential does **not** include WhatsApp questions and answers. Critical safety continues through the Essential channels that are explicitly configured; the service must never silently substitute an excluded WhatsApp service.

### Guardian Family

| Advertised promise | Current proof | State | Required release evidence |
|---|---|---|---|
| Everything in Essential | Inherited by the versioned plan catalogue. | Partial | Every Essential gate above must pass. |
| Guardian AI | Deterministic intent, language and factual reply engines exist; an LLM is bounded to eligible functional paths. | Partial | Remove or qualify unsupported inferences; evaluation corpus and cost/error budgets. |
| WhatsApp questions and answers | Registered-caller authorization, deterministic controller, journey/location/battery/alert replies and safe actions exist. The app first offers deterministic quick checks and makes WhatsApp an explicit continuation. | Partial | Approved business-number build configuration, Meta production token/template test, expiry handling, idempotency, cost limits and full acceptance corpus. |
| Proactive smart notifications | Push/WhatsApp policy and deterministic escalation rules exist. | Partial | Scenario matrix, quiet-hour policy, rate limits and real delivery tests. |
| Unlimited location history | Family/Care bypass the Essential query/rule window and the app exposes retained dates. | Partial | Publish a retention/fair-use definition and prove restore/export and downgrade behaviour. |
| Voice assistant | No verified voice-assistant product exists. Voice monitoring/listen is intentionally prohibited. | Not implemented | Define a safe product separately and implement it, or remove/reword this promise. |
| Up to 5 family caregivers | Gateway transactions, Firestore invite rules, Flutter service checks and adaptive account UI enforce five caregivers for the verified owner. | Partial | Concurrent live acceptance, revocation and owner/member lifecycle. |

### Guardian Care

| Advertised promise | Current proof | State | Required release evidence |
|---|---|---|---|
| Everything in Family | Inherited by the versioned plan catalogue. | Partial | Every Family and Essential gate above must pass. |
| Medication reminders and acknowledgements | App/WhatsApp creation is Care-gated in UI, service, rules and gateway. Reminder stores remain inconsistent and acknowledgement is not end to end. | Partial | One canonical reminder store, delivery state, wearer/guardian acknowledgement, retry and V52 device test. |
| Wellbeing and activity summaries | Deterministic daily summary and rule-based device intelligence exist. | Partial | Evidence-labelled facts, missing-data behaviour, Care-only app/WhatsApp gates and acceptance corpus. |
| Weekly Guardian AI care summaries | No complete scheduled weekly product and delivery audit exists. | Not implemented | Define data window, generation, consent, channel, retries, provenance and opt-out. |
| Shareable family wellbeing reports | Journey sharing exists, but it is not the advertised wellbeing report. | Not implemented | Define report content/privacy, generate, authorize, expire links/files and test sharing. |
| Proactive safety and routine alerts | Some safety/escalation rules exist; a complete routine-care policy does not. | Partial | Approved rule catalogue, suppression/quiet hours, audit trail and real scenarios. |
| Priority family support | No documented support queue or SLA is proven by code. | Operational | Name the channel, hours, response target, escalation owner and reporting process. |

## Trusted subscription model

`users/{uid}.subscription` is legacy display data and must never grant access. It was client-writable and used the obsolete `free/premium` vocabulary.

The authoritative record is `serviceSubscriptions/{serviceOwnerUid}`:

```text
version: 1
managedBy: guardian_admin | billing | migration
plan: essential | family | care
status: active | trialing | grace_period | past_due | cancelled
currentPeriodEnd: timestamp?   # active/cancelled boundary
trialEndsAt: timestamp?        # required for trialing
graceEndsAt: timestamp?        # required for grace/past_due
updatedAt: timestamp
```

Access rules:

- Missing, malformed, unknown-plan and untrusted records fail closed.
- `trialing`, `grace_period`, `past_due` and `cancelled` require an explicit future access boundary.
- `users/{uid}.serviceOwnerUid` identifies the purchaser whose plan the family member inherits.
- Inheritance is valid only when the purchaser also lists that UID in backend-managed `memberUids`; the legacy client-maintained `familyMembers` list and a self-asserted owner UID are insufficient.
- Only an Admin SDK billing/admin/migration path may write authoritative subscriptions.
- Downgrade, cancellation and family removal must take effect at a documented timestamp across the app, WhatsApp, notifications, scheduled jobs and writes.

## Enforcement layers

| Layer | Requirement |
|---|---|
| Gateway | Check feature entitlement before tools, replies, commands, reminders, summaries and notification fan-out. Recheck immediately before a confirmed write. |
| Firestore rules | Deny client writes to authoritative subscription data; enforce plan, linked-device, history-window and caregiver constraints. |
| Flutter app | Read the effective family plan, hide or explain unavailable services, constrain history dates and block direct service writes. |
| Scheduled workers | Re-evaluate the current plan at execution time; never rely on the plan at creation time. |
| Audit/metrics | Record plan, feature and outcome without message contents, tokens or unnecessary health/location data. |

## Known security dependency

Family membership now uses a backend-verified join request: clients may submit an invite code, but only the gateway transaction may set `serviceOwnerUid`, `memberUids`, family display lists or inherited watch links. `users/{uid}.linkedImeis` still participates in direct device authorization while remaining client-writable in the example rules. That remaining linking boundary is not acceptable for production; before release, initial device linking must also move to a server-verified proof-of-possession workflow.

## Release gate

PR #106 must remain draft until all applicable gates pass:

1. Gateway full test suite and entitlement adversarial tests.
2. Flutter analyzer, full test suite and Web release build.
3. Firestore emulator rule tests for plan, history, linking and caregiver boundaries.
4. Advertised promise matrix has no unexplained red or partial launch item.
5. Real V52 acceptance for SOS, calls, reminders, location, battery and geofences.
6. Meta production acceptance for replies, templates, token expiry and idempotency.
7. Android build and device smoke test before mobile release. Android SDK absence may be deferred during Web development, but it is not waived for release.
8. Billing/admin subscription lifecycle and downgrade test.
9. Privacy, retention, support/SLA and customer-facing wording review.

No release decision may be based only on a green unit-test count.

## Adaptive Flutter contract

- `HomeShell` resolves the effective family subscription once and exposes it through `GuardianEntitlementsScope` to all routed pages.
- Essential receives factual watch status, core safety controls, a seven-day history selector and one caregiver slot. Guardian AI, WhatsApp service actions and Care observations are not presented as active.
- Family adds Guardian AI, deterministic Guardian-help actions, optional WhatsApp continuation, smart-notification presentation, retained history and five caregiver slots. Care-only medication and wellbeing controls remain locked.
- Care adds medication, wellbeing and routine-care surfaces. Medication and care-profile writes require the verified Care subscription in Flutter services and Firestore rules.
- Loading, permission/network error, inactive, excluded and allowed states use different deterministic copy. Restricted services fail closed while the plan is unverified.
