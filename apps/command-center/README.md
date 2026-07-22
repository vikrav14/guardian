# Guardian Mission Control

Internal SaaS-style ops platform for Guardian fleet, cloud cost, and AI observability.

## Why this app exists (separate from `apps/mobile`)

| Choice | Rationale |
|--------|-----------|
| **Location:** `apps/command-center/` | Isolated from the family-facing Flutter app — different audience, release cadence, and auth. |
| **Stack:** Vite + React (not Flutter web) | Ops dashboards need fast iteration, rich chart libraries (Recharts/Visx in Phase 2), and no mobile UI baggage. Flutter remains the consumer product. |
| **Backend:** `gateway/` extensions | Metrics are collected where packets, alerts, and assistant calls already happen. Cost logic stays server-side in `gateway/src/cost-engine/`. |
| **Data:** Firestore `ops/metrics/today` + `ops/metrics/daily/{date}` | Dashboard reads pre-aggregated docs; gateway flushes every 60s when Firestore is enabled. |

## Access URLs

| Environment | URL |
|-------------|-----|
| **Local dev (UI)** | http://localhost:5173 |
| **Local dev (API)** | http://localhost:9001/ops/metrics |
| **Production (target)** | https://command.guardian.mu |

## Auth

**Phase 1 (now):** `ADMIN_API_KEY` on the gateway. Command Center stores the key in `localStorage` and sends `X-Admin-Key` on each request.

**Phase 2:** Firebase Auth on the Command Center site with custom claim `admin: true`, or email allowlist via `ADMIN_EMAILS` (default includes `vikrav14@gmail.com`). Grant admin claim with Firebase Admin SDK:

```js
await admin.auth().setCustomUserClaims(uid, { admin: true });
```

**Production security:** If `NODE_ENV=production` and `ADMIN_API_KEY` is unset, `/ops/*` returns 503.

## Run locally

```bash
# Terminal 1 — gateway (Firestore optional for metrics flush)
cd gateway
cp .env.example .env   # set FIRESTORE_DISABLED=false + credentials for Firestore flush
npm start

# Terminal 2 — Command Center UI
cd apps/command-center
npm install
npm run dev
```

Open http://localhost:5173. Vite proxies `/ops/*` to port 9001.

Optional: set `ADMIN_API_KEY` in `gateway/.env` and paste the same value in the login gate.

## Deploy

### 1. Gateway (ops API)

Host the existing Node gateway on Cloud Run, Fly.io, or a VPS with public HTTP on port 9001 (or reverse-proxy `/ops`).

Set env:

```
NODE_ENV=production
ADMIN_API_KEY=<long random secret>
FIRESTORE_DISABLED=false
```

### 2. Command Center (static UI)

**Option A — Firebase Hosting second site** (recommended with existing Firebase project):

Add to root `firebase.json`:

```json
{
  "hosting": [
    {
      "target": "mobile",
      "public": "apps/mobile/build/web",
      "ignore": ["firebase.json", "**/.*", "**/node_modules/**"]
    },
    {
      "target": "command",
      "public": "apps/command-center/dist",
      "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
      "rewrites": [{ "source": "**", "destination": "/index.html" }]
    }
  ]
}
```

```bash
cd apps/command-center && npm run build
firebase target:apply hosting command command-guardian
firebase deploy --only hosting:command
```

Point DNS `command.guardian.mu` CNAME to Firebase Hosting.

Set `VITE_GATEWAY_URL=https://api.guardian.mu` at build time so the UI calls the production gateway.

**Option B — Same origin:** Serve `dist/` behind nginx at `command.guardian.mu` and reverse-proxy `/ops` to the gateway.

## Firestore rules (Phase 2)

Add read rules for `ops/**` restricted to admin users. Gateway service account writes metrics via Admin SDK (bypasses rules).

## Phase roadmap

| Phase | Scope |
|-------|--------|
| **1 (built)** | Cost engine, ops metrics, `/ops/*` API, Operations tab + cost sliders, Finance/AI placeholders |
| **2** | Finance dashboard, Firebase Auth login, device fleet view, burn rate charts |
| **3** | AI observability, growth/what-if simulators, Datadog-level charts, BigQuery billing import |

## Not built yet

- Payment processor / real revenue
- BigQuery billing import
- Full Datadog-style charting
- API latency histograms
