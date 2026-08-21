# WhatsApp assistant — Meta Cloud API only

Guardian answers registered family questions using live Firestore data and
sends safety notifications through Meta WhatsApp Cloud API. Twilio is not a
WhatsApp transport or fallback.

## Required configuration

Keep all secrets in `gateway/.env` or deployment secrets:

```dotenv
HTTP_PORT=9001
META_WHATSAPP_ACCESS_TOKEN=
META_WHATSAPP_PHONE_NUMBER_ID=
META_WHATSAPP_WABA_ID=
META_APP_SECRET=
META_WHATSAPP_VERIFY_TOKEN=
```

Set `ANTHROPIC_API_KEY` and `LLM_PROVIDER=anthropic` for conversational
questions. Critical SOS narration remains deterministic and does not call an
LLM.

Business-initiated messages require approved Meta templates:

```dotenv
META_WHATSAPP_REMINDER_TEMPLATE=
```

Fall alerts use three fixed English (`en`) templates selected from the location
snapshot captured when the V52 fall event is persisted:

| Location at event time | Template | Button |
|---|---|---|
| Trustworthy and at most 10 minutes old | `guardian_fall_alert_v1` | `View location` |
| Trustworthy but older or missing a dependable timestamp | `guardian_fall_last_location_v1` | `View last known location` |
| No trustworthy event-time location | `guardian_fall_unavailable_v1` | None |

All three templates receive exactly four body values: deterministic safety
narration, event time, location details/status, and watch status. The two
location templates also receive the dynamic latitude/longitude suffix for
`https://maps.google.com/?q={{1}}`. The unavailable template has no URL button.
Location age is event-relative (for example, `2 mins before fall`) so a delayed
provider retry cannot make the frozen evidence read like a current fix.

Guardian never builds a fall map link from the current device document. The
alert's immutable `payload.locationSnapshot` is the only fall-location source,
so movement after the event cannot silently change the destination. Legacy
fall alerts without a snapshot fail closed to the unavailable template.

The reminder template receives wearer name, reminder text, and scheduled time.
If any required template is missing or rejected, Guardian records a visible
failure; it never switches to another WhatsApp provider.

### SOS callback pilot

Guardian can select a second, pilot-only SOS template set after a controlled
V52 no-call acceptance test:

| Location at event time | Template | Approved buttons |
|---|---|---|
| Fresh | `guardian_sos_callback_alert_v1` | Index 0 `Call watch` (static phone), index 1 `View location` (dynamic URL) |
| Last known | `guardian_sos_callback_last_location_v1` | Index 0 `Call watch` (static phone), index 1 `View last known location` (dynamic URL) |
| Unavailable | `guardian_sos_callback_unavailable_v1` | Index 0 `Call watch` (static phone) |

Meta fixes the phone number in the approved phone-button template. Guardian
therefore enables this set only when both private settings below match the
alerting device exactly:

```dotenv
META_WHATSAPP_SOS_CALLBACK_PILOT_IMEI=
META_WHATSAPP_SOS_CALLBACK_PILOT_NUMBER=
```

Leave both empty by default. This pilot guard prevents another watch's alert
from displaying a button that calls the pilot watch. The template button text
is static; use the generic production label `Call watch` rather than embedding
a wearer's name. This is not yet the scalable multi-watch call-link design.

The current plan catalogue grants WhatsApp safety alerts to Guardian Family
and Care, not Essential. Enabling SOS-only WhatsApp in Essential is a separate
commercial and entitlement decision; this pilot does not silently change it.

## Webhook

Expose this signed endpoint over HTTPS and configure it in the Meta app:

```text
GET/POST https://YOUR_PUBLIC_HOST/webhooks/meta/whatsapp
```

Subscribe the WhatsApp Business Account to the `messages` webhook field. The
same endpoint receives inbound family questions and outbound message status
updates (`sent`, `delivered`, `read`, and `failed`). Guardian verifies
`X-Hub-Signature-256` with `META_APP_SECRET` before processing either.

Meta returning a `wamid` means the message was accepted by its API. Guardian
does not label delivery proven until the webhook records `delivered` or `read`.
Every signed status is also retained in `metaDeliveryEvents`, including smoke
messages that are not linked to an alert.

## Controlled smoke test

Use the Meta-provided `hello_world` template with an approved test recipient:

```powershell
cd "C:\Users\MSI\repos\guardian\gateway"
node .\scripts\meta-send-smoke.js +23058590100 hello_world en_US
```

This sends one real WhatsApp message and may incur Meta charges. Do not use a
physical SOS press for configuration testing.

Copy the printed `messageId`, wait for the webhook, then inspect it:

```powershell
node .\scripts\inspect-meta-delivery.js --message-id "wamid..."
```

## Local chat without sending WhatsApp

```powershell
npm run chat -- "Where is the watch?"
```

or:

```powershell
Invoke-RestMethod http://127.0.0.1:9001/dev/chat `
  -Method Post `
  -ContentType application/json `
  -Body '{"from":"+23051234567","text":"Battery?"}'
```

The sender number must match a Firebase user `phone` or `whatsapp` field before
the assistant can disclose family data.
