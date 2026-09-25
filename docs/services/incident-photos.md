# SOS and fall incident photos

Implementation on `feat/v52-remote-photo`; **not activated or hardware-accepted**.
The single-photo path has four consecutive operator-reported successes after the
padding correction on 25 September 2026, including two without manual CR. Five
sequential captures, capture during an SOS call, and real AI output remain to be
tested. No CR, invented wake command, generative enhancement or photo retry is added.

## Behavior

The watch alarm handler marks persisted SOS/fall alerts as photo-eligible. Existing
emergency delivery runs immediately and never awaits the photo worker or AI.
Client-created help alerts cannot authorize automatic capture. A separate worker
uses enrolled household consent and an active Family/Care subscription.

One durable device lock collapses duplicate SOS/fall reports into the same gallery
for 12 minutes. The worker requests **up to five photos**, sequentially, at least
10 seconds after the previous image was received. It stops at the first failed,
timed-out, deleted, duplicate-image or disconnected capture, or at the 12-minute
deadline. No overlapping command, timeout retry or restart replay is permitted.
The 15-minute manual test cooldown is independent. Manual capture requires its
own gateway flag and is hidden in normal app builds.

The firmware has no verified capture request ID. Correlation remains one active
request on the same socket within two minutes; it is not proof of exact capture
time. Exact duplicate JPEGs are rejected within a sequence. Distinct delayed or
manually generated images inside another request's window remain a hardware
limitation. Do not advertise verified chronology or five guaranteed captures.

## Private gallery and AI

`GET /api/incident-photos/:alertId` requires a revoked-token-checked Firebase bearer
token, current watch linkage, verified family membership, active subscription and
the incident's original household. The HTTPS app link is `/?incident=<alertId>`;
the ID is not an access token. A forwarded WhatsApp link does not grant access.
Emergency contacts need an authorized Guardian account to open photos.

The Flutter gallery shows each original as it arrives, received time, per-photo
analysis state, visible details, uncertainties and image limitations. Rotation and
brightness are display-only controls. Backgrounding hides both images and AI;
foreground access is rechecked. Deletion removes the server-side description too.
Access expires after 24 hours; physical object/description cleanup runs with the
gateway and catches up after restart. Scene summaries already delivered to
WhatsApp remain in the recipient's chat.

With separate AI consent and `INCIDENT_PHOTO_AI_ENABLED=true`, the gateway sends
only the original JPEG to the configured Anthropic vision model. It sends no
watch identity, name, GPS, event narrative or generated enhancement. One bounded
attempt per photo; no provider error or image content is logged. Structured output
validation and a restrictive prompt reduce unsupported claims but cannot guarantee
truth. AI output is explicitly unverified. No photo result can resolve, downgrade,
diagnose or change location evidence for an alert. The cross-photo summary cites
individual photo descriptions; it does not infer motion or recovery.

## WhatsApp contracts

Both SOS and fall receive fresh / last-known / unavailable variants. Callback
variants retain `Call watch` for the exact existing IMEI/SIM pilot. Map URLs remain
bound to the existing frozen event location. Each new variant adds `Photos & AI
details` and an awaiting-photos section. An optional single follow-up reports photo
counts and up to two grounded, explicitly unverified per-photo descriptions.

Generate and review definitions using `npm run incident:templates -- --app-url
https://YOUR-DEPLOYED-GUARDIAN-APP --call-number +230YOURWATCHNUMBER`.
No credentials are needed for this preview. `--submit` creates new versioned
templates in the configured WABA; it does not change or interrupt existing approved
templates. `--check` verifies both approval and the exact expected body/buttons.
Do not turn on `INCIDENT_PHOTO_TEMPLATES_APPROVED` until that check passes and the
deployed gallery opens correctly on a phone. The switch is independent of capture.

References: [Meta template components](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/components/),
[template overview](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview),
[Anthropic vision](https://platform.claude.com/docs/en/build-with-claude/vision).

## Controlled trial and activation

Keep the existing snapshot bucket, allowlist and device acceptance gates. Deploy
`firestore:rules` from this branch before enabling AI, so direct client reads cannot
bypass incident authorization or expiry. Existing photo indexes are unchanged;
new worker queries use automatic single-field indexes.

The rules now retain the phonebook, manual/automatic answering, emergency
callback and private call-link protections from PR #115 at `348087cb`. Earlier
photo commits through `6756f08` omitted those separate calling rules; do not
deploy their entire rules file over the calling pilot. This reconciliation changes
only client authorization and does not activate calling or photo workers.
Deploy only `firestore:rules`, preserving the existing calling indexes and Storage
configuration. Any additional unpublished rules still need to be reconciled.

If a new PowerShell window reports photo capture disabled, restore the six
process-local snapshot settings from the single-photo trial in that same window
before starting the gateway. Set the incident trial-only switch explicitly; photo
capture settings do not themselves confirm a live watch connection.

1. Record wearer/responsible-guardian agreement to automatic SOS/fall capture. AI
   agreement also covers sending originals to Anthropic and brief descriptions to
   the household's configured emergency WhatsApp contacts. In `gateway`:

   ```powershell
   npm run incident:setup -- --imei 861397052547492 --enable --wearer-confirmed --ai-confirmed --recorded-by YOUR_CONFIGURED_ADMIN_EMAIL
   ```

   Omit `--ai-confirmed` for capture-only testing. A unique owner is resolved from
   linked accounts; ambiguous households require an explicit `--owner` UID.
   `--disable` immediately prevents further automatic capture and new AI work.

2. Start the gateway in its existing configured shell with:

   ```powershell
   $env:INCIDENT_PHOTOS_ENABLED = 'true'
   $env:INCIDENT_PHOTOS_TRIAL_ONLY = 'true'
   $env:INCIDENT_PHOTO_AI_ENABLED = 'true'
   $env:INCIDENT_PHOTO_TEMPLATES_APPROVED = 'false'
   npm start
   ```

   `ANTHROPIC_API_KEY` and a valid vision model are required for AI. It uses
   `INCIDENT_PHOTO_AI_MODEL` or the existing `ANTHROPIC_MODEL`; verify availability
   with the account. AI unavailable does not prevent receiving/viewing photos.
   No five-photo sequence is remotely dispatched from this development workspace.

3. Restart Flutter with the existing `GUARDIAN_GATEWAY_URL`. The standalone
   snapshot card now requires explicit `GUARDIAN_SAFETY_SNAPSHOTS_ENABLED=true`
   and `SAFETY_SNAPSHOT_MANUAL_TEST_ENABLED=true` on the gateway for manual trials.
   Normal customers enter through alert details or the WhatsApp incident link.

4. In a separate PowerShell window, queue one supervised sequence:

   ```powershell
   npm run incident:trial -- --imei 861397052547492 --confirm
   ```

   This creates a clearly labelled, resolved trial in alert history and sends no
   emergency notification. Open its `Photos & AI details` or append the printed
   `?incident=ID` to the app URL. Leave the watch worn/asleep/untouched, with no CR.
   Record received counts/times, analysis, rotation, deletion and expiry/access
   behavior. Stop after a failed/partial sequence and inspect evidence.

5. After supervised acceptance, deploy the app at a stable HTTPS URL, submit/check
   template revisions, set `INCIDENT_PHOTOS_APP_URL`, enable the approved-template
   switch, then set `INCIDENT_PHOTOS_TRIAL_ONLY=false` for a coordinated physical
   SOS and fall test. Confirm the alert arrives promptly, call/map actions still
   work, no duplicate batch starts, the gallery works on mobile, and AI remains
   appropriately uncertain. Templates, live capture and AI are not production
   accepted until these checks are recorded.

Rollback: leave existing templates selected (`INCIDENT_PHOTO_TEMPLATES_APPROVED=false`)
and disable automatic capture (`INCIDENT_PHOTOS_ENABLED=false`). Authenticated
gallery reads, deletion and expiry cleanup continue for existing photos.
