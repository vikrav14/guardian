# Safety snapshot

| Field | Value |
| --- | --- |
| Service | `remote-photo`, Family and Care |
| App trial | Temporary Safety snapshot card; request, view, delete |
| Runtime | Explicit gates, private bucket and exact IMEI allowlist required |
| Verified watch exchange | `[3G*<protocolId>*0008*rcapture]`, then TCP `img` |
| Hardware evidence | Two decoded reference captures; first Guardian photo displayed at 17:30:24 MUT on 25 September |
| Next acceptance | Replay the 17:47 rejected frame, then repeat Guardian capture and test deletion |

The app integration is implemented on PR #113. It does not activate the user's
Windows gateway or deploy Firebase changes. See the
[Windows launch and acceptance steps](../testing/photo-app-trial.md).
Historical captures, including the earlier manually triggered sample, remain in
[the evidence runbook](../testing/photo-reference-capture.md).

## Intended customer flow (agreed 25 September; not implemented)

The manual Snapshot menu is a test tool. The agreed customer feature is limited
to received SOS/fall incidents: send the emergency alert promptly and collect
up to five photos sequentially in the background. A **View incident photos**
button in a new WhatsApp template version would open an authenticated gallery
for that incident, showing photos as they arrive and reporting partial failures.
Existing calling and location actions must remain available.

Five-photo reliability, capture during SOS calling and the required spacing
are not verified. Implementation needs a bounded incident-specific capture
policy, emergency-photo permission, durable duplicate-incident suppression,
current family authorization and retention. The manual 15-minute cooldown
remains unchanged; no automatic sequence or template change is enabled here.

## Current app trial flow

A linked Family/Care guardian opens **Safety snapshot**, chooses **Take photo**,
enters a safety purpose and confirms permission. The backend verifies current
membership, service owner and plan, then reserves one request for this watch.
The screen shows **Taking photo…** until a complete image is decoded and saved.
A bare watch reply does not count as a picture. A two-minute timeout produces
**No photo received**, with no automatic camera retry.

Photos show gateway receipt time and expire after 24 hours. The page supports
immediate deletion and cancellation of waiting. Cancel waiting revokes image
acceptance; it cannot undo an already sent camera command. A snapshot provides
context and never establishes that the wearer is safe.

## Dispatch and reception

- All request/customer/ingress flags, `deviceMode=accepted`, an explicit private
  bucket and an exact 15-digit IMEI allowlist are required for capture.
- One live TCP connection with the matching bound IMEI/protocol ID is required.
  Duplicate connections, disconnection and missing identity block dispatch.
- A Firestore transaction enforces a 15-minute cooldown shared across guardians
  and gateway processes. Reconnect/startup never resends a request.
- The sender uses the observed `3G` prefix and lowercase `rcapture` exactly.
  It is separate from the generic command dispatcher and has no SMS fallback.
- A pending request receives at most one image from its original connection.
  Unsolicited, duplicate, late and mismatched images are discarded without ACKs.
- Images bypass the ASCII telemetry decoder and normal logging. The receiver
  validates framing, identity, escapes, JPEG structure and bounded full pixel
  decoding before storage. Only the observed one-, two-, five- and six-NUL trailers
  are accepted. Those trailer meanings remain unknown.
- The wire format has no verified request identifier. Association uses the
  same connection and request window; `requestCorrelationVerified` remains
  false. A late or manually triggered image inside that window is ambiguous.

## Private storage and recovery

The backend writes bounded JPEGs to `privateSafetySnapshots` with no download
token or public URL. The app retrieves bytes from an authenticated gateway
route. Token validity, current linked device, service ownership and active plan
are checked; viewing is audited and responses use `private, no-store`.
Direct client Storage reads/writes are denied.

Deletion and expiry revoke access immediately. Cleanup runs every 30 seconds
while the gateway runs, and recovers persisted work on restart. A stopped
gateway cannot physically remove objects until it restarts. Interrupted uploads
retain a bounded write lease and durable cleanup intent. The app keeps images
in memory only, clears them on backgrounding and evicts them when disposed.

## Validation and remaining acceptance

Local gateway tests include concurrent requests, full JPEG decoding, TCP chunks,
late/duplicate uploads, revoked membership, storage faults, interrupted deletion,
timeout and restart cleanup. Flutter request/permission/offline tests and a real
Firestore transaction test are included in release CI.

Two AnyTracking hands-off captures and full offline/live-decoder validation are
established on Jesh. The operator confirmed a displayed Guardian photo received
at 17:30:24 MUT on 25 September. The next attempt, around 17:47, delivered an
image frame after 9.285 seconds but was rejected solely at the trailer check:
five zero bytes after a structurally parsed 4358-byte, 240x240 JPEG. Five-NUL
support now preserves the JPEG bytes and still requires full pixel validation;
the saved private frame has not yet been supplied for exact replay. See the
[trial evidence](../testing/photo-app-trial.md#five-nul-trailer-rejection-1747-mut).

Repeat success, direct Guardian deletion, wearer indication, reliability across
device states, and a second V52 still require physical acceptance. No new FTP
provisioning or supplier response is required for the observed TCP integration.
