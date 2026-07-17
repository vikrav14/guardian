# WhatsApp AI assistant

Guardian answers family questions over WhatsApp using Claude + live Firestore data.

## What it does

Incoming message → gateway webhook → Claude with tools (`list_devices`, `get_last_location`, `get_battery`, `get_recent_alerts`) → natural reply on WhatsApp.

Example: *"Where's mum?"* → location + Google Maps link.

## Setup

1. In `gateway/.env` set:

```
HTTP_PORT=9001
ANTHROPIC_API_KEY=sk-ant-...
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
```

2. Restart the gateway (`npm start`). It listens on:
   - TCP `9000` — GT06 pendants
   - HTTP `9001` — webhooks

3. **Local test (no Twilio):**

```powershell
cd C:\Users\MSI\repos\guardian\gateway
npm run chat -- "Where is the pendant?"
```

Or:

```powershell
curl http://127.0.0.1:9001/dev/chat -ContentType application/json -Body '{"from":"+23051234567","text":"Battery?"}'
```

4. **Twilio sandbox:** point the WhatsApp webhook to  
   `https://YOUR_PUBLIC_URL/webhooks/twilio/whatsapp`  
   (use ngrok: `ngrok http 9001`).

5. Put your WhatsApp number on the Firebase user as `phone` or `whatsapp` (E.164, e.g. `+2305xxxxxxx`) so the assistant knows which pendants you can see.

Without `ANTHROPIC_API_KEY`, `/dev/chat` still returns a simple non-LLM status from Firestore.
