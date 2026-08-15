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
META_WHATSAPP_FALL_TEMPLATE=
META_WHATSAPP_REMINDER_TEMPLATE=
```

The fall template receives one body value containing the verified alert text.
The reminder template receives wearer name, reminder text, and scheduled time.
If either template is missing or rejected, Guardian records a visible failure;
it never switches to another WhatsApp provider.

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
