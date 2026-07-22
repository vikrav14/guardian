import { useEffect, useState } from 'react';
import { fetchFleet, type FleetSnapshot } from '../api';

function MetricCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="metric-card">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      {hint ? <div className="metric-hint">{hint}</div> : null}
    </div>
  );
}

export default function FleetTab({ onError }: { onError: (msg: string | null) => void }) {
  const [fleet, setFleet] = useState<FleetSnapshot | null>(null);

  useEffect(() => {
    const load = () =>
      fetchFleet()
        .then(setFleet)
        .catch((e) => onError(e instanceof Error ? e.message : 'Failed to load fleet'));
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [onError]);

  const f = fleet?.fleet;

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Device fleet</h2>
        <span className="muted">
          Source: {f?.source || '—'} · Updated{' '}
          {fleet?.updatedAt ? new Date(fleet.updatedAt).toLocaleTimeString() : '—'}
        </span>
      </div>
      <div className="metric-grid">
        <MetricCard label="Total devices" value={f?.totalDevices ?? 0} />
        <MetricCard label="Online (Firestore)" value={f?.devicesOnline ?? 0} />
        <MetricCard label="Offline" value={f?.devicesOffline ?? 0} />
        <MetricCard label="Online (TCP now)" value={f?.devicesOnlineTcp ?? 0} hint="Live gateway sessions" />
        <MetricCard
          label="Avg battery"
          value={f?.avgBatteryPercent != null ? `${f.avgBatteryPercent}%` : '—'}
          hint={f?.batterySampleSize ? `${f.batterySampleSize} devices sampled` : undefined}
        />
        <MetricCard
          label="GPS quality"
          value={f?.gpsQualityPct != null ? `${f.gpsQualityPct}%` : '—'}
          hint={f?.gpsSampleSize ? `${f.gpsSampleSize} with accuracy source` : undefined}
        />
      </div>
    </section>
  );
}
