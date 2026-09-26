# SOS and fall incident photos

Implementation on `feat/v52-remote-photo`; **supervised trial only, not hardware-accepted**.
The single-photo path has four consecutive operator-reported successes after the
padding correction on 25 September 2026, including two without manual CR. On
26 September, a live saved-original AI probe succeeded and a subsequent gallery
displayed three photos with AI descriptions. Five-photo completion and capture
during an SOS call remain unverified. No CR, invented wake command, generative
enhancement or photo retry is added.

The 26 September 00:56 MUT supervised trial displayed two photos. A third image
passed decoding/storage but failed publication; the old generic error does not
establish why. Exact-duplicate rejection is a possibility, not a confirmed result.
Both displayed photos reported AI unavailable. The gateway log also shows an
independent automatic recovery CR before this sequence, so this trial does not
isolate capture without CR. At that checkpoint, five-photo completion and real AI
output were still open.

At 01:23 MUT the saved-original AI probe completed with `analysis_invalid_json`
and `contentFormat=fenced_json`. The original download and provider request both
completed; this result is a parser failure, not evidence of a stuck command.
The analyzer now accepts one complete outer Markdown fence (JSON-labelled or
unlabelled) around otherwise valid JSON. It still rejects surrounding prose,
multiple blocks, incomplete/truncated replies, invalid JSON and invalid scene
content. No raw provider response was retained. Repeat the saved-photo probe to
verify live output; the two earlier stored failures remain unchanged.

The repeat probe succeeded with `too_unclear` at 01:42 MUT. A later supervised
gallery screenshot (trial at 01:57:54) shows three available photos with stored AI
descriptions and an unavailable fourth request. That fourth stop reason still
needs diagnostics. This establishes displayed AI results, not verified scene
accuracy, five-photo completion or live acceptance of automatic orientation.

On 26 September at 20:21 and 20:36 MUT, two supervised attempts each returned
one bare capture reply and 64 total bytes across two frames, with no photo
header/frame or partial buffer before timeout. The supplied log contains no
reconnect or CR around either attempt. A further alert at 20:42 reused the 20:36
incident's lock, which expired at 20:48:11; it was not another capture attempt.
A 21:00 screenshot subsequently shows an available photo and an AI description
the operator found too vague. That screenshot alone does not establish sequence
completion, the effect of the suggested CR comparison, the model used, or
automatic orientation. The displayed image was labelled as an adjusted view.

## Scene description quality

Prompt version 3 prioritises recognisable people, visible body/support positions
and surroundings, considers possible quarter-turn orientations, and requests a
short scene summary. `ready` means at least one meaningful scene detail can be
described; `too_unclear` is reserved for largely unreadable imagery. Neither is
a judgment about a person's condition or the seriousness of an incident.
Empty detail arrays are allowed; the prompt discourages filler and repeated
caveats. A summary has the same content checks as other scene text and a
320-character limit. The existing image, JSON-size, consent and response-time
limits remain; the description output budget is 900 tokens. The default path
uses one call. The opt-in orientation-first trial below uses up to two calls.
The operator selects the model explicitly; no default model is silently changed.

New analyses retain the requested/configured `model`, the provider's
`responseModel` when supplied as a bounded model ID, and `promptVersion`.
Historical results without those fields remain unknown, not attributed to the
current configuration. The model metadata comes from the request/provider
envelope, not model-generated scene JSON. It follows the same access, consent,
expiry and deletion lifecycle as the description.

The gallery leads with the summary, keeps the first specific ambiguity and
image limitation visible, and puts additional observations under **More photo
details**. Legacy descriptions use their visible observations as the lead;
they are not silently reanalysed. This presentation and its tests cannot establish
real model accuracy: compare the new prompt on a still-authorised saved original
before changing the configured model or claiming better scene recognition.

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
brightness are display-only controls. The same consented original-photo AI request
also asks for a viewing orientation. A validated, high-confidence suggestion of
90, 180 or 270 degrees clockwise is applied automatically when analysis arrives;
0 means already upright. Low-confidence, missing or malformed suggestions keep
the original orientation. Model confidence is not a guarantee of correctness.
The image is available while AI runs, and no additional upload/request is added.
Manual Rotate and Original take priority over later analysis and refreshes, even
across background/foreground access checks; Auto rotate reapplies the suggestion.
Brightness and rotation never rewrite the stored JPEG or feed an altered image
back to AI. Older analyses without orientation metadata retain manual rotation;
they are not silently reprocessed. Backgrounding hides both images and AI;
foreground access is rechecked. Deletion removes the server-side description too.
Access expires after 24 hours; physical object/description cleanup runs with the
gateway and catches up after restart. Scene summaries already delivered to
WhatsApp remain in the recipient's chat.

With separate AI consent and `INCIDENT_PHOTO_AI_ENABLED=true`, the default path
sends the original JPEG to the configured Anthropic vision model. The explicit
orientation-first trial sends lossless rotated pixel views as described below.
Neither path sends watch identity, name, GPS, event narrative or generated
enhancement. One bounded analysis attempt per photo (up to two provider calls in
the orientation-first trial); no provider error or image content is logged. Structured output
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

## Inspect a partial sequence without another capture

From a separate configured shell in `gateway`, select an existing request UUID:

```powershell
npm run incident:inspect -- --photo PHOTO_REQUEST_UUID
```

This reads the incident and prints bounded status fields for all its requests.
New gateway failures retain a fixed rejection reason for duplicate images,
revoked consent or inactive requests, and fixed AI failure categories for HTTP,
timeout, response parsing or schema rejection. Earlier generic failures cannot
be reconstructed retrospectively. No image, scene description, key, provider
error body or raw model output is printed.

To diagnose AI while the original remains available, make one explicit provider
request using the original photo and current household AI consent:

```powershell
npm run incident:inspect -- --photo PHOTO_REQUEST_UUID --probe-ai --confirm --bucket guardian-fbadd.firebasestorage.app
```

The explicit bucket must belong to the configured Firebase project. Current
access, subscription, consent, incident and photo expiry are rechecked. The probe
prints status/counts or a fixed failure code and bounded metadata such as HTTP
status. It leaves the saved analysis unchanged; an ordinary photo-view audit is
recorded. It starts no gateway watchers and sends no camera or emergency message.
The running gateway can stay connected; no restart or Firebase deploy is needed
to run this diagnostic. New persisted failure categories require the updated
gateway on its next normal restart. An AI response of `too_unclear` is successful
analysis of an unreadable scene; `unavailable` means analysis did not complete.

To explicitly review the new description of that same original, add
`--show-analysis` to the confirmed probe:

```powershell
npm run incident:inspect -- --photo PHOTO_REQUEST_UUID --probe-ai --confirm --show-analysis --bucket guardian-fbadd.firebasestorage.app
```

This prints the validated private scene description and orientation in your
terminal, together with requested/provider model IDs and prompt version when
available. Omit `--show-analysis` from ordinary diagnostic logs. Access is checked
again after AI completes, and deleted, expired or revoked images cannot release
a description. No saved analysis is replaced and no watch command, notification,
gateway restart or new capture is needed for this comparison. Pulling the new
code is enough for this one-shot script; restart the gateway and Flutter to use
the new processing and presentation for subsequent incident photos.

### Compare a known upright view without another capture

If an operator has checked the original and knows its viewing rotation, a
confirmed diagnostic can rotate decoded pixels before the one AI request:

```powershell
npm run incident:inspect -- --photo PHOTO_REQUEST_UUID --probe-ai --confirm --show-analysis --rotate-clockwise 270 --bucket guardian-fbadd.firebasestorage.app
```

`--rotate-clockwise` accepts only 0, 90, 180 or 270. Omit it for the exact original
JPEG baseline. The explicit flag decodes under the existing 1.1 MP / 32 MB limits,
rearranges RGB pixels with no interpolation, and encodes an in-memory lossless PNG
bounded to 4 MB. No resizing, brightening, metadata, generative enhancement or
derived file is saved. `0` is a PNG decoding/encoding control with no rotation;
use it if an improvement needs separating from the JPEG-versus-PNG input change.
Keep the same model and prompt for a rotation comparison. Prompt version 3 and
its text remain unchanged; no scene hints or expected answers are sent.

Output identifies `basis: rotated_original_photo` (or `decoded_original_photo`
for 0), `inputRotationClockwiseDegrees`, `inputEncoding: png`, and
`orientationReference: analysis_input`. Any model orientation is a further turn
relative to the submitted view, **not** the stored original; do not apply it to
the gallery. The original bytes, saved analysis and gallery remain unchanged.
Consent, access and expiry checks apply before upload and after the response.
The flag is unavailable without `--probe-ai --confirm`; runtime automatic
analysis sends the original JPEG unless the separate orientation-first runtime
flag below is enabled. The diagnostic flag itself never changes the runtime.

Sept 26 operator review found that a model could suggest the wrong quarter-turn
with high confidence. A successful schema check and `ready` status do not prove
scene accuracy or correct orientation. Evaluate the explicit rotated-input
probe before changing runtime preprocessing or the model; a fixed correction
for every watch photo is not justified by one example. Capture timeouts remain
a separate, unresolved device/transport issue.

## Orientation-first live trial

In the Sept 26 saved-photo comparison, the upright-input Sonnet 4.6 result was
materially more faithful to the visible scene than upright-input Haiku and either
sideways-input result. This is one-image evidence, not broad accuracy acceptance.
The new runtime path still needs a fresh supervised capture to establish its
automatic selection, saved description and matching gallery rotation together.

In the **existing configured gateway terminal**, stop Node and restart after
pulling the updated branch with:

```powershell
$env:INCIDENT_PHOTO_AI_MODEL = 'claude-sonnet-4-6'
$env:INCIDENT_PHOTO_AI_ENABLED = 'true'
$env:INCIDENT_PHOTO_AI_ORIENTATION_ENABLED = 'true'
$env:INCIDENT_PHOTOS_ENABLED = 'true'
$env:INCIDENT_PHOTOS_TRIAL_ONLY = 'true'
$env:INCIDENT_PHOTO_TEMPLATES_APPROVED = 'false'
npm start
```

Keep the existing accepted-watch snapshot flags, credentials and private bucket.
Restart Flutter with the existing gateway URL to load the updated gallery model.
Wait for the watch to reconnect before queuing **one** `incident:trial` command;
no manual CR or local watch photo is required. This is still the bounded sequence
of up to five photos, and capture may stop earlier on a timeout or other failure.

With `INCIDENT_PHOTO_AI_ORIENTATION_ENABLED=true`, processing uses:

1. One orientation request containing four explicitly labelled PNG quarter-turn
   views of the **same** original. Each is a pixel-preserving, strictly decoded
   view; no interpolation, scene hints or generative enhancement is involved.
2. After fresh access/AI-consent checks, one description request on the selected
   view (or zero-degree decoded original if selection abstained). Prompt v4 makes
   the orientation reference explicit: any turn is additional to the image actually
   supplied in this request. This call gets no proposed scene description or
   orientation answer. A valid description is kept even if orientation is uncertain
   or disagrees. Automatic viewing rotation requires a clear selection and a
   high-confidence residual zero; disagreement withholds that viewing suggestion
   without a third call or automatic retry.

Each provider request has a 20-second timeout; orientation is bounded to 160 output
tokens/1,000 characters and description to 900 tokens/5,000 characters. Each PNG
is bounded to 4 MB, so four images remain within the direct API request-size limit.
Current ownership, subscription, incident/photo expiry and AI consent are checked
before uploads, between calls, after analysis and at persistence. Original JPEG
storage/hash, capture timing and emergency delivery remain independent of AI.
Two model passes agreeing still do not prove orientation or description accuracy.

The saved record includes the input rotation, separate selector provenance and
`orientationSelection.method=four_views_then_description`. Residual orientation
remains relative to `analysis_input`; the gallery applies the selected input turn
to the original exactly once. Manual Rotate/Original choices take precedence.
`orientationSelection.verification` is derived from the two responses: `confirmed`,
`uncertain`, `conflicting`, or `not_selected`. Uncertain or conflicting orientation
leaves the original view and the validated description available with a separate
orientation note. Existing photos are not automatically reanalysed.
Inspect a new photo with `incident:inspect -- --photo UUID` to confirm the stored
model, prompt version, input rotation and orientation method.

The first live trial of the two-call path received one photo, but discarded its
description because the second response did not confirm the selected orientation.
A later photo timed out separately. That result exposed the unnecessary coupling;
it did not establish which of the two model orientations was correct. Prompt v4
clarifies the reference and retains descriptions, but live orientation accuracy
still needs verification on the saved image.

To test the complete automatic path on one existing, unexpired photo without
another capture, use this explicit diagnostic (up to two AI requests):

```powershell
npm run incident:inspect -- --photo UUID --probe-ai --probe-orientation --confirm --show-analysis --bucket guardian-fbadd.firebasestorage.app
```

`--probe-orientation` cannot be combined with `--rotate-clockwise`. It explicitly
uses the automatic path regardless of the gateway runtime flag, with the model
configured in this command's environment. Output includes the selected input
rotation, the description's residual rotation, both provider model IDs and the
derived verification state. `--show-analysis` exposes the validated description
only in the operator's terminal. Access and AI consent are checked between both
calls. No saved analysis, camera command, original bytes, incident state or
notification is changed; the result reports `savedAnalysisChanged: false`.

Rollback: set `INCIDENT_PHOTO_AI_ORIENTATION_ENABLED=false` and restart the gateway
to restore the single original-JPEG AI call. Saved originals remain unchanged.
The supervised trial does not submit or activate SOS/fall WhatsApp templates.
