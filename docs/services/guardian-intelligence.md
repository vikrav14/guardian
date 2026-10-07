# Guardian Intelligence service

## Scope and status

PR #140 implements the first release documented in [the product contract](../ai/GUARDIAN_AI.md). New app surfaces and HTTP routes are opt-in. The common provider budget boundary applies to all provider callers in this revision, including existing photo AI and WhatsApp. Do not deploy this revision assuming only the new screen flag changes behaviour.

The bounded synthetic live-model qualification passed on 7 October 2026. Physical-phone acceptance with managed family accounts and production activation remain pending. Watch alarms, new photographs and audio were not needed. See [acceptance cases, measured costs and the remaining gates](../ai/GUARDIAN_AI_ACCEPTANCE.md).

## WhatsApp navigation

Linked Family/Care numbers can send `hi`, `hello`, `help`, `menu` or `options`
to receive a native **Choose an option** list. Current managed-circle answer
paths support **Last known location** and **Watch battery**. **Open Guardian**
returns the configured app link for other shared features. Multiple wearers get
a paginated picker; row IDs do not contain raw watch IDs.

Opening/reopening a menu does not invoke AI or consume the answer allowance.
Selecting location/battery retains the existing allowance and permission checks.
Old cards are not authority: revoked/expired membership is checked on every tap.
Menus require a current inbound service window and a durable claim before
provider handoff. Ambiguous sends are retained and never retried automatically.
API acceptance is not proof of WhatsApp delivery or display.

This requires **Family → WhatsApp → Link my WhatsApp**. Receiving existing
emergency alerts does not establish interactive chat identity. Navigation does
not enroll numbers or change alert recipients, and is independent of the
Guardian Intelligence rollout flag.

On 7 October, only the four deterministic menu/transport files were applied to
the existing local gateway after a verified idle check. Gateway health, both
listeners, unchanged environment/ngrok and preservation of other local changes
were verified. The larger AI foundation remains unactivated. Live menu display
is pending the operator linking their WhatsApp number and sending `menu`.
The combined gateway suite passed 1,793 tests, including nine menu regressions.

## Configuration

| Setting | Default / meaning |
| --- | --- |
| `GUARDIAN_INTELLIGENCE_ENABLED` | `false`; set server environment and Flutter dart-define to `true` for the new experience |
| `GUARDIAN_GATEWAY_URL` | Existing authenticated HTTPS gateway base URL in the Flutter build |
| `LLM_PROVIDER` | Existing provider selection; choose explicitly for a pilot |
| `ANTHROPIC_MODEL` | Defaults to `claude-haiku-4-5-20251001` |
| `GEMINI_MODEL` | Defaults to `gemini-3.1-flash-lite`; adapter implemented, live qualification pending |
| `INCIDENT_PHOTO_AI_MODEL` | Existing explicit photo model; keep the qualified model, do not silently downgrade quality |
| `AI_BUDGET_MUR_PER_USD` | Fixed planning conversion, default 50; not a live exchange rate |
| `AI_FAMILY_MONTHLY_MUR` / `AI_CARE_MONTHLY_MUR` | Defaults 50 / 100 per paid wearer, all family members combined |
| `AI_FLEET_MONTHLY_MUR` / `AI_BACKGROUND_MONTHLY_MUR` | Defaults 15000 / 1000; background also counts toward fleet |

Priced models: Haiku 4.5 ($1/$5 per million input/output tokens), Sonnet 4.6 ($3/$15), Gemini 3.1 Flash-Lite ($0.25/$1.50). Model IDs outside the allowlist stop before generation. Changing pricing/model qualification needs a code review and new version. Existing unsupported model environment values must be resolved before deployment, not silently substituted.

Budget reservations are durable Firestore transactions. The service bucket key includes the canonical service owner and wearer, so family members cannot gain another allowance by using a different account. Daily/monthly boundaries use Mauritius time. Operational thresholds can be reduced to zero to block new spend; the recorded overview remains available while new routes are enabled. An unavailable budget database blocks generation.

## API and evidence

- `GET /app/intelligence?imei=...` — recorded overview, no model.
- `GET /app/intelligence?imei=...&incidentId=...` — recorded incident brief, no model.
- `POST /app/intelligence/ask?imei=...` with `{ "question": "...", "incidentId": null }` — direct fact lookup or one constrained evidence-selection generation.

Firebase ID tokens are verified with revocation checks. Only backend-managed Family/Care service access is eligible. Location/alert/photo permissions independently control evidence. The handler rejects caller-supplied owners/plans and limits requests to 20/minute per identity per process; the durable provider ledger supplies cross-process spending limits. Body and question lengths are bounded.

Responses are `no-store, private`. Answers expire within 60 seconds (earlier when media expires), clear on background/access/wearer changes, and are reauthorised after generation. The cache stores only evidence IDs. Permission, owner, plan, evidence, question, model configuration, prompt version and day are part of cache identity. Deletion and fresh evidence invalidate old selections. A changed answer is withheld without an automatic new model call.

The model sees only the supplied evidence packet. It cannot access tools, fetch additional history, issue watch commands, create alerts, schedule medication or send messages. Simple English fact questions bypass it; complex/comparative questions use selection, which may explicitly report insufficient information. The first release is not a general-history chatbot.

## Operations

From `gateway/`, `node scripts/inspect-ai-budget.js [YYYY-MM]` reads the fleet ledger and a bounded, labelled sample grouped by feature/model. It does not start workers or call a model. It reports conservative reserved/charged USD and the planning MUR equivalent, including incomplete/over-reservation attempt counts. It is not an invoice reconciliation tool.

The synthetic photo contract checker now needs Firestore budget access as well as its explicit `--run`; it starts no watchers, reads no photo and makes no watch request. Its diagnostic job has a background budget. Existing explicit original-photo inspection requires its normal consent/access checks and records each provider generation in the ledger. Test transports are injected only by test fixtures; the production default always uses the metered client.

Deploy the backend-only rules before enabling the feature. Configure Firestore TTL on `expiresAt` for `aiSelections` (1 day), `aiBudgetDays` (35 days), and `aiAttempts` (95 days). TTL is delayed cleanup, not authorisation. Monthly buckets are retained for operations; they contain hashed scope, counters and pricing metadata, not user text or media. No new composite index is required by these queries. Existing alerts indexes are reused.

Rollout order: complete the isolated qualification and app replay review; verify rules/TTL and ledger credentials; deploy gateway idle using the established procedure; build app with matching flag; verify one managed wearer and restricted family member; compare the bounded pilot's budget report with provider usage. Keep the new experience off until these gates pass. The synthetic qualification does not restart or configure live processes.

Rollback: disable the UI/API flag to restore the previous app surfaces and rules presentation; no watch settings change. That flag does **not** remove the shared cost boundary. If reverting the gateway revision, retain the ledger/rules rather than deleting billing evidence. Initial alerts and calling remain independent of AI.

## Validation

- Gateway unit/regression suite plus new price, reservation, monthly allowance, duplicate/restart, ambiguous completion, both photo stages, Gemini thought-signature/usage, permission, media-deletion and HTTP tests.
- Real Firestore emulator transactions for competing budget reservations; client read/list/write/delete denial for all four AI collections.
- Flutter authenticated GET/POST, no automatic POST retry, narrow/large-text layout, expiry, revoked access, changing wearer and backgrounding tests; full app analysis/test suite and release Web compile.
- The separate local review entry point replays saved synthetic provider results through the real answer widget, without Firebase startup, credentials or model calls. Native phone and real-family acceptance remain separate steps.

See the PR for the executed test counts and any build limitations. Do not interpret unit tests as a successful live provider response, a reliable prediction or a completed emergency.

Executed locally after integrating main including PR #153 on 7 October 2026:
1,832 gateway tests; 831 full Flutter tests; 115 Firestore emulator tests; clean
Flutter analysis; separate review Web release build. Earlier enabled Web release
and Android debug builds used a placeholder gateway URL and were not installed
or published. Final Haiku qualification: 21/21 fixed synthetic scenarios, 13
generations, zero additional generations on repeats, Rs0.4702 at configured rates.
All four paid evaluation runs total Rs1.6466. Earlier unavailable answers were
incorrectly scored as negative-case passes; the acceptance record preserves the
corrected results and the structured-output fix. These small text cases do not
measure photo processing, WhatsApp tool loops or production workload economics.
Managed-family pilot acceptance remains open.
