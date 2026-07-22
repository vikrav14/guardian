import { useCallback, useEffect, useState } from 'react';
import {
  fetchCostEstimate,
  fetchMetrics,
  getAdminKey,
  setAdminKey,
  type CostEstimate,
} from './api';

type Tab = 'operations' | 'finance' | 'ai';

type Metrics = {
  updatedAt: string;
  counters: Record<string, number>;
  alertTypes: Record<string, number>;
  eventTypes: Record<string, number>;
  costEstimateTodayMur?: { totalMur: number; breakdown: Record<string, number> };
};

function mur(n: number | undefined) {
  if (n == null || Number.isNaN(n)) return '—';
  return `Rs ${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function MetricCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="metric-card">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      {hint ? <div className="metric-hint">{hint}</div> : null}
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>('operations');
  const [adminKey, setAdminKeyState] = useState(getAdminKey());
  const [loggedIn, setLoggedIn] = useState(!import.meta.env.PROD || !!getAdminKey());
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cost, setCost] = useState<CostEstimate | null>(null);

  const [users, setUsers] = useState(500);
  const [gpsIntervalSec, setGpsIntervalSec] = useState(60);
  const [whatsappPct, setWhatsappPct] = useState(15);
  const [historyOn, setHistoryOn] = useState(false);
  const [journeyCompression, setJourneyCompression] = useState(true);
  const [aiNarrationOn, setAiNarrationOn] = useState(true);

  const loadMetrics = useCallback(async () => {
    try {
      setError(null);
      const data = await fetchMetrics();
      setMetrics(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load metrics');
    }
  }, []);

  const loadCost = useCallback(async () => {
    try {
      const data = await fetchCostEstimate({
        users,
        gpsIntervalSec,
        historyOn,
        journeyCompression,
        whatsappPct,
        aiNarrationOn,
      });
      setCost(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load cost estimate');
    }
  }, [users, gpsIntervalSec, historyOn, journeyCompression, whatsappPct, aiNarrationOn]);

  useEffect(() => {
    if (!loggedIn) return;
    loadMetrics();
    const id = setInterval(loadMetrics, 15_000);
    return () => clearInterval(id);
  }, [loggedIn, loadMetrics]);

  useEffect(() => {
    if (!loggedIn || tab !== 'operations') return;
    loadCost();
  }, [loggedIn, tab, loadCost]);

  function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setAdminKey(adminKey);
    setLoggedIn(true);
  }

  if (!loggedIn) {
    return (
      <div className="login-shell">
        <form className="login-card" onSubmit={handleLogin}>
          <h1>Guardian Mission Control</h1>
          <p>Dev: leave blank if gateway has no ADMIN_API_KEY. Production requires your ops key.</p>
          <label>
            Admin API key
            <input
              type="password"
              value={adminKey}
              onChange={(e) => setAdminKeyState(e.target.value)}
              placeholder="X-Admin-Key value"
            />
          </label>
          <button type="submit">Enter</button>
        </form>
      </div>
    );
  }

  const c = metrics?.counters || {};

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>Guardian Mission Control</h1>
          <p className="subtitle">Real-time ops · cost modelling · AI observability</p>
        </div>
        <nav className="tabs">
          {(['operations', 'finance', 'ai'] as Tab[]).map((t) => (
            <button
              key={t}
              className={tab === t ? 'tab active' : 'tab'}
              onClick={() => setTab(t)}
              type="button"
            >
              {t === 'operations' ? 'Operations' : t === 'finance' ? 'Finance' : 'AI'}
            </button>
          ))}
        </nav>
      </header>

      {error ? <div className="banner error">{error}</div> : null}

      {tab === 'operations' ? (
        <>
          <section className="panel">
            <div className="panel-head">
              <h2>Live operations</h2>
              <span className="muted">Updated {metrics?.updatedAt ? new Date(metrics.updatedAt).toLocaleTimeString() : '—'}</span>
            </div>
            <div className="metric-grid">
              <MetricCard label="TCP sessions" value={c.tcpConnections ?? 0} hint="Active gateway sockets" />
              <MetricCard label="Devices online (TCP)" value={c.devicesOnlineTcp ?? 0} />
              <MetricCard label="Alerts today" value={c.alertsCreated ?? 0} />
              <MetricCard label="Firestore writes" value={c.firestoreWrites ?? 0} />
              <MetricCard label="Write-gate persisted" value={c.writeGatePersisted ?? 0} />
              <MetricCard label="Write-gate skipped" value={c.writeGateSkipped ?? 0} />
              <MetricCard label="WhatsApp inbound" value={c.whatsappInbound ?? 0} />
              <MetricCard label="Assistant requests" value={c.assistantRequests ?? 0} />
              <MetricCard label="Claude tokens in/out" value={`${c.assistantTokensIn ?? 0} / ${c.assistantTokensOut ?? 0}`} />
              <MetricCard
                label="Est. cost today"
                value={mur(metrics?.costEstimateTodayMur?.totalMur)}
                hint="From gateway counters + cost engine"
              />
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Cost simulator</h2>
              <span className="muted">Monthly projection (MUR)</span>
            </div>
            <div className="sliders">
              <label>
                Users: <strong>{users}</strong>
                <input type="range" min={10} max={5000} step={10} value={users} onChange={(e) => setUsers(Number(e.target.value))} />
              </label>
              <label>
                GPS interval (sec): <strong>{gpsIntervalSec}</strong>
                <input type="range" min={30} max={300} step={15} value={gpsIntervalSec} onChange={(e) => setGpsIntervalSec(Number(e.target.value))} />
              </label>
              <label>
                WhatsApp assistant adoption %: <strong>{whatsappPct}</strong>
                <input type="range" min={0} max={100} step={5} value={whatsappPct} onChange={(e) => setWhatsappPct(Number(e.target.value))} />
              </label>
              <label className="checkbox">
                <input type="checkbox" checked={historyOn} onChange={(e) => setHistoryOn(e.target.checked)} />
                Raw location history (WRITE_LOCATION_HISTORY)
              </label>
              <label className="checkbox">
                <input type="checkbox" checked={journeyCompression} onChange={(e) => setJourneyCompression(e.target.checked)} />
                Journey compression (default path)
              </label>
              <label className="checkbox">
                <input type="checkbox" checked={aiNarrationOn} onChange={(e) => setAiNarrationOn(e.target.checked)} />
                Claude AI narration
              </label>
            </div>
            {cost ? (
              <div className="cost-summary">
                <div className="cost-total">
                  <span>Projected monthly</span>
                  <strong>{mur(cost.totalMur)}</strong>
                  <span className="muted">{mur(cost.totalMurPerUser)} / user</span>
                </div>
                <ul className="breakdown">
                  {Object.entries(cost.breakdown).map(([k, v]) => (
                    <li key={k}>
                      <span>{k}</span>
                      <span>{mur(v)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        </>
      ) : null}

      {tab === 'finance' ? (
        <section className="panel placeholder">
          <h2>Finance dashboard</h2>
          <p>Phase 2 — revenue, subscriptions, device sales, gross margin, burn rate, growth planner.</p>
          <p className="muted">Pricing assumptions live in gateway/src/cost-engine/pricing.js (MUR).</p>
        </section>
      ) : null}

      {tab === 'ai' ? (
        <section className="panel placeholder">
          <h2>AI observability</h2>
          <p>Phase 2 — decision confidence, false positives, response times, token burn, recommendations.</p>
          <p className="muted">Assistant counters are already collected on the gateway.</p>
        </section>
      ) : null}
    </div>
  );
}
