# One automatic photo, then guardian requests

Product decision, 5 October 2026. Supersedes the automatic five-photo policy for
new physical SOS/fall incidents. This workflow is not a fix for the watch's
intermittently delayed or missing image uploads.

- The initial SOS/fall notification and its call/location actions remain independent.
- An eligible server-origin alarm creates one automatic capture attempt, with AI
  only if a fully decoded image is stored. There is no automatic second capture.
- A server-owned photo-request window ends exactly one hour after alarm receipt,
  even if the automatic photo fails. Duplicate alarms in the existing 12-minute
  grouping window do not renew it. A later distinct incident has its own window.
- The wearer card has a Photos action and time remaining. Outside the window it
  is disabled. Alerts retain access to historical photos under existing retention.
  The bottom bar contains Home, Safe zones, Alerts and Account; it does not create
  an app-generated SOS. The physical watch SOS is unchanged.
- A linked, currently authorized Family/Care guardian can explicitly request
  additional photos within the hour; there is no five-photo count ceiling.
  Every request receives AI separately. Extra photos do not automatically send
  additional WhatsApp messages.

## Capture authorization and coordination

The authenticated POST `/api/incident-photos/:alertId/requests` accepts only a
client-generated request UUID. It derives the watch, household, incident and
deadline from server records. Capture consent, subscription, membership, a fresh
unambiguous session and the shared camera lock are checked on dispatch.

The UUID is scoped to requesting user and incident and maps to one durable
authorization. A repeated intent retrieves its existing request without replaying
the command, including after restart. The client does not automatically retry a
POST; after an unknown result it retains that intent for a status check.

Only one capture may be pending per watch. A successful saved photo retains the
existing 60-second spacing before another request. An unsuccessful request keeps
the next action disabled through its original authorization expiry plus the
120-second late-upload observation period. This bounds overlap risk; V52 images
still carry no verified request ID, so correlation is not proven. Expired grants
are never renewed or accepted by a later request.

Each new incident request allows at most 240 seconds, capped by its applicable
deadline. Automatic first-capture readiness retains the 12-minute outer deadline;
guardian requests are capped by the fixed one-hour window. No CR-before-photo,
automatic camera retry, or command replay after reconnect is introduced. Required
replies, calls, explicit stops and emergency reporting retain their coordination
priority. Legacy collecting incidents are stopped on rollout without new captures.

`GET /api/incident-photos/active?imei=...` returns authorized availability for the
Home card; gallery responses include the same server clock and window information.
The client expires its control using server-relative time and clears access on
backgrounding or failed reauthorization. Neither GET sends a watch command.

## AI, retention and WhatsApp

The initial automatic photo/AI follow-up is attempted at most once independently
of later guardian captures. A separate durable `analysisPending` queue allows AI
for guardian photos after that follow-up is terminal. Viewing, consent withdrawal,
deletion and existing 24-hour retention protections remain in force.

The concise Meta initial-alert templates use `_v5` names and preserve the approved
call and frozen-location buttons/parameters. They show wearer, dated alert time,
call action, location provenance/age and watch status without repeated headings.
The photo follow-up uses `guardian_incident_photo_update_v3`; it describes the
automatic attempt and AI availability, with scene descriptions kept in Guardian.
It uses the persisted photo-window end time, never a new hour from message delivery.
The previously submitted `_v4` / photo `_v2` drafts are superseded, not activated.
Existing template versions are preserved. Before activation, verify all seven
new template contracts are approved; then enable
`INCIDENT_PHOTO_GUARDIAN_WINDOW_APPROVED=true` in the preserved private environment.
The live factory uses that same flag for capture policy and notification names.
A restart before approval therefore retains the prior live behavior, rather than
sending an unapproved follow-up. The new behavior is not live until this flag is
verified and activated at an idle boundary.

## Validation

Regression coverage includes one automatic attempt, more than five explicit
requests, concurrent guardians, idempotent replay, timeout/late-upload guard,
expiry at the original hour, membership/consent/subscription revocation, offline
and replacement sessions, independent analysis and at-most-once follow-up.
Flutter tests cover server-clock expiry, disabled Home controls, pending requests,
failed automatic capture, ambiguous response handling and the four-tab navigation.
Hardware capture success and real message delivery require a separate controlled
operator-triggered test; software tests do not establish camera reliability.
