import { useCallback, useEffect, useState } from 'react';
import { fetchGrowth, mur, type GrowthProjection } from '../api';

export default function GrowthTab({ onError }: { onError: (msg: string | null) => void }) {
  const [projection, setProjection] = useState<GrowthProjection | null>(null);
  const [users, setUsers] = useState(500);
  const [growthRate, setGrowthRate] = useState(5);
  const [churn, setChurn] = useState(2);
  const [deviceCost, setDeviceCost] = useState(1800);
  const [salePrice, setSalePrice] = useState(2500);
  const [subscription, setSubscription] = useState(1500);
  const [supportCost, setSupportCost] = useState(45);

  const load = useCallback(async () => {
    try {
      onError(null);
      const data = await fetchGrowth({
        users,
        growthRate,
        churn,
        deviceCost,
        salePrice,
        subscription,
        supportCost,
        gpsIntervalSec: 60,
        historyOn: false,
        journeyCompression: true,
        whatsappPct: 15,
        aiNarrationOn: true,
      });
      setProjection(data);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to load growth projection');
    }
  }, [users, growthRate, churn, deviceCost, salePrice, subscription, supportCost, onError]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>Growth planner</h2>
          <span className="muted">Break-even and profit projection</span>
        </div>
        <div className="sliders">
          <label>
            Users: <strong>{users}</strong>
            <input type="range" min={10} max={5000} step={10} value={users} onChange={(e) => setUsers(Number(e.target.value))} />
          </label>
          <label>
            Growth rate %/mo: <strong>{growthRate}</strong>
            <input type="range" min={0} max={20} step={1} value={growthRate} onChange={(e) => setGrowthRate(Number(e.target.value))} />
          </label>
          <label>
            Churn %/mo: <strong>{churn}</strong>
            <input type="range" min={0} max={15} step={1} value={churn} onChange={(e) => setChurn(Number(e.target.value))} />
          </label>
          <label>
            Device COGS: <strong>{mur(deviceCost)}</strong>
            <input type="range" min={1000} max={4000} step={100} value={deviceCost} onChange={(e) => setDeviceCost(Number(e.target.value))} />
          </label>
          <label>
            Device sale price: <strong>{mur(salePrice)}</strong>
            <input type="range" min={1500} max={6000} step={100} value={salePrice} onChange={(e) => setSalePrice(Number(e.target.value))} />
          </label>
          <label>
            Annual subscription: <strong>{mur(subscription)}</strong>
            <input type="range" min={500} max={5000} step={100} value={subscription} onChange={(e) => setSubscription(Number(e.target.value))} />
          </label>
          <label>
            Support/marketing per user: <strong>{mur(supportCost)}</strong>
            <input type="range" min={0} max={200} step={5} value={supportCost} onChange={(e) => setSupportCost(Number(e.target.value))} />
          </label>
        </div>
      </section>

      {projection ? (
        <section className="panel">
          <div className="metric-grid">
            <div className="metric-card highlight">
              <div className="metric-label">Break-even users</div>
              <div className="metric-value">
                {projection.breakEvenUsers == null ? 'N/A' : projection.breakEvenUsers.toLocaleString()}
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Revenue / month</div>
              <div className="metric-value">{mur(projection.revenue.totalMur)}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Cloud costs</div>
              <div className="metric-value">{mur(projection.costs.cloudMur)}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Gross margin</div>
              <div className="metric-value">{mur(projection.grossMarginMur)}</div>
              <div className="metric-hint">{projection.grossMarginPct}%</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Net profit est.</div>
              <div className="metric-value">{mur(projection.netProfitMur)}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Users in 12 mo</div>
              <div className="metric-value">{projection.projectedUsers12Mo.toLocaleString()}</div>
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
}
