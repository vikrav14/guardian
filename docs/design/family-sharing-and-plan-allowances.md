# Family sharing and plan allowances

Status: implementation in progress. This document records the agreed product scope;
it does not claim that the controls are already deployed.

## Commercial policy

One paid watch service is shared with a limited circle of people. Counts include
the owner; notification recipients are a subset of the same circle, not extra
members. Access is explicit for each wearer.

| Policy | Family | Care |
| --- | --- | --- |
| Monthly customer price (MUR) | 1,000 | 1,300 |
| People including owner | 3 | 5 |
| Selected WhatsApp safety recipients including owner | 2 | 3 |
| Shared everyday WhatsApp answers per month | 50 | 100 |

The free-watch offer retains the 12-month minimum commitment. Price changes do
not rewrite existing billing agreements. Existing members are not silently
deleted when a new limit is introduced; over-limit circles need an explicit
owner review and cannot add further members meanwhile.

Care retains its additional entitled care features. Availability and wearer
consent remain separate from membership and delivery preferences.

## Navigation and access

- Bottom navigation: Home, Safe zones, Family, Watch.
- The top bell remains the alert entry point; the avatar remains the account
  entry point.
- Family exposes people, role presets with individual permissions, invitation
  acceptance/revocation, WhatsApp recipients and shared allowance usage.
- Owner-only actions include granting/revoking access, invitations and billing.
- Caregiver, Viewer and Alerts-only presets are starting points. Access to
  location, history, wellbeing, voice messages, reminders, safe zones, settings
  and eligible incident photos is checked independently where applicable.
- Backend and Firestore authorization enforce the same grants. Hiding controls
  is not authorization. App and WhatsApp use the same current wearer grants.
- Invitations are personal, expiring and revocable. Accepting an app invitation
  does not require agreeing to WhatsApp messages.
- The first release uses authenticated Guardian app members. WhatsApp-only
  contacts remain a later, explicitly selected extension; notification-only
  contacts must never gain assistant/query access implicitly.

## Messaging and cost controls

- WhatsApp requires a linked, verified recipient number and recipient consent.
- Selected SOS/fall recipients are limited by plan; routine updates stay in the
  app.
- Everyday questions share one server-enforced allowance for the paid wearer
  service. Reservations and idempotency prevent parallel requests or webhook
  retries from bypassing the allowance.
- Failed requests and access denials do not consume a completed answer. Such
  replies can still incur provider costs, so abuse and repeated-limit replies
  need bounded handling.
- SOS/fall delivery and explicit response acknowledgements do not consume the
  everyday question allowance. Delivery/read status is not acknowledgement and
  acknowledgement does not resolve an incident automatically.
- Deterministic verified answers precede AI; AI input, output, retries and spend
  remain bounded separately from the answer count.
- At the limit, ordinary WhatsApp answers pause and the recipient is directed
  to the app. There are no automatic paid overages.
- Unchanged incoming device events must not cause duplicate billable alerts.
- The watch does not initiate outgoing calls. SOS produces Guardian alerts.

## Integration and release

This branch starts at main after merging PR #145, preserving the implemented
voice conversation, private audio and notification policies, the Mauritius logo
with its two green pulses, and the latest dashboard changes. Keep the existing
weather card and Soft sage appearance.

Required evidence before marking this PR ready:

- Membership, role, owner and cross-wearer authorization tests, including
  revocation and expired/cancelled invitations.
- Concurrent and duplicate WhatsApp allowance tests; safety delivery remains
  independent of question usage.
- Firestore rules tests for client writes and reads at each permission level.
- Flutter navigation, Family, Watch and allowance/access-state tests.
- Relevant gateway and Flutter regression suites, analyzer and release builds.
- A responsive visual review and explicit reporting of any device-only checks
  that have not been completed.

No production membership migration, billing change or deployment is implied by
opening the draft PR. The implementation and release evidence must identify the
actual compatibility/migration path for legacy owner-scoped subscriptions.
