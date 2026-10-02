'use client';
import { useState, useMemo, useEffect } from 'react';
import { reassignWorkOrder, describeReassignment } from '@/lib/reassign';
import { Plus, Search, Edit2, Trash2, MapPin, Clock, Send, Wrench, Copy, DollarSign, CalendarDays, Archive, ArchiveRestore, Sparkles, X, CheckCircle2, Timer, UserCog, Columns3, List } from 'lucide-react';
import { fmtMoney, fmtDate, sortByWO, workOrderBreakdownText } from '@/lib/utils';
import type { EnrichedWorkOrder, WorkOrder, WorkOrderStatus, Contractor, Payment } from '@/lib/types';
import { WO_STATUSES } from '@/lib/types';
import EmailModal, { type EmailPayload } from '@/components/EmailModal';
import { backdropClose } from '@/lib/backdrop';
import WorkBoard from '@/components/WorkBoard';
import WorkFlowView from '@/components/WorkFlowView';
import { Workflow } from 'lucide-react';

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
  initialSearch = '',
  siteVisits = [],
  onArchive, onUnarchive, onCloseJob, onReassign, payments = [], onRefresh, ownerFirstName = 'Fred',
}: {
  workOrders: EnrichedWorkOrder[];
  /** Pre-fill the search, so a link can point at one work order. */
  initialSearch?: string;
  /** Visits linked to work orders, so a job can show where it came from. */
  siteVisits?: LinkedVisit[];
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
  /** Hand a job from one tech to another. */
  onReassign: (w: EnrichedWorkOrder, from: string, to: string) => Promise<void>;
  /** Needed to know what each tech has already been paid on a job. */
  payments?: Payment[];
  /** Reload the jobs after a change made on the WorkFlow screen. */
  onRefresh: () => Promise<void> | void;
  /** For the WorkFlow greeting. */
  ownerFirstName?: string;
}) {
  // WorkFlow (Fred, 2026-10-02: "rename to WorkFlow, I like it and keep it")
  // is the default; the board and the original list are one tap away. A new
  // storage key, so a device that last chose the list still opens on WorkFlow.
  const [mode, setMode] = useState<'workflow' | 'board' | 'list'>('workflow');
  useEffect(() => {
    try {
      const m = localStorage.getItem('wo-view-mode-v2');
      if (m === 'board' || m === 'list') setMode(m);
    } catch { /* private window */ }
  }, []);
  const chooseMode = (m: 'workflow' | 'board' | 'list') => {
    setMode(m);
    try { localStorage.setItem('wo-view-mode-v2', m); } catch { /* private window */ }
  };
  const [aiOpen, setAiOpen] = useState(false);
  // The job open on WorkFlow's job screen — from the WorkFlow list or a Board
  // card. A link to one work order (?wo=…) opens it straight away.
  const [wfOpen, setWfOpen] = useState<string | null>(() =>
    initialSearch ? workOrders.find((w) => w.wo_number === initialSearch)?.id ?? null : null);
  const showWf = mode === 'workflow' || wfOpen !== null;
  const [reassigning, setReassigning] = useState<EnrichedWorkOrder | null>(null);
  // Arriving from a Site Log card's "WO #… →" link, the board opens already
  // looking at that work order rather than at a list to hunt through.
  const [search, setSearch] = useState(initialSearch);
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
    return matchesSearch(w, search);
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
      {/* ── Header (Board and List; WorkFlow has its own) ── */}
      {!showWf && (
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
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div role="group" aria-label="How to show work orders" style={{ display: 'flex', borderRadius: 999, border: '1px solid rgba(13,115,119,0.25)', overflow: 'hidden' }}>
              {([['workflow', 'WorkFlow', <Workflow key="w" size={14} />], ['board', 'Board', <Columns3 key="b" size={14} />], ['list', 'List', <List key="l" size={14} />]] as const).map(([m, label, icon]) => (
                <button
                  key={m} onClick={() => chooseMode(m)} aria-pressed={mode === m}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', border: 'none', cursor: 'pointer',
                    fontSize: 12, fontWeight: 700, background: mode === m ? 'var(--teal)' : 'transparent', color: mode === m ? 'white' : 'var(--teal)',
                  }}
                >{icon} {label}</button>
              ))}
            </div>
            <button className="btn btn-ghost" onClick={() => setAiOpen(true)}><Sparkles size={14} /> Generate with AI</button>
            <button className="btn btn-primary" onClick={onAdd}><Plus size={14} /> New Work Order</button>
          </div>
        </div>
      </div>
      )}

      {showWf && (
        <div className="wf">
          <WorkFlowView
            workOrders={workOrders}
            contractors={contractors}
            ownerFirstName={ownerFirstName}
            initialSearch={initialSearch}
            owedToTechs={stats.remaining}
            modeSwitch={
              <div role="group" aria-label="How to show work orders" className="wf-filters">
                {([['workflow', 'WorkFlow'], ['board', 'Board'], ['list', 'List']] as const).map(([m, label]) => (
                  <button key={m} className="wf-filter" aria-pressed={mode === m} onClick={() => chooseMode(m)}>{label}</button>
                ))}
              </div>
            }
            onAdd={onAdd}
            onAI={() => setAiOpen(true)}
            onEdit={onEdit}
            onDelete={onDelete}
            onDuplicate={onDuplicate}
            onPay={onPay}
            onSend={openSendModal}
            onSendPortal={onSendPortal}
            onArchive={onArchive}
            onUnarchive={onUnarchive}
            onCloseJob={onCloseJob}
            onReassign={(w) => setReassigning(w)}
            onRefresh={onRefresh}
            openId={wfOpen}
            onOpenChange={setWfOpen}
          />
        </div>
      )}

      {aiOpen && (
        <AIGenerateModal
          onClose={() => setAiOpen(false)}
          onGenerated={(fields) => { setAiOpen(false); onAddFromAI(fields); }}
        />
      )}

      {!showWf && mode === 'board' && (
        <>
          <div className="glass card" style={{ marginBottom: 16, padding: '12px 16px', position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 28, top: '50%', transform: 'translateY(-50%)', color: '#aaa' }} />
            <input
              className="input" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by WO number, tech, title, service type, city…" style={{ paddingLeft: 36 }}
              aria-label="Search work orders"
            />
          </div>
          <WorkBoard
            workOrders={sorted.filter((w) => w.archived_at === null && matchesSearch(w, search))}
            owedToTechs={stats.remaining}
            onEdit={(w) => { setWfOpen(w.id); window.scrollTo({ top: 0 }); }}
          />
          <div style={{ fontSize: 12, color: '#888', marginTop: 12 }}>
            Click a work order to open it in WorkFlow, where sending, paying, closing and archiving are.
            Closed jobs ({archivedCount}) are in the List view under Closed.
          </div>
        </>
      )}

      {!showWf && mode === 'list' && (<>
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
          {filtered.map((w) => <WOCard key={w.id} w={w} onEdit={onEdit} onDelete={onDelete} onSend={openSendModal} onDuplicate={onDuplicate} onPay={onPay} onSendPortal={onSendPortal} contractors={contractors} onArchive={onArchive} onUnarchive={onUnarchive} onCloseJob={onCloseJob} siteVisits={siteVisits} onReassign={() => setReassigning(w)} />)}
        </div>
      )}
      </>)}

      {emailPayload && <EmailModal payload={emailPayload} onClose={() => setEmailPayload(null)} />}
      {reassigning && (
        <ReassignModal
          wo={reassigning}
          contractors={contractors}
          payments={payments}
          onClose={() => setReassigning(null)}
          onConfirm={async (from, to) => { await onReassign(reassigning, from, to); setReassigning(null); }}
        />
      )}
    </div>
  );
}

/** The search box's rule, shared by the board and the list. */
function matchesSearch(w: EnrichedWorkOrder, search: string): boolean {
  const q = search.toLowerCase();
  const allNames = (w.contractor_names && w.contractor_names.length > 0)
    ? w.contractor_names
    : [w.contractor_name];
  return (
    w.wo_number.includes(search) ||
    allNames.some((n) => (n ?? '').toLowerCase().includes(q)) ||
    (w.title ?? '').toLowerCase().includes(q) ||
    (w.service_type ?? '').toLowerCase().includes(q) ||
    (w.site_city ?? '').toLowerCase().includes(q)
  );
}

/** Only what the board shows about a linked visit. */
export type LinkedVisit = {
  id: string;
  work_order_id: string | null;
  visit_date: string | null;
  site_name: string | null;
  site_code: string | null;
  hours: number | null;
  miles: number | null;
};

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
  onReassign,
  siteVisits = [],
}: {
  w: EnrichedWorkOrder;
  /** The site visits this job came from — kept alongside what is already here. */
  siteVisits?: LinkedVisit[];
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
  onReassign: () => void;
}) {
  const visitsForWO = siteVisits.filter((v) => v.work_order_id === w.id);
  const breakdownText = workOrderBreakdownText(w);
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
            {!isArchived && (w.contractor_names?.length || w.contractor_name) && (
              <button
                className="icon-btn"
                title="Hand this job to another tech"
                onClick={(e) => { e.stopPropagation(); onReassign(); }}
              >
                <UserCog size={14} />
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
          {/* What the client pays, what the tech gets, and what is left — the
              three numbers the business actually runs on. The card used to show
              Total / Paid / Due, which never said what the job MADE.

              With no tech pay recorded the middle number is unknown, so it says
              so and offers to fix it. Printing $0 profit (the old behaviour) or
              the whole client price would each be a different lie. */}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 18, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <Money label="Client pays" value={fmtMoney(Number(w.total_amount))} big sub={w.pay_type} />

            {w.pay_set ? (
              <>
                <Money
                  label="Tech gets"
                  value={fmtMoney(w.payout_total)}
                  color="#b45309"
                  sub={w.remaining > 0 ? `${fmtMoney(w.remaining)} still due` : 'paid in full'}
                />
                {(() => {
                  const profit = Math.round((Number(w.total_amount) - w.payout_total) * 100) / 100;
                  return (
                    <Money
                      label="Your profit"
                      value={fmtMoney(profit)}
                      color={profit >= 0 ? '#047857' : '#b91c1c'}
                      sub={profit < 0 ? 'paid out more than billed' : undefined}
                    />
                  );
                })()}
              </>
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); onEdit(w); }}
                title="No tech pay recorded, so this job's profit is unknown. Set it here."
                style={{
                  textAlign: 'left', border: '1px dashed rgba(180,83,9,0.45)', background: 'rgba(245,158,11,0.07)',
                  borderRadius: 9, padding: '6px 11px', cursor: 'pointer', fontFamily: 'Lato, sans-serif',
                }}
              >
                <div style={{ fontSize: 10, color: '#b45309', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                  Tech pay not set
                </div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#b45309' }}>
                  Profit unknown — set it
                </div>
              </button>
            )}
          </div>
        </div>

        {/* What the total is made of, and the site visits it came from. The
            board used to show one number, so a job converted from a $168.70
            visit read "2 hours at $55" with no sign of the travel. */}
        {(breakdownText || visitsForWO.length > 0) && (
          <div style={{
            marginTop: 10, paddingTop: 9, borderTop: '1px dashed #e8e8e8',
            display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center',
            fontSize: 11, color: '#777',
          }}>
            {breakdownText && (
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                {breakdownText} <strong style={{ color: '#1a1a1a' }}>= {fmtMoney(Number(w.total_amount))}</strong>
              </span>
            )}
            {visitsForWO.map((v) => (
              <a
                key={v.id}
                href="/?view=sitelog"
                onClick={(e) => e.stopPropagation()}
                title="Open the Site Log"
                style={{ color: 'var(--teal)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
              >
                <Timer size={11} />
                {[v.site_name, v.site_code ? `#${v.site_code}` : null].filter(Boolean).join(' ') || 'Site visit'}
                {v.visit_date ? ` · ${fmtDate(v.visit_date)}` : ''}
                {v.hours ? ` · ${v.hours}h` : ''}
                {v.miles ? ` · ${v.miles} mi` : ''}
              </a>
            ))}
          </div>
        )}
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
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }} {...backdropClose(onClose)}>
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

/**
 * Handing a job from one tech to another.
 *
 * Shows what the move will actually do to the money BEFORE it happens, because
 * the answer is not obvious: a tech already part-paid keeps what they were
 * paid and stays on the job for that share, and only the unpaid remainder
 * transfers. All of that is worked out and tested in lib/reassign.
 */
function ReassignModal({ wo, contractors, payments, onClose, onConfirm }: {
  wo: EnrichedWorkOrder;
  contractors: Contractor[];
  payments: Payment[];
  onClose: () => void;
  onConfirm: (from: string, to: string) => Promise<void>;
}) {
  const crew = (wo.contractor_names && wo.contractor_names.length > 0)
    ? wo.contractor_names
    : [wo.contractor_name].filter(Boolean);
  const [from, setFrom] = useState(crew[0] ?? '');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);

  const plan = useMemo(
    () => (from && to ? reassignWorkOrder(wo as unknown as WorkOrder, payments, from, to) : null),
    [wo, payments, from, to],
  );

  const available = contractors
    .map((c) => c.name)
    .filter((n) => n && !crew.includes(n))
    .sort((a, b) => a.localeCompare(b));

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }}
      {...backdropClose(onClose)}
    >
      <div className="modal-solid" style={{ maxWidth: 460, width: '100%', padding: 22, borderRadius: 14 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
          <div className="serif" style={{ fontSize: 20, fontWeight: 600 }}>Hand this job over</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999' }}><X size={18} /></button>
        </div>
        <div style={{ fontSize: 12.5, color: '#777', marginBottom: 16 }}>
          WO #{wo.wo_number}{wo.title ? ` · ${wo.title}` : ''}
        </div>

        <label className="stat-label" style={{ display: 'block', marginBottom: 5 }}>Take it off</label>
        <select className="input" value={from} onChange={(e) => setFrom(e.target.value)} style={{ marginBottom: 13 }}>
          {crew.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>

        <label className="stat-label" style={{ display: 'block', marginBottom: 5 }}>Give it to</label>
        <select className="input" value={to} onChange={(e) => setTo(e.target.value)} style={{ marginBottom: 13 }}>
          <option value="">Choose a tech…</option>
          {available.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>

        {plan && (
          <div style={{
            padding: '11px 13px', borderRadius: 10, fontSize: 12.5, lineHeight: 1.55,
            background: 'rgba(13,115,119,0.07)', color: '#0a5a5d', marginBottom: 14,
          }}>
            {describeReassignment(plan, from, to)}
            <div style={{ marginTop: 6, color: '#666' }}>
              {to} will be asked to accept or decline — they do not inherit anyone else&apos;s answer.
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={!plan || busy}
            onClick={async () => { setBusy(true); await onConfirm(from, to); setBusy(false); }}
          >
            {busy ? 'Moving…' : 'Hand it over'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** One figure on a work order card, with its label and an optional note under it. */
function Money({ label, value, color, sub, big }: {
  label: string; value: string; color?: string; sub?: string; big?: boolean;
}) {
  return (
    <div style={{ textAlign: 'right' }}>
      <div style={{ fontSize: 11, color: '#aaa', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {label}
      </div>
      <div style={{
        fontSize: big ? 16 : 14, fontWeight: big ? 800 : 700,
        color: color ?? '#1a1a1a', fontFamily: 'Lato, sans-serif',
      }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 10, color: '#aaa' }}>{sub}</div>}
    </div>
  );
}
