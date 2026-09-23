# Calls settings — draft PR #115

## Scope and evidence

Guardian-generated Auto and Manual transitions physically passed on the existing
V52 pilot on 23 September 2026. The new **Watch settings → Calls** screen uses
that exact captured adapter through a dedicated authenticated request path.
It does not enable SOS-only answering or claim caller exclusivity.

**Latest app retest passed, 23 September:** After the connection-validation
update, the operator reported "it works!!!" and supplied the app's Manual then
Auto exchanges. This records a successful operator-reported app retest on Jesh
with the existing tested caller. Receipt evidence is summarized below; physical
behavior comes from the operator, not the bare protocol replies.

| Mode | Connection check (UTC) | Expected replies received (UTC) | App request outcome |
| --- | --- | --- | --- |
| Manual | 18:46:17.869, connection 2 / peer 57614 | APPLOCK and ACALL by 18:46:18.771 | device_replied |
| Auto | 18:47:05.367, connection 3 / peer 54262 | ACALL at 18:47:06.455 | device_replied |

Manual request: `49tjN1xqpEoheuHyot0u`. Auto request:
`xdOjymVuaL4RvzJ9LioS`. Mauritius local times are UTC +04:00.
The final request in this excerpt is **Auto**; a later return to Manual is not
recorded. Exact call times, answer delay and a new two-way-audio observation were
not separately supplied. The earlier two-way-audio results remain historical.
Caller exclusivity, persistence and SOS-only switching are not established by
this retest. No claim of a firmware state readback is added.

**Earlier app trial, superseded by the successful retest:** Auto physically
answered, but the subsequent Manual request reported socket_handoff and the
next call still auto-answered. No subsequent APPLOCK/ACALL reply appeared in
that excerpt. The operator had not run the proposed helper restoration.

Manual handoff coincided with a new TCP connection at 18:22:45.244 UTC. That
connection later closed with only 47 bytes written, less than the complete
61-byte captured Manual pair. This is consistent with selection of an older
socket while the new connection was not yet identified. It does not establish
the exact selected socket or prove the cause; old logs lack that correlation.

The screen starts with Manual selected as the default choice and sends nothing
when opened. Auto requires an explicit confirmation explaining that eligible
incoming calls can connect without a tap, including ordinary calls, and that
the setting persists until Manual is sent and checked. The configured caller
is shown only by a masked hint; users cannot supply a new phone or raw command.
Both Family and Care can request Auto on a configured watch. Linked guardians
can still request Manual if their plan expires or support disables Auto.

Request status says waiting, checking connection/awaiting replies, watch replied,
not sent, or uncertain. Historical handoff-only records explicitly show receipt
as unconfirmed. A reply is not applied firmware state. A cached
pending record that times out is also uncertain: the app may not have received
the backend's latest result. A separate last-sent row is not a current-state
readback. Sound/vibration, contacts, reporting, wellness and SOS behavior are
unchanged.

## Backend and authorization

- `watchCallPolicies/{imei}`: backend-only six-record capture and policy
  revision, using the exact private Auto value from the successful test.
- `watchCallSettings/{imei}`: linked-user-readable projection, containing only
  availability, masked caller hint, revision and request/handoff status.
- `watchCallRequests/{id}`: immutable client request and backend completion
  record. No private phone, frame, caller override or command payload is accepted.

Rules require the linked signed-in guardian, matching author, explicit Auto
consent, an active trusted Family/Care entitlement for Auto, the current
backend policy revision and a bounded expiry. Backend processing independently
rechecks these conditions, including trusted family membership. Manual is
allowed after entitlement expiry; it still requires a linked guardian and
valid backend capture. The generic deviceCommands channel rejects answer-mode
requests.

The app gives each request a deadline 60 seconds from the user action. Rules
allow at most 90 seconds of remaining lifetime and require server-createdAt.
The explicit client deadline prevents an offline queued Auto write from
becoming new intent when serverTimestamp resolves much later.

A Firestore transaction claims each pending request and acquires a per-device
30-second lease, bounded by request expiry. Concurrent changes are rejected
with a visible busy result. Requests older than the last claimed intent are
rejected. The sender prefers the newest identified connection with fresh packets
and sends the documented read-only VERNO query on that exact socket. Only a
firmware-label response on that socket permits the setting write. It may probe
one replacement connection during a handover, but never retries mode bytes.
The setting is written once: exact captured Auto or the ordered Manual pair.
Afterward it waits for ACALL (Auto), or both APPLOCK and ACALL (Manual), on the
same socket. Missing/partial replies are uncertain, not successful delivery.
No SMS fallback or automatic setting replay is introduced.

Each version check waits at most four seconds; the setting replies wait at most
eight seconds, also bounded by the request lease/deadline. Expiry during the
preflight prevents a delayed setting write. Reply observation is synchronous
before database work, so slow Firestore writes cannot hide a received reply.
Logs include command names, connection ID and local peer port; no caller or
private frame bytes. Bare replies have no transaction ID or applied value:
they remain receipt-window evidence, not a substitute for the physical call.

If a gateway pauses until its lease expires, it sends nothing. If it crashes
after claim/handoff, the sending record is not replayed. A later explicit Manual
request can acquire the expired lease. Late completion cannot overwrite a newer
device projection. Failed result persistence leaves uncertainty rather than
fabricating failure-to-send. Requests are retained as an audit trail, with
actor, mode, timestamps and bounded outcomes, excluding private frame data.

This lease is a server dispatch lock, **not** an automatic answering timeout.
The watch may keep Auto when data is disconnected. No SOS window, background
mode expiry or durable automatic restoration is implemented by this change.

## One-time setup for the verified pilot

Keep PR #115 draft. After the implementation checks pass, pull the branch.
Preserve the unrelated untracked news review file.

```powershell
cd C:\Users\MSI\repos\guardian
git switch feat/v52-watch-modes
if ($LASTEXITCODE -ne 0) { throw 'Branch switch failed' }
git pull --ff-only origin feat/v52-watch-modes
if ($LASTEXITCODE -ne 0) { throw 'Pull failed' }
```

The new client collection needs the checked Firestore rules and query index
deployed to the pilot project. This is separate from pushing the draft PR:

```powershell
firebase deploy --project guardian-fbadd --only "firestore:rules,firestore:indexes"
```

Wait for the watchCallRequests index to finish building. Using the existing
private capture file, provision the backend policy:

```powershell
cd C:\Users\MSI\repos\guardian\gateway
node scripts/configure-watch-calls.js --imei 861397052547492 --capture-file "$env:TEMP\guardian-answer-private-20260923-210251-301.jsonl" --apply
```

Without --apply this only previews. Setup checks the persisted device's protocol
identity and writes a private policy plus masked projection. It sends no watch
command and does not claim that Manual has just been applied. Reconfiguration
changes the revision so an older pending request cannot target a changed caller
configuration. Do not provision untested devices from example captures.

Restart only the gateway with npm start in its existing window, then restart
Flutter normally. Keep ngrok and the working Guardian route unchanged.
No new gateway URL, app secret or Dart define is needed.

## App acceptance

The requested Manual restoration retest is complete: the operator reported
success, and both Manual replies were recorded through the checked connection.
Auto was subsequently requested and also received its expected reply. For
normal manual answering, end the call and select/send Manual from Calls; wait
for Watch replied to Manual and check the next call waits for a tap. A final
restoration after the latest Auto request has not yet been reported.

No new setup, supplier capture or routing SMS is required. The full initial
acceptance procedure below is retained for future pilots, not a request to
repeat the already-passed transition tests:

1. Open Jesh → Watch settings → Calls. Manual is initially selected; no command
   should be sent by opening the screen.
2. Select Auto. Cancel its confirmation once and verify no request is created.
   Then deliberately confirm Auto. Wait for Watch replied to Auto.
3. Call from the same approved guardian number. Verify automatic answering and
   audio both ways. End the call.
4. Select/send Manual. Wait for Watch replied to Manual. Call again, verify it waits for a tap and check audio.
   Leave the watch in physically verified Manual.
5. If a request is not sent or uncertain, inspect the displayed result. Do not
   blindly repeat Auto. The existing captured Manual helper remains available
   to the operator for a deliberate restoration attempt.
6. Separately verify another approved caller and unknown-caller rejection before
   claiming that Auto applies only to the configured guardian.

The earlier two physical calls established the command adapter. These app
checks cover the newly added UI, Firestore rules, request delivery and status.
Supervised SOS callbacks, persistence after restart and offline restoration
remain separate gates in the [SOS proposal](watch-answer-sos-design.md).

## Software checks

Implementation commit `d0f4bfb` passed all release gates in
[CI run 335](https://github.com/vikrav14/guardian/actions/runs/35903829878):
gateway, Firestore authorization, Flutter analysis/tests, Chrome regression
and Web release build. Dashboard UI review also passed. This acceptance update
changes documentation only.

The local gateway suite passes 1,325 tests. Added coverage includes stale intent,
identity/plan/consent validation, duplicate claims, device leases, uncertain writes
and no replay after result persistence failure. Emulator tests exercise actual
transactions, immutable client requests, private policies and Manual restoration
after plan expiry. Flutter tests cover default/no-write behavior, consent/cancel,
Manual availability, request wording and narrow/wide layouts with enlarged text.
Transport regressions cover overlapping old/new sockets, expired preflight,
wrong-socket replies, partial Manual replies, asynchronous write errors and
real TCP delivery. Flutter exercises Auto then Manual and missing-reply copy.
Require all three CI jobs (gateway, Firestore, Flutter) before pilot deployment.
