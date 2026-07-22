import { useEffect, useState } from 'react';
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { fetchFinance, mur, type FinanceSnapshot } from '../api';

const PIE_COLORS = ['#1f6feb', '#3fb950', '#d29922', '#a371f7', '#f85149', '#8fa3b8'];

export default function FinanceTab({ onError }: { onError: (msg: string | null) => void }) {
  const [data, setData] = useState<FinanceSnapshot | null>(null);
  const [devicesSoldMonth, setDevicesSoldMonth] = useState(8);
  const [subscriptionsSoldMonth, setSubscriptionsSoldMonth] = useState(25);
  const [budget, setBudget] = useState(15000);

  useEffect(() => {
    fetchFinance({
      users: 500,
      devicesSoldMonth,
      subscriptionsSoldMonth,
      budget,
    })
      .then(setData)
      .catch((e) => onError(e instanceof Error ? e.message : 'Failed to load finance'));
  }, [devicesSoldMonth, subscriptionsSoldMonth, budget, onError]);

  const pieData = data
    ? Object.entries(data.costBreakdown)
        .filter(([, v]) => v > 0)
        .map(([name, value]) => ({ name, value }))
    : [];

  const burnPct = data?.burnRate.usedPct ?? 0;

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>Finance dashboard</h2>
          <span className="muted">Manual revenue inputs · live cloud costs</span>
        </div>
        <div className="sliders">
          <label>
            Devices sold this month: <strong>{devicesSoldMonth}</strong>
            <input type="range" min={0} max={100} value={devicesSoldMonth} onChange={(e) => setDevicesSoldMonth(Number(e.target.value))} />
          </label>
          <label>
            New subscriptions this month: <strong>{subscriptionsSoldMonth}</strong>
            <input type="range" min={0} max={200} value={subscriptionsSoldMonth} onChange={(e) => setSubscriptionsSoldMonth(Number(e.target.value))} />
          </label>
          <label>
            Monthly cloud budget: <strong>{mur(budget)}</strong>
            <input type="range" min={5000} max={50000} step={500} value={budget} onChange={(e) => setBudget(Number(e.target.value))} />
          </label>
        </div>
        {data ? (
          <div className="metric-grid">
            <div className="metric-card">
              <div className="metric-label">Revenue today</div>
              <div className="metric-value">{mur(data.revenue.todayMur)}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Revenue this month</div>
              <div className="metric-value">{mur(data.revenue.monthMur)}</div>
              <div className="metric-hint">
                Device Rs {data.pricing.deviceSaleMur} · Sub Rs {data.pricing.subscriptionAnnualMur}/yr
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Cloud cost today</div>
              <div className="metric-value">{mur(data.cloud.todayMur)}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Projected cloud / month</div>
              <div className="metric-value">{mur(data.cloud.projectedMonthMur)}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Gross margin</div>
              <div className="metric-value">{mur(data.grossMargin.monthMur)}</div>
              <div className="metric-hint">{data.grossMargin.monthPct}% of revenue</div>
            </div>
          </div>
        ) : null}
      </section>

      {data ? (
        <section className="panel">
          <div className="panel-head">
            <h2>Burn rate</h2>
            <span className="muted">Budget vs used vs forecast</span>
          </div>
          <div className="burn-bar">
            <div className="burn-used" style={{ width: `${Math.min(100, burnPct)}%` }} />
          </div>
          <div className="burn-labels">
            <span>Budget {mur(data.burnRate.budgetMur)}</span>
            <span>Used {mur(data.burnRate.usedMur)} ({burnPct}%)</span>
            <span>Forecast {mur(data.burnRate.forecastMur)}</span>
          </div>
        </section>
      ) : null}

      {pieData.length ? (
        <section className="panel">
          <div className="panel-head">
            <h2>Cost breakdown</h2>
            <span className="muted">Projected monthly cloud spend</span>
          </div>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name, value }) => `${name}: ${mur(value)}`}>
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => mur(v)} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </section>
      ) : null}
    </>
  );
}
