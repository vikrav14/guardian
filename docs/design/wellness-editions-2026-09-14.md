# Shared Wellness editions — 14 September 2026

This decision supersedes the 13 September Activity/Care-only visual split recorded
in PRs #119 and #120. Rav and his partner approved consistent screens, with service
and history differences by edition, and authorized implementation in this conversation.

| Edition | Shared dashboard | Wellness detail | History access |
| --- | --- | --- | --- |
| Essential | Today's steps and available watch readings, with each update time | Dashboard only | Current Mauritius calendar day |
| Family | Same Wellness card | Activity and watch-reading history | Today plus six preceding Mauritius calendar days |
| Care | Same Wellness card | Same detail layout, date selection and earlier weeks | Available retained history during active service |

The four dashboard tiles are steps, heart rate, blood oxygen and skin temperature.
At Rav's request on 15 September, a full-width blood-pressure row sits beneath
these tiles, with systolic/diastolic values in mmHg, its own reading age and a
`Watch estimate` label. It uses the latest eligible reading from today; older
readings remain in dated details. Temperature remains `Not available yet`;
no unverified temperature packet or request is introduced. Unsupported readings have
no invented values. Old readings do not become today's readings. Missing days are
gaps, not zeros. Connectivity is separate from measurement freshness.

Mobile order is location, Wellness, Safe zones. On desktop Wellness sits beneath
Safe zones in the adjacent column. The repetitive location insight is replaced
only when Wellness is actually present. Calling, Home evidence, journeys, SOS and
navigation keep their existing behavior and release gates.

## Implementation sequence

- #119: integrate current main; shared card/detail components; today's steps for
  Essential; bounded Family activity; Care date browsing; activity source windows,
  WhatsApp calendar correctness, Firestore authorization and accepted-record retention.
- #120: integrate #119; adapt consented accepted wellbeing records into the shared
  components for all editions; separate basic reading entitlement from Care profile,
  medication and advanced-summary entitlements; enforce the same history windows.
- Follow-up: Care weekly WhatsApp delivery, longer-term AI comparisons and optional
  personal-pattern notifications. These are approved product direction, not completed
  capabilities of the first screen/history increment. No background report scheduler,
  unsolicited messages or measurement commands are activated by this work.

Family retains basic WhatsApp Q&A. Care adds advanced reports and interpretation
later. Essential's separate SOS WhatsApp entitlement remains unchanged.

## Retention and release boundary

Care exposes history that actually exists. Existing expiry cleanup renews accepted
records for another 30 days after verifying an active trusted Care subscription and
linked membership. Wellbeing additionally requires current wearer consent. This review
repeats while Care remains active; shadow acceptance evidence keeps fixed expiry.
An upgrade never backfills deleted records. On downgrade the new access window takes
effect immediately; existing retention deadlines still govern eventual deletion.
On wellbeing consent revocation, the established deletion path continues to apply.
`expiresAt` is managed by Guardian cleanup; do not enable an independent automatic TTL
that bypasses the Care review policy.

The existing default-off ingestion/customer/app flags, exact-device acceptance and
consent requirements remain. Layout approval does not establish medical accuracy,
accept counter resets, enable watch measurement requests or approve public rollout.

Pattern notices must be based on validated, repeated, sufficiently covered evidence
and the person's mobility/routine. Missing data and low step counts alone do not prove
inactivity or illness. AI may explain verified evidence; tested rules own triggering.
SOS and other accepted safety delivery operate independently.
