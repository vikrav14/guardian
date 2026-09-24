# Safety snapshot

| Field | Value |
|---|---|
| Service ID | `remote-photo` |
| Product wording | **Safety snapshot** |
| Minimum package | Family |
| Current state | Pilot TCP img decoded offline to a viewable JPEG; live Guardian capture/media disabled |
| Customer-visible | No |
| Protocol inventory | `FTPIP`, `FTPPWD`, `PIC`, `rcapture` |
| Accepted V52 capture commands | None |
| Observed reference exchange | `3G` / lowercase `rcapture`, then watch-to-server `img`; 24 September 2026 |

Safety snapshot is designed as a **single, consent-bound contextual image** for a genuine family-safety question. It is not a live camera, continuous monitoring service, background camera, or covert-surveillance feature.

## Intended product flow

1. An approved Family/Care guardian states a short safety purpose and confirms household consent.
2. Guardian verifies the family membership, linked watch and active plan.
3. The backend creates a one-time authorization bound to that requester and 15-digit IMEI.
4. The authorization expires quickly and repeated requests are cooldown-limited.
5. Only after exact-device protocol acceptance may a later reviewed path ask the V52 for one capture.
6. Any returned image must match the same unexpired authorization before Guardian accepts it.
7. Media stays private, has no permanent/public URL, and expires automatically after a short retention period.
8. Authorized deletion removes the media immediately while preserving privacy-safe audit evidence.

## Implemented software boundary

- Family/Care linked-device authorization policy
- inherited-family access requires backend-managed `memberUids`
- explicit consent and safety-purpose confirmation
- one-device / one-request authorization
- 10-minute default authorization window
- 15-minute default request cooldown
- 24-hour default media-retention ceiling in the policy model
- upload matching by authorization, device and request
- public snapshot URLs rejected by policy
- delete state clears the private media path
- immutable request audit shape with `deviceCommandSent: false`
- Firestore request creation restricted to linked Family/Care users
- backend-owned authorization/audit documents are client read-only
- Essential, unlinked and requester-spoofed requests denied by emulator tests
- backend pending-request watcher wired behind an explicit default-off runtime gate
- hidden Flutter snapshot status model and compile-time-gated read service
- Flutter customer request path deliberately unavailable
- product wording explicitly says a snapshot provides context only and does not prove safety

## Default-off release gates

```dotenv
SAFETY_SNAPSHOT_REQUESTS_ENABLED=false
SAFETY_SNAPSHOT_DEVICE_MODE=unverified
SAFETY_SNAPSHOT_MEDIA_INGRESS_ENABLED=false
SAFETY_SNAPSHOT_CUSTOMER_ENABLED=false
```

Flutter remains hidden by default:

```text
GUARDIAN_SAFETY_SNAPSHOT_ENABLED=false
```

`SAFETY_SNAPSHOT_DEVICE_MODE=accepted` alone cannot start request processing, media ingress or customer visibility. This PR hard-codes `deviceDispatchAllowed=false`, so even enabling all current flags cannot send a capture command.

## Protocol boundary

Guardian's V52 decoder recognizes `FTPIP`, `FTPPWD`, `PIC` and `rcapture` as server-to-watch protocol inventory. The 24 September same-watch capture establishes that AnyTracking sends `[3G*9705254749*0008*rcapture]`, Jesh replies with bare `rcapture`, and later uploads `img` over the same observed TCP session. The operator reports receiving the photos in AnyTracking. This is reference-service physical evidence on one watch, not acceptance of Guardian's receiver or customer feature. See [the capture and next test](../testing/photo-reference-capture.md).

This PR still contains no photo command builder and does not add any of these commands to the generic `deviceCommands` dispatcher. The supplier document's separate `PIC,1` / FTP example must not replace this observed `rcapture` / `img` flow. The private 24 September sample establishes `img,5,260924213927,` followed by an escaped binary JPEG and two NUL bytes. The five documented media escapes restore a viewable 240x240 JPEG of 4969 bytes. The field `5`, trailer semantics, request correlation and any ACK requirements remain unknown. Do not provision FTP or invent an image ACK from this evidence.

The operator subsequently confirmed that the recovered 17:39:27 image was triggered by accidentally pressing the camera button on the watch. This sample proves a locally triggered upload can be decoded. Its 205.457-second interval after an AnyTracking request is not remote-capture latency. A controlled app-only request with the watch controls untouched is still needed; the trigger of the earlier 17:00/17:01 uploads is not established by this correction.

`src/protocol/v52-photo.js` now decodes the observed envelope offline, preserves unknown fields, reverses only the five documented escapes and checks bounded baseline JPEG marker structure. `scripts/decode-photo-capture.js` inspects a private file and optionally writes JPEGs to a new local directory. It opens no network and is not connected to live ingress/dispatch. Its `jpeg_structure_only` result is not a substitute for a full image decoder in production; the actual pilot output was separately loaded with Pillow and visually inspected. The real pilot image and private capture are not committed to the repository.

An optional standalone recorder saves only exact `rcapture` frames and watch-to-server `img` frames to a new private local file. It forwards supplier traffic unchanged and generates no commands or ACKs. This diagnostic is not imported into gateway startup, writes nothing to Firestore or Storage, and does not enable the customer flags. Normal output continues to redact images. The code is adapted from the tested PR #115 relay; the photo work stays in PR #113.

Exact physical acceptance must establish:

- repeatable single-request behavior for the observed `rcapture` command
- validate further `img` samples, request correlation and any image ACK requirements
- determine whether additional configuration matters; FTP was not established for this flow
- image type, size and naming behavior
- latency and SIM data use
- offline/reconnect behavior
- whether the wearer sees or hears a capture indication
- what happens on repeated requests, reboot and partial configuration

## Media security boundary

The repository currently has Firebase Storage CORS configuration but no dedicated Firebase Storage authorization rules for Safety snapshots. For this phase, media ingress remains **backend-only and disabled**. The mobile app must not upload snapshot media and must not receive a permanent/public Storage URL.

Before real image ingestion is enabled, Guardian still needs:

- isolated private ingress for the accepted V52 upload transport
- strict MIME/signature and size validation
- malware/content-processing safety as appropriate to the accepted image format
- a private storage path bound to the request/owner/device
- short automatic expiry and deletion processing
- authenticated, audited image viewing rather than public download URLs
- access/deletion audit evidence

## Software gates

- [x] one-time authorization policy
- [x] Family/Care backend access policy
- [x] cooldown and expiry semantics
- [x] private-media/no-public-URL policy
- [x] hidden Flutter read/presentation model
- [x] Firestore request/auth/audit authorization rules and emulator tests
- [x] backend watcher/startup gate for request processing
- [x] explicit default-off gateway flags and release-gate regression tests
- [ ] private media-ingress/storage implementation after transport acceptance
- [ ] full gateway, Firestore and Flutter release gates on the completed software checkpoint

## Physical/privacy acceptance

- [x] observe AnyTracking `rcapture` and subsequent `img` on Jesh, with operator-reported photos in Pictures
- [x] decode the exact private `img` sample offline and visually verify a 240x240 JPEG
- [ ] verify reliable remote-only capture and live authorized Guardian reception
- [ ] prove wearer-visible/audible indication behavior
- [ ] verify single-capture behavior and prevent continuous/repeated capture
- [ ] measure image size, latency and SIM data use
- [ ] test offline, reconnect, reboot and failure recovery
- [ ] verify private ingress, expiry and immediate deletion
- [ ] repeat on a second production-equivalent V52
- [ ] complete privacy/security/product acceptance

## Release rule

Keep Safety snapshot customer-hidden and non-dispatchable. Continue the operator-authorized tabletop comparison through AnyTracking to establish the image format. Guardian dispatch and media ingestion remain disabled until the receiver and physical acceptance are complete. No FTP credentials are required or collected by this diagnostic.
