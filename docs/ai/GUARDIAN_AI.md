# Guardian Intelligence - product and implementation contract

PR #140 contains a shared AI budget/access foundation, read-only Today and incident
briefs, and comprehensive WhatsApp menus. **There is no Ask Guardian.** The new
revision remains draft and is not deployed or enabled. The earlier three-option
menu restoration is a separate local runtime change.

## Product behaviour

| Experience | Behaviour | Model usage |
| --- | --- | --- |
| Today with Guardian | Prioritised permitted recorded alerts, connection, battery and location, with timestamps and source links | No generation on open/refresh |
| Incident brief | Recorded event, retained event location, family responses and existing unverified photo observations | Reuses photo analysis |
| WhatsApp menu | Nine categories covering current features; recorded answers or authenticated app links; text returns menu | No AI calls |
| Photos | Existing orientation/description pipeline and existing consent, capture and expiry rules | Both stages metered |
| Shared context | Existing observe-only relevance pipeline | Shared bounded background budget |

Menu categories and permission behaviour are specified in
[the service guide](../services/guardian-intelligence.md). Calling, voice messages,
reminders, wellness, journeys, safe zones, account and family controls open their
existing app experiences. A menu selection itself cannot call the watch, request
a photo, change settings or send a recording. SOS/fall alerts remain independent.

Photo observations remain unverified. A response is not arrival, an ACK is not an
image/playback, and receipt time is not verified capture time. Old location is not
current presence. Medication schedules do not establish adherence. Routine
learning, wellness/journey interpretation and voice transcription remain future
work; menu coverage does not claim these AI capabilities already exist.

## Implementation and legacy disposition

- `intelligence-core` retains shared provider transport, versioned pricing,
  transactional budgets, access checks and bounded recorded evidence.
- Public overview/incident endpoints accept GET only and never acquire a provider.
  Ask and legacy dev/chat return 410. The Flutter client has no Ask or POST method.
- The WhatsApp webhook always routes through deterministic managed-family menus.
  Unlinked callers receive linking guidance; disabled menus do not fall back to AI.
- Menus have current permission checks, durable inbound claims and no ambiguous
  resend. Recorded WhatsApp answers use the existing shared answer allowance;
  navigation does not. These are distinct from model spend.
- App links resolve opaque keys through current authenticated family access, with
  no alternate-wearer fallback. Destination stacks clear on revocation/background.
- Existing photo AI and background context retain the common budget boundary.
  Initial notifications, watch cadence, capture policy and calls do not depend on AI.
- Old provider/tool and constrained question modules remain only as internal
  compatibility/diagnostic code. No public text entry point reaches them. The
  earlier paid synthetic results are historical, not the current user experience.
- Legacy movement/geofence/battery predictions remain retired when the new overview
  is enabled; independent offline alerts and deterministic source selection remain.
- Family recordings/reminders require no AI transcription or generated audio.
  Voice monitoring is not introduced. There is no LLM per location packet.

## Costs

Pilot operating ceilings are Rs50 for Family and Rs100 for Care per paid wearer per Mauritius calendar month. This is an internal AI operating budget, not the subscription price or a promise about the complete hosting bill. Family members share it. Routine work may consume up to 70%; photo/incident work can use the remaining capacity. The fleet ceiling is Rs15,000/month; background work has its own Rs1,000 ceiling and still shares the fleet limit.

Public app and WhatsApp model questions are removed. The internal diagnostic question ledger retains its 50 Family / 100 Care job limit for legacy regression coverage. A job can have at most three provider attempts; actual daily attempts are capped at 40 per wearer. Cached answers and deterministic lookups do not consume model-question jobs. Failed or uncertain billed attempts remain counted. There are no automatic generation retries or model escalations.

Every generation has bounded text, input tokens, output tokens and supported image count/size. Unknown model prices and optional pricing modifiers fail closed. Provider token counting precedes reservation; the reservation includes 20% + 256 input-token headroom and the full output allowance. Reported usage reconciles the reservation exactly once. If usage exceeds an estimate, the ledger records the excess and future calls see it. Therefore these are conservative application controls, not an absolute guarantee of the provider's invoice ceiling. Provider-side spend caps and invoice reconciliation remain necessary operational controls.

Pricing is versioned in code. At the fixed planning conversion of Rs50/USD, 300 calls of 2,000 input + 300 output tokens would cost approximately Rs52.50 on Haiku 4.5 or Rs14.25 on Gemini 3.1 Flash-Lite. This excludes images, retries, context, database, notifications, taxes and hosting; it is a scenario, not measured Guardian usage. The lower-price provider is available behind the adapter but has not been qualified against a live Guardian evaluation set.

Sources checked for this implementation: [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing), [Google pricing](https://ai.google.dev/gemini-api/docs/pricing), [Anthropic token counting](https://platform.claude.com/docs/en/build-with-claude/token-counting), [Gemini token counting](https://ai.google.dev/api/tokens), [Gemini thought signatures](https://ai.google.dev/gemini-api/docs/thought-signatures).

## Release gates and subsequent work

Verify menu coverage, old cards, shared access/revocation, service expiry and no
model calls using synthetic tests and a managed-family phone pilot. Keep #140
draft until the operator has reviewed the phone/WhatsApp flow. Deploy shared
budget rules/TTL and validate photo/context metering separately before activation.
No test alarm, capture, paid question or live outbound message was needed for
this menu revision.

Later derived summaries must use authorised history with sufficient coverage,
distinguish missing observations from behaviour changes, and measure false
positives before exposing routine deviations. Future external context must be
source-, geography- and freshness-aware; same-town news is not evidence that a
wearer is affected. Any future voice transcription needs separate consent and
measured economics.

See [acceptance evidence](GUARDIAN_AI_ACCEPTANCE.md) and
[rollout/rollback](../services/guardian-intelligence.md).
