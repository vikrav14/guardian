# Guardian communication and cost policy

**Status:** Engineering and product contract
**Applies to:** Guardian app, V52 watch calls, WhatsApp and AI-backed replies

## Product rule

Guardian must give the useful, verified answer at the lowest safe cost. A
dashboard click must not open WhatsApp, invoke an LLM or create billable traffic
unless the user explicitly chooses that next step.

## Guardian help flow

For Guardian Family and Care, the dashboard **Guardian help** action opens an
in-app panel with deterministic actions:

1. current or last-known location, including freshness;
2. battery and connection status, including stale-reading wording;
3. recent alerts from the Guardian alert timeline; and
4. confirmed journey history.

These actions use data already available to the app. They do not call an LLM
and do not send a WhatsApp message. **Continue on WhatsApp** is a separate,
explicit action.

Essential keeps Guardian help locked because WhatsApp questions and answers are
not included in that plan. Essential's normal map, watch status, alert, journey
and safety surfaces remain available according to its own entitlements. A
physical watch SOS is the narrow exception: Guardian sends one deterministic
Meta template per accepted incident to the primary emergency contact. It does
not open chat or invoke an LLM.

Guardian Essential remains Rs 199/month from month 13. SOS-only WhatsApp is a
core safety-delivery channel at that price, not the WhatsApp assistant. Product
copy must say **SOS alerts in the Guardian app and WhatsApp** rather than the
broader and misleading **WhatsApp included**.

## WhatsApp handoff

The approved business number is public build configuration, not a secret. Set
it using digits in international format:

```powershell
flutter run -d chrome --dart-define=GUARDIAN_WHATSAPP_NUMBER=2301234567
```

Production Web builds must receive the same define in CI. A missing value fails
closed with honest copy; it must never display a false “ready” message.

- On Android and iOS, Guardian opens the WhatsApp deep link only after the user
  chooses **Continue on WhatsApp**.
- On desktop, Guardian offers **Open WhatsApp Web**, **Copy number** and
  **Cancel**. WhatsApp Web is never assumed to be installed or signed in.
- Copying the number lets a user continue on their phone without using
  WhatsApp Web.

## Watch calls and the 500MB SIM allowance

**Call watch** is a normal carrier voice call to the watch SIM number. It is not
a WhatsApp or VoIP call. Therefore:

- the voice call does not consume the watch's 500MB mobile-data allowance;
- the carrier may charge voice by the minute under the SIM plan;
- WhatsApp runs on the caregiver's phone or computer connection, not on the
  watch SIM; and
- GPS reports, heartbeats and watch commands use the watch's mobile data.

On mobile Guardian may pass the number to the system dialler. On desktop it
shows the number and the voice/data distinction, with explicit copy and
try-this-device actions. The app must not promise that an offline watch can
receive a call: carrier voice may still work only when the watch has network
coverage.

The current Mauritius Telecom M2M Machine plan advertises a 500MB allowance and
reduced-speed service after the allowance. Carrier voice/SMS pricing is
separate. Commercial terms can change and must be checked before launch:
<https://www.myt.mu/business/m2m-iot>.

## Data and AI budget gates

No launch assumption may rely only on a theoretical telemetry estimate. During
the device pilot, retain per-watch monthly counters for received bytes,
heartbeat/location frequency, commands and abnormal reconnect loops. Review at
50%, 75% and 90% of the 500MB allowance.

AI-backed WhatsApp behaviour must also have server-enforced controls:

- deterministic intent and reply paths first;
- LLM fallback only for eligible Family/Care requests;
- per-family daily and monthly request/token ceilings;
- no LLM call for courtesy, navigation, entitlement, safety-critical or
  unsupported requests;
- bounded input/output length, timeout and one safe fallback;
- aggregate cost and error telemetry without message bodies or private
  location/health content; and
- a kill switch that preserves deterministic safety functions.

Essential SOS cost controls are separate from AI limits:

- exactly one primary WhatsApp recipient per Essential family;
- one WhatsApp template per accepted wearer-SOS incident;
- repeated device SOS packets collapse into the same incident for 90 seconds;
- no LLM narration, conversational reply, routine alert or watch command; and
- delivery/cost metrics must be reviewed against Meta invoices. A horizontally
  scaled gateway requires a durable shared incident claim before scaling beyond
  one notification worker; the current process-local window is not a
  distributed lock.

Marketing must not describe AI or WhatsApp use as unlimited until a written
fair-use definition, budget model and abuse policy are approved.

## Release evidence

Before release, retain:

- a mobile dialler test and a desktop call-handoff test;
- an Android/iOS WhatsApp deep-link test and a desktop copy/Web/cancel test;
- proof that opening Guardian help causes no WhatsApp or LLM request;
- a missing-WhatsApp-number test;
- at least one full billing-cycle watch data measurement; and
- carrier invoice/usage evidence separating mobile data, voice and SMS.
