import { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { fetchFinance, mur, type FinanceSnapshot } from '../api';

const PIE_COLORS = ['#1f6feb', '#3fb950', '#d29922', '#a371f7', '#f85149', '#8fa3b8'];
const PROFIT_COLOR = '#3fb950';
const COST_COLOR = '#f85149';
const REVENUE_COLOR = '#1f6feb';

const CHART_TOOLTIP = {
  contentStyle: {
    background: '#121821',
    border: '1px solid #243246',
    borderRadius: 8,
    color: '#e8eef5',
  },
  itemStyle: { color: '#e8eef5' },
  labelStyle: { color: '#8fa3b8' },
};

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
  const profitVsCost = data?.profitVsCost;

  const barData = profitVsCost
    ? [
        { name: 'Revenue', value: profitVsCost.revenueMur, fill: REVENUE_COLOR },
        { name: 'Cloud cost', value: profitVsCost.costMur, fill: COST_COLOR },
        {
          name: 'Gross profit',
          value: profitVsCost.profitMur,
          fill: profitVsCost.profitMur >= 0 ? PROFIT_COLOR : COST_COLOR,
        },
      ]
    : [];

  const donutData =
    profitVsCost && profitVsCost.revenueMur > 0
      ? [
          {
            name: 'Cloud cost',
            value: Math.min(profitVsCost.costMur, profitVsCost.revenueMur),
            fill: COST_COLOR,
          },
          {
            name: 'Gross profit',
            value: Math.max(0, profitVsCost.profitMur),
            fill: PROFIT_COLOR,
          },
        ].filter((d) => d.value > 0)
      : [];

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

      {profitVsCost ? (
        <section className="panel">
          <div className="panel-head">
            <h2>Profit vs cost</h2>
            <span className="muted">Monthly revenue split · cloud cost vs gross profit</span>
          </div>
          <div className="metric-grid profit-summary">
            <div className="metric-card highlight">
              <div className="metric-label">Revenue</div>
              <div className="metric-value">{mur(profitVsCost.revenueMur)}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Cloud cost</div>
              <div className="metric-value">{mur(profitVsCost.costMur)}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Gross profit</div>
              <div className={`metric-value ${profitVsCost.profitMur < 0 ? 'delta-bad' : 'delta-good'}`}>
                {mur(profitVsCost.profitMur)}
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Gross margin</div>
              <div className={`metric-value ${profitVsCost.marginPct < 0 ? 'delta-bad' : ''}`}>
                {profitVsCost.marginPct}%
              </div>
            </div>
          </div>
          <div className="profit-charts">
            <div className="chart-wrap">
              <h3 className="chart-title">Amount comparison (MUR)</h3>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={barData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <XAxis dataKey="name" tick={{ fill: '#8fa3b8', fontSize: 12 }} axisLine={{ stroke: '#243246' }} tickLine={{ stroke: '#243246' }} />
                  <YAxis tick={{ fill: '#8fa3b8', fontSize: 12 }} axisLine={{ stroke: '#243246' }} tickLine={{ stroke: '#243246' }} tickFormatter={(v) => `Rs ${v}`} />
                  <Tooltip {...CHART_TOOLTIP} formatter={(v: number) => mur(v)} />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                    {barData.map((entry) => (
                      <Cell key={entry.name} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            {donutData.length ? (
              <div className="chart-wrap">
                <h3 className="chart-title">Revenue share</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={donutData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={90}
                      label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                    >
                      {donutData.map((entry) => (
                        <Cell key={entry.name} fill={entry.fill} />
                      ))}
                    </Pie>
                    <Tooltip {...CHART_TOOLTIP} formatter={(v: number) => mur(v)} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="chart-wrap chart-empty">
                <h3 className="chart-title">Revenue share</h3>
                <p className="muted">Set device or subscription sales to compare profit vs cost.</p>
              </div>
            )}
          </div>
        </section>
      ) : null}

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
                <Tooltip {...CHART_TOOLTIP} formatter={(v: number) => mur(v)} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </section>
      ) : null}
    </>
  );
}
