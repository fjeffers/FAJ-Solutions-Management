'use client';
import { shown } from '@/lib/screen-parts';
import { dashRows, designNow, type DashBlock } from '@/lib/screen-design';
import { useMemo, type ReactNode } from 'react';
import { TrendingUp, Clock, CheckCircle, AlertCircle, Briefcase, CreditCard, StickyNote, ArrowRight } from 'lucide-react';
import { fmtMoney, fmtDate } from '@/lib/utils';
import type { EnrichedWorkOrder, Payment, WorkOrderStatus } from '@/lib/types';

const WO_STATUS_COLORS: Record<WorkOrderStatus, { bg: string; color: string }> = {
  'Open':        { bg: 'rgba(14,27,46,0.12)', color: '#0E1B2E' },
  'Assigned':    { bg: 'rgba(245,158,11,0.15)', color: '#b45309' },
  'In Progress': { bg: 'rgba(249,115,22,0.15)', color: '#c2410c' },
  'Work Done':   { bg: 'rgba(99,102,241,0.15)', color: '#4338ca' },
  'Approved':    { bg: 'rgba(16,185,129,0.15)', color: '#047857' },
  'Paid':        { bg: 'rgba(5,150,105,0.2)',   color: '#065f46' },
};

type Stats = { total: number; paid: number; remaining: number; paidCount: number; partialCount: number; pendingCount: number; jobCount: number };

export const NOTE_STYLE: Record<string, { bg: string; edge: string }> = {
  plain: { bg: '#ffffff', edge: '#d8dde5' },
  gold: { bg: '#FBF5E6', edge: '#C9A24B' },
  blue: { bg: '#EEF4FC', edge: '#1565C0' },
  green: { bg: '#ECF7EF', edge: '#2E7D32' },
  red: { bg: '#FDEEEE', edge: '#C62828' },
};

export default function DashboardView({ stats, workOrders, payments, onView, attention, screenName }: {
  stats: Stats; workOrders: EnrichedWorkOrder[]; payments: Payment[]; onView: (v: string) => void;
  /** "Needs your attention" — built by the owner app, placed here like any other block. */
  attention?: ReactNode;
  /** A screen's name in Fred's menu, for shortcut buttons. */
  screenName?: (view: string) => string;
}) {
  const recentPayments = [...payments].slice(0, 5);
  // Closed jobs are done with. They used to stay in Outstanding Jobs forever,
  // because nothing here looked at archived_at — so closing a job changed
  // nothing on the dashboard and it read as though the close hadn't saved.
  const liveJobs = useMemo(() => workOrders.filter((w) => !w.archived_at), [workOrders]);
  const urgentJobs = liveJobs.filter((w) => w.payment_status !== 'paid').slice(0, 5);
  // The same rule the Work Orders board uses for its tab counts, so the two
  // screens cannot disagree about how many jobs are outstanding.
  const liveCounts = useMemo(() => ({
    paid:    liveJobs.filter((w) => w.payment_status === 'paid').length,
    partial: liveJobs.filter((w) => w.payment_status === 'partial').length,
    pending: liveJobs.filter((w) => w.payment_status === 'pending').length,
  }), [liveJobs]);
  // Progress = how much of what techs are owed has been paid out
  const payoutTotal = stats.paid + stats.remaining;
  const pct = payoutTotal > 0 ? Math.round((stats.paid / payoutTotal) * 100) : 0;

  const block = (b: DashBlock): ReactNode => {
    if (b.kind === 'note') {
      const c = NOTE_STYLE[b.color] ?? NOTE_STYLE.plain;
      return (
        <div className="card" style={{ background: c.bg, borderLeft: `4px solid ${c.edge}` }}>
          <div style={{ fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8, marginBottom: b.text ? 8 : 0 }}>
            <StickyNote size={15} color={c.edge} /> {b.title || 'Note'}
          </div>
          {b.text && <div style={{ fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{b.text}</div>}
        </div>
      );
    }
    if (b.kind === 'links') {
      return (
        <div className="glass card">
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>{b.title || 'Shortcuts'}</div>
          {b.views.length === 0
            ? <div style={{ color: '#aaa', fontSize: 13 }}>Pick screens for this block in Settings → Screen designer.</div>
            : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {b.views.map((v) => (
                  <button key={v} className="btn btn-ghost" style={{ padding: '8px 12px', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={() => onView(v)}>
                    {screenName ? screenName(v) : v} <ArrowRight size={14} />
                  </button>
                ))}
              </div>
            )}
        </div>
      );
    }
    switch (b.key) {
      case 'dash.attention': return attention;
      case 'dash.kpis': return (
      <div className="kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
        {[
          { label: 'Billed to Clients', value: fmtMoney(stats.total), icon: <Briefcase size={20} color="var(--teal)" />, color: 'var(--teal)' },
          { label: 'Paid to Techs', value: fmtMoney(stats.paid), icon: <CheckCircle size={20} color="#047857" />, color: '#047857' },
          { label: 'Owed to Techs', value: fmtMoney(stats.remaining), icon: <AlertCircle size={20} color="#b45309" />, color: '#b45309' },
          { label: 'Techs Paid', value: `${pct}%`, icon: <TrendingUp size={20} color="var(--gold)" />, color: 'var(--gold)' },
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
      );
      case 'dash.status': return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        {[
          { label: 'Paid Jobs', count: liveCounts.paid, color: '#047857', bg: 'rgba(16,185,129,0.1)' },
          { label: 'Partial', count: liveCounts.partial, color: '#b45309', bg: 'rgba(245,158,11,0.1)' },
          { label: 'Pending', count: liveCounts.pending, color: '#b91c1c', bg: 'rgba(239,68,68,0.1)' },
        ].map((s) => (
          <div key={s.label} style={{ background: s.bg, borderRadius: 12, padding: '16px 20px', textAlign: 'center' }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: s.color, fontFamily: "'Playfair Display', serif" }}>{s.count}</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: s.color, letterSpacing: 1, textTransform: 'uppercase', marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>
      );
      case 'dash.outstanding': return (
        <div className="glass card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}><Clock size={15} color="var(--teal)" /> Outstanding Jobs</div>
            <button className="btn btn-ghost" style={{ padding: '6px 12px', fontSize: 11 }} onClick={() => onView('workorders')}>View All</button>
          </div>
          {urgentJobs.length === 0 ? <div style={{ color: '#aaa', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>All jobs paid!</div> : (
            urgentJobs.map((j) => (
              <div key={j.id} className="row-hover" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f5f5f5' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--teal)' }}>WO#{j.wo_number}</span>
                    {(() => { const sc = WO_STATUS_COLORS[j.wo_status] ?? WO_STATUS_COLORS['Open']; return (
                      <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: sc.bg, color: sc.color }}>{j.wo_status}</span>
                    ); })()}
                  </div>
                  <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{j.contractor_name}{j.title ? ` · ${j.title}` : ''}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{fmtMoney(j.remaining)}</div>
                  <span className={`chip chip-${j.payment_status}`} style={{ fontSize: 10, marginTop: 3 }}>{j.payment_status}</span>
                </div>
              </div>
            ))
          )}
        </div>
      );
      case 'dash.payments': return (
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
      );
      default: return null;
    }
  };


  return (
    <div className="view-inner" style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ marginBottom: 28 }}>
        <div className="display" style={{ fontSize: 11, color: 'var(--teal)', letterSpacing: 3, marginBottom: 6 }}>OVERVIEW</div>
        <h1 className="serif" style={{ fontSize: 36, fontWeight: 600, margin: 0, lineHeight: 1 }}>Dashboard</h1>
        <p style={{ margin: '6px 0 0', color: '#666', fontSize: 14 }}>Your business at a glance</p>
      </div>

      {/* Arranged in Settings -> Screen designer (lib/screen-design.ts); parts
          switched off in "What each screen shows" are left out. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {dashRows(designNow().dash.filter((b) => b.kind !== 'part' || (shown(b.key) && (b.key !== 'dash.attention' || attention)))).map((row) => (
          <div key={row.map((b) => b.key).join('|')} className={row.length === 2 ? 'dash-row dash-row-2' : 'dash-row'}
            style={{ display: 'grid', gridTemplateColumns: row.length === 2 ? '1fr 1fr' : '1fr', gap: 20, alignItems: 'start' }}>
            {row.map((b) => <div key={b.key} style={{ minWidth: 0 }}>{block(b)}</div>)}
          </div>
        ))}
      </div>
    </div>
  );
}
