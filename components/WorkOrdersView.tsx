'use client';
import { useState, useMemo, useEffect, useRef, type ReactNode } from 'react';
import { reassignWorkOrder, describeReassignment } from '@/lib/reassign';
import { Plus, Search, Edit2, Trash2, MapPin, Clock, Send, Wrench, Copy, DollarSign, CalendarDays, Archive, ArchiveRestore, Sparkles, X, CheckCircle2, Timer, UserCog, Columns3, List, UserPlus, FileText, ReceiptText, ChevronDown } from 'lucide-react';
import { fmtMoney, fmtDate, sortByWO, workOrderBreakdownText } from '@/lib/utils';
import type { EnrichedWorkOrder, WorkOrder, WorkOrderStatus, Contractor, Payment } from '@/lib/types';
import { WO_STATUSES } from '@/lib/types';
import EmailModal, { type EmailPayload } from '@/components/EmailModal';
import { backdropClose } from '@/lib/backdrop';
import WorkBoard from '@/components/WorkBoard';
import WorkFlowView, { OwnerAlerts } from '@/components/WorkFlowView';
import { Dialog } from '@/components/wf/WfUi';
import { DispatchBoard, type BoardRow } from '@/components/wf/PrimioScreens';
import { wfJobFromOwner, type WfJob } from '@/lib/wf';
import type { BoardColumn, Move } from '@/lib/dispatch-columns';
import { createClient } from '@/lib/supabase/client';
import { listsNow } from '@/lib/app-lists';
import { shown } from '@/lib/screen-parts';
import { toastError, toastInfo, toastSuccess } from '@/lib/toast';

type Stats = {
  total: number; paid: number; remaining: number;
  paidCount: number; partialCount: number; pendingCount: number; jobCount: number;
};

const WO_STATUS_META: Record<WorkOrderStatus, { bg: string; color: string; accent: string }> = {
  'Open':        { bg: 'rgba(14,27,46,0.09)',  color: '#0E1B2E',  accent: '#0E1B2E' },
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
  workOrders, stats, onAdd, onCreate, onAddFromAI, onEdit, onDelete, onDuplicate, onPay, onSendPortal, contractors,
  initialSearch = '',
  siteVisits = [],
  onArchive, onUnarchive, onCloseJob, onReassign, payments = [], onRefresh, ownerFirstName = 'Fred', startOpenId, onJobClosed,
}: {
  /** Open this job straight away (a job tapped on the Schedule). */
  startOpenId?: string;
  /** The job opened with startOpenId was closed (back to the Schedule). */
  onJobClosed?: () => void;
  workOrders: EnrichedWorkOrder[];
  /** Pre-fill the search, so a link can point at one work order. */
  initialSearch?: string;
  /** Visits linked to work orders, so a job can show where it came from. */
  siteVisits?: LinkedVisit[];
  stats: Stats;
  onAdd: () => void;
  /** The Create menu's other items (a new customer, quote or invoice, or paying a tech). */
  onCreate?: (what: 'customer' | 'quote' | 'invoice' | 'payment') => void;
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
  // The jobs screen is Primio's Dispatch board (Fred, 2026-10-04: "i asked for
  // every to mirror primio"); a card opens the job screen.
  const [aiOpen, setAiOpen] = useState(false);
  // The job open on WorkFlow's job screen — from the WorkFlow list or a Board
  // card. A link to one work order (?wo=…) opens it straight away.
  const [wfOpen, setWfOpenState] = useState<string | null>(() =>
    startOpenId ?? (initialSearch ? workOrders.find((w) => w.wo_number === initialSearch)?.id ?? null : null));
  const setWfOpen = (id: string | null) => {
    setWfOpenState(id);
    if (id === null && startOpenId && onJobClosed) onJobClosed();
  };
  const lists = listsNow(); // stage and priority names (Settings -> Lists & stages)
  // Message and photo counts for the cards, counted in the database (migration 113).
  const [jobCounts, setJobCounts] = useState<Record<string, { messages: number; photos: number; hours: number | null }>>({});
  useEffect(() => {
    void createClient().rpc('board_job_counts').then(({ data }) => {
      const m: Record<string, { messages: number; photos: number; hours: number | null }> = {};
      for (const r of (data as { wo_id: string; messages: number; photos: number; hours: number | string | null }[] | null) ?? []) {
        m[r.wo_id] = { messages: r.messages, photos: r.photos, hours: r.hours == null ? null : Number(r.hours) };
      }
      setJobCounts(m);
    });
  }, [workOrders]);
  const boardRows: BoardRow[] = useMemo(() => workOrders.map((w) => {
    const job = wfJobFromOwner(w);
    return {
      job, updatedAt: w.updated_at ?? '', payNotSet: job.techs.length > 0 && !w.pay_set && job.status !== 'closed',
      messages: jobCounts[w.id]?.messages ?? 0, photos: jobCounts[w.id]?.photos ?? 0, hours: jobCounts[w.id]?.hours ?? null,
    };
  }), [workOrders, lists, jobCounts]); // eslint-disable-line react-hooks/exhaustive-deps -- lists changes the names inside each job

  /**
   * A card moved to another column on the board (lib/dispatch-columns.ts says
   * what that means). Only the board column or the office stage changes —
   * closing goes through the usual Close job window.
   */
  const moveJob = async (job: WfJob, move: Move, target: BoardColumn) => {
    if (move.kind === 'none') return;
    if (move.kind === 'blocked') { toastInfo(move.reason); return; }
    const w = workOrders.find((x) => x.id === job.id);
    if (!w) return;
    if (move.kind === 'close') { onCloseJob(w); return; }
    const { error } = await createClient().from('work_orders').update(move.patch).eq('id', w.id);
    if (error) { toastError(`WO ${w.wo_number} didn't move to ${target.label}: ${error.message}`); return; }
    toastSuccess(move.note);
    await onRefresh();
  };
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
      {wfOpen ? (
        <div className="wf">
          <WorkFlowView
            workOrders={workOrders}
            contractors={contractors}
            ownerFirstName={ownerFirstName}
            initialSearch={initialSearch}
            owedToTechs={stats.remaining}
            modeSwitch={null}
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
      ) : (
        <DispatchBoard
          rows={boardRows}
          onMove={(job, move, target) => void moveJob(job, move, target)}
          onOpen={(j) => { setWfOpen(j.id); window.scrollTo({ top: 0 }); }}
          right={<>
            <button className="wf-btn wf-btn-outline wf-btn-sm" onClick={() => setAiOpen(true)}><Sparkles size={15} /> Generate with AI</button>
            <button className="wf-btn wf-btn-gold wf-btn-sm" onClick={onAdd}><Plus size={16} /> New order</button>
            {onCreate && (
              <CreateMenu items={[
                { label: 'New job', icon: <Wrench size={16} />, onClick: onAdd },
                { label: 'New customer', icon: <UserPlus size={16} />, onClick: () => onCreate('customer') },
                { label: 'New quote', icon: <FileText size={16} />, onClick: () => onCreate('quote') },
                { label: 'New invoice', icon: <ReceiptText size={16} />, onClick: () => onCreate('invoice') },
                { label: 'Pay a tech', icon: <DollarSign size={16} />, onClick: () => onCreate('payment') },
              ]} />
            )}
          </>}
          between={shown('dispatch.alerts') && <OwnerAlerts workOrders={workOrders} onOpenJob={(id) => { setWfOpen(id); window.scrollTo({ top: 0 }); }} onRefresh={onRefresh} />}
        />
      )}

      {aiOpen && (
        <div className="wf">
        <AIGenerateModal
          onClose={() => setAiOpen(false)}
          onGenerated={(fields) => { setAiOpen(false); onAddFromAI(fields); }}
        />
        </div>
      )}

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

/** Dispatch's Create menu (from SimplySub's job board): every "new" in one place. */
function CreateMenu({ items }: { items: { label: string; icon: ReactNode; onClick: () => void }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="wf-btn wf-btn-outline wf-btn-sm" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Plus size={15} /> Create <ChevronDown size={14} />
      </button>
      {open && (
        <div role="menu" style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 60, minWidth: 210, background: '#fff', border: '1px solid var(--wf-line)', borderRadius: 12, boxShadow: '0 12px 30px rgba(0,0,0,0.15)', padding: 6 }}>
          {items.map((it) => (
            <button key={it.label} type="button" role="menuitem" onClick={() => { setOpen(false); it.onClick(); }}
              style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 12px', border: 'none', background: 'transparent', borderRadius: 8, textAlign: 'left', fontWeight: 600, fontSize: 14, cursor: 'pointer', color: 'var(--wf-navy)' }}>
              {it.icon}{it.label}
            </button>
          ))}
        </div>
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
    (w.customer_name ?? '').toLowerCase().includes(q) ||
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
      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = '0 4px 16px rgba(14,27,46,0.15)'; (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(14,27,46,0.3)'; }}
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
            <span style={{ fontWeight: 800, fontSize: 15, color: 'var(--teal)', fontFamily: 'Inter, sans-serif' }}>
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
                padding: '6px 12px', borderRadius: 8, border: '1.5px solid rgba(14,27,46,0.35)',
                background: 'rgba(14,27,46,0.06)', cursor: 'pointer',
                fontSize: 11, fontWeight: 700, color: 'var(--teal)',
                fontFamily: 'Inter, sans-serif',
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
                  fontFamily: 'Inter, sans-serif',
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
                  fontFamily: 'Inter, sans-serif',
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
                  fontFamily: 'Inter, sans-serif',
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
                  borderRadius: 9, padding: '6px 11px', cursor: 'pointer', fontFamily: 'Inter, sans-serif',
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
                href="/admin?view=sitelog"
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
  // Fred, 2026-10-02: "fix the AI generate — it needs to look and fill in
  // everything necessary". WorkFlow's look; the AI reads the whole paste and
  // fills every field it can, plus the tech's checklist (lib/wo-ai.ts).
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
      const fields = (data.result ?? {}) as Partial<WorkOrder>;
      if (Object.keys(fields).length === 0) {
        setError("Couldn't find any job details in that text. Paste the whole email or work order and try again.");
        return;
      }
      onGenerated(fields);
      const tasks = fields.wo_tasks?.length ?? 0;
      if (data.source === 'ai') {
        toastSuccess(`Filled ${data.filled ?? 'the'} fields${tasks ? ` and a ${tasks}-step tech checklist` : ''}. Check them, then Save.`);
      } else {
        toastInfo("The AI didn't answer, so only the basics were filled (address, price, dates, contact). Check them, then Save.");
      }
    } catch {
      setError('Could not reach the AI service — try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      title="Generate with AI"
      onClose={onClose}
      wide
      footer={<>
        <button className="wf-btn wf-btn-ghost" onClick={onClose}>Cancel</button>
        <button className="wf-btn wf-btn-gold" onClick={generate} disabled={loading || !prompt.trim()}>
          <Sparkles size={16} /> {loading ? 'Reading the job…' : 'Fill in the job'}
        </button>
      </>}
    >
      <p className="wf-subtle" style={{ marginTop: 0 }}>
        Paste the whole email or work order — Field Nation, NetView, a client&apos;s message, or your own notes.
        The AI fills in every field it can find (site, schedule, contact, access and parking, scope, tools, parts,
        deliverables, the client&apos;s WO number and price) and writes the tech&apos;s checklist. Nothing is saved until you check it and press Save.
      </p>
      <textarea
        className="wf-input"
        rows={12}
        autoFocus
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder={"Paste the work order here…\n\ne.g. Field Nation WO 1234567 — Wendy's #5798, 123 Main St, Roselle NJ. Replace the POS switch, run 2 new cat6 drops to the drive-thru, label and test. Arrive Tue 8am, ask for the manager (Maria 908-555-0101). Photos before/after required."}
        style={{ minHeight: 220 }}
      />
      {error && <div role="alert" style={{ fontSize: 13, color: 'var(--wf-danger)', marginTop: 8 }}>{error}</div>}
      <div className="wf-subtle" style={{ fontSize: 12, marginTop: 8 }}>
        Techs and their pay are never filled in by the AI — you pick those.
      </div>
    </Dialog>
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
            background: 'rgba(14,27,46,0.07)', color: '#13284A', marginBottom: 14,
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
        color: color ?? '#1a1a1a', fontFamily: 'Inter, sans-serif',
      }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 10, color: '#aaa' }}>{sub}</div>}
    </div>
  );
}
