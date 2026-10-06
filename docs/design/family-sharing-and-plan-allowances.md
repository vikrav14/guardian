# Family sharing and plan allowances

Status: implemented for review in draft PR #150, behind a default-off gateway
switch. This is not a production activation or migration.

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

## Implementation and rollout boundary

`familyServices/{imei}` is the backend-owned authority for a paid watch and its
members. The versioned policy leaves legacy `serviceSubscriptions/{ownerUid}`
agreements intact. Each new service has a unique contract binding. Client IMEI
links, editable phone fields, legacy invite codes and emergency-contact entries
cannot grant access to a managed service. Owner access cannot be transferred or
removed through the member API.

The Family page contains People, WhatsApp and Plan views. Invitations are bound
to the recipient's verified account email, expire after seven days, reserve a
place while pending, and are checked again in a transaction on acceptance.
Custom access may be ongoing, seven days or thirty days. Revocation updates the
authoritative grant and clears the app's stream-selection cache. Device views
carry the selected wearer's own subscription, so a Care wearer cannot lend Care
entitlements to a different Family wearer.

Raw telemetry is owner-only for managed watches. Relatives with location access
read an allowlisted location/status projection; other members use a separate
identity/status projection so the wearer and permitted actions remain visible
without a map. Delegated settings load a freshly authorized configuration-only
response, excluding positions and SIM numbers. History, wellbeing, reminders,
settings, safe zones, alerts, voice and incident-photo authorization retain
their separate checks. Existing device pilots, owner-only enrollment/contact
management and wearer-consent requirements remain applicable. Granting a
permission does not activate a firmware feature or expand a device pilot.
Open wellbeing/weather streams clear on permission removal or expiry. The
outgoing SOS-call and fall auto-dial controls are removed: the supported watch
sends Guardian alerts and cannot initiate a call.

An authenticated app member links a number by sending a short-lived one-use
code from WhatsApp. The private verified-number index, not `users.phone` or
`users.whatsapp`, identifies managed senders. Each member separately consents
to safety messages for each wearer. Only the owner selects recipients, within
the edition's cap. Routine reminder WhatsApp fan-out is disabled for managed
services. Existing legacy services keep their established routing.

Managed WhatsApp answers are intentionally deterministic in this first release:
location and battery/status questions. Other requests go to the app. No LLM
call is made on this route, avoiding unbounded model costs. Monthly usage is
shared across members and resets on the Mauritius calendar boundary. Durable
reservations count against the limit during processing; provider rejection
refunds a reservation, provider acceptance commits it, and an ambiguous network
handoff remains reserved for operator reconciliation without automatic resend.
Duplicate messages cannot create another answer. Non-answer notices are bounded
to one per person/reason/day. SOS/fall delivery has an independent durable claim.
`ACK <alert-id>` records a response without marking the alert resolved; delivery
receipts cannot create that record. An acknowledgement UI and approved template
button still require a separate live-channel acceptance pass before launch.

### Operator setup and outstanding live acceptance

1. Deploy reviewed rules, gateway and app together in a non-production test
   environment. Set `FAMILY_SHARING_ENABLED=true` only for that reviewed rollout.
   It is false by default. Build the app with the authenticated gateway URL.
2. Preview `node scripts/provision-family-service.js --manifest <file>` with a
   reviewed manifest containing `imei`, `ownerUid`, `plan`, `contractId` and
   `verifiedMemberUids`. The contract ID must represent an actual paid service;
   the utility does not create a payment, order or billing agreement.
3. Provision only after reviewing ownership and every existing linked member,
   using `--apply-reviewed-migration`. Existing members are preserved even when
   over the new limit; additions remain blocked. A live legacy emergency-contact
   list blocks automatic migration with `existing_notification_migration_required`.
   Its verified recipients and consent need a separately reviewed cutover;
   this PR does not silently disable their safety delivery.
4. Complete two-account handset acceptance: personal invite, role change,
   expiry/revocation, wearer switching and the available watch actions. Confirm
   number linking, consent, selected safety templates and allowance exhaustion
   against the real Meta channel with authorized test recipients. Gateway unit
   tests and emulator tests are not evidence of actual device/provider delivery.
5. Only after that acceptance, activate customer services. Do not treat a draft
   PR, a generated APK or a provider `accepted` result as delivery confirmation.

The legacy account-wide invitation generator remains in the backend for old
clients, but managed-watch joins through that route are rejected. The new UI
uses only the personal per-wearer flow. No production data was changed while
developing this PR.

### Review evidence

The gateway, Flutter and Firestore emulator suites cover verified invitations,
concurrent quota reservations, relinking a WhatsApp number before delivery,
cross-wearer access, role removal, non-location wearer cards and configuration
reads without raw telemetry. Responsive screenshots were rendered from the
actual Flutter Family widgets with synthetic data at phone and desktop sizes,
including enlarged text. The existing weather artwork and Mauritius logo are
unchanged.

Managed owner name/avatar edits now go through one authorized transaction that
updates the raw profile, both shared projections and the circle name. Firestore
rejects direct managed identity writes so relatives cannot retain a stale avatar.
SOS/fall details include an explicit “I'm responding” action and the confirmed
responders. The app and WhatsApp ACK payloads use the same authorization and
idempotency checks; neither resolves an incident or consumes the answer allowance.

The remaining launch work is two-account handset/provider acceptance, an approved
WhatsApp template button, reviewed legacy notification migration and the real
billing/provisioning integration. No real messages were sent and no production
subscriptions or membership records were changed.

### Interactive local review

See [the local review guide](../testing/family-sharing-review.md). It runs the
actual Flutter app, family API and Firebase rules against an isolated demo project
with synthetic accounts. A separately labelled WhatsApp simulator exercises the
same link, grant and allowance handlers without calling a provider. It is not
evidence of actual watch, push, Meta or billing delivery.
