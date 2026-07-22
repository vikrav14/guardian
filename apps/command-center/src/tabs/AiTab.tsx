import { useEffect, useState } from 'react';
import { fetchAiStats, mur, type AiStats } from '../api';

function MetricCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="metric-card">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      {hint ? <div className="metric-hint">{hint}</div> : null}
    </div>
  );
}

export default function AiTab({ onError }: { onError: (msg: string | null) => void }) {
  const [stats, setStats] = useState<AiStats | null>(null);

  useEffect(() => {
    const load = () =>
      fetchAiStats()
        .then(setStats)
        .catch((e) => onError(e instanceof Error ? e.message : 'Failed to load AI stats'));
    load();
    const id = setInterval(load, 20_000);
    return () => clearInterval(id);
  }, [onError]);

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>AI dashboard</h2>
          <span className="muted">Today&apos;s assistant telemetry</span>
        </div>
        <div className="metric-grid">
          <MetricCard label="AI requests today" value={stats?.aiRequests ?? 0} />
          <MetricCard label="Avg response time" value={stats?.avgLatencyMs ? `${stats.avgLatencyMs} ms` : '—'} />
          <MetricCard
            label="Tokens in / out"
            value={`${stats?.aiTokensIn ?? 0} / ${stats?.aiTokensOut ?? 0}`}
          />
          <MetricCard label="Est. cost today" value={mur(stats?.estimatedCostTodayMur)} />
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Quality counters</h2>
          <span className="muted">Manual placeholders until feedback loop</span>
        </div>
        <div className="metric-grid">
          <MetricCard label="Correct" value={stats?.quality.correct ?? 0} />
          <MetricCard label="Manual overrides" value={stats?.quality.manualOverrides ?? 0} />
          <MetricCard label="False positives" value={stats?.quality.falsePositives ?? 0} />
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>AI recommendations</h2>
          <span className="muted">Rule-based cost sensitivity (not LLM)</span>
        </div>
        <ul className="recommendations">
          {(stats?.recommendations || []).map((rec) => (
            <li key={rec.id} className={`rec rec-${rec.impact}`}>
              <strong>{rec.title}</strong>
              <span className="rec-savings">Save {mur(rec.savingsMur)}/mo</span>
              <p>{rec.description}</p>
            </li>
          ))}
        </ul>
      </section>

      {stats?.recentDecisions?.length ? (
        <section className="panel">
          <div className="panel-head">
            <h2>Recent decisions</h2>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Tools</th>
                <th>Tokens</th>
                <th>Latency</th>
              </tr>
            </thead>
            <tbody>
              {stats.recentDecisions.map((d) => (
                <tr key={d.id}>
                  <td>{new Date(d.timestamp).toLocaleTimeString()}</td>
                  <td>{d.toolsUsed.join(', ') || '—'}</td>
                  <td>{d.tokensIn}/{d.tokensOut}</td>
                  <td>{d.latencyMs} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </>
  );
}
