# One automatic photo, then guardian requests

Product decision, 5 October 2026. Supersedes the automatic five-photo policy for
new physical SOS/fall incidents. This workflow is not a fix for the watch's
intermittently delayed or missing image uploads.

- The initial SOS/fall notification and its call/location actions remain independent.
- An eligible server-origin alarm creates one automatic capture attempt, with AI
  only if a fully decoded image is stored. There is no automatic second capture.
- A server-owned photo-request window ends exactly one hour after alarm receipt,
  even if the automatic photo fails. Reprocessing the same alert ID does not
  renew it. Each separate accepted alert owns its own gallery and follow-up,
  including a fall shortly after SOS. An occupied camera produces an explicit
  no-photo result for the new alert, not a link to a previous event's photo.
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
of later guardian captures, per accepted alert ID. Camera locking is separate
from notification identity: the former 12-minute cross-alert grouping could
attach a new fall to an already-completed SOS and silently lose the fall's own
readings update. Separate alerts now retain separate records. A new automatic
capture cannot bypass an active capture/sequence, the successful-photo spacing,
or the failed-upload quiet period, and a blocked capture never steals that lock.
A separate durable `analysisPending` queue allows AI
for guardian photos after that follow-up is terminal. Viewing, consent withdrawal,
deletion and existing 24-hour retention protections remain in force.

The concise Meta initial-alert templates use `_v5` names and preserve the approved
call and frozen-location buttons/parameters. They show wearer, dated alert time,
call action, location provenance/age and watch status without repeated headings.
The photo follow-up uses `guardian_incident_photo_update_v3`; it describes the
automatic attempt and AI availability, with scene descriptions kept in Guardian.
It uses the persisted photo-window end time, never a new hour from message delivery.
The previously submitted `_v4` / photo `_v2` drafts are superseded, not activated.
Existing template versions are preserved. App activation is independent of Meta
copy approval: explicitly set `INCIDENT_PHOTO_GUARDIAN_WINDOW_ENABLED=true` to use
one automatic attempt and the one-hour app window for new incidents. Keep
`INCIDENT_PHOTO_GUARDIAN_WINDOW_APPROVED=false` until all seven new Meta contracts
pass approval/category/content checks. While pending, the existing approved
initial-alert and photo-follow-up templates remain in use. Their legacy "up to 5"
wording is an upper bound, not a promise of five automatic attempts. The initial
follow-up counts only the automatic attempt; guardian requests do not send more
WhatsApp messages. The app shows the actual one-photo policy and remaining hour.

For backward compatibility, if ENABLED is absent, APPROVED remains its fallback.
An unchanged old environment retains its prior behavior. Activate at an idle
boundary. Do not retrofit an old incident into a new capture grant or renew an
expired request. The Home action explains a disabled service or an older incident
instead of implying that no SOS/fall occurred. A pending/failed automatic photo
does not disable opening an authorized, unexpired incident window; the separate
request action still enforces the pending capture and late-upload guard.

## SOS reconnection candidate

The 5 October 12:56 and 23:15 SOS failures both used an original connection that
received an immediate UPLOAD echo, became silent, and was replaced shortly after
the first camera write. Neither received a camera ACK or image. Closing the old
socket under packet-idle policy stopped each request. This is distinct from
ACKed-but-late images; a gateway cannot prove a call/modem/firmware cause here.

`INCIDENT_PHOTO_SOS_SETTLE_ENABLED=true` enables a bounded pilot candidate: for
the first non-trial SOS capture, require a heartbeat or location received on the
selected socket at least 30 seconds after the alarm, still fresh within 30 seconds
at dispatch. The alarm's own location, command echoes, unknown bytes and elapsed
time alone cannot satisfy it. A single eligible replacement may be selected;
multiple eligible sockets still fail closed. This passively waits without a
camera grant, CR or retry, retains the original 12-minute first-attempt deadline,
and rechecks identity, consent, access and socket after awaited reads. Initial
notifications/calls and emergency tracking are independent. Fall first captures
and later explicit guardian requests retain existing behavior.

The 30-second settling interval is an engineering candidate, not a supplier
guarantee or proof of camera readiness. It adds at least 30 seconds to the first
SOS photo, potentially longer until telemetry arrives. It does not repair an
ACKed upload delay or guarantee delivery. Hardware acceptance remains pending.
After a command is sent, reconnect never migrates or automatically replays it.

## Validation

Regression coverage includes one automatic attempt, more than five explicit
requests, concurrent guardians, idempotent replay, timeout/late-upload guard,
expiry at the original hour, membership/consent/subscription revocation, offline
and replacement sessions, independent analysis and at-most-once follow-up.
Flutter tests cover server-clock expiry, disabled Home controls, pending requests,
failed automatic capture, ambiguous response handling and the four-tab navigation.
Hardware capture success and real message delivery require a separate controlled
operator-triggered test; software tests do not establish camera reliability.


## Integration checkpoint: 5 October 2026

Integrated with main's medication pilot/shared coordinator and merged Home Wi-Fi
PR #141 in an isolated checkout. Local checks: 1,705 gateway tests, 93 Firestore
emulator tests, 747 Flutter tests and clean Flutter analysis. Hosting publication
failure tests and Maps-build checks also pass; CI validates Web/Android builds.
Original checkouts, the live gateway/ngrok and private launch environment are
preserved. Merging code does not deploy a new runtime or activate this policy.

At 22:45 Mauritius time all seven revised Meta templates were still pending.
The photo follow-up remained categorized Marketing and failed the Utility
contract check. Keep the template approval flag false until that is resolved;
the separate app-window flag may be enabled using the existing approved copy.
Do not substitute a new template without checking its exact contract.
Earlier image delays/ACK-only failures remain unresolved hardware evidence.
