'use client';
import { useState } from 'react';
import { Plus, Search, Edit2, Trash2, MapPin, Clock, Send, Wrench, Copy, DollarSign, CalendarDays } from 'lucide-react';
import { fmtMoney, fmtDate, sortByWO } from '@/lib/utils';
import type { EnrichedWorkOrder, WorkOrderStatus, Contractor } from '@/lib/types';
import { WO_STATUSES } from '@/lib/types';
import EmailModal, { type EmailPayload } from '@/components/EmailModal';

type Stats = {
  total: number; paid: number; remaining: number;
  paidCount: number; partialCount: number; pendingCount: number; jobCount: number;
};

const WO_STATUS_META: Record<WorkOrderStatus, { bg: string; color: string; accent: string }> = {
  'Open':        { bg: 'rgba(13,115,119,0.09)',  color: '#0D7377',  accent: '#0D7377' },
  'Assigned':    { bg: 'rgba(245,158,11,0.12)',  color: '#b45309',  accent: '#f59e0b' },
  'In Progress': { bg: 'rgba(249,115,22,0.12)',  color: '#c2410c',  accent: '#f97316' },
  'Work Done':   { bg: 'rgba(99,102,241,0.12)',  color: '#4338ca',  accent: '#6366f1' },
  'Approved':    { bg: 'rgba(16,185,129,0.12)',  color: '#047857',  accent: '#10b981' },
  'Paid':        { bg: 'rgba(5,150,105,0.15)',   color: '#065f46',  accent: '#059669' },
};

const PAY_META: Record<string, { bg: string; color: string }> = {
  paid:    { bg: 'rgba(16,185,129,0.12)', color: '#047857' },
  partial: { bg: 'rgba(245,158,11,0.12)', color: '#b45309' },
  pending: { bg: 'rgba(239,68,68,0.1)',   color: '#b91c1c' },
};

export default function WorkOrdersView({
  workOrders, stats, onAdd, onEdit, onDelete, onDuplicate, onPay, onSendPortal, contractors,
}: {
  workOrders: EnrichedWorkOrder[];
  stats: Stats;
  onAdd: () => void;
  onEdit: (w: EnrichedWorkOrder) => void;
  onDelete: (id: string) => void;
  onDuplicate: (w: EnrichedWorkOrder) => void;
  onPay: (w: EnrichedWorkOrder) => void;
  onSendPortal: (w: EnrichedWorkOrder) => Promise<void>;
  contractors: Contractor[];
}) {
  const [search, setSearch] = useState('');
  const [woStatusFilter, setWoStatusFilter] = useState<'all' | WorkOrderStatus>('all');
  const [emailPayload, setEmailPayload] = useState<EmailPayload | null>(null);

  const sorted = sortByWO(workOrders);
  const filtered = sorted.filter((w) => {
    const q = search.toLowerCase();
    const matchSearch =
      w.wo_number.includes(search) ||
      w.contractor_name.toLowerCase().includes(q) ||
      (w.title ?? '').toLowerCase().includes(q) ||
      (w.service_type ?? '').toLowerCase().includes(q) ||
      (w.site_city ?? '').toLowerCase().includes(q);
    const matchStatus = woStatusFilter === 'all' || w.wo_status === woStatusFilter;
    return matchSearch && matchStatus;
  });

  const statusCounts = WO_STATUSES.reduce((acc, s) => {
    acc[s] = workOrders.filter((w) => w.wo_status === s).length;
    return acc;
  }, {} as Record<WorkOrderStatus, number>);

  const openSendModal = (w: EnrichedWorkOrder) => {
    const contractor = contractors.find((c) => c.name === w.contractor_name);
    setEmailPayload({
      type: 'work_order',
      to: contractor?.email ?? '',
      subject: `Work Order #${w.wo_number}${w.title ? ` — ${w.title}` : ''}`,
      data: { workOrder: w },
    });
  };

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1200, margin: '0 auto' }}>
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

      {/* ── Search + Filter ── */}
      <div className="glass card" style={{ marginBottom: 20, padding: '14px 16px' }}>
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
            <button className={`filter-chip ${woStatusFilter === 'all' ? 'active' : ''}`} onClick={() => setWoStatusFilter('all')}>
              All <span style={{ opacity: 0.6, fontSize: 10, marginLeft: 4 }}>{workOrders.length}</span>
            </button>
            {WO_STATUSES.map((s) => (
              <button
                key={s}
                className={`filter-chip ${woStatusFilter === s ? 'active' : ''}`}
                onClick={() => setWoStatusFilter(s)}
              >
                {s}
                {statusCounts[s] > 0 && <span style={{ opacity: 0.6, fontSize: 10, marginLeft: 4 }}>{statusCounts[s]}</span>}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Cards ── */}
      {filtered.length === 0 ? (
        <div className="glass card" style={{ textAlign: 'center', padding: '56px 24px', color: '#aaa' }}>
          {search || woStatusFilter !== 'all'
            ? 'No work orders match your filter.'
            : 'No work orders yet — create your first one!'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {filtered.map((w) => <WOCard key={w.id} w={w} onEdit={onEdit} onDelete={onDelete} onSend={openSendModal} onDuplicate={onDuplicate} onPay={onPay} onSendPortal={onSendPortal} contractors={contractors} />)}
        </div>
      )}

      {emailPayload && <EmailModal payload={emailPayload} onClose={() => setEmailPayload(null)} />}
    </div>
  );
}

function WOCard({
  w,
  onEdit,
  onDelete,
  onSend,
  onDuplicate,
  onPay,
  onSendPortal,
  contractors,
}: {
  w: EnrichedWorkOrder;
  onEdit: (w: EnrichedWorkOrder) => void;
  onDelete: (id: string) => void;
  onSend: (w: EnrichedWorkOrder) => void;
  onDuplicate: (w: EnrichedWorkOrder) => void;
  onPay: (w: EnrichedWorkOrder) => void;
  onSendPortal: (w: EnrichedWorkOrder) => Promise<void>;
  contractors: Contractor[];
}) {
  const [portalSending, setPortalSending] = useState(false);
  const [portalSent,    setPortalSent]    = useState(false);
  const sm = WO_STATUS_META[w.wo_status] ?? WO_STATUS_META['Open'];
  const pm = PAY_META[w.payment_status] ?? PAY_META['pending'];
  const siteLabel = [w.site_city, w.site_state].filter(Boolean).join(', ');
  const hasSchedule = w.start_date || w.start_time;
  const contractor  = contractors.find((c) => c.name === w.contractor_name);
  const canSendPortal = !!(contractor?.email && contractor?.portal_token);

  return (
    <div
      style={{
        background: 'white',
        borderRadius: 12,
        border: '1px solid #e5e7eb',
        overflow: 'hidden',
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        display: 'flex',
      }}
    >
      {/* Status accent bar */}
      <div style={{ width: 4, background: sm.accent, flexShrink: 0 }} />

      <div style={{ flex: 1, padding: '16px 20px' }}>
        {/* ── Row 1: WO # + badges + actions ── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 800, fontSize: 15, color: 'var(--teal)', fontFamily: 'Lato, sans-serif' }}>
              #{w.wo_number}
            </span>
            {/* WO status badge */}
            <span style={{
              padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 700,
              background: sm.bg, color: sm.color, whiteSpace: 'nowrap',
            }}>
              {w.wo_status}
            </span>
            {/* Payment status badge */}
            <span style={{
              padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 700,
              background: pm.bg, color: pm.color, whiteSpace: 'nowrap',
            }}>
              {w.payment_status}
            </span>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <button
              title="Send Work Order"
              onClick={() => onSend(w)}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '6px 12px', borderRadius: 8, border: '1.5px solid rgba(13,115,119,0.35)',
                background: 'rgba(13,115,119,0.06)', cursor: 'pointer',
                fontSize: 11, fontWeight: 700, color: 'var(--teal)',
                fontFamily: 'Lato, sans-serif',
              }}
            >
              <Send size={11} /> Send WO
            </button>
            {canSendPortal && (
              <button
                title="Send contractor their portal link"
                disabled={portalSending || portalSent}
                onClick={async () => {
                  setPortalSending(true);
                  await onSendPortal(w);
                  setPortalSending(false);
                  setPortalSent(true);
                  setTimeout(() => setPortalSent(false), 4000);
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '6px 12px', borderRadius: 8,
                  border: portalSent
                    ? '1.5px solid rgba(4,120,87,0.35)'
                    : '1.5px solid rgba(99,102,241,0.35)',
                  background: portalSent
                    ? 'rgba(4,120,87,0.07)'
                    : 'rgba(99,102,241,0.07)',
                  cursor: portalSending ? 'wait' : 'pointer',
                  fontSize: 11, fontWeight: 700,
                  color: portalSent ? '#047857' : '#4338ca',
                  fontFamily: 'Lato, sans-serif',
                  opacity: portalSending ? 0.6 : 1,
                }}
              >
                {portalSent ? (
                  <><CalendarDays size={11} /> Sent!</>
                ) : (
                  <><CalendarDays size={11} /> {portalSending ? '…' : 'Portal'}</>
                )}
              </button>
            )}
            {w.remaining > 0 && (
              <button
                title="Record Payment"
                onClick={() => onPay(w)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '6px 12px', borderRadius: 8, border: '1.5px solid rgba(4,120,87,0.35)',
                  background: 'rgba(4,120,87,0.07)', cursor: 'pointer',
                  fontSize: 11, fontWeight: 700, color: '#047857',
                  fontFamily: 'Lato, sans-serif',
                }}
              >
                <DollarSign size={11} /> Pay
              </button>
            )}
            <button className="icon-btn" onClick={() => onEdit(w)} title="Edit"><Edit2 size={14} /></button>
            <button className="icon-btn" onClick={() => onDuplicate(w)} title="Duplicate"><Copy size={14} /></button>
            <button
              className="icon-btn"
              style={{ color: '#b91c1c' }}
              title="Delete"
              onClick={() => { if (confirm(`Delete WO ${w.wo_number}?`)) onDelete(w.id); }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        {/* ── Row 2: Title + Contractor ── */}
        <div style={{ marginBottom: 10 }}>
          {w.title && (
            <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1a1a', marginBottom: 2 }}>{w.title}</div>
          )}
          <div style={{ fontSize: 13, color: '#555', fontWeight: 600 }}>{w.contractor_name}</div>
        </div>

        {/* ── Row 3: Meta chips ── */}
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          {w.service_type && (
            <MetaChip icon={<Wrench size={11} />} label={w.service_type} />
          )}
          {siteLabel && (
            <MetaChip icon={<MapPin size={11} />} label={siteLabel} />
          )}
          {hasSchedule && (
            <MetaChip
              icon={<Clock size={11} />}
              label={[fmtDate(w.start_date), w.start_time].filter(Boolean).join(' ')}
            />
          )}
          {/* Amount + pay breakdown */}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 20, alignItems: 'flex-end' }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: '#aaa', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>Total</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#1a1a1a', fontFamily: 'Lato, sans-serif' }}>
                {fmtMoney(Number(w.total_amount))}
              </div>
              <div style={{ fontSize: 10, color: '#aaa' }}>{w.pay_type}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: '#aaa', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>Paid</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#047857' }}>{fmtMoney(w.paid)}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: '#aaa', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>Due</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: w.remaining > 0 ? '#b91c1c' : '#047857' }}>
                {fmtMoney(w.remaining)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetaChip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#666' }}>
      <span style={{ color: '#aaa' }}>{icon}</span>
      {label}
    </span>
  );
}
