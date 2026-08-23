# Safety snapshot

| Field | Value |
|---|---|
| Service ID | `remote-photo` |
| Product wording | **Safety snapshot** |
| Minimum package | Family |
| Current state | Software safety path implemented; capture/media disabled |
| Customer-visible | No |
| Protocol inventory | `FTPIP`, `FTPPWD`, `PIC`, `rcapture` |
| Accepted V52 capture commands | None |

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

Guardian's V52 decoder recognizes `FTPIP`, `FTPPWD`, `PIC` and `rcapture` as server-to-watch protocol inventory. The current Guardian command-evidence ledger does **not** establish an accepted production payload or role for this capture family.

This PR therefore contains no photo command builder and does not add any of these commands to the generic `deviceCommands` dispatcher. In particular, Guardian must not assume that `rcapture` alone triggers a safe capture, that `PIC` is the request command, or that FTP configuration can safely point at arbitrary infrastructure.

Exact physical acceptance must establish:

- which command/configuration initiates one capture
- whether FTP configuration is persistent or per-session
- where and how the V52 uploads the image
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

- [ ] capture supplier documentation or exact-device evidence for `FTPIP`, `FTPPWD`, `PIC` and `rcapture`
- [ ] prove wearer-visible/audible indication behavior
- [ ] verify single-capture behavior and prevent continuous/repeated capture
- [ ] measure image size, latency and SIM data use
- [ ] test offline, reconnect, reboot and failure recovery
- [ ] verify private ingress, expiry and immediate deletion
- [ ] repeat on a second production-equivalent V52
- [ ] complete privacy/security/product acceptance

## Release rule

Keep Safety snapshot customer-hidden and non-dispatchable. No photo command or FTP credential should be sent to a V52 until the exact transport and capture behavior are physically proven and separately accepted.
