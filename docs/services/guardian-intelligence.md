# Guardian Intelligence service

## Current scope - PR #140

The app provides read-only Today and incident briefs. **Ask Guardian is removed.**
WhatsApp uses deterministic menus only. Ordinary typed text reopens the menu;
there is no fallback to the old tool/LLM assistant, including for unlinked numbers
or when family sharing is disabled. Initial SOS/fall alerts and explicit responder
acknowledgements retain their existing paths.

This revision is prepared in PR #140, not deployed. The earlier three-option menu
was applied locally on 7 October; that does not mean this expanded menu is live.
The common provider budget boundary still affects existing photo/background AI
when this gateway revision is deployed, even with the new overview flag off.

## WhatsApp navigation

The main menu has nine categories, filtered by current per-wearer permissions:

| Category | Options |
| --- | --- |
| Today's overview | Recorded overview; local updates and weather in the app |
| Location & journeys | Last recorded location, Home evidence; journey history |
| Alerts & photos | Recent alerts; incidents/responses; eligible photos and AI details |
| Watch status | Last check-in, timestamped battery; watch settings |
| Medicine reminders | Standard and recorded-voice schedules in the app |
| Wellness | Readings/history, routine and movement reminders in the app |
| Call & voice messages | Explicit app calling; private voice conversation |
| Home & safe zones | Home evidence; saved places and enrolled Home Wi-Fi |
| Family & settings | Sharing/WhatsApp, account/preferences, help |

Multiple wearers get a paginated picker and Switch wearer. Every submenu has Back
to main menu. Result replies show a visible **Main menu** reply button; one tap
returns to the same wearer without opening a More options list. Multiple wearers
also get a visible **Switch wearer** button. Both button and list IDs resolve
through current authorisation, including existing v1 cards.
Titles are never interpreted as commands. Typed text is not parsed as a question;
the existing exact LINK and incident ACK protocols are the two explicit exceptions.

Navigation and app links use no model or answer allowance. Recorded reads retain
the shared monthly WhatsApp answer allowance; this is separate from AI spend.
All menus/replies require a recent inbound service window. Durable claims precede
handoff, and uncertain sends are not repeated. API acceptance is not delivery.

Each tap rechecks channel identity, membership, subscription and permissions.
The complete permission scope is checked again before sending an assembled
answer. Alerts-only access cannot expose battery, check-in or location facts.
Links contain an opaque wearer key and a fixed screen, never an IMEI, phone number
or authentication token. The authenticated app resolves that key against current
`GET /app/family` menuScreens and exact membership; it never substitutes another
wearer. Backgrounding, revocation and expiry discard the destination stack.
App links open existing features; they never initiate a call, capture, recording
or setting write. Photo consent, expiry and one-hour request rules still apply.

Interactive identity requires **Family > WhatsApp > Link my WhatsApp**. Emergency
alert recipients are not automatically enrolled as menu users. No templates,
contacts, watch settings or notification routing are changed by menu navigation.

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

- `GET /app/intelligence?imei=...`: recorded overview, no model.
- `GET /app/intelligence?imei=...&incidentId=...`: recorded incident brief, no model.
- `/app/intelligence/ask` and `/dev/chat`: **410 Gone**, including old clients.
- The Meta inbound handler always uses the deterministic family/menu handler.

Firebase tokens are verified with revocation checks. Only backend-managed current
Family/Care grants are eligible. The read endpoint rejects extra query fields,
including question, owner and plan, and has no provider dependency. Reads are
limited to 20/minute per identity per process. Responses are no-store/private;
evidence expires within 60 seconds or earlier when media expires. The Flutter
client exposes GET only, with no question composer, suggestion chips or POST API.

Location and watch status require location permission; alert and photo evidence
have separate permissions. Existing consent-aware photo observations stay labelled
unverified and are reused without another model call. No routine, wellness,
journey or medication-adherence inference is introduced by this menu change.

The old constrained question selector and synthetic qualification remain internal
regression/diagnostic code. No public app or WhatsApp path invokes them. Historical
paid qualification is retained as evidence, not as current menu acceptance.

## Operations

From `gateway/`, `node scripts/inspect-ai-budget.js [YYYY-MM]` reads the fleet ledger and a bounded, labelled sample grouped by feature/model. It does not start workers or call a model. It reports conservative reserved/charged USD and the planning MUR equivalent, including incomplete/over-reservation attempt counts. It is not an invoice reconciliation tool.

The synthetic photo contract checker now needs Firestore budget access as well as its explicit `--run`; it starts no watchers, reads no photo and makes no watch request. Its diagnostic job has a background budget. Existing explicit original-photo inspection requires its normal consent/access checks and records each provider generation in the ledger. Test transports are injected only by test fixtures; the production default always uses the metered client.

Deploy the backend-only rules before enabling the feature. Configure Firestore TTL on `expiresAt` for `aiSelections` (1 day), `aiBudgetDays` (35 days), and `aiAttempts` (95 days). TTL is delayed cleanup, not authorisation. Monthly buckets are retained for operations; they contain hashed scope, counters and pricing metadata, not user text or media. No new composite index is required by these queries. Existing alerts indexes are reused.

Rollout order: complete the isolated qualification and menu preview and read-only app review; verify rules/TTL and ledger credentials; deploy gateway idle using the established procedure; build app with matching flag; verify one managed wearer and restricted family member; compare the bounded pilot's budget report with provider usage. For an operator-authorized deployed pilot, keep remaining phone/WhatsApp and restricted-family acceptance explicit before merge. The synthetic qualification does not restart or configure live processes.

Rollback: disable the UI/API flag to restore the previous app surfaces and rules presentation; no watch settings change. That flag does **not** remove the shared cost boundary. If reverting the gateway revision, retain the ledger/rules rather than deleting billing evidence. Initial alerts and calling remain independent of AI.

## Validation and preview

Run `npm test` from gateway and `flutter analyze` / `flutter test` from apps/mobile.
Regression coverage includes old/forged cards, duplicate delivery, permission loss
during a read, multi-wearer pagination, channel identity, retired Ask routes, app
link parsing/resolution and read-only app lifecycle. The menu is deployed to the controlled pilot; signed-in phone/WhatsApp link
acceptance remains pending.

To build a synthetic preview using the real menu builders (no live records,
transport, provider or watch):

```powershell
node gateway/scripts/build-whatsapp-menu-review.js apps/mobile/build/intelligence-review/menu.html
```

The existing loopback review server can serve this as `/menu.html`. The prior
synthetic question replay is historical and no longer contains a composer.
See [the acceptance record](../ai/GUARDIAN_AI_ACCEPTANCE.md) for executed checks,
historical spend and remaining release gates. No live message or watch test is
required for software validation.

## Deployed pilot — 7 October 2026

The operator-authorized combined pilot was deployed at 22:47–22:50 Mauritius
time. Gateway and Web run the PR #140 menu-only experience; the matching Android
build (29856649) was installed on the test Samsung without removing app data.
Release `5e65276b-dcf1-47c9-b212-2bdc81b10484` uses PR base `3b9f237` plus the
coordinated incident-readings, launch/logo and photo best-view overlays. Those
overlays are separate work and are not claimed as part of this PR's code diff.

- Combined release: **1,873 gateway tests and 845 Flutter tests passed**, clean
  Flutter analysis, successful Web release and Android builds. The PR-only
  baseline below remains distinct from these combined counts.
- Backend budget rules match the source. TTL on `expiresAt` is ACTIVE for
  `aiSelections`, `aiBudgetDays` and `aiAttempts`. A temporary ledger-access probe
  was read and removed; the managed-owner overview left the ledger unchanged.
- Both local and public gateway health passed. The read-only overview requires
  sign-in (401 without credentials), while Ask and dev-chat return 410. Fresh
  identified watch telemetry arrived after the idle-checked restart; ngrok and
  both tunnel addresses were preserved. The runtime error log was empty at check.
- The public Web release marker and exact JavaScript bundle hash match the built
  artifact. Android's installed version was checked with the package manager.
- A separately authorized refresh of an existing saved photo exercised the shared
  budget: two completed Sonnet 4.6 calls, USD0.010452 / planning Rs0.5226, with no
  unconfirmed or over-reservation attempts. This is ledger usage, not an invoice.
  Original image/capture fields, incident, delivery and readings were preserved;
  no new photo or alarm was generated. This is not a new live capture acceptance.

PR #140 remains draft. Real WhatsApp menu delivery/display, signed-in destination
links on the phone, restricted/revoked-family access and phone lifecycle still
need controlled acceptance. Software tests cover these paths but do not replace
those observations. The saved-photo visual orientation check is also unconfirmed.
The existing incident-readings follow-up template is still pending approval, so
its separate delivery flag remains off.
