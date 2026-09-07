# Guardian Essential SOS WhatsApp contract

**Decision date:** 22 August 2026

**Commercial price:** Rs 199/month from month 13; unchanged

**Scope:** Physical V52 wearer SOS only

## Customer promise

> **Guardian Essential — Rs 199/month**
>
> When SOS is pressed on the watch, the primary guardian receives an alert in
> the Guardian app and on WhatsApp.

Do not market this as **WhatsApp included**. Essential does not include the
Guardian WhatsApp assistant, questions and answers, AI, watch commands,
medication reminders, fall alerts on WhatsApp, geofence/routine WhatsApp alerts, or
proactive WhatsApp messages.

## Delivery contract

1. App push remains available to eligible linked guardian devices.
2. One deterministic Meta SOS template is selected for the primary emergency
   contact. No LLM is called.
3. `isPrimary: true` selects that contact. Legacy records fall back to the
   service owner's first valid contact, then stored order.
4. Essential sends to exactly one WhatsApp recipient per service owner. Family
   and Care retain their existing full safety-alert fan-out.
5. Repeated wearer SOS packets for the same IMEI collapse into one incident for
   90 seconds. A press after the window is a new incident; there is no monthly
   emergency cap.
6. Every Meta attempt and delivery status remains auditable in
   `notificationLogs` and signed delivery events.

## Callback button boundary

The current Meta `Call watch` button contains a static approved phone number.
It remains enabled only when the exact private pilot IMEI and SIM number match.
Essential entitlement must never cause one customer's alert to call another
customer's watch.

Until a scalable, authenticated per-device call-link is implemented and
accepted, non-pilot Essential devices use the standard SOS template and map
button. Marketing must not promise a universal `Call watch` WhatsApp button.

## Cost and safety controls

- one Essential WhatsApp recipient;
- one template per accepted incident;
- deterministic content with no AI tokens;
- 90-second packet suppression;
- no silent safety cut-off after a monthly message count; and
- usage, delivery failure, abuse and actual Meta cost monitoring.

The process-local incident window is suitable for the current single gateway.
Before horizontal notification-worker scaling, replace it with a durable shared
claim so two workers cannot bill or notify for the same incident.
