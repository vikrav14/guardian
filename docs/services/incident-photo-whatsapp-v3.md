# SOS and fall callback v3 rollout

This rollout creates six new alert templates and one shared photo follow-up.
Existing v1/v2 templates are never edited or deleted. All new send gates default
off, and the template CLI does not change them. The photo branch includes the
standalone per-watch call-link code from PR #115; it does not include that PR's
watch-mode commands or automatic-answer changes.

## Alert contracts

| New name | Existing source | URL buttons, in order |
| --- | --- | --- |
| `guardian_sos_callback_alert_v3` | `guardian_sos_callback_alert_v2` | Call watch, incident map |
| `guardian_sos_callback_last_location_v3` | `guardian_sos_callback_last_location_v2` | Call watch, last-known map |
| `guardian_sos_callback_unavailable_v3` | `guardian_sos_callback_unavailable_v2` | Call watch |
| `guardian_fall_callback_alert_v3` | `guardian_fall_callback_alert_v2` | Call watch, incident map |
| `guardian_fall_callback_last_location_v3` | `guardian_fall_callback_last_location_v2` | Call watch, last-known map |
| `guardian_fall_callback_unavailable_v3` | `guardian_fall_callback_unavailable_v2` | Call watch |

The CLI reads all six approved English Utility v2 templates from the configured
WABA. It preserves their header, footer, exact existing body wording, variable
examples and button labels/URLs, and appends this sentence to each body:

> Incident photos may follow, if available (up to 5). Keep checking on the wearer; do not wait for photos.

The four numbered body parameters keep their existing values and positions. The
call URL is `https://YOUR-GATEWAY/call-watch/{{1}}` at button 0; a map, when
available, is `https://maps.google.com/?q={{1}}` at button 1. The map uses the
frozen alert snapshot, not the watch's later location. There are at most two URL
buttons, in line with [Meta's component contract](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/components/).

Each selected recipient gets a distinct opaque call token for the correct watch.
It expires one hour after the saved alert receipt time. The backend stores only
the token hash and rechecks the current watch SIM, alert, emergency-contact
membership and subscription when the page opens. The landing page requires a
second tap to dial; opening it does not send a device command. Missing SIM data,
revocation or expiry produces an unavailable page. Link issuance is bounded to
two seconds per recipient; a lookup failure still sends the alert with its map.
Avoid capturing bearer URLs in HTTP/proxy access logs. Client access to
`watchCallLinks` remains denied by Firestore rules.

## Separate photo follow-up

`guardian_incident_photo_update_v1` is shared by SOS and fall. It contains:

- Header: `Guardian incident update`.
- Received count out of up to five and analysed count.
- Up to two brief, explicitly unverified photo descriptions, or an honest
  unavailable message when photos or analysis are missing.
- A reminder that photos cannot establish the wearer's condition or location.
- One `Photos & AI details` URL button opening the signed-in incident gallery.

The follow-up is independent of initial alert delivery. The worker waits for the
initial alert's accepted/sent/delivered state, completes or stops the photo
sequence, then claims at most one follow-up attempt. It rechecks household
access and selected emergency contacts. Supervised trials never send it. A
failed follow-up does not replay the initial alert or restart capture. Existing
terminal incidents whose follow-up has already been claimed are not resent when
the flag is later enabled.

## Preview, create and check

Use a PowerShell terminal in `C:\Users\MSI\repos\guardian\gateway`. Keep the
current gateway running with its current configuration during this preparation.
Meta credentials stay in the existing private local environment. Do not paste
tokens into chat or commit preview output containing household examples.

First establish the two public destinations. `WATCH_CALL_PUBLIC_ORIGIN` must
match the call origin in all six approved v2 templates and serve the gateway's
`/call-watch/…` route. `INCIDENT_PHOTOS_APP_URL` must serve the deployed Flutter
app with its working gateway configuration and support `?incident=ID` after
sign-in. A desktop localhost URL is not a usable destination on contacts'
phones. A changing ngrok hostname requires contract review; it must not be
silently substituted under an already-approved template.

```powershell
# Replace both placeholders with the verified deployed destinations.
$env:WATCH_CALL_PUBLIC_ORIGIN = 'https://YOUR-PUBLIC-GATEWAY'
$env:INCIDENT_PHOTOS_APP_URL = 'https://YOUR-DEPLOYED-GUARDIAN-APP'

# GET only: verify the existing six v2 contracts.
npm run call:templates
if ($LASTEXITCODE -ne 0) { throw 'Existing calling templates need review. Stop here.' }

# GET only: print the seven complete proposed contracts for review.
npm run incident:templates -- --preview
if ($LASTEXITCODE -ne 0) { throw 'Template preview failed. Stop here.' }
```

Explicit `--app-url` and `--call-origin` arguments can override those environment
values for preview/check/submission. The old `--call-number` option is rejected:
v3 preserves dynamic per-watch calling, rather than hard-coding one SIM.

After reviewing the actual seven definitions, create the missing versions:

```powershell
npm run incident:templates -- --submit
if ($LASTEXITCODE -ne 0) { throw 'Submission incomplete. Inspect Meta before repeating.' }
```

Submission reads the entire template inventory and checks all six bases and all
seven target contracts before the first POST. A conflicting existing target
aborts the whole preflight. Exact existing targets are skipped, including those
still pending review. No PATCH/DELETE operation is used, no message is sent, and
no gateway flag is changed. A network failure after a POST can have an unknown
outcome; inspect Meta and run the read-only check before repeating. Previously
created matching versions are skipped on the next run.

Wait for approval, then run:

```powershell
npm run incident:templates -- --check
if ($LASTEXITCODE -ne 0) { throw 'All seven contracts must be approved and match before activation.' }
```

The check requires all seven English Utility templates to be APPROVED and have
the expected body/header/footer/buttons. An approved name alone is insufficient.
The command exits nonzero for missing, pending or incompatible contracts.

## Activation and acceptance

Before activating, deploy the call-link route and app gallery. Verify their
public HTTPS destinations on a phone, signed-in gallery access and current
Firestore rules. Run the supervised five-photo trial with the intended AI model
and rotation settings. The trial verifies capture and the gallery; it does not
verify WhatsApp delivery. Record the current gateway flag values for rollback.

Once the checks pass, these are the new settings to persist in the private
gateway environment for the coordinated SOS/fall acceptance test:

```dotenv
WATCH_CALL_PUBLIC_ORIGIN=https://YOUR-PUBLIC-GATEWAY
INCIDENT_PHOTOS_APP_URL=https://YOUR-DEPLOYED-GUARDIAN-APP
META_WHATSAPP_SOS_DYNAMIC_CALL_ENABLED=true
META_WHATSAPP_FALL_DYNAMIC_CALL_ENABLED=true
INCIDENT_PHOTO_SOS_V3_ENABLED=true
INCIDENT_PHOTO_FALL_V3_ENABLED=true
INCIDENT_PHOTO_FOLLOWUP_APPROVED=true
```

Automatic incident capture separately requires `INCIDENT_PHOTOS_ENABLED=true`,
`INCIDENT_PHOTOS_TRIAL_ONLY=false`, existing snapshot runtime acceptance and
household consent. AI/rotation remain separately configured; this rollout does
not choose or change the model. Restart the gateway in the environment containing
the intended values. Setting a variable in another PowerShell window does not
update an already-running gateway. A Flutter rebuild is necessary only if its
code or compiled gateway URL changes.

With the enrolled watch and informed test contacts, check both physical SOS and
fall delivery: prompt initial alert, correct call destination, frozen map for
each available location state, honest unavailable-location handling, no duplicate
batch, and one follow-up whose signed-in gallery opens on a phone. Record actual
notification template names and delivery results. Mock tests cover all six
location variants; Meta/phone delivery still requires this operational test.
Do not manufacture falls or deliberately put a wearer at risk to trigger a test.

## Rollback

Set `INCIDENT_PHOTO_SOS_V3_ENABLED=false`,
`INCIDENT_PHOTO_FALL_V3_ENABLED=false`, and
`INCIDENT_PHOTO_FOLLOWUP_APPROVED=false`, then restart the gateway. With the
dynamic-call gates still enabled, initial alerts select the approved callback
v2 templates. Turning off a family's dynamic-call gate restores its pre-existing
legacy v1 selection (including the SOS static callback pilot where configured).
Restore the recorded settings if the gateway had not yet been using v2.

Disable `INCIDENT_PHOTOS_ENABLED` separately to stop automatic capture. Existing
authenticated galleries, deletion and expiry cleanup remain available. No
rollback deletes or edits Meta templates. The retired
`INCIDENT_PHOTO_TEMPLATES_APPROVED` flag does not control this rollout.
