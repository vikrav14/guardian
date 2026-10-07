# Guardian Intelligence — implementation and product contract

PR #140 now contains the first implementation, based on current main. It replaces the original RSS-first proposal with a shared cost/access foundation and three app experiences. The new screens are disabled by default. No production gateway, watch setting, deployed app or paid model qualification was changed by this implementation.

## First release

| Experience | Implemented behaviour | Model cost |
| --- | --- | --- |
| Today with Guardian | A prioritised overview of recent alerts, watch connection, timestamped battery and permitted location evidence; links to the underlying records | No model call when opening or refreshing |
| Ask Guardian | Simple fact questions answered directly; broader questions use a model to select relevant authorised evidence, which the server renders from current records | At most one generation for a new question/evidence/scope/day combination |
| Incident brief | Event time/status, the location retained with that event, family responses and permitted existing photo observations | No second analysis of an already analysed photo |

The first Ask release selects evidence; it does not generate free-form medical advice or claim to be a general historical assistant. The evidence adapters currently cover connection, battery, location, recent alerts, incident responses and incident photos. Journey comparisons, medication history, wellness/activity trends and voice transcripts are not yet available in Ask. Routine learning is not implemented.

Photo observations remain explicitly unverified. A family response is not arrival; a command ACK is not an image or playback; receipt time is not a verified capture time. Old location evidence is never relabelled current. The app clears its answer on backgrounding, wearer changes, access changes or evidence expiry.

## Common implementation

`gateway/src/intelligence-core/` owns the provider transport, pricing policy, transactional budget ledger, access checks, evidence adapters, question selection/cache and authenticated HTTP endpoints. Flutter uses `IntelligenceService` and `IntelligenceView` from both Home and incident details.

1. Resolve one wearer through backend-owned `familyServices`, current membership, service entitlement and granular permissions.
2. Assemble a small allowlist of timestamped facts, without raw coordinates, radios, full histories or media bytes for text questions.
3. Serve a recorded overview or simple lookup without a model.
4. For a broader question, claim the question cache key transactionally. The model can return only allowed evidence IDs, never actions or new prose.
5. Count input tokens, atomically reserve spending capacity, call once and settle actual reported usage. Missing usage or ambiguous completion retains the reservation.
6. Reauthorise and rebuild evidence before returning. Changed evidence suppresses the old selection without another paid attempt.

Questions, names, private prose and images are not stored in the selection cache. Cached IDs are useful only when matched against freshly authorised evidence. Photo access uses the existing gallery's consent/expiry/deletion rules. The new endpoints reject editable client plan/owner assertions and have no legacy `linkedImeis` fallback.

## Product-wide audit and disposition

| Existing feature/path | Decision in this release |
| --- | --- |
| SOS/fall detection, initial WhatsApp/push, calling, map access | Retain deterministic services; do not wait for AI |
| Photo orientation and description | Keep the two-stage validated pipeline; meter both generations through the common client |
| Old direct Claude assistant | Replace its separate five-round loop with a compatibility adapter to the common evidence service |
| WhatsApp tool assistant | Keep existing intent/tool validation, confirmations and deterministic answer safeguards; meter every round and sum all usage; shared wearer budget/allowance |
| Provider health checks | Configuration checks only; no paid probe generation |
| Legacy context relevance model | Keep observe-only behaviour; common transport and a bounded shared background budget |
| Défi RSS / official context | Reuse the existing ingestion/deduplication/source pipeline; do not introduce another paid extraction loop |
| Legacy rules called `intelligence` | When the new experience is enabled, stop publishing movement/geofence/battery predictions; preserve the independent offline-alert rule |
| Old Home AI/Today panels | Replaced by the common overview when enabled; flag-off compatibility retained |
| Voice monitoring | Removed from AI context actions and advertised tool options; the existing server rejection remains |
| Family voice messages | Playback and notifications remain native communication features; no automatic transcription or ambient listening |
| Voice medication reminders | Keep user-recorded audio and proven reminder commands; no model call needed to play/schedule a recording; no inference of adherence |
| Home Wi-Fi, safe zones, location selection | Keep deterministic source/freshness policy; AI cannot override it |
| Journey, wellness, activity and routine patterns | Preserve working data services; future derived summaries require permission, history coverage and explicit validation |
| Cost dashboard | Correct obsolete AI/model and one-minute reporting planning assumptions; mixed-model ledger is the operational AI accounting source |
| Diagnostic photo scripts | Explicit operator-run probes also use the common budget; no hidden unmetered API route |

The source tree still contains flag-off compatibility logic and established WhatsApp tool workflows. They are not claimed to be entirely deleted. Remove compatibility code only after the enabled experience has passed rollout acceptance.

## Costs

Pilot operating ceilings are Rs50 for Family and Rs100 for Care per paid wearer per Mauritius calendar month. This is an internal AI operating budget, not the subscription price or a promise about the complete hosting bill. Family members share it. Routine work may consume up to 70%; photo/incident work can use the remaining capacity. The fleet ceiling is Rs15,000/month; background work has its own Rs1,000 ceiling and still shares the fleet limit.

App and WhatsApp model questions share 50 Family / 100 Care new question jobs per month. A job can have at most three provider attempts; actual daily attempts are capped at 40 per wearer. Cached answers and deterministic lookups do not consume model-question jobs. Failed or uncertain billed attempts remain counted. There are no automatic generation retries or model escalations.

Every generation has bounded text, input tokens, output tokens and supported image count/size. Unknown model prices and optional pricing modifiers fail closed. Provider token counting precedes reservation; the reservation includes 20% + 256 input-token headroom and the full output allowance. Reported usage reconciles the reservation exactly once. If usage exceeds an estimate, the ledger records the excess and future calls see it. Therefore these are conservative application controls, not an absolute guarantee of the provider's invoice ceiling. Provider-side spend caps and invoice reconciliation remain necessary operational controls.

Pricing is versioned in code. At the fixed planning conversion of Rs50/USD, 300 calls of 2,000 input + 300 output tokens would cost approximately Rs52.50 on Haiku 4.5 or Rs14.25 on Gemini 3.1 Flash-Lite. This excludes images, retries, context, database, notifications, taxes and hosting; it is a scenario, not measured Guardian usage. The lower-price provider is available behind the adapter but has not been qualified against a live Guardian evaluation set.

Sources checked for this implementation: [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing), [Google pricing](https://ai.google.dev/gemini-api/docs/pricing), [Anthropic token counting](https://platform.claude.com/docs/en/build-with-claude/token-counting), [Gemini token counting](https://ai.google.dev/api/tokens), [Gemini thought signatures](https://ai.google.dev/gemini-api/docs/thought-signatures).

## Next stages and release gates

1. **This PR:** shared budgets/access/usage, recorded Today and incident views, constrained Ask, compatibility cleanup, synthetic tests and builds.
2. **Pilot qualification:** deploy backend-only rules and TTL policy, select one priced model, run a bounded labelled evaluation set, verify real app access/revocation and provider usage, then enable the screens. A successful software test is not a qualified model or a device acceptance result.
3. **Routine learning:** build daily derived features from authorised history; require 2–4 weeks of usable coverage, distinguish missing observations from behaviour changes, and test false-positive rates before exposing deviations. No LLM per location packet.
4. **Useful summaries:** consent-aware journey, activity, wellness and medication-schedule summaries; weekly reports reuse the same derived facts. No diagnosis, adherence inference or claim of current safety.
5. **External context:** deduplicate each source event once, deterministic geography/freshness first, shared extraction only where useful; app-first, preference-controlled insights. Same-town news is not proof a wearer is affected.
6. **Optional voice assistance:** explicit transcription/translation only if justified by user need, consent and separate measured economics. No ambient listening.

AI Insight notifications remain separate from authoritative Guardian Alerts. This release sends no new AI-generated notification and changes no watch cadence, capture policy or emergency command.

Operational configuration, rollback and validation: [Guardian Intelligence service](../services/guardian-intelligence.md).
