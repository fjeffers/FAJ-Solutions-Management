'use client';
import { useMemo } from 'react';
import { TrendingUp, Clock, CheckCircle, AlertCircle, Briefcase, CreditCard } from 'lucide-react';
import { fmtMoney, fmtDate } from '@/lib/utils';
import type { EnrichedWorkOrder, Payment } from '@/lib/types';

type Stats = { total: number; paid: number; remaining: number; paidCount: number; partialCount: number; pendingCount: number; jobCount: number };

export default function DashboardView({ stats, workOrders, payments, onView }: { stats: Stats; workOrders: EnrichedWorkOrder[]; payments: Payment[]; onView: (v: string) => void }) {
  const recentPayments = [...payments].slice(0, 5);
  const urgentJobs = workOrders.filter((w) => w.status !== 'paid').slice(0, 5);
  const pct = stats.total > 0 ? Math.round((stats.paid / stats.total) * 100) : 0;

  return (
    <div>
      <div style={{ marginBottom: 28 }}>
        <div className="display" style={{ fontSize: 11, color: 'var(--teal)', letterSpacing: 3, marginBottom: 6 }}>OVERVIEW</div>
        <h1 className="serif" style={{ fontSize: 36, fontWeight: 600, margin: 0, lineHeight: 1 }}>Dashboard</h1>
        <p style={{ margin: '6px 0 0', color: '#666', fontSize: 14 }}>Your business at a glance</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 28 }}>
        {[
          { label: 'Total Billed', value: fmtMoney(stats.total), icon: <Briefcase size={20} color="var(--teal)" />, color: 'var(--teal)' },
          { label: 'Total Paid', value: fmtMoney(stats.paid), icon: <CheckCircle size={20} color="#047857" />, color: '#047857' },
          { label: 'Outstanding', value: fmtMoney(stats.remaining), icon: <AlertCircle size={20} color="#b45309" />, color: '#b45309' },
          { label: 'Collection Rate', value: `${pct}%`, icon: <TrendingUp size={20} color="var(--gold)" />, color: 'var(--gold)' },
        ].map((kpi) => (
          <div key={kpi.label} className="glass card card-kpi">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <div className="stat-label">{kpi.label}</div>
              {kpi.icon}
            </div>
            <div className="stat-value" style={{ color: kpi.color }}>{kpi.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 28 }}>
        {[
          { label: 'Paid Jobs', count: stats.paidCount, color: '#047857', bg: 'rgba(16,185,129,0.1)' },
          { label: 'Partial', count: stats.partialCount, color: '#b45309', bg: 'rgba(245,158,11,0.1)' },
          { label: 'Pending', count: stats.pendingCount, color: '#b91c1c', bg: 'rgba(239,68,68,0.1)' },
        ].map((s) => (
          <div key={s.label} style={{ background: s.bg, borderRadius: 12, padding: '16px 20px', textAlign: 'center' }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: s.color, fontFamily: "'Cormorant Garamond', serif" }}>{s.count}</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: s.color, letterSpacing: 1, textTransform: 'uppercase', marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div className="glass card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}><Clock size={15} color="var(--teal)" /> Outstanding Jobs</div>
            <button className="btn btn-ghost" style={{ padding: '6px 12px', fontSize: 11 }} onClick={() => onView('workorders')}>View All</button>
          </div>
          {urgentJobs.length === 0 ? <div style={{ color: '#aaa', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>All jobs paid!</div> : (
            urgentJobs.map((j) => (
              <div key={j.id} className="row-hover" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f5f5f5' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--teal)' }}>WO#{j.wo_number}</div>
                  <div style={{ fontSize: 12, color: '#888' }}>{j.contractor_name}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{fmtMoney(j.remaining)}</div>
                  <span className={`chip chip-${j.status}`} style={{ fontSize: 10 }}>{j.status}</span>
                </div>
              </div>
            ))
          )}
        </div>
        <div className="glass card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}><CreditCard size={15} color="var(--teal)" /> Recent Payments</div>
            <button className="btn btn-ghost" style={{ padding: '6px 12px', fontSize: 11 }} onClick={() => onView('payments')}>View All</button>
          </div>
          {recentPayments.length === 0 ? <div style={{ color: '#aaa', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>No payments yet</div> : (
            recentPayments.map((p) => (
              <div key={p.id} className="row-hover" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f5f5f5' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{p.contractor_name}</div>
                  <div style={{ fontSize: 12, color: '#888' }}>{fmtDate(p.payment_date)} · {p.method}</div>
                </div>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#047857' }}>{fmtMoney(Number(p.amount))}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
