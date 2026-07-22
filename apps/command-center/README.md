# Guardian Mission Control

Internal SaaS-style ops platform for Guardian fleet, cloud cost, finance, growth planning, and AI observability.

## Why this app exists (separate from `apps/mobile`)

| Choice | Rationale |
|--------|-----------|
| **Location:** `apps/command-center/` | Isolated from the family-facing Flutter app — different audience, release cadence, and auth. |
| **Stack:** Vite + React (not Flutter web) | Ops dashboards need fast iteration, rich chart libraries (Recharts), and no mobile UI baggage. |
| **Backend:** `gateway/` extensions | Metrics are collected where packets, alerts, and assistant calls already happen. Cost logic stays server-side in `gateway/src/cost-engine/`. |
| **Data:** Firestore `ops/metrics/today` + `ops/metrics/daily/{date}` | Dashboard reads pre-aggregated docs; gateway flushes every 60s when Firestore is enabled. |

## Access URLs

| Environment | URL |
|-------------|-----|
| **Local dev (UI)** | http://localhost:5173 |
| **Local dev (API)** | http://localhost:9001/ops/metrics |
| **Production (target)** | https://command.guardian.mu |

## How to log in

Mission Control supports two auth paths:

### Option A — Firebase Auth (recommended)

1. Use a Google or email/password account on the **guardian-fbadd** Firebase project.
2. Your account must either:
   - Have custom claim `admin: true` (set via Firebase Admin SDK), **or**
   - Appear in gateway `ADMIN_EMAILS` (default: `vikrav14@gmail.com`).
3. Click **Continue with Google** or sign in with email on the login page.
4. The UI sends `Authorization: Bearer <Firebase ID token>` to `/ops/*`.

Grant admin claim:

```js
await admin.auth().setCustomUserClaims(uid, { admin: true });
```

### Option B — Dev API key (local fallback)

1. Optionally set `ADMIN_API_KEY` in `gateway/.env`.
2. On the login page, paste the same value under **Dev admin API key** and click **Enter with API key**.
3. Leave blank if the gateway has no key and `NODE_ENV` is not `production` — ops routes are open in dev.

**Production security:** If `NODE_ENV=production` and neither Firebase Admin nor `ADMIN_API_KEY` is configured, `/ops/*` returns 503.

## Run locally

```bash
# Terminal 1 — gateway
cd gateway
cp .env.example .env   # set FIRESTORE_DISABLED=false + credentials for fleet/metrics flush
npm start

# Terminal 2 — Command Center UI
cd apps/command-center
npm install
npm run dev
```

Open http://localhost:5173. Vite proxies `/ops/*` to port 9001.

## Test each tab locally

| Tab | What to verify | API |
|-----|----------------|-----|
| **Operations** | Live counters refresh every 15s; cost sliders update monthly projection; what-if table shows Rs/month deltas; API monitoring table lists services | `GET /ops/metrics`, `GET /ops/cost-estimate?sensitivity=true` |
| **Finance** | Adjust device/subscription sales sliders; burn rate bar vs budget; pie chart of cloud breakdown | `GET /ops/finance?devicesSoldMonth=8&subscriptionsSoldMonth=25` |
| **Fleet** | Total/online/offline devices, avg battery, GPS quality (needs Firestore + devices) | `GET /ops/fleet` |
| **Growth** | Sliders update break-even users, revenue, cloud cost, gross margin, net profit | `GET /ops/growth?users=500&salePrice=2500&subscription=1500` |
| **AI** | Request count, latency, tokens, cost; rule-based recommendations; recent decisions after `/dev/chat` | `GET /ops/ai-stats` |

Quick API smoke test (dev, no key):

```bash
curl http://localhost:9001/ops/metrics
curl "http://localhost:9001/ops/cost-estimate?users=500&sensitivity=true"
curl http://localhost:9001/ops/finance
curl http://localhost:9001/ops/fleet
curl "http://localhost:9001/ops/growth?users=500"
curl http://localhost:9001/ops/ai-stats
```

Trigger AI telemetry:

```bash
curl -X POST http://localhost:9001/dev/chat -H "Content-Type: application/json" -d "{\"text\":\"Battery?\"}"
```

## New endpoints (Phase 2 + 3)

| Endpoint | Description |
|----------|-------------|
| `GET /ops/metrics` | Live counters + today's cost + API monitoring rows |
| `GET /ops/cost-estimate` | Monthly projection; add `&sensitivity=true` for what-if deltas |
| `GET /ops/finance` | Revenue, gross margin, burn rate, cost breakdown |
| `GET /ops/fleet` | Device fleet aggregates (Firestore + TCP) |
| `GET /ops/growth` | Business projection (`users`, `growthRate`, `churn`, `salePrice`, `subscription`, etc.) |
| `GET /ops/ai-stats` | AI requests, tokens, latency, recommendations, recent decisions |

All `/ops/*` routes use the same auth as Phase 1.

## Pricing assumptions

Edit `gateway/src/cost-engine/pricing.js`:

- Device sale: Rs 2500
- Annual subscription: Rs 1500
- Cloud rates: Firestore, Maps, WhatsApp, Claude, hosting

Optional Firestore overrides: `ops/finance/config/assumptions`.

## Deploy

See Phase 1 notes above for Firebase Hosting + gateway env vars. Set `VITE_GATEWAY_URL` at build time for production API URL.

## Phase roadmap

| Phase | Scope |
|-------|--------|
| **1** | Cost engine, ops metrics, Operations tab + cost sliders |
| **2 (built)** | Finance, Fleet, Growth, Firebase Auth, what-if simulator, API monitoring |
| **3 (built)** | AI telemetry, AI dashboard, rule-based recommendations |

## Not built

- Payment processor / real revenue
- BigQuery billing import
- Full Datadog-style APM
