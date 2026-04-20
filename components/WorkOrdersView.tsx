'use client';
import { useState } from 'react';
import { Plus, Search, Edit2, Trash2, MapPin, Clock } from 'lucide-react';
import { fmtMoney, fmtDate, sortByWO } from '@/lib/utils';
import type { EnrichedWorkOrder, WorkOrderStatus } from '@/lib/types';
import { WO_STATUSES } from '@/lib/types';

type Stats = {
  total: number; paid: number; remaining: number;
  paidCount: number; partialCount: number; pendingCount: number; jobCount: number;
};

const WO_STATUS_COLORS: Record<WorkOrderStatus, { bg: string; color: string }> = {
  'Open':        { bg: 'rgba(13,115,119,0.12)', color: '#0D7377' },
  'Assigned':    { bg: 'rgba(245,158,11,0.15)', color: '#b45309' },
  'In Progress': { bg: 'rgba(249,115,22,0.15)', color: '#c2410c' },
  'Work Done':   { bg: 'rgba(99,102,241,0.15)', color: '#4338ca' },
  'Approved':    { bg: 'rgba(16,185,129,0.15)', color: '#047857' },
  'Paid':        { bg: 'rgba(5,150,105,0.2)',   color: '#065f46' },
};

const PAY_CHIP: Record<string, { bg: string; color: string }> = {
  paid:    { bg: 'rgba(16,185,129,0.15)', color: '#047857' },
  partial: { bg: 'rgba(245,158,11,0.15)', color: '#b45309' },
  pending: { bg: 'rgba(239,68,68,0.12)',  color: '#b91c1c' },
};

export default function WorkOrdersView({
  workOrders, stats, onAdd, onEdit, onDelete,
}: {
  workOrders: EnrichedWorkOrder[];
  stats: Stats;
  onAdd: () => void;
  onEdit: (w: EnrichedWorkOrder) => void;
  onDelete: (id: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [woStatusFilter, setWoStatusFilter] = useState<'all' | WorkOrderStatus>('all');

  const sorted = sortByWO(workOrders);
  const filtered = sorted.filter((w) => {
    const q = search.toLowerCase();
    const matchSearch =
      w.wo_number.includes(search) ||
      w.contractor_name.toLowerCase().includes(q) ||
      (w.title ?? '').toLowerCase().includes(q) ||
      (w.description ?? '').toLowerCase().includes(q) ||
      (w.service_type ?? '').toLowerCase().includes(q) ||
      (w.site_city ?? '').toLowerCase().includes(q);
    const matchStatus = woStatusFilter === 'all' || w.wo_status === woStatusFilter;
    return matchSearch && matchStatus;
  });

  // Count per wo_status for the chips
  const statusCounts = WO_STATUSES.reduce((acc, s) => {
    acc[s] = workOrders.filter((w) => w.wo_status === s).length;
    return acc;
  }, {} as Record<WorkOrderStatus, number>);

  return (
    <div>
      {/* ── Header ── */}
      <div style={{ marginBottom: 28 }}>
        <div className="display" style={{ fontSize: 11, color: 'var(--teal)', letterSpacing: 3, marginBottom: 6 }}>WORK ORDERS</div>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 className="serif" style={{ fontSize: 36, fontWeight: 600, margin: 0, lineHeight: 1 }}>Work Orders</h1>
            <p style={{ margin: '6px 0 0', color: '#666', fontSize: 14 }}>
              {stats.jobCount} jobs ·{' '}
              <span style={{ color: '#b91c1c', fontWeight: 600 }}>{fmtMoney(stats.remaining)} outstanding</span>
              {' · '}
              <span style={{ color: '#047857', fontWeight: 600 }}>{fmtMoney(stats.paid)} collected</span>
            </p>
          </div>
          <button className="btn btn-primary" onClick={onAdd}><Plus size={14} /> New Work Order</button>
        </div>
      </div>

      {/* ── Search + Status Filter ── */}
      <div className="glass card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: '1 1 220px' }}>
            <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#aaa' }} />
            <input
              className="input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by contractor, title, service type, city…"
              style={{ paddingLeft: 36 }}
            />
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button
              className={`filter-chip ${woStatusFilter === 'all' ? 'active' : ''}`}
              onClick={() => setWoStatusFilter('all')}
            >
              All <span style={{ opacity: 0.6, fontSize: 10, marginLeft: 4 }}>{workOrders.length}</span>
            </button>
            {WO_STATUSES.map((s) => (
              <button
                key={s}
                className={`filter-chip ${woStatusFilter === s ? 'active' : ''}`}
                onClick={() => setWoStatusFilter(s)}
              >
                {s}
                {statusCounts[s] > 0 && (
                  <span style={{ opacity: 0.6, fontSize: 10, marginLeft: 4 }}>{statusCounts[s]}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Table ── */}
      <div className="glass card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="print-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'rgba(13,115,119,0.05)', borderBottom: '1px solid rgba(13,115,119,0.1)' }}>
              <th style={thStyle('left')}>WO #</th>
              <th style={thStyle('left')}>Contractor</th>
              <th style={thStyle('left')}>Service</th>
              <th style={thStyle('left')}>Site</th>
              <th style={thStyle('left')}>Schedule</th>
              <th style={thStyle('right')}>Amount</th>
              <th style={thStyle('left')}>WO Status</th>
              <th style={thStyle('right')}>Paid</th>
              <th style={thStyle('right')}>Remaining</th>
              <th style={thStyle('left')}>Pay</th>
              <th style={thStyle('left')}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((w) => {
              const sc = WO_STATUS_COLORS[w.wo_status] ?? WO_STATUS_COLORS['Open'];
              const pc = PAY_CHIP[w.payment_status] ?? PAY_CHIP['pending'];
              const siteLabel = [w.site_city, w.site_state].filter(Boolean).join(', ');
              const hasSchedule = w.start_date || w.start_time;
              return (
                <tr key={w.id} className="row-hover" style={{ borderBottom: '1px solid #f5f5f5' }}>

                  {/* WO # */}
                  <td style={{ padding: '14px 16px', fontWeight: 700, color: 'var(--teal)', whiteSpace: 'nowrap' }}>
                    {w.wo_number}
                  </td>

                  {/* Contractor + title */}
                  <td style={{ padding: '14px 16px' }}>
                    <div style={{ fontWeight: 600 }}>{w.contractor_name}</div>
                    {w.title && <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{w.title}</div>}
                  </td>

                  {/* Service type */}
                  <td style={{ padding: '14px 16px', color: '#555', fontSize: 12 }}>
                    {w.service_type || <span style={{ color: '#ccc' }}>—</span>}
                  </td>

                  {/* Site */}
                  <td style={{ padding: '14px 16px' }}>
                    {siteLabel ? (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#555' }}>
                        <MapPin size={11} color="#aaa" />
                        {siteLabel}
                      </span>
                    ) : <span style={{ color: '#ccc' }}>—</span>}
                  </td>

                  {/* Schedule */}
                  <td style={{ padding: '14px 16px' }}>
                    {hasSchedule ? (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#555' }}>
                        <Clock size={11} color="#aaa" />
                        {fmtDate(w.start_date)}
                        {w.start_time && <span style={{ color: '#aaa' }}>{' '}{w.start_time}</span>}
                      </span>
                    ) : <span style={{ color: '#ccc' }}>—</span>}
                  </td>

                  {/* Amount */}
                  <td style={{ padding: '14px 16px', textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {fmtMoney(Number(w.total_amount))}
                    <div style={{ fontSize: 10, color: '#aaa', fontWeight: 400, marginTop: 2 }}>{w.pay_type}</div>
                  </td>

                  {/* WO Status badge */}
                  <td style={{ padding: '14px 16px' }}>
                    <span style={{
                      display: 'inline-block', padding: '3px 10px', borderRadius: 20,
                      fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap',
                      background: sc.bg, color: sc.color,
                    }}>
                      {w.wo_status}
                    </span>
                  </td>

                  {/* Paid */}
                  <td style={{ padding: '14px 16px', textAlign: 'right', color: '#047857', fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {fmtMoney(w.paid)}
                  </td>

                  {/* Remaining */}
                  <td style={{ padding: '14px 16px', textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap',
                    color: w.remaining > 0 ? '#b91c1c' : '#047857' }}>
                    {fmtMoney(w.remaining)}
                  </td>

                  {/* Payment status chip */}
                  <td style={{ padding: '14px 16px' }}>
                    <span style={{
                      display: 'inline-block', padding: '3px 10px', borderRadius: 20,
                      fontSize: 10, fontWeight: 700,
                      background: pc.bg, color: pc.color,
                    }}>
                      {w.payment_status}
                    </span>
                  </td>

                  {/* Actions */}
                  <td style={{ padding: '14px 16px' }}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="icon-btn" onClick={() => onEdit(w)} title="Edit"><Edit2 size={14} /></button>
                      <button className="icon-btn" style={{ color: '#b91c1c' }} title="Delete"
                        onClick={() => { if (confirm(`Delete WO ${w.wo_number}?`)) onDelete(w.id); }}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={11} style={{ textAlign: 'center', padding: '40px', color: '#aaa' }}>
                  {search || woStatusFilter !== 'all' ? 'No work orders match your filter.' : 'No work orders yet — create your first one!'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function thStyle(align: 'left' | 'right' = 'left'): React.CSSProperties {
  return {
    padding: '12px 16px',
    textAlign: align,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 1,
    color: '#888',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
  };
}
