# Dynamic Call watch links — 24 September 2026

Draft PR #115 implements a shared SOS/fall Call watch URL. Gateway code is
available and all six shared v2 templates were submitted to Meta on 24 September
2026. All six showed **In review** after submission. The public trial origin
served the new call-page fallback; approval, activation and physical WhatsApp
tap-to-call acceptance remain pending. The feature defaults off separately for
SOS and fall. Approved v1 templates remain intact.

## Submission checkpoint — 24 September 2026

- Submitted every template in the matrix below as **Utility / English**, with
  four body variables. All six use a dynamic **Call watch** website button at
  index 0. Fresh and last-known variants retain their dynamic map button at
  index 1; unavailable variants have only Call watch.
- Submitted call URL: `https://lidless-inward-lucas.ngrok-free.dev/call-watch/{{1}}`.
  Review examples use the generic `/call-watch/unavailable` page and synthetic
  wearer/location data. No watch SIM or contact number is fixed in any template.
- A read-only request to that origin's `/call-watch/unavailable` returned the
  new Guardian fallback HTML with expected HTTP 410. The request skipped ngrok's
  browser warning; this does not prove a handset can reach a live call link.
- No messages or watch commands were sent. No remote environment flags, TTL
  policy or tunnel inspection settings were changed. The operator must configure
  the matching origin, keep both gates off during review, and complete the
  deployment checks below before activation.
- Code commit `bafc7d2`: 1,394 gateway tests passed locally. Guardian release
  gates #355 and Dashboard UI review #173 passed, including the Firestore
  authorization and Flutter checks.

## Paused pending Meta approval — operator handoff

On 24 September the operator ran
`node scripts/check-watch-call-templates.js --type both` on the Windows gateway.
It returned `ready: false`, `changesMade: false`, and exactly
`problems: ["not_approved"]` for each of the six templates in the matrix below.
The checker reported no other contract problems. This is approval-pending
evidence, not successful delivery or tap-to-call acceptance. Meta's review time
is outside Guardian's control; do not assume approval after a fixed 24 hours.

The operator requested a pause to work on the everyday WhatsApp menu. Keep
PR #115 **draft**, with both dynamic-call gates **false**, and retain the
approved v1 alert route. No live environment change is claimed by this handoff.
All gateway implementation and these notes are pushed to
`feat/v52-watch-modes`; menu examples are a separate design discussion, with no
menu implementation in this checkpoint.

Resume after Meta's decision:

1. Pull `feat/v52-watch-modes` with `git pull --ff-only`. Confirm the public
   HTTPS origin still matches the approved template URL; check gateway health
   and the expected HTTP 410 fallback page. Check TTL cleanup and access-log /
   tunnel-inspection privacy from the deployment section below.
2. Run `node scripts/check-watch-call-templates.js --type both` again. If any
   template remains unapproved or reports another contract problem, keep its
   family's flag off and inspect that Meta template. Do not recreate templates
   or alter their names just to bypass review.
3. Once all three variants of a family pass, enable that family's flag and
   restart the gateway. When both pass, enable both SOS and fall flags.
4. With the wearer/test watch supervised, test one SOS and one uncancelled fall
   separately. Verify receipt and provider delivery, Call watch opening the
   correct watch page, then the correct SIM in the carrier dialer. Verify
   two-way audio after answering; record alert time and outcomes without
   publishing live tokens or phone numbers.
5. Verify the primary contact auto-answers during the existing five-minute
   emergency window, the second approved phonebook contact rings normally, and
   the primary rings normally after Manual restoration. Opening/reopening the
   URL must not start or extend that window. A fall cancelled locally before
   upload does not test the alert/WhatsApp flow.
6. Complete the remaining contract/security acceptance: fresh, last-known and
   unavailable location messages; separate SIM destinations; expired links;
   changed SIM/contact removal; and restoration after gateway restart/offline.
   The second recipient's earlier WhatsApp failure also remains unresolved.

Do not promote URL delivery to Proven or merge solely because templates become
approved. Record the actual message, dial destination and physical call results
in `docs/GUARDIAN_V52_REAL_DEVICE_ACCEPTANCE.md`.

## Customer flow

The selected emergency contact receives the existing four alert facts. **Call
watch** opens a Guardian page for that alert's watch. A second **Call watch** tap
opens the phone's carrier dialer. The number is also displayed for desktop users.
No Flutter login is needed: emergency contacts may not have Guardian accounts.

Opening a link sends no watch command, starts no call, and never starts or
extends a handsfree window. Existing opt-in emergency answering still admits a
fresh SOS/fall, enables the configured primary caller for five minutes, then
restores Manual. Carrier calls have no WhatsApp-origin tag. Other approved
phonebook contacts continue to follow the tested manual behavior. The page does
not claim that the watch is online or will auto-answer.

## Security and failure behavior

- A separate random 256-bit URL-safe token is issued to each selected recipient.
  IMEI and phone numbers never appear in the URL. Store only its SHA-256 digest
  as the backend-only `watchCallLinks` document ID.
- Bind it to the alert, device, linked guardian, service owner, original SIM and
  recipient/contact phone hashes. Each GET rechecks current records, verified
  service membership and the applicable WhatsApp entitlement. SIM replacement,
  unlinking, contact removal or backend `revokedAt` invalidates the old link.
- Expiry is one hour after the persisted alert's receipt/creation time. Delayed
  delivery does not reset the clock. Expiry is enforced on access independently
  of cleanup. Configure Firestore TTL on `watchCallLinks.expiresAt` at deployment.
- This is a **bearer link**, not authentication of the person opening it. A
  forwarded link can reveal/call the watch number until expiry or revocation.
  It grants no app, location, microphone or call-setting access.
- Pages use no scripts, cookies, third-party resources or analytics. HTML is
  escaped, `tel:` strictly normalized, and headers disable caching, indexing,
  framing and referrer transmission. Query parameters cannot select another
  watch/number. HEAD and GET previews do not consume links or cause writes.
- Redact `/call-watch/*` in public proxy/access logs. Disable traffic inspection
  on the tunnel serving call pages; inspectors can retain URLs and response
  bodies. Do not paste live links, private records or request bodies into issues.

Issuance has a two-second budget per selected recipient. Missing SIM, expired
or unauthorized data, storage failure or timeout uses `/call-watch/unavailable`;
the safety alert and its map still send. No recipients or SMS messages are added.
Provider errors have the emitted token redacted before notification logging.
Failed page lookups also show the generic unavailable page.

## Submitted Meta contracts

New **v2** versions retain the approved v1 alerts during review. Editing a live
fixed-phone template in place would make old payloads incompatible with its new
URL parameter. These are shared location variants, not per-watch templates.

| Alert | Location | Template |
| --- | --- | --- |
| SOS | Fresh | `guardian_sos_callback_alert_v2` |
| SOS | Last known | `guardian_sos_callback_last_location_v2` |
| SOS | Unavailable | `guardian_sos_callback_unavailable_v2` |
| Fall | Fresh | `guardian_fall_callback_alert_v2` |
| Fall | Last known | `guardian_fall_callback_last_location_v2` |
| Fall | Unavailable | `guardian_fall_callback_unavailable_v2` |

All use English `en`, Utility and the existing four ordered body variables:
`{{1}}` safety update, `{{2}}` event time, `{{3}}` location facts, `{{4}}` watch
status. Retain possible-fall wording and distinct last-known/unavailable location
wording. The gateway preserves frozen event location and narration.

| Index | Type | Label | Template URL |
| --- | --- | --- | --- |
| 0 | Website / dynamic URL | Call watch | `https://YOUR_STABLE_HOST/call-watch/{{1}}` |
| 1, fresh | Website / dynamic URL | View location | `https://maps.google.com/?q={{1}}` |
| 1, last known | Website / dynamic URL | View last known location | `https://maps.google.com/?q={{1}}` |

Unavailable-location variants have only the call button. There is no
`PHONE_NUMBER` button. Each button's `{{1}}` belongs to that button, separately
from body variables. Gateway supplies a token at button index 0 and the frozen
map suffix at index 1. Use `/call-watch/unavailable` as the non-private template
URL example, never a live token or phone number.

## Deployment and activation

```powershell
cd C:\Users\MSI\repos\guardian
git pull --ff-only origin feat/v52-watch-modes
cd gateway
```

Configure privately in `gateway/.env`, initially with both flags off:

```dotenv
WATCH_CALL_PUBLIC_ORIGIN=https://lidless-inward-lucas.ngrok-free.dev
META_WHATSAPP_SOS_DYNAMIC_CALL_ENABLED=false
META_WHATSAPP_FALL_DYNAMIC_CALL_ENABLED=false
```

Use a stable public HTTPS origin forwarding to HTTP port 9001, matching the
approved template URL exactly. This is not the watch TCP tunnel. A sleeping
development laptop cannot serve call pages; deployed hosting must stay available.
The gateway never derives a public origin from incoming Host headers.

1. Restart gateway; verify public `/health`, then `/call-watch/unavailable`.
   The latter intentionally returns HTTP 410 with a readable fallback page.
   Complete TTL and access-log configuration above.
2. The six v2 templates are submitted and awaiting Meta review. Keep v1
   templates and pilot gates until each corresponding v2 family is ready.
3. Configure WABA/access token privately and run the read-only schema checks:

   ```powershell
   node scripts/check-watch-call-templates.js --type sos
   node scripts/check-watch-call-templates.js --type fall
   ```

   All three templates per family must say `ready: true`. Checks cover approval,
   Utility, English, four body parameters and exact dynamic button positions/URLs.
   The script does not change templates, enable flags or send messages.
4. Enable only the ready family's `META_WHATSAPP_*_DYNAMIC_CALL_ENABLED=true`,
   then restart. Dynamic routing takes precedence over static pilot routing.
   Do not enable unapproved templates: Meta failures are logged without silently
   sending a second alert through a different contract/provider.
5. Controlled acceptance: receive SOS and fall messages, open their links on a
   phone and confirm the correct watch is dialed. Test two distinct SIMs to rule
   out cross-device routing; check all location variants, expiry, changed SIM and
   contact removal. Confirm primary auto-answer during the existing emergency
   window, normal ringing for other contacts, and subsequent Manual restoration.

Rollback: disable the relevant gate and restart. Approved v1 messages remain
usable, with the static SOS pilot still requiring its exact IMEI/SIM match.
Previously delivered links remain valid until original expiry or revocation.
Changing the public origin later requires Meta URL reapproval.

## Verification and scope

Tests cover opaque storage, distinct SIM destinations, expiry and revocation,
preview/injection safety, all six location contracts, recipient fanout, failure
fallback and provider-log redaction. Emulator tests deny every client operation
on link records, including linked owners. Contract checks reject fixed phone
buttons, incorrect origins/indexes/language and unapproved templates.

No device protocols or Flutter settings change. Keep PR #115 draft. Repository
documentation is the handoff; Wiki publishing is unavailable through this
connection. Physical URL delivery is a separate acceptance gate from the
previously observed SOS/fall handsfree behavior.
