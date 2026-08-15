'use client';
import { useState } from 'react';
import { Plus, Search, Edit2, Trash2, MapPin, Clock, Send, Wrench, Copy, DollarSign, CalendarDays, Archive, ArchiveRestore, Sparkles, X, CheckCircle2 } from 'lucide-react';
import { fmtMoney, fmtDate, sortByWO } from '@/lib/utils';
import type { EnrichedWorkOrder, WorkOrder, WorkOrderStatus, Contractor } from '@/lib/types';
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
  workOrders, stats, onAdd, onAddFromAI, onEdit, onDelete, onDuplicate, onPay, onSendPortal, contractors,
  onArchive, onUnarchive, onCloseJob,
}: {
  workOrders: EnrichedWorkOrder[];
  stats: Stats;
  onAdd: () => void;
  onAddFromAI: (fields: Partial<WorkOrder>) => void;
  onEdit: (w: EnrichedWorkOrder) => void;
  onDelete: (id: string) => void;
  onDuplicate: (w: EnrichedWorkOrder) => void;
  onPay: (w: EnrichedWorkOrder) => void;
  onSendPortal: (w: EnrichedWorkOrder) => Promise<void>;
  contractors: Contractor[];
  onArchive: (id: string) => void;
  onUnarchive: (id: string) => void;
  onCloseJob: (w: EnrichedWorkOrder) => void;
}) {
  const [aiOpen, setAiOpen] = useState(false);
  const [search, setSearch] = useState('');
  // FieldNation-style board: active jobs move through status tabs; Closed is
  // its own tab at the end (our archived jobs) instead of a separate toggle.
  const [woStatusFilter, setWoStatusFilter] = useState<'all' | 'closed' | WorkOrderStatus>('all');
  const [emailPayload, setEmailPayload] = useState<EmailPayload | null>(null);

  const archivedCount = workOrders.filter((w) => w.archived_at !== null).length;

  const sorted = sortByWO(workOrders);
  const filtered = sorted.filter((w) => {
    const isClosed = w.archived_at !== null;
    if (woStatusFilter === 'closed') {
      if (!isClosed) return false;
    } else {
      if (isClosed) return false;
      if (woStatusFilter !== 'all' && w.wo_status !== woStatusFilter) return false;
    }
    const q = search.toLowerCase();
    const allNames = (w.contractor_names && w.contractor_names.length > 0)
      ? w.contractor_names
      : [w.contractor_name];
    return (
      w.wo_number.includes(search) ||
      allNames.some((n) => n.toLowerCase().includes(q)) ||
      (w.title ?? '').toLowerCase().includes(q) ||
      (w.service_type ?? '').toLowerCase().includes(q) ||
      (w.site_city ?? '').toLowerCase().includes(q)
    );
  });

  // Tab counts follow the board: active tabs count non-closed jobs only
  const activeWOs = workOrders.filter((w) => w.archived_at === null);
  const statusCounts = WO_STATUSES.reduce((acc, s) => {
    acc[s] = activeWOs.filter((w) => w.wo_status === s).length;
    return acc;
  }, {} as Record<WorkOrderStatus, number>);

  const openSendModal = (w: EnrichedWorkOrder) => {
    const names = w.contractor_names?.length ? w.contractor_names : [w.contractor_name].filter(Boolean);
    // Each tech gets an individualized email (their pay + their accept/decline
    // links), so the server needs name/email/portal_token per recipient.
    const recipients = names
      .map((name) => {
        const c = contractors.find((x) => x.name === name);
        return c?.email ? { name: c.name, email: c.email, portal_token: c.portal_token ?? null } : null;
      })
      .filter(Boolean);
    setEmailPayload({
      type: 'work_order',
      to: recipients.map((r) => r!.email).join(', '),
      subject: `Work Order #${w.wo_number}${w.title ? ` — ${w.title}` : ''}`,
      data: { workOrder: w, recipients },
    });
  };

  return (
    <div className="view-inner" style={{ maxWidth: 1200, margin: '0 auto' }}>
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
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn btn-ghost" onClick={() => setAiOpen(true)}><Sparkles size={14} /> Generate with AI</button>
            <button className="btn btn-primary" onClick={onAdd}><Plus size={14} /> New Work Order</button>
          </div>
        </div>
      </div>

      {aiOpen && (
        <AIGenerateModal
          onClose={() => setAiOpen(false)}
          onGenerated={(fields) => { setAiOpen(false); onAddFromAI(fields); }}
        />
      )}

      {/* ── FieldNation-style status board tabs ── */}
      <div className="glass card" style={{ marginBottom: 20, padding: '0 16px' }}>
        <div style={{ display: 'flex', gap: 2, overflowX: 'auto', borderBottom: '1px solid #eee' }}>
          {[
            { key: 'all' as const, label: 'All Active', count: activeWOs.length },
            ...WO_STATUSES.map((s) => ({ key: s, label: s, count: statusCounts[s] })),
            { key: 'closed' as const, label: 'Closed', count: archivedCount },
          ].map((t) => {
            const active = woStatusFilter === t.key;
            const isClosedTab = t.key === 'closed';
            return (
              <button
                key={t.key}
                onClick={() => setWoStatusFilter(t.key)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', flexShrink: 0,
                  padding: '13px 14px', border: 'none', background: 'none', cursor: 'pointer',
                  fontFamily: 'Lato, sans-serif', fontWeight: 700, fontSize: 12,
                  color: active ? (isClosedTab ? '#6d28d9' : 'var(--teal)') : '#888',
                  borderBottom: active
                    ? `2.5px solid ${isClosedTab ? '#6d28d9' : 'var(--teal)'}`
                    : '2.5px solid transparent',
                  marginBottom: -1,
                }}
              >
                {isClosedTab && <Archive size={11} />}
                {t.label}
                <span style={{
                  fontSize: 10, fontWeight: 800, padding: '1px 7px', borderRadius: 999,
                  background: active ? (isClosedTab ? 'rgba(109,40,217,0.12)' : 'rgba(13,115,119,0.12)') : 'rgba(0,0,0,0.06)',
                  color: active ? (isClosedTab ? '#6d28d9' : 'var(--teal)') : '#999',
                }}>
                  {t.count}
                </span>
              </button>
            );
          })}
        </div>
        <div style={{ position: 'relative', padding: '12px 0' }}>
          <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#aaa' }} />
          <input
            className="input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by contractor, title, service type, city…"
            style={{ paddingLeft: 36 }}
          />
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
          {filtered.map((w) => <WOCard key={w.id} w={w} onEdit={onEdit} onDelete={onDelete} onSend={openSendModal} onDuplicate={onDuplicate} onPay={onPay} onSendPortal={onSendPortal} contractors={contractors} onArchive={onArchive} onUnarchive={onUnarchive} onCloseJob={onCloseJob} />)}
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
  onArchive,
  onUnarchive,
  onCloseJob,
}: {
  w: EnrichedWorkOrder;
  onEdit: (w: EnrichedWorkOrder) => void;
  onDelete: (id: string) => void;
  onSend: (w: EnrichedWorkOrder) => void;
  onDuplicate: (w: EnrichedWorkOrder) => void;
  onPay: (w: EnrichedWorkOrder) => void;
  onSendPortal: (w: EnrichedWorkOrder) => Promise<void>;
  contractors: Contractor[];
  onArchive: (id: string) => void;
  onUnarchive: (id: string) => void;
  onCloseJob: (w: EnrichedWorkOrder) => void;
}) {
  const [portalSending, setPortalSending] = useState(false);
  const [portalSent,    setPortalSent]    = useState(false);
  const sm = WO_STATUS_META[w.wo_status] ?? WO_STATUS_META['Open'];
  const pm = PAY_META[w.payment_status] ?? PAY_META['pending'];
  const siteLabel = [w.site_city, w.site_state].filter(Boolean).join(', ');
  const hasSchedule = w.start_date || w.start_time;
  const contractor  = contractors.find((c) => c.name === w.contractor_name);
  const canSendPortal = !!(contractor?.email && contractor?.portal_token);

  const isArchived = w.archived_at !== null;

  return (
    <div
      onClick={() => onEdit(w)}
      style={{
        background: 'white',
        borderRadius: 12,
        border: isArchived ? '1px solid rgba(109,40,217,0.25)' : '1px solid #e5e7eb',
        overflow: 'hidden',
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        display: 'flex',
        flexDirection: 'column',
        opacity: isArchived ? 0.82 : 1,
        cursor: 'pointer',
        transition: 'box-shadow 0.2s, border-color 0.2s',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = '0 4px 16px rgba(13,115,119,0.15)'; (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(13,115,119,0.3)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = '0 1px 4px rgba(0,0,0,0.06)'; (e.currentTarget as HTMLDivElement).style.borderColor = isArchived ? 'rgba(109,40,217,0.25)' : '#e5e7eb'; }}
    >
      {/* Archived banner */}
      {isArchived && (
        <div style={{
          background: 'rgba(109,40,217,0.1)', borderBottom: '1px solid rgba(109,40,217,0.2)',
          padding: '4px 16px', display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 10, fontWeight: 800, color: '#6d28d9', letterSpacing: 0.5, textTransform: 'uppercase',
        }}>
          <Archive size={10} /> Archived
        </div>
      )}

      <div style={{ display: 'flex' }}>
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

          {/* Action buttons — stopPropagation prevents card-level onClick from firing */}
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
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
            {!isArchived && (
              <button
                title={w.remaining > 0
                  ? `Close job (${fmtMoney(w.remaining)} still owed — closes as Approved)`
                  : 'Close job — everyone is paid, moves to Closed'}
                onClick={() => onCloseJob(w)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '6px 12px', borderRadius: 8,
                  border: '1.5px solid rgba(4,120,87,0.4)',
                  background: '#047857', cursor: 'pointer',
                  fontSize: 11, fontWeight: 700, color: 'white',
                  fontFamily: 'Lato, sans-serif',
                }}
              >
                <CheckCircle2 size={11} /> Close
              </button>
            )}
            <button className="icon-btn" onClick={() => onEdit(w)} title="Edit"><Edit2 size={14} /></button>
            <button className="icon-btn" onClick={() => onDuplicate(w)} title="Duplicate"><Copy size={14} /></button>
            {isArchived ? (
              <button
                className="icon-btn"
                title="Restore from archive"
                style={{ color: '#6d28d9' }}
                onClick={() => onUnarchive(w.id)}
              >
                <ArchiveRestore size={14} />
              </button>
            ) : (
              <button
                className="icon-btn"
                title="Archive"
                style={{ color: '#6d28d9' }}
                onClick={() => onArchive(w.id)}
              >
                <Archive size={14} />
              </button>
            )}
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
          <div style={{ fontSize: 13, color: '#555', fontWeight: 600 }}>
            {(w.contractor_names && w.contractor_names.length > 1)
              ? w.contractor_names.join(' · ')
              : w.contractor_name}
          </div>
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

function AIGenerateModal({
  onClose, onGenerated,
}: {
  onClose: () => void;
  onGenerated: (fields: Partial<WorkOrder>) => void;
}) {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_description: prompt }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Generation failed'); return; }
      // Server already whitelists/sanitizes keys — pass everything through so
      // address, price, schedule, and contact fields prefill the form.
      onGenerated(data.result as Partial<WorkOrder>);
    } catch {
      setError('Could not reach the AI service — try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }} onClick={onClose}>
      <div className="glass card" style={{ width: 480, maxWidth: '90vw' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 15 }}>
            <Sparkles size={16} color="var(--gold)" /> Generate Work Order with AI
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999' }}><X size={18} /></button>
        </div>
        <p style={{ fontSize: 12, color: '#888', margin: '0 0 12px' }}>
          Paste or describe the job — address, price, date, and contact info are picked up automatically for you to review.
        </p>
        <textarea
          className="input"
          rows={4}
          autoFocus
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. Install a new security camera in the training room at the Wendy's on Main St, needs cat6 cabling run from the wiring closet..."
        />
        {error && <div style={{ fontSize: 12, color: '#b91c1c', marginTop: 8 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={generate} disabled={loading || !prompt.trim()}>
            {loading ? 'Generating…' : 'Generate'}
          </button>
        </div>
      </div>
    </div>
  );
}
