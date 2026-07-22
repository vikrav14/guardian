import { useCallback, useEffect, useState } from 'react';
import {
  fetchCostEstimate,
  fetchCostSensitivity,
  fetchMetrics,
  mur,
  type ApiMonitoringRow,
  type CostEstimate,
  type CostSensitivity,
} from '../api';

function MetricCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="metric-card">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      {hint ? <div className="metric-hint">{hint}</div> : null}
    </div>
  );
}

export default function OperationsTab({ onError }: { onError: (msg: string | null) => void }) {
  const [metrics, setMetrics] = useState<any>(null);
  const [cost, setCost] = useState<CostEstimate | null>(null);
  const [sensitivity, setSensitivity] = useState<CostSensitivity | null>(null);

  const [users, setUsers] = useState(500);
  const [gpsIntervalSec, setGpsIntervalSec] = useState(60);
  const [whatsappPct, setWhatsappPct] = useState(15);
  const [historyOn, setHistoryOn] = useState(false);
  const [journeyCompression, setJourneyCompression] = useState(true);
  const [aiNarrationOn, setAiNarrationOn] = useState(true);

  const loadMetrics = useCallback(async () => {
    try {
      onError(null);
      setMetrics(await fetchMetrics());
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to load metrics');
    }
  }, [onError]);

  const loadCost = useCallback(async () => {
    try {
      const params = { users, gpsIntervalSec, historyOn, journeyCompression, whatsappPct, aiNarrationOn };
      const [estimate, sens] = await Promise.all([
        fetchCostEstimate(params),
        fetchCostSensitivity(params),
      ]);
      setCost(estimate);
      setSensitivity(sens);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to load cost estimate');
    }
  }, [users, gpsIntervalSec, historyOn, journeyCompression, whatsappPct, aiNarrationOn, onError]);

  useEffect(() => {
    loadMetrics();
    const id = setInterval(loadMetrics, 15_000);
    return () => clearInterval(id);
  }, [loadMetrics]);

  useEffect(() => {
    loadCost();
  }, [loadCost]);

  const c = metrics?.counters || {};
  const apiRows: ApiMonitoringRow[] = metrics?.apiMonitoring || [];

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>Live operations</h2>
          <span className="muted">
            Updated {metrics?.updatedAt ? new Date(metrics.updatedAt).toLocaleTimeString() : '—'}
          </span>
        </div>
        <div className="metric-grid">
          <MetricCard label="TCP sessions" value={c.tcpConnections ?? 0} hint="Active gateway sockets" />
          <MetricCard label="Devices online (TCP)" value={c.devicesOnlineTcp ?? 0} />
          <MetricCard label="Devices online (Firestore)" value={c.devicesOnline ?? 0} />
          <MetricCard label="Alerts today" value={c.alertsCreated ?? 0} />
          <MetricCard label="Firestore writes" value={c.firestoreWrites ?? 0} />
          <MetricCard label="Write-gate persisted" value={c.writeGatePersisted ?? 0} />
          <MetricCard label="WhatsApp inbound" value={c.whatsappInbound ?? 0} />
          <MetricCard label="Assistant requests" value={c.assistantRequests ?? 0} />
          <MetricCard
            label="Est. cost today"
            value={mur(metrics?.costEstimateTodayMur?.totalMur)}
            hint="From gateway counters + cost engine"
          />
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>What-if simulator</h2>
          <span className="muted">Monthly projection + delta vs baseline</span>
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
            WhatsApp adoption %: <strong>{whatsappPct}</strong>
            <input type="range" min={0} max={100} step={5} value={whatsappPct} onChange={(e) => setWhatsappPct(Number(e.target.value))} />
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={historyOn} onChange={(e) => setHistoryOn(e.target.checked)} />
            Raw location history (WRITE_LOCATION_HISTORY)
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={journeyCompression} onChange={(e) => setJourneyCompression(e.target.checked)} />
            Journey compression
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
        {sensitivity ? (
          <div className="whatif-table-wrap">
            <h3>Scenario deltas vs baseline ({mur(sensitivity.baseline.totalMur)}/mo)</h3>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Scenario</th>
                  <th>Total/mo</th>
                  <th>Delta</th>
                </tr>
              </thead>
              <tbody>
                {sensitivity.scenarios.map((s: CostSensitivity['scenarios'][number]) => (
                  <tr key={s.key}>
                    <td>{s.label}</td>
                    <td>{mur(s.totalMur)}</td>
                    <td className={s.deltaMur <= 0 ? 'delta-good' : 'delta-bad'}>
                      {s.deltaMur >= 0 ? '+' : ''}{mur(s.deltaMur)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>API monitoring</h2>
          <span className="muted">Requests + estimated MUR cost today</span>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Service</th>
              <th>Requests</th>
              <th>Cost today</th>
            </tr>
          </thead>
          <tbody>
            {apiRows.map((row) => (
              <tr key={row.service}>
                <td>{row.service}</td>
                <td>{row.requests.toLocaleString()}</td>
                <td>{mur(row.costMur)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
