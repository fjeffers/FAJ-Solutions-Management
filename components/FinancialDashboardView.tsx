'use client';
import { useMemo, useState } from 'react';
import { Download, TrendingUp } from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import { fmtMoney } from '@/lib/utils';
import type { EnrichedWorkOrder } from '@/lib/types';
import { exportFinancialSummaryCSV } from '@/lib/export';
import { mileageAcrossWOs } from '@/lib/mileage';

const PIE_COLORS = ['#0D7377', '#C9A961', '#4338ca', '#b45309', '#047857', '#b91c1c', '#6b7280'];

function monthKey(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const [y, m] = dateStr.split('T')[0].split('-');
  if (!y || !m) return null;
  return `${y}-${m}`;
}

function monthLabel(key: string): string {
  const [y, m] = key.split('-');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

export default function FinancialDashboardView({ workOrders }: { workOrders: EnrichedWorkOrder[] }) {
  const [months, setMonths] = useState(12);

  const monthly = useMemo(() => {
    const map = new Map<string, { committed: number; paid: number; outstanding: number; jobCount: number }>();
    for (const w of workOrders) {
      const key = monthKey(w.start_date) ?? monthKey(w.created_at);
      if (!key) continue;
      const row = map.get(key) ?? { committed: 0, paid: 0, outstanding: 0, jobCount: 0 };
      row.committed += w.payout_total;
      row.paid += w.paid;
      row.outstanding += w.remaining;
      row.jobCount += 1;
      map.set(key, row);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-months)
      .map(([key, v]) => ({ key, month: monthLabel(key), ...v }));
  }, [workOrders, months]);

  const byContractor = useMemo(() => {
    const map = new Map<string, { committed: number; paid: number; outstanding: number; jobCount: number }>();
    for (const w of workOrders) {
      const name = w.contractor_name || 'Unassigned';
      const row = map.get(name) ?? { committed: 0, paid: 0, outstanding: 0, jobCount: 0 };
      row.committed += w.payout_total;
      row.paid += w.paid;
      row.outstanding += w.remaining;
      row.jobCount += 1;
      map.set(name, row);
    }
    return Array.from(map.entries())
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.committed - a.committed)
      .slice(0, 12);
  }, [workOrders]);

  const bySource = useMemo(() => {
    const map = new Map<string, number>();
    for (const w of workOrders) {
      const src = w.source_platform || 'Internal';
      map.set(src, (map.get(src) ?? 0) + Number(w.total_amount));
    }
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [workOrders]);

  const totals = useMemo(() => {
    const revenue = workOrders.reduce((s, w) => s + Number(w.total_amount), 0);
    const committed = workOrders.reduce((s, w) => s + w.payout_total, 0);
    const paid = workOrders.reduce((s, w) => s + w.paid, 0);
    return { revenue, committed, paid, outstanding: committed - paid, profit: revenue - committed };
  }, [workOrders]);

  const mileage = useMemo(() => mileageAcrossWOs(workOrders), [workOrders]);

  return (
    <div className="view-inner" style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ marginBottom: 28, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="display" style={{ fontSize: 11, color: 'var(--teal)', letterSpacing: 3, marginBottom: 6 }}>FINANCIALS</div>
          <h1 className="serif" style={{ fontSize: 36, fontWeight: 600, margin: 0, lineHeight: 1 }}>Financial Dashboard</h1>
          <p style={{ margin: '6px 0 0', color: '#666', fontSize: 14 }}>Committed, paid, and outstanding payables over time</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            value={months}
            onChange={(e) => setMonths(Number(e.target.value))}
            style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 12, fontFamily: 'Lato, sans-serif' }}
          >
            <option value={6}>Last 6 months</option>
            <option value={12}>Last 12 months</option>
            <option value={24}>Last 24 months</option>
          </select>
          <button
            className="btn btn-ghost"
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', fontSize: 12 }}
            onClick={() => exportFinancialSummaryCSV(monthly, byContractor)}
          >
            <Download size={13} /> Export CSV
          </button>
        </div>
      </div>

      {/* KPI tiles */}
      <div className="kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 28 }}>
        {[
          { label: 'Revenue (Billed to Clients)', value: fmtMoney(totals.revenue), color: 'var(--teal)', sub: null },
          { label: 'Tech Payouts (incl. mileage)', value: fmtMoney(totals.committed), color: '#4338ca', sub: `${fmtMoney(totals.paid)} paid · ${fmtMoney(totals.outstanding)} still owed` },
          {
            label: 'Your Profit',
            value: fmtMoney(totals.profit),
            color: totals.profit >= 0 ? '#047857' : '#b91c1c',
            sub: totals.revenue > 0 ? `${Math.round((totals.profit / totals.revenue) * 100)}% margin` : null,
          },
          {
            label: 'Mileage Logged',
            value: `${mileage.miles.toLocaleString()} mi`,
            color: '#b45309',
            sub: mileage.miles > 0 ? `${fmtMoney(mileage.amount)} reimbursement value` : 'Log miles in a WO’s Closeout tab',
          },
        ].map((kpi) => (
          <div key={kpi.label} className="glass card card-kpi">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <div className="stat-label">{kpi.label}</div>
              <TrendingUp size={20} color={kpi.color} />
            </div>
            <div className="stat-value" style={{ color: kpi.color }}>{kpi.value}</div>
            {kpi.sub && <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>{kpi.sub}</div>}
          </div>
        ))}
      </div>

      {/* Monthly chart */}
      <div className="glass card" style={{ marginBottom: 20 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16 }}>Monthly Committed vs. Paid</div>
        {monthly.length === 0 ? (
          <div style={{ color: '#aaa', fontSize: 13, textAlign: 'center', padding: '40px 0' }}>No dated work orders yet</div>
        ) : (
          <div style={{ width: '100%', height: 300 }}>
            <ResponsiveContainer>
              <BarChart data={monthly}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v) => fmtMoney(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="paid" name="Paid" fill="#047857" radius={[4, 4, 0, 0]} />
                <Bar dataKey="outstanding" name="Outstanding" fill="#b45309" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 20, marginBottom: 20 }}>
        {/* Per-contractor table */}
        <div className="glass card">
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16 }}>Top Contractors by Committed Amount</div>
          {byContractor.length === 0 ? (
            <div style={{ color: '#aaa', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>No work orders yet</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <th style={{ textAlign: 'left', padding: '8px 6px', color: '#888', fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>Contractor</th>
                  <th style={{ textAlign: 'right', padding: '8px 6px', color: '#888', fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>Jobs</th>
                  <th style={{ textAlign: 'right', padding: '8px 6px', color: '#888', fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>Committed</th>
                  <th style={{ textAlign: 'right', padding: '8px 6px', color: '#888', fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {byContractor.map((c) => (
                  <tr key={c.name} style={{ borderBottom: '1px solid #f8f8f8' }}>
                    <td style={{ padding: '9px 6px', fontWeight: 600 }}>{c.name}</td>
                    <td style={{ padding: '9px 6px', textAlign: 'right', color: '#888' }}>{c.jobCount}</td>
                    <td style={{ padding: '9px 6px', textAlign: 'right' }}>{fmtMoney(c.committed)}</td>
                    <td style={{ padding: '9px 6px', textAlign: 'right', color: c.outstanding > 0 ? '#b45309' : '#aaa' }}>{fmtMoney(c.outstanding)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Source breakdown pie */}
        <div className="glass card">
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16 }}>By Source</div>
          {bySource.length === 0 ? (
            <div style={{ color: '#aaa', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>No data yet</div>
          ) : (
            <div style={{ width: '100%', height: 260 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={bySource} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={(d) => d.name}>
                    {bySource.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v) => fmtMoney(Number(v))} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
