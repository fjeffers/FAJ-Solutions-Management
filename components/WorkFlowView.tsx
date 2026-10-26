'use client';
// WorkFlow — Fred's work orders, in WorkFlow's look, inside the management app
// (Fred, 2026-10-02: "all one app", "rename to WorkFlow, I like it and keep
// it"). One screen for every job: the list with the day's numbers on top, and a
// job screen with the checklist, who is on it, the money, messages and every
// office button (send, pay, close, archive…).
//
// Money comes from the enriched work order (lib/utils rules), never worked out
// here. Ticking a checklist item and changing techs go through the same server
// functions the tech portal uses (migration-098), so both sides always agree.
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Archive, ArchiveRestore, CalendarClock, CalendarDays, CheckCircle2, Copy, DollarSign, Download, Edit2, FileText, MessageSquare, MoreHorizontal, Navigation,
  FilePlus2, Plus, Receipt, Search, Send, Signature, Sparkles, Trash2, UserCog, Users,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useLiveRows } from '@/components/wf/useLive';
import {
  wfJobFromOwner, matchesWf, sortWf, ownerCounts, bucketOf, bucketCounts, withTask, withCloseout, fullAddress, wfReasonText,
  requestWhen, whenText, isFinished, type WfBucket, type WfJob, type WfTask,
} from '@/lib/wf';
import {
  acceptTimePatch, closeoutArgs, keepTimePatch, listFor, parseCloseoutLists, waitingRequests,
  type CloseoutList, type CloseoutOp,
} from '@/lib/closeout';
import CloseoutCard from '@/components/wf/Closeout';
import { fmtMoney, techPayToShow } from '@/lib/utils';
import { sendNewJobNotice } from '@/lib/notify';
import { logAudit } from '@/lib/audit';
import { toastError, toastInfo, toastSuccess } from '@/lib/toast';
import { type Contractor, type EnrichedWorkOrder, type WorkOrder } from '@/lib/types';
import WorkOrderChatPanel from '@/components/WorkOrderChatPanel';
import JobLogReport from '@/components/JobLogReport';
import AddJobPhotos from '@/components/AddJobPhotos';
import { jobGaps } from '@/lib/job-gaps';
import { buildVisits, logTotals, type Punch } from '@/lib/job-log';
import { mapLink } from '@/lib/geo';
import { downloadHref, photoDay, photoFileName } from '@/lib/job-photos';
import { EXPENSE_STATUS, expenseCategoryLabel, expenseReasonText, type ExpenseStatus } from '@/lib/expenses';
import { Banner, BucketTabs, Dialog, Empty, Hero, JobCard, Section, greeting } from '@/components/wf/WfUi';
import WfJobDetail, { mapsDirections } from '@/components/wf/WfJobDetail';
import { listsNow } from '@/lib/app-lists';
import { shown as partShown } from '@/lib/screen-parts';
import { designNow } from '@/lib/screen-design';
import { answeredFields } from '@/lib/custom-fields';
import { CustomFieldList } from '@/components/CustomFieldInputs';
import SketchesPanel from '@/components/sketch/SketchesPanel';
import PdfEditor, { photosToPdf, type SendResult } from '@/components/tools/PdfEditor';
import DocViewer, { docKind } from '@/components/tools/DocViewer';
import { trimPdf } from '@/lib/pdf-trim';
import { DOC_KINDS, editedName } from '@/lib/job-docs';
import { ProjectDayCard, EXPENSES_CHANGED, useBilledRows, billedHoursOf } from '@/components/wf/ProjectOffice';
import { asks } from '@/lib/capture';

type Row = { w: EnrichedWorkOrder; job: WfJob };

/**
 * The top of the job screen — the same in WorkFlow, Board and List (Fred,
 * 2026-10-04: "these 3 are different setup and it should not be"): the
 * greeting and day's numbers, New job / Generate with AI, the WorkFlow · Board
 * · List switch and one search box. `between` sits under the greeting
 * (WorkFlow's to-do banners).
 */
export function WorkFlowTop({
  ownerFirstName, counts, owedToTechs, onAdd, onAI, onNeedTech, onWorkDone, modeSwitch, search, onSearch, between,
}: {
  ownerFirstName: string;
  counts: ReturnType<typeof ownerCounts>;
  owedToTechs: number;
  onAdd: () => void;
  onAI: () => void;
  onNeedTech?: () => void;
  onWorkDone?: () => void;
  modeSwitch: ReactNode;
  search: string;
  onSearch: (s: string) => void;
  between?: ReactNode;
}) {
  return (
    <>
      <Hero
        eyebrow={`WorkFlow · ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`}
        title={`${greeting()}, ${ownerFirstName}`}
        actions={<>
          <button className="wf-btn wf-btn-gold" onClick={onAdd}><Plus size={17} /> New job</button>
          <button className="wf-btn" onClick={onAI} style={{ background: 'rgba(255,255,255,0.14)', color: '#fff', borderColor: 'rgba(201,162,75,0.45)' }}>
            <Sparkles size={16} /> Generate with AI
          </button>
        </>}
        stats={[
          { value: String(counts.needTech), label: 'Need a tech', onClick: onNeedTech },
          { value: String(counts.today), label: 'Today' },
          { value: String(counts.workDone), label: 'Work done', onClick: onWorkDone },
          { value: fmtMoney(owedToTechs), label: 'Owed to techs' },
        ]}
      />
      {between}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h2 className="wf-title" style={{ flex: 1 }}>Work orders</h2>
        {modeSwitch}
      </div>
      <div style={{ position: 'relative' }}>
        <Search size={18} color="var(--wf-subtle)" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
        <input
          className="wf-input" value={search} onChange={(e) => onSearch(e.target.value)}
          placeholder="Search WO number, client, city, tech…" aria-label="Search work orders" style={{ paddingLeft: 40 }}
        />
      </div>
    </>
  );
}

export default function WorkFlowView({
  workOrders, contractors, ownerFirstName, initialSearch = '', owedToTechs, modeSwitch, search: searchIn, onSearch, initialBucket,
  onAdd, onAI, onEdit, onDelete, onDuplicate, onPay, onSend, onSendPortal, onArchive, onUnarchive, onCloseJob,
  onReassign, onRefresh, openId, onOpenChange,
}: {
  workOrders: EnrichedWorkOrder[];
  contractors: Contractor[];
  ownerFirstName: string;
  initialSearch?: string;
  owedToTechs: number;
  /** WorkFlow | Board | List. */
  modeSwitch: ReactNode;
  /** The search box, shared with Board and List so it carries across. */
  search?: string;
  onSearch?: (s: string) => void;
  /** The list to open on (a number tapped on the Board or List). */
  initialBucket?: WfBucket;
  onAdd: () => void;
  onAI: () => void;
  onEdit: (w: EnrichedWorkOrder) => void;
  onDelete: (id: string) => void;
  onDuplicate: (w: EnrichedWorkOrder) => void;
  onPay: (w: EnrichedWorkOrder) => void;
  onSend: (w: EnrichedWorkOrder) => void;
  onSendPortal: (w: EnrichedWorkOrder) => Promise<void>;
  onArchive: (id: string) => void;
  onUnarchive: (id: string) => void;
  onCloseJob: (w: EnrichedWorkOrder) => void;
  /** Opens the Reassign window, which splits paid and unpaid money. */
  onReassign: (w: EnrichedWorkOrder) => void;
  onRefresh: () => Promise<void> | void;
  /** The job open on the job screen, or null for the list. */
  openId: string | null;
  onOpenChange: (id: string | null) => void;
}) {
  const [ownSearch, setOwnSearch] = useState(initialSearch);
  const search = searchIn ?? ownSearch;
  const setSearch = onSearch ?? setOwnSearch;
  // Available · Current · Pending · Closed — no "All jobs" (Fred, 2026-10-02).
  const [bucket, setBucket] = useState<WfBucket>(initialBucket ?? 'current');
  const setOpenId = onOpenChange;

  const appLists = listsNow(); // stage and priority names (Settings -> Lists & stages)
  const rows: Row[] = useMemo(() => workOrders.map((w) => ({ w, job: wfJobFromOwner(w) })), [workOrders, appLists]); // eslint-disable-line react-hooks/exhaustive-deps -- lists changes the names inside each job
  const counts = ownerCounts(rows.map((r) => r.job));
  // Techs asking for another date and time on an offer (migration-105).
  const timeAsks = rows.filter((r) => !r.job.archived && r.job.status === 'offered'
    && waitingRequests(r.job.timeRequests, r.job.techs).length > 0);

  // Closed reaches into the archive too; the other three are live jobs only.
  const searched = rows.filter((r) => matchesWf(r.job, search));
  const inBucket = searched.filter((r) => bucketOf(r.job.status, true) === bucket);
  const shown = sortWf(inBucket.map((r) => r.job))
    .map((j) => inBucket.find((r) => r.job.id === j.id)!)
    // Closed work reads newest first; everything else soonest first.
    .sort((a, b) => (bucket === 'closed' ? (b.w.updated_at ?? '').localeCompare(a.w.updated_at ?? '') : 0));
  const tabCounts = bucketCounts(searched.map((r) => r.job), true);
  const [waitingExp, setWaitingExp] = useState<ExpenseRow[]>([]);
  const [inboxOpen, setInboxOpen] = useState(false);
  const loadWaiting = async () => {
    const { data } = await createClient().from('job_expenses')
      .select('id, wo_id, wo_number, contractor_name, category, vendor, amount, expense_date, note, receipt_path, status, decline_reason')
      .eq('status', 'submitted').order('created_at');
    setWaitingExp((data as ExpenseRow[] | null) ?? []);
  };
  useEffect(() => { void loadWaiting(); }, [workOrders]);
  useLiveRows('job_expenses', null, () => void loadWaiting());

  const [lists, setLists] = useState<CloseoutList[]>([]);
  useEffect(() => {
    void createClient().from('closeout_lists').select('id, name, keywords, items, sort').order('sort')
      .then(({ data }) => setLists(parseCloseoutLists(data)));
  }, []);

  const open = openId ? rows.find((r) => r.w.id === openId) ?? null : null;

  if (open) {
    return (
      <OwnerJob
        row={open}
        author={ownerFirstName}
        lists={lists}
        contractors={contractors}
        onBack={() => setOpenId(null)}
        onRefresh={onRefresh}
        onEdit={onEdit} onDelete={(id) => { onDelete(id); setOpenId(null); }} onDuplicate={onDuplicate}
        onPay={onPay} onSend={onSend} onSendPortal={onSendPortal} onArchive={onArchive} onUnarchive={onUnarchive}
        onCloseJob={onCloseJob} onReassign={onReassign}
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <WorkFlowTop
        ownerFirstName={ownerFirstName} counts={counts} owedToTechs={owedToTechs} onAdd={onAdd} onAI={onAI}
        onNeedTech={() => setBucket('available')} onWorkDone={() => setBucket('pending')}
        modeSwitch={modeSwitch} search={search} onSearch={setSearch}
        between={<>

      {waitingExp.length > 0 && (
        <button className="wf-card wf-card-click wf-rise" onClick={() => setInboxOpen(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 16, borderColor: 'rgba(180,83,9,0.35)' }}>
          <span style={{ width: 46, height: 46, borderRadius: 12, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--wf-gold)', color: 'var(--wf-gold-ink)' }}>
            <Receipt size={22} />
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontWeight: 600, fontSize: 15 }}>Expenses to approve</span>
            <span className="wf-subtle" style={{ display: 'block', fontSize: 12.5 }}>
              {waitingExp.length} receipt{waitingExp.length === 1 ? '' : 's'} from techs · {fmtMoney(waitingExp.reduce((s, e) => s + Number(e.amount), 0))}
            </span>
          </span>
        </button>
      )}
      {inboxOpen && (
        <Dialog title="Expenses to approve" wide onClose={() => setInboxOpen(false)}>
          <ExpenseList
            rows={waitingExp}
            showJob
            onOpenJob={(woId) => { setInboxOpen(false); setOpenId(woId); window.scrollTo({ top: 0 }); }}
            onDecided={async () => { await loadWaiting(); void onRefresh(); }}
          />
          {waitingExp.length === 0 && <div className="wf-subtle">All caught up.</div>}
        </Dialog>
      )}

      {timeAsks.length > 0 && (
        <Banner
          title="Another time asked"
          subtitle={timeAsks.length === 1
            ? `WO ${timeAsks[0].job.number}: ${waitingRequests(timeAsks[0].job.timeRequests, timeAsks[0].job.techs)[0][0]} asks for another time`
            : `${timeAsks.length} jobs have a tech asking for another time`}
          onClick={() => {
            if (timeAsks.length === 1) { setOpenId(timeAsks[0].w.id); window.scrollTo({ top: 0 }); } else setBucket('available');
          }}
        />
      )}

      {counts.needTech > 0 && bucket !== 'available' && (
        <Banner
          tone="red"
          title="Needs a tech"
          subtitle={`${counts.needTech} ${counts.needTech === 1 ? 'job has' : 'jobs have'} nobody on it, or the tech declined`}
          onClick={() => setBucket('available')}
        />
      )}

        </>}
      />

      <BucketTabs value={bucket} counts={tabCounts} onChange={setBucket} ownerView />

      {shown.length === 0 ? (
        <Empty
          title={rows.length === 0 ? 'No jobs yet' : 'No jobs here'}
          message={rows.length === 0 ? 'Create one with New job.' : search ? 'Nothing matches your search.' : 'Nothing in this list right now.'}
          action={rows.length === 0 ? <button className="wf-btn wf-btn-navy" onClick={onAdd}><Plus size={16} /> New job</button> : undefined}
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 400px), 1fr))', gap: 12 }}>
          {shown.map((r, i) => (
            <JobCard
              key={r.w.id} job={r.job} ownerView index={i}
              payNotSet={r.job.techs.length > 0 && !r.w.pay_set && r.job.status !== 'closed'}
              onOpen={() => { setOpenId(r.w.id); window.scrollTo({ top: 0 }); }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * What needs Fred on the Dispatch board: tech receipts waiting for a yes or no,
 * and techs asking for another time on an offer. Tapping one opens it.
 */
export function OwnerAlerts({ workOrders, onOpenJob, onRefresh }: {
  workOrders: EnrichedWorkOrder[];
  onOpenJob: (woId: string) => void;
  onRefresh: () => Promise<void> | void;
}) {
  const [waitingExp, setWaitingExp] = useState<ExpenseRow[]>([]);
  const [inboxOpen, setInboxOpen] = useState(false);
  const loadWaiting = async () => {
    const { data } = await createClient().from('job_expenses')
      .select('id, wo_id, wo_number, contractor_name, category, vendor, amount, expense_date, note, receipt_path, status, decline_reason')
      .eq('status', 'submitted').order('created_at');
    setWaitingExp((data as ExpenseRow[] | null) ?? []);
  };
  useEffect(() => { void loadWaiting(); }, [workOrders]);
  useLiveRows('job_expenses', null, () => void loadWaiting());
  const timeAsks = workOrders.map((w) => ({ w, job: wfJobFromOwner(w) }))
    .filter((r) => !r.job.archived && r.job.status === 'offered' && waitingRequests(r.job.timeRequests, r.job.techs).length > 0);
  if (waitingExp.length === 0 && timeAsks.length === 0 && !inboxOpen) return null;

  return (
    <>
      {waitingExp.length > 0 && (
        <button className="wf-card wf-card-click wf-rise" onClick={() => setInboxOpen(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 16, borderColor: 'rgba(180,83,9,0.35)' }}>
          <span style={{ width: 46, height: 46, borderRadius: 12, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--wf-gold)', color: 'var(--wf-gold-ink)' }}>
            <Receipt size={22} />
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontWeight: 600, fontSize: 15 }}>Expenses to approve</span>
            <span className="wf-subtle" style={{ display: 'block', fontSize: 12.5 }}>
              {waitingExp.length} receipt{waitingExp.length === 1 ? '' : 's'} from techs · {fmtMoney(waitingExp.reduce((sum, e) => sum + Number(e.amount), 0))}
            </span>
          </span>
        </button>
      )}
      {inboxOpen && (
        <Dialog title="Expenses to approve" wide onClose={() => setInboxOpen(false)}>
          <ExpenseList
            rows={waitingExp}
            showJob
            onOpenJob={(woId) => { setInboxOpen(false); onOpenJob(woId); }}
            onDecided={async () => { await loadWaiting(); void onRefresh(); }}
          />
          {waitingExp.length === 0 && <div className="wf-subtle">All caught up.</div>}
        </Dialog>
      )}
      {timeAsks.length > 0 && (
        <Banner
          title="Another time asked"
          subtitle={timeAsks.length === 1
            ? `WO ${timeAsks[0].job.number}: ${waitingRequests(timeAsks[0].job.timeRequests, timeAsks[0].job.techs)[0][0]} asks for another time`
            : `${timeAsks.length} jobs have a tech asking for another time — tap for the first`}
          onClick={() => onOpenJob(timeAsks[0].w.id)}
        />
      )}
    </>
  );
}

// ── One job, from the office's side ─────────────────────────────────────────

function OwnerJob({
  row, author, lists, contractors, onBack, onRefresh, onEdit, onDelete, onDuplicate, onPay, onSend, onSendPortal,
  onArchive, onUnarchive, onCloseJob, onReassign,
}: {
  /** Who is signed in, for the notes they add. */
  author?: string;
  row: Row;
  lists: CloseoutList[];
  contractors: Contractor[];
  onBack: () => void;
  onRefresh: () => Promise<void> | void;
  onEdit: (w: EnrichedWorkOrder) => void;
  onDelete: (id: string) => void;
  onDuplicate: (w: EnrichedWorkOrder) => void;
  onPay: (w: EnrichedWorkOrder) => void;
  onSend: (w: EnrichedWorkOrder) => void;
  onSendPortal: (w: EnrichedWorkOrder) => Promise<void>;
  onArchive: (id: string) => void;
  onUnarchive: (id: string) => void;
  onCloseJob: (w: EnrichedWorkOrder) => void;
  onReassign: (w: EnrichedWorkOrder) => void;
}) {
  const { w } = row;
  // A tick shows at once; the office's own copy replaces it on the next load.
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [portalBusy, setPortalBusy] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  // The app's own "are you sure" for Delete: the browser's confirm box is
  // blocked in some browsers and installed apps, and then nothing happened.
  const [askDelete, setAskDelete] = useState(false);
  const [sketchCount, setSketchCount] = useState(0);
  const [addSketch, setAddSketch] = useState(false);
  useEffect(() => {
    let live = true;
    void createClient().from('sketches').select('id', { count: 'exact', head: true }).eq('wo_id', w.id)
      .then(({ count }) => { if (live) setSketchCount(count ?? 0); });
    return () => { live = false; };
  }, [w.id]);

  // Closeout changes Fred makes himself show at once (each is safe to repeat).
  const [coOps, setCoOps] = useState<CloseoutOp[]>([]);

  // Time logged: every clock-in and clock-out on the job (job_punches), not
  // only the latest one the time log keeps.
  const [clockMs, setClockMs] = useState<number | null>(null);
  useEffect(() => {
    void createClient().from('job_punches').select('contractor_name, kind, at, lat, lng, accuracy').eq('wo_id', w.id).order('at')
      .then(({ data }) => {
        const punches = (data as Punch[] | null) ?? [];
        setClockMs(punches.length ? logTotals(buildVisits(punches, [])).ms : null);
      });
  }, [w.id, w.updated_at]);
  // The hours as billed, with the office's changes on Hours (Fred, 2026-10-24: "it need to reflect of the work order also").
  const billed = useBilledRows(w);

  let job = row.job;
  for (const [id, done] of Object.entries(ticked)) job = withTask(job, id, done);
  for (const o of coOps) job = withCloseout(job, o);
  const checklist = listFor(lists, job.title, job.description);

  const refresh = async () => {
    setRefreshing(true);
    try { await onRefresh(); setTicked({}); setCoOps([]); } finally { setRefreshing(false); }
  };

  /** A tech declined, and the office sends it to them again (Fred, 2026-10-18:
   *  "I am sending it back to me to see it in the app ... nothing"). Their old
   *  "declined" is cleared, so the job is waiting for their answer again, and
   *  the new-job notice goes out. */
  const sendAgain = async (name: string) => {
    const c = contractors.find((x) => x.name === name);
    if (c?.on_hold) { toastInfo(`${name} is on hold. Release them in Team first.`); return; }
    const sb = createClient();
    const { data, error: readErr } = await sb.from('work_orders').select('assignment_responses').eq('id', w.id).single();
    if (readErr) { toastError("Couldn't send it again. Check your connection."); return; }
    const answers = { ...((data?.assignment_responses ?? {}) as Record<string, unknown>) };
    delete answers[name];
    const { error } = await sb.from('work_orders')
      .update({ assignment_responses: answers, updated_at: new Date().toISOString() }).eq('id', w.id);
    if (error) { toastError(`Couldn't send it again: ${error.message}`); return; }
    logAudit({ action: 'update', entityType: 'work_order', entityId: w.id, entityLabel: `WO#${w.wo_number} sent again to ${name}` });
    if (c?.email) void sendNewJobNotice(w, c, techPayToShow(w as unknown as WorkOrder, name));
    toastSuccess(c?.email ? `WO ${w.wo_number} sent to ${name} again` : `WO ${w.wo_number} is waiting for ${name}'s answer again (no email on file)`);
    await refresh();
  };

  /** The tech's Tools on this job (Fred, 2026-10-18: "Tools should only apply
   *  if admin adds it"; migration 129). Off unless turned on here. */
  const setTechTools = async (on: boolean) => {
    const { error } = await createClient().from('work_orders')
      .update({ tech_tools: on, updated_at: new Date().toISOString() }).eq('id', w.id);
    if (error) { toastError(`Couldn't change Tools: ${error.message}`); return; }
    logAudit({ action: 'update', entityType: 'work_order', entityId: w.id, entityLabel: `WO#${w.wo_number} tech Tools ${on ? 'on' : 'off'}` });
    toastSuccess(on ? `Tools are on for the tech on WO ${w.wo_number}` : `Tools are off for the tech on WO ${w.wo_number}`);
    await refresh();
  };

  /** The same closeout steps a tech takes (wf_tech_closeout lets the owner in too, migration-106). */
  const closeoutOp = async (op: CloseoutOp) => {
    setCoOps((l) => [...l, op]);
    const { data, error } = await createClient().rpc('wf_tech_closeout', {
      p_wo_number: w.wo_number, p_op: op.op, p_args: closeoutArgs(op), p_at: new Date().toISOString(),
    });
    const r = (data ?? {}) as { ok?: boolean; reason?: string };
    if (error || !r.ok) {
      setCoOps((l) => l.filter((x) => x !== op));
      toastError(error ? "Couldn't save that. Check your connection." : wfReasonText(r.reason ?? ''));
      return;
    }
    void onRefresh();
  };

  /** Fred takes the customer's signature himself: the picture goes with the job's photos. */
  const ownerSign = async (name: string, signature: Blob) => {
    const fd = new FormData();
    fd.append('wo_number', w.wo_number);
    fd.append('file', new File([signature], 'signature.jpg', { type: 'image/jpeg' }));
    try {
      const res = await fetch('/api/jobs/signature', { method: 'POST', body: fd });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) { toastError(json.error ?? "The signature didn't save."); return; }
    } catch {
      toastError("The signature didn't save. Check your connection.");
      return;
    }
    await closeoutOp({ op: 'sign', name, at: new Date().toISOString() });
    toastSuccess('Signed off.');
  };

  const toggleTask = async (t: WfTask, done: boolean) => {
    setTicked((m) => ({ ...m, [t.id]: done }));
    const { data, error } = await createClient().rpc('wf_set_task', { p_wo_number: w.wo_number, p_task_id: t.id, p_done: done });
    const r = (data ?? {}) as { ok?: boolean; reason?: string };
    if (error || !r.ok) {
      setTicked((m) => { const n = { ...m }; delete n[t.id]; return n; });
      toastError(error ? "Couldn't save that tick. Check your connection." : wfReasonText(r.reason ?? ''));
      return;
    }
    void onRefresh();
  };

  const contractor = contractors.find((c) => c.name === w.contractor_name);
  const canSendPortal = !!(contractor?.email && contractor?.portal_token);
  const archived = !!w.archived_at;
  const address = fullAddress(job);

  // Fred, 2026-10-02: "make it readable and manageable". The everyday
  // buttons stay in view; the rarer ones sit under More.
  const actions = (
    <>
      <button className="wf-btn wf-btn-navy wf-btn-sm" onClick={() => onEdit(w)}><Edit2 size={15} /> Edit job</button>
      {/* At the top with the other buttons (Fred, 2026-10-18: "Assign tech can go at the top"). */}
      {!archived && (
        <button className={`wf-btn wf-btn-sm ${job.techs.length ? 'wf-btn-outline' : 'wf-btn-gold'}`} onClick={() => setPicking(true)}>
          <UserCog size={15} /> {job.techs.length ? 'Change techs' : 'Assign techs'}
        </button>
      )}
      <button className="wf-btn wf-btn-outline wf-btn-sm" onClick={() => setChatOpen((v) => !v)} aria-pressed={chatOpen}>
        <MessageSquare size={15} /> Messages
      </button>
      <button className="wf-btn wf-btn-outline wf-btn-sm" onClick={() => onSend(w)}><Send size={15} /> Send to tech</button>
      <button className="wf-btn wf-btn-outline wf-btn-sm" onClick={() => setLogOpen(true)}><FileText size={15} /> Job log</button>
      {w.remaining > 0 && (
        <button className="wf-btn wf-btn-success wf-btn-sm" onClick={() => onPay(w)}><DollarSign size={15} /> Pay tech</button>
      )}
      {!archived && (
        <button className="wf-btn wf-btn-outline wf-btn-sm" onClick={() => onCloseJob(w)}
          title={w.remaining > 0 ? `${fmtMoney(w.remaining)} still owed — closes as Approved` : 'Everyone is paid — moves to Closed'}>
          <CheckCircle2 size={15} /> Close job
        </button>
      )}
      <MoreMenu items={[
        address ? { label: 'Directions', icon: <Navigation size={15} />, href: mapsDirections(job) } : null,
        canSendPortal ? {
          label: portalBusy ? 'Sending portal link…' : 'Send portal link', icon: <CalendarDays size={15} />,
          onClick: async () => { setPortalBusy(true); try { await onSendPortal(w); } finally { setPortalBusy(false); } },
        } : null,
        { label: 'Duplicate', icon: <Copy size={15} />, onClick: () => onDuplicate(w) },
        sketchCount === 0 && !addSketch ? { label: 'Add a sketch', icon: <FilePlus2 size={15} />, onClick: () => setAddSketch(true) } : null,
        archived
          ? { label: 'Restore from Closed', icon: <ArchiveRestore size={15} />, onClick: () => onUnarchive(w.id) }
          : { label: 'Archive', icon: <Archive size={15} />, onClick: () => onArchive(w.id) },
        { label: 'Delete', icon: <Trash2 size={15} />, danger: true, onClick: () => setAskDelete(true) },
      ]} />
    </>
  );

  const jobDesign = designNow();
  const jobCards: Record<string, ReactNode> = {
    'job.timeRequests': !archived && <TimeRequestsCard w={w} job={job} onSaved={refresh} />,
    'job.techs': <TechsCard w={w} job={job}
      onSendAgain={archived ? undefined : (t) => void sendAgain(t)}
      onToolsChange={archived ? undefined : (on) => void setTechTools(on)} />,
    'job.fields': <YourFieldsCard w={w} />,
    'job.closeout': showCloseout(job) && (
      <CloseoutCard job={job} items={checklist.items} listName={checklist.name} canEdit={!archived} ownerView
        onOp={(op) => void closeoutOp(op)} onSign={ownerSign} />
    ),
    // Every job's drives and time on site with the miles (Fred, 2026-10-18:
    // home → hotel, hotel → site, site → hotel, the hotel → home on the last day).
    'job.project': <ProjectDayCard w={w} lists={lists} billed={billed} />,
    'job.notes': <JobNotesCard woId={w.id} author={author ?? 'Office'} />,
    'job.docs': <JobDocsCard woId={w.id} files={w.doc_urls} jobLabel={`WO ${w.wo_number}${w.site_name || w.customer_name ? ` · ${w.site_name || w.customer_name}` : ''}`} archived={archived} />,
    'job.report': <OwnerReport w={w} onEdit={() => onEdit(w)} />,
    'job.expenses': <OwnerExpenses woId={w.id} onDecided={() => void onRefresh()} />,
    'job.photos': <OwnerPhotos w={w} />,
    // Only when the job has a sketch, or Fred adds one from More (Fred, 2026-10-18:
    // "Sketches can go too, I'll add it if I need it").
    'job.sketches': (sketchCount > 0 || addSketch) && (
      <Section title="Sketches" subtitle="Floor plan, cable runs, cameras, APs and drops — drawn to scale">
        <SketchesPanel woId={w.id} compact defaultTitle={`WO ${w.wo_number}${w.site_name ? ` · ${w.site_name}` : w.title ? ` · ${w.title}` : ''}`} />
      </Section>
    ),
  };

  return (
    <>
      <WfJobDetail
        job={job}
        ownerView
        loggedMs={clockMs ?? undefined}
        billedHours={billedHoursOf(billed)}
        onBack={onBack}
        onRefresh={refresh}
        refreshing={refreshing}
        actions={actions}
        onToggleTask={archived ? undefined : toggleTask}
        // Each card can be switched off in Settings -> What each screen shows,
        // and moved between the two columns in Settings -> Screen designer.
        side={<>{jobDesign.jobSide.filter(partShown).map((k) => <Fragment key={k}>{jobCards[k]}</Fragment>)}</>}
        below={<>
          <JobGapsCard job={job} woId={w.id} deliverables={checklist.items} />
          {chatOpen && (
            <Section title="Messages" subtitle="The same thread the tech sees in their portal">
              <WorkOrderChatPanel woNumber={w.wo_number} />
            </Section>
          )}
          {jobDesign.jobBelow.filter(partShown).map((k) => <Fragment key={k}>{jobCards[k]}</Fragment>)}
        </>}
      />
      {logOpen && <JobLogReport w={w} deliverables={checklist.items} onClose={() => setLogOpen(false)} />}
      {askDelete && (
        <Dialog title={`Delete WO ${w.wo_number}?`} onClose={() => setAskDelete(false)}
          footer={<>
            <button className="wf-btn wf-btn-ghost" onClick={() => setAskDelete(false)}>Keep it</button>
            <button className="wf-btn" style={{ background: 'var(--wf-danger)', color: '#fff' }}
              onClick={() => { setAskDelete(false); onDelete(w.id); }}>Yes, delete</button>
          </>}>
          <p style={{ margin: 0 }}>{w.title || 'This job'} is removed for good, with its time, photos and receipts. This can&apos;t be undone.</p>
          <p className="wf-subtle" style={{ marginTop: 8, fontSize: 13 }}>To take it off the board but keep it, use Archive instead.</p>
        </Dialog>
      )}
      {picking && (
        <TechPicker
          w={w} job={job} contractors={contractors}
          onClose={() => setPicking(false)}
          onSaved={async () => { setPicking(false); await refresh(); }}
          onReassign={() => { setPicking(false); onReassign(w); }}
        />
      )}
    </>
  );
}

// ── Documents on the job (iScanner-style, migrations 115–116): PDFs techs
// scanned or signed in the field, and PDFs added here — filled in, signed or
// marked up in the PDF editor (Fred, 2026-10-07: "edit and sign pdfs
// everything from iscanner"). Tick "Techs can open" on one and the techs on
// the job get it under Tools to fill in and sign; their signed copy comes back
// here. Private: opened through a short-lived signed link, never a public one.

type JobDoc = { id: string; name: string; kind: string; pages: number | null; sent_by: string | null; path: string; created_at: string; for_tech: boolean };

/** A file added in Edit job (Documents): its name without the upload stamp. */
const officeFileName = (url: string) => {
  const raw = url.split('/wo-docs/')[1] ?? url;
  let name = raw;
  try { name = decodeURIComponent(raw); } catch { /* keep it as it is */ }
  return name.replace(/^\d{13}-/, '').replace(/_/g, ' ');
};

/** A PDF with its blank paper cut away, or as it is. */
async function trimmed(file: Blob): Promise<Blob> {
  try {
    const out = await trimPdf(new Uint8Array(await file.arrayBuffer()));
    return out ? new Blob([out.slice()], { type: 'application/pdf' }) : file;
  } catch { return file; }
}

function JobDocsCard({ woId, jobLabel, archived, files }: { woId: string; jobLabel: string; archived: boolean; files?: string[] | null }) {
  // Files added in Edit job live in work_orders.doc_urls, not job_docs. Fred
  // uploaded one and saw "nothing there" (2026-10-18), so they show here too.
  const officeFiles = (files ?? []).filter((u) => u.includes('/storage/v1/object/public/deliverables/wo-docs/'));
  const [docs, setDocs] = useState<JobDoc[] | null>(null);
  const [editing, setEditing] = useState<{ file: Blob; name: string; kind: string } | null>(null);
  // Open shows the document inside the app (components/tools/DocViewer). A plain link
  // spun forever on Fred's Android phone, which has no PDF viewer of its own (2026-10-23).
  const [viewing, setViewing] = useState<{ url: string; name: string; kind: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const load = async () => {
    const { data } = await createClient().from('job_docs').select('id, name, kind, pages, sent_by, path, created_at, for_tech').eq('wo_id', woId).order('created_at', { ascending: false });
    setDocs((data as JobDoc[] | null) ?? []);
  };
  useEffect(() => { void load(); }, [woId]); // eslint-disable-line react-hooks/exhaustive-deps
  useLiveRows('job_docs', woId, () => void load());
  if (!docs || (docs.length === 0 && officeFiles.length === 0 && archived)) return null;
  const open = async (d: JobDoc) => {
    const { data, error } = await createClient().storage.from('job-docs').createSignedUrl(d.path, 600);
    if (error || !data?.signedUrl) { toastError("That document couldn't be opened."); return; }
    setViewing({ url: data.signedUrl, name: /\.pdf$/i.test(d.name) ? d.name : `${d.name}.pdf`, kind: d.kind });
  };
  const editDoc = async (d: JobDoc) => {
    setBusyId(d.id);
    const { data, error } = await createClient().storage.from('job-docs').download(d.path);
    setBusyId(null);
    if (error || !data) { toastError("That document couldn't be opened."); return; }
    setEditing({ file: await trimmed(data), name: editedName(d.name), kind: d.kind });
  };
  /** Any document from the device. Fred uploaded a Google Sheet as a PDF and got a
   *  tiny table on a tall page (2026-10-23): a sheet, Word file or photo now goes in
   *  as it is, and a PDF's blank paper is cut away (lib/pdf-trim.ts). */
  const addFile = async (f: File) => {
    const base = f.name.replace(/\.[a-z0-9]+$/i, '');
    const k = docKind(f.name, f.type);
    try {
      if (k === 'pdf') setEditing({ file: await trimmed(f), name: base, kind: 'Work order' });
      else if (k === 'image') setEditing({ file: await photosToPdf([f]), name: base, kind: 'Other' });
      else if (k === 'word' || k === 'sheet') setViewing({ url: URL.createObjectURL(f), name: f.name, kind: 'Work order' });
      else toastError('That kind of file can’t be added. Use a PDF, Word, Excel or Google Sheet download, or a photo.');
    } catch { toastError('That file couldn’t be opened.'); }
  };
  const closeViewer = () => { if (viewing?.url.startsWith('blob:')) URL.revokeObjectURL(viewing.url); setViewing(null); };
  const share = async (d: JobDoc) => {
    setBusyId(d.id);
    const { error } = await createClient().from('job_docs').update({ for_tech: !d.for_tech }).eq('id', d.id);
    setBusyId(null);
    if (error) { toastError(`It wasn't changed: ${error.message}`); return; }
    toastSuccess(d.for_tech ? `Techs can no longer open "${d.name}".` : `Techs on this job can now open "${d.name}" under Tools to fill in and sign.`);
    await load();
  };
  const remove = async (d: JobDoc) => {
    if (!confirm(`Delete "${d.name}"? This can't be undone.`)) return;
    const db = createClient();
    const { error } = await db.from('job_docs').delete().eq('id', d.id);
    if (error) { toastError(`It wasn't deleted: ${error.message}`); return; }
    await db.storage.from('job-docs').remove([d.path]);
    await load();
  };
  /** File a finished PDF from the editor on this job (a new document; the original stays). */
  const save = async (r: SendResult): Promise<boolean> => {
    const db = createClient();
    const { data: me } = await db.auth.getUser();
    const uid = me.user?.id;
    if (!uid) { toastError('Your sign-in ran out. Sign in again and retry.'); return false; }
    const path = `${uid}/${woId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.pdf`;
    const { error: upErr } = await db.storage.from('job-docs').upload(path, r.blob, { contentType: 'application/pdf', upsert: false });
    if (upErr) { toastError(`It wasn't saved: ${upErr.message}`); return false; }
    const { error } = await db.from('job_docs').insert({
      user_id: uid, wo_id: woId, path, name: r.name.slice(0, 120) || 'Document', kind: r.kind.slice(0, 40),
      pages: r.pages, bytes: r.blob.size, for_tech: r.forTech,
    });
    if (error) { await db.storage.from('job-docs').remove([path]); toastError(`It wasn't saved: ${error.message}`); return false; }
    toastSuccess(r.forTech ? 'Saved to the job — the techs on it can open it under Tools.' : 'Saved to the job.');
    await load();
    return true;
  };
  const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  return (
    <Section title="Documents" subtitle="Documents on the job — scans and signed copies from techs, and PDFs, Word files and sheets to fill in and sign"
      right={!archived ? (
        <label className="wf-btn wf-btn-outline wf-btn-sm" style={{ cursor: 'pointer' }}>
          <FilePlus2 size={14} /> Add a document
          <input type="file" accept="application/pdf,.pdf,.docx,.xlsx,.xls,.csv,image/*" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void addFile(f); }} />
        </label>
      ) : undefined}>
      {officeFiles.map((u) => (
        <div key={u} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderTop: '1px solid var(--wf-line)', flexWrap: 'wrap' }}>
          <span style={{ flex: '1 1 200px', minWidth: 0 }}>
            <span style={{ display: 'block', fontWeight: 600, overflowWrap: 'anywhere' }}>{officeFileName(u)}</span>
            <span className="wf-subtle" style={{ fontSize: 12.5 }}>Added in Edit job · the techs on this job can open it</span>
          </span>
          <button className="wf-btn wf-btn-outline wf-btn-sm" onClick={() => setViewing({ url: u, name: officeFileName(u), kind: 'Signed document' })}>Open</button>
        </div>
      ))}
      {docs.length === 0 ? (officeFiles.length > 0 ? null : (
        <div className="wf-subtle" style={{ fontSize: 13.5 }}>
          Nothing yet. Add a document — a PDF, Word file, Excel or Google Sheet, or a photo — to fill in or sign it here — tick &ldquo;Techs on this job can open it&rdquo; and they can sign it on site.
        </div>
      )) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {docs.map((d) => (
            <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderTop: '1px solid var(--wf-line)', flexWrap: 'wrap' }}>
              <span style={{ flex: '1 1 200px', minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: 600 }}>{d.name}</span>
                <span className="wf-subtle" style={{ fontSize: 12.5 }}>{d.kind}{d.pages ? ` · ${d.pages} page${d.pages === 1 ? '' : 's'}` : ''} · {d.sent_by ? `${d.sent_by} · ` : ''}{when(d.created_at)}</span>
                {d.for_tech && <span style={{ display: 'inline-block', marginLeft: 6, fontSize: 11.5, fontWeight: 700, color: 'var(--wf-success)' }}>· Techs can open</span>}
              </span>
              <button className="wf-btn wf-btn-outline wf-btn-sm" onClick={() => void open(d)}>Open</button>
              {!archived && <button className="wf-btn wf-btn-outline wf-btn-sm" disabled={busyId === d.id} onClick={() => void editDoc(d)}><Signature size={14} /> Edit / sign</button>}
              {!archived && (
                <button className="wf-btn wf-btn-ghost wf-btn-sm" disabled={busyId === d.id} onClick={() => void share(d)} aria-pressed={d.for_tech}
                  title={d.for_tech ? 'Stop the techs on this job opening it' : 'Let the techs on this job open it to fill in and sign'}>
                  <Users size={14} /> {d.for_tech ? 'Unshare' : 'Share with techs'}
                </button>
              )}
              <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={() => void remove(d)} aria-label={`Delete ${d.name}`}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      )}
      {viewing && (
        <DocViewer url={viewing.url} name={viewing.name} onClose={closeViewer}
          onSign={archived ? undefined : (pdf, name) => { const kind = viewing.kind; const fresh = viewing.url.startsWith('blob:'); closeViewer(); setEditing({ file: pdf, name: fresh ? name : editedName(name), kind }); }} />
      )}
      {editing && (
        <PdfEditor file={editing.file} name={editing.name} heading={jobLabel}
          send={{ label: 'Save to the job', kinds: [...DOC_KINDS], defaultKind: editing.kind, techToggle: true }}
          onSend={save} onClose={() => setEditing(null)} />
      )}
    </Section>
  );
}

// ── Notes (from SimplySub's job page, Fred 2026-10-06: "add some of these
// features") — dated office notes with a kind and who wrote them. Saved in
// job_notes (migration 114): owner only, never sent to a tech.

const NOTE_KINDS = ['General', 'Site', 'Billing', 'Client', 'Follow-up'];
type JobNote = { id: string; body: string; kind: string; author: string | null; created_at: string };

function JobNotesCard({ woId, author }: { woId: string; author: string }) {
  const [notes, setNotes] = useState<JobNote[] | null>(null);
  const [body, setBody] = useState('');
  const [kind, setKind] = useState('General');
  const [busy, setBusy] = useState(false);
  const load = async () => {
    const { data } = await createClient().from('job_notes').select('id, body, kind, author, created_at').eq('wo_id', woId).order('created_at', { ascending: false });
    setNotes((data as JobNote[] | null) ?? []);
  };
  useEffect(() => { void load(); }, [woId]); // eslint-disable-line react-hooks/exhaustive-deps
  useLiveRows('job_notes', woId, () => void load());
  const add = async () => {
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    const sb = createClient();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) { setBusy(false); toastError('You were signed out. Sign in again, then add the note.'); return; }
    const { error } = await sb.from('job_notes').insert({ user_id: user.id, wo_id: woId, body: text.slice(0, 4000), kind, author });
    setBusy(false);
    if (error) { toastError(`The note didn't save: ${error.message}`); return; }
    setBody('');
    await load();
  };
  const remove = async (id: string) => {
    if (!confirm('Delete this note?')) return;
    const { error } = await createClient().from('job_notes').delete().eq('id', id);
    if (error) toastError(`The note wasn't deleted: ${error.message}`);
    await load();
  };
  const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  return (
    <Section title="Notes" subtitle="Office notes on this job — techs never see these">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select className="wf-input" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind of note" style={{ width: 150 }}>
            {NOTE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
        <textarea className="wf-input" rows={3} value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000}
          placeholder="What happened, what to remember, what's next" aria-label="New note" />
        <div>
          <button className="wf-btn wf-btn-navy wf-btn-sm" disabled={busy || !body.trim()} onClick={() => void add()}>{busy ? 'Saving…' : 'Add note'}</button>
        </div>
        {notes === null ? <div className="wf-subtle" style={{ fontSize: 13 }}>Loading…</div>
          : notes.length === 0 ? <div className="wf-subtle" style={{ fontSize: 13 }}>No notes yet.</div>
          : notes.map((n) => (
            <div key={n.id} style={{ borderTop: '1px solid var(--wf-line)', paddingTop: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12.5 }}>
                <span className="wf-chip" style={{ background: 'rgba(201,162,75,0.15)', color: '#8a6d2b', padding: '1px 8px' }}>{n.kind}</span>
                <span className="wf-subtle">{n.author ? `${n.author} · ` : ''}{when(n.created_at)}</span>
                <span style={{ flex: 1 }} />
                <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={() => void remove(n.id)} aria-label="Delete note" title="Delete note"><Trash2 size={14} /></button>
              </div>
              <div style={{ whiteSpace: 'pre-wrap', marginTop: 4, fontSize: 14 }}>{n.body}</div>
            </div>
          ))}
      </div>
    </Section>
  );
}

/**
 * A finished job: what the tech left undone (Fred, 2026-10-18: "if certain
 * items were not inputted then it should be in the final work order").
 * Nothing shows while the job is still going, or when everything was done.
 */
function JobGapsCard({ job, woId, deliverables }: { job: WfJob; woId: string; deliverables: string[] }) {
  const finished = isFinished(job);
  const [photoCount, setPhotoCount] = useState<number | null>(null);
  const load = async () => {
    const { count } = await createClient().from('wo_photos').select('id', { count: 'exact', head: true }).eq('wo_id', woId);
    setPhotoCount(count ?? 0);
  };
  useEffect(() => {
    if (!finished) return;
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [finished, woId]); // eslint-disable-line react-hooks/exhaustive-deps -- load reads only woId
  useLiveRows('wo_photos', woId, () => { if (finished) void load(); });
  if (!finished || photoCount === null) return null;
  const gaps = jobGaps(job, deliverables, photoCount);
  if (gaps.length === 0) return null;
  return (
    <Section title="Not completed" subtitle="What the tech left undone on this job">
      <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {gaps.map((g) => (
          <li key={g.text} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
            <span style={{ color: '#B42318', fontWeight: 700 }}>✗</span><span>{g.text}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/**
 * Closeout shows once a tech has the job, or as soon as anything is filled in,
 * and only on a job that asks for deliverables or a signature: the tech's
 * screen shows it on the same jobs (Fred, 2026-10-18: "i dont require signed
 * this work order").
 */
function showCloseout(job: WfJob): boolean {
  const c = job.closeout;
  if (c.done.length || c.delays.length || c.signoff) return true;
  if (job.capture && !asks(job.capture, 'deliverables') && !asks(job.capture, 'signature')) return false;
  return job.status === 'scheduled' || job.status === 'inProgress' || job.status === 'workDone' || job.status === 'closed';
}

// ── A tech asks for another time (Primio's counter-offer, never pay) ───────
// Fred, 2026-10-04: "No pay for techs". A tech offered a job can only ask for
// another date and time. Use it (the job moves and the tech counts as having
// accepted) or keep the original (the offer still stands).

function TimeRequestsCard({ w, job, onSaved }: { w: EnrichedWorkOrder; job: WfJob; onSaved: () => Promise<void> | void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const waiting = waitingRequests(job.timeRequests, job.techs);
  if (waiting.length === 0) return null;

  const answer = async (name: string, use: boolean) => {
    const patch = use ? acceptTimePatch(w, name) : keepTimePatch(w, name);
    if (!patch) return;
    if (use && job.techs.length > 1 && !confirm(`This moves WO ${w.wo_number} for everyone on it, not only ${name}. Go ahead?`)) return;
    setBusy(name);
    const { error } = await createClient().from('work_orders').update(patch).eq('id', w.id);
    setBusy(null);
    if (error) { toastError(`Couldn't save that: ${error.message}`); return; }
    const req = job.timeRequests[name];
    logAudit({
      action: 'update', entityType: 'work_order', entityId: w.id, entityLabel: `WO#${w.wo_number}`,
      changes: use
        ? { start_date: { from: w.start_date ?? null, to: req.date }, ...(req.time ? { start_time: { from: w.start_time ?? null, to: req.time } } : {}), via: `time asked by ${name}` }
        : { time_request: { tech: name, kept: 'original time' } },
    });
    toastSuccess(use ? `Moved to ${requestWhen(req)}. ${name.split(' ')[0]} is on it.` : `Kept the original time. ${name.split(' ')[0]} sees your answer.`);
    await onSaved();
  };

  return (
    <Section title="Another time asked" subtitle={`Now: ${whenText(job)}`} right={<CalendarClock size={18} color="var(--wf-warning)" />}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {waiting.map(([name, r]) => (
          <div key={name}>
            <div style={{ fontWeight: 600 }}>{name} asks for {requestWhen(r)}</div>
            {r.note && <div style={{ fontSize: 13.5, marginTop: 2, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>&ldquo;{r.note}&rdquo;</div>}
            {r.at && <div className="wf-subtle" style={{ fontSize: 12 }}>Asked {new Date(r.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <button className="wf-btn wf-btn-gold wf-btn-sm" disabled={busy !== null} onClick={() => void answer(name, true)}>
                <CheckCircle2 size={15} /> Use this time
              </button>
              <button className="wf-btn wf-btn-outline wf-btn-sm" disabled={busy !== null} onClick={() => void answer(name, false)}>
                Keep the original
              </button>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

const ANSWER: Record<string, { label: string; color: string }> = {
  accepted: { label: 'Accepted', color: 'var(--wf-success)' },
  declined: { label: 'Declined', color: 'var(--wf-danger)' },
};

/**
 * Who is on the job and how each answered. No pay here (Fred, 2026-10-18:
 * "Still seeing money"): tech pay is set in Edit job, on the Pay tab.
 */
function TechsCard({ w, job, onSendAgain, onToolsChange }: {
  w: EnrichedWorkOrder; job: WfJob; onSendAgain?: (tech: string) => void;
  onToolsChange?: (on: boolean) => void;
}) {
  return (
    <Section title="Techs" right={<Users size={18} color="var(--wf-subtle)" />}>
      {job.techs.length === 0 ? (
        <div style={{ color: 'var(--wf-danger)', fontWeight: 700 }}>Nobody on this job yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {job.techs.map((t) => {
            const a = ANSWER[job.answers[t] ?? ''];
            return (
              <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 600 }}>{t}</span>
                  <span style={{ display: 'block', fontSize: 12, color: a?.color ?? 'var(--wf-subtle)' }}>
                    {a?.label ?? (job.status === 'open' || job.status === 'offered' ? 'Has not answered yet' : 'On the job')}
                  </span>
                </span>
                {onSendAgain && job.answers[t] === 'declined' && (
                  <button className="wf-btn wf-btn-outline wf-btn-sm" onClick={() => onSendAgain(t)}>Send it again</button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {onToolsChange && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--wf-line)' }}>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ fontWeight: 600 }}>Tools for the tech</span>
            <span style={{ display: 'block', fontSize: 12, color: 'var(--wf-subtle)' }}>
              {w.tech_tools ? 'On: scan, sign a PDF, read codes, count and measure.' : 'Off. Turn on if this job needs scanning, signing a PDF, reading codes, counting or measuring.'}
            </span>
          </span>
          <button className={`wf-btn wf-btn-sm ${w.tech_tools ? 'wf-btn-outline' : 'wf-btn-gold'}`} onClick={() => onToolsChange(!w.tech_tools)}>
            {w.tech_tools ? 'Turn off' : 'Turn on'}
          </button>
        </div>
      )}
      {/* Assign / Change techs is in the row of buttons at the top of the job now. */}
    </Section>
  );
}

/** Only the office sees this: what the client pays, what the techs get, what FAJ keeps. */
/** Fred's own fields on this job (Settings -> Custom fields), when answered. Office only. */
function YourFieldsCard({ w }: { w: EnrichedWorkOrder }) {
  if (answeredFields('jobs', w.custom).length === 0) return null;
  return (
    <Section title="Your fields" subtitle="Your own details on this job — techs don't see these">
      <CustomFieldList target="jobs" values={w.custom} />
    </Section>
  );
}

/**
 * Pick the techs for a job, each with what they get. Goes through
 * wf_set_techs (migration-098): a tech who has already been paid on the job
 * cannot be dropped here — that is Reassign's job, because it splits the paid
 * and unpaid money. New techs get the job as an offer to accept.
 */
function TechPicker({ w, job, contractors, onClose, onSaved, onReassign }: {
  w: EnrichedWorkOrder; job: WfJob; contractors: Contractor[];
  onClose: () => void; onSaved: () => void; onReassign: () => void;
}) {
  const [picked, setPicked] = useState<Record<string, string>>(() => Object.fromEntries(
    job.techs.map((t) => [t, w.contractor_pay?.[t] != null ? String(w.contractor_pay[t]) : '']),
  ));
  const [saving, setSaving] = useState(false);
  const [paidBlock, setPaidBlock] = useState<string | null>(null);
  const names = [...new Set([...contractors.map((c) => c.name), ...job.techs])].sort((a, b) => a.localeCompare(b));

  const toggle = (n: string) => setPicked((p) => {
    const next = { ...p };
    if (n in next) delete next[n]; else next[n] = '';
    return next;
  });

  const save = async () => {
    for (const [n, v] of Object.entries(picked)) {
      if (v.trim() && !(Number(v.replace(/[$,\s]/g, '')) >= 0)) { toastError(`${n}'s pay is not a number.`); return; }
    }
    setSaving(true);
    const techs = Object.entries(picked).map(([name, v]) => ({ name, pay: v.replace(/[$,\s]/g, '') }));
    const { data, error } = await createClient().rpc('wf_set_techs', { p_wo_id: w.id, p_techs: techs });
    setSaving(false);
    const r = (data ?? {}) as { ok?: boolean; reason?: string; name?: string };
    if (error) { toastError("Couldn't save the techs. Check your connection."); return; }
    if (!r.ok) {
      if (r.reason === 'paid_tech') { setPaidBlock(r.name ?? 'A tech'); return; }
      toastError(wfReasonText(r.reason ?? '', r.name));
      return;
    }
    // New techs get the new-job notice, the same as a brand-new job (Fred,
    // 2026-10-18). Pay only when it was typed in for them here.
    const added = Array.isArray((r as { added?: unknown }).added) ? (r as { added: string[] }).added : [];
    for (const n of added) {
      const c = contractors.find((x) => x.name === n);
      if (!c?.email || c.on_hold) continue;
      const typed = Number((picked[n] ?? '').replace(/[$,\s]/g, ''));
      void sendNewJobNotice(w, c, picked[n]?.trim() && typed > 0 ? typed : null);
    }
    toastSuccess(techs.length ? `Techs saved on WO ${w.wo_number}${added.length ? `. Sent to ${added.join(', ')}` : ''}` : `WO ${w.wo_number} now needs a tech`);
    onSaved();
  };

  return (
    <Dialog
      title={`Techs on WO ${w.wo_number}`}
      onClose={onClose}
      footer={<>
        <button className="wf-btn wf-btn-ghost" onClick={onClose}>Cancel</button>
        <button className="wf-btn wf-btn-navy" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      </>}
    >
      <div className="wf-filters">
        {names.map((n) => {
          const held = !!contractors.find((c) => c.name === n)?.on_hold && !(n in picked);
          return (
            <button key={n} className="wf-filter" aria-pressed={n in picked} disabled={held} onClick={() => toggle(n)}
              title={held ? 'On hold. Release them in Team first.' : undefined} style={held ? { opacity: 0.5 } : undefined}>
              {n}{held ? ' · on hold' : ''}
            </button>
          );
        })}
      </div>
      {Object.keys(picked).length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
          {Object.entries(picked).map(([n, v]) => (
            <label key={n} style={{ display: 'block' }}>
              <span className="wf-label" style={{ display: 'block', marginBottom: 4 }}>{n} gets ($)</span>
              <input className="wf-input" inputMode="decimal" value={v} placeholder="Leave blank if not decided"
                onChange={(e) => setPicked((p) => ({ ...p, [n]: e.target.value }))} />
            </label>
          ))}
        </div>
      )}
      {paidBlock && (
        <div style={{ marginTop: 14, padding: 12, borderRadius: 12, background: 'rgba(180,83,9,0.08)', color: 'var(--wf-warning)' }}>
          {paidBlock} has already been paid on this job, so they can&apos;t simply be taken off.
          <button className="wf-btn wf-btn-outline wf-btn-sm" style={{ marginTop: 8 }} onClick={onReassign}>Use Reassign instead</button>
        </div>
      )}
      <div className="wf-subtle" style={{ fontSize: 12.5, marginTop: 14 }}>
        Tap names to add or take techs off. New techs are sent the job to accept: by email the first time, on their phone once they use the tech app. Pay left blank shows as &ldquo;Pay not set&rdquo; until you fill it in.
      </div>
      {job.techs.length > 0 && !paidBlock && (
        <div style={{ marginTop: 14, padding: 12, borderRadius: 12, border: '1px solid var(--wf-line)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ flex: '1 1 220px', fontSize: 13.5 }}>
            <b>Handing the job from one tech to another?</b>
            <span className="wf-subtle" style={{ display: 'block', fontSize: 12.5 }}>Reassign moves it and keeps what&apos;s already been paid with the right tech.</span>
          </span>
          <button className="wf-btn wf-btn-outline wf-btn-sm" onClick={onReassign}>Reassign…</button>
        </div>
      )}
    </Dialog>
  );
}

type MoreItem = { label: string; icon: ReactNode; onClick?: () => void; href?: string; danger?: boolean };

/** "More ▾": the job's less frequent buttons, out of the way until needed. */
function MoreMenu({ items }: { items: (MoreItem | null)[] }) {
  const [open, setOpen] = useState(false);
  const list = items.filter((i): i is MoreItem => !!i);
  const row: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '11px 14px', border: 'none', background: 'none',
    font: 'inherit', fontSize: 14, fontWeight: 500, textAlign: 'left', cursor: 'pointer', textDecoration: 'none', color: 'var(--wf-text)',
  };
  return (
    <div style={{ position: 'relative' }}>
      <button className="wf-btn wf-btn-outline wf-btn-sm" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <MoreHorizontal size={16} /> More
      </button>
      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 30 }} onClick={() => setOpen(false)} />
          <div role="menu" className="wf-card" style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 31, minWidth: 220, padding: '6px 0', boxShadow: '0 12px 36px rgba(14,27,46,0.16)' }}>
            {list.map((i) => i.href ? (
              <a key={i.label} role="menuitem" href={i.href} target="_blank" rel="noopener noreferrer" style={row} onClick={() => setOpen(false)}>
                {i.icon} {i.label}
              </a>
            ) : (
              <button key={i.label} role="menuitem" style={{ ...row, color: i.danger ? 'var(--wf-danger)' : row.color }}
                onClick={() => { setOpen(false); i.onClick?.(); }}>
                {i.icon} {i.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

type PhotoRow = { id: string; url: string; taken_at: string; lat: number | null; lng: number | null; contractor_name: string | null };

/**
 * The job's photos (Fred, 2026-10-02): what the techs took in their portal,
 * stamped with the date, time and GPS, plus any other pictures already on the
 * job. Each tech photo links to the spot on the map where it was taken.
 *
 * Fred, 2026-10-26 ("still unable to download photo or add them"): Add photos
 * puts pictures from the office's device on the job (components/AddJobPhotos),
 * and each photo has Download, which saves it to the device.
 */
function OwnerPhotos({ w }: { w: EnrichedWorkOrder }) {
  const [rows, setRows] = useState<PhotoRow[] | null>(null);
  const [added, setAdded] = useState(0);
  useEffect(() => {
    createClient().from('wo_photos').select('id, url, taken_at, lat, lng, contractor_name').eq('wo_id', w.id)
      .order('taken_at', { ascending: false })
      .then(({ data }) => setRows((data as PhotoRow[] | null) ?? []));
  }, [w.id, w.doc_urls, added]);

  const tech = new Set((rows ?? []).map((r) => r.url));
  const others = (w.doc_urls ?? []).filter((u) => !tech.has(u) && /\.(jpe?g|png|gif|webp|heic)(\?|$)/i.test(u));
  if (rows === null) return null;

  const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const fileDay = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', timeZone: 'America/New_York' }).replace(/\//g, '-');
  const tile = { width: '100%', aspectRatio: '1', objectFit: 'cover' as const, borderRadius: 10, display: 'block' };
  const save = (href: string, name: string, what: string) => (
    <a href={downloadHref(href, name)} download={name} aria-label={`Download ${what}`} style={{ color: 'var(--wf-navy)', fontWeight: 600 }}>
      <Download size={12} style={{ verticalAlign: '-2px' }} /> Download
    </a>
  );
  const crew = (w.contractor_names?.length ? w.contractor_names : [w.contractor_name]).filter((t): t is string => !!t);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  return (
    <Section title="Photos" subtitle={rows.length + others.length ? `${rows.length + others.length} on this job` : 'None yet'}
      right={<AddJobPhotos woId={w.id} woNumber={w.wo_number} techs={crew} day={photoDay(w.start_date, w.end_date, today)} onAdded={() => setAdded((n) => n + 1)} />}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10 }}>
        {rows.map((p, i) => {
          const what = `photo by ${p.contractor_name ?? 'tech'}, ${when(p.taken_at)}`;
          return (
            <div key={p.id}>
              <a href={p.url} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt={`Photo by ${p.contractor_name ?? 'tech'}, ${when(p.taken_at)}`} loading="lazy" style={tile} />
              </a>
              <div style={{ fontSize: 11.5, color: 'var(--wf-subtle)', marginTop: 3, lineHeight: 1.35 }}>
                {p.contractor_name && <div style={{ fontWeight: 600, color: 'var(--wf-text)' }}>{p.contractor_name}</div>}
                {when(p.taken_at)}
                {p.lat != null && p.lng != null && <> · <a href={mapLink(p.lat, p.lng)} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--wf-navy)' }}>map</a></>}
                <div>{save(p.url, photoFileName([`WO ${w.wo_number}`, p.contractor_name, fileDay(p.taken_at), String(rows.length - i)]), what)}</div>
              </div>
            </div>
          );
        })}
        {others.map((u, i) => (
          <div key={u}>
            <a href={u} target="_blank" rel="noopener noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u} alt="Job photo" loading="lazy" style={tile} />
            </a>
            <div style={{ fontSize: 11.5, marginTop: 3 }}>{save(u, photoFileName([`WO ${w.wo_number}`, 'photo', String(i + 1)], (u.match(/\.(jpe?g|png|gif|webp|heic)(\?|$)/i)?.[1] ?? 'jpg').toLowerCase()), `job photo ${i + 1}`)}</div>
          </div>
        ))}
      </div>
    </Section>
  );
}

/**
 * What the tech reported: their notes for the office and their answers to the
 * job's questions (Fred, 2026-10-02). Questions are set, and answers can be
 * corrected, in Edit job.
 */
function OwnerReport({ w, onEdit }: { w: EnrichedWorkOrder; onEdit: () => void }) {
  const qa = w.custom_qa ?? [];
  const notes = (w.closeout_notes ?? '').trim();
  if (!notes && qa.length === 0) return null;
  const answered = qa.filter((q) => (q.answer ?? '').trim()).length;
  const isUrl = (v: string) => /^https?:\/\//.test(v);
  return (
    <Section
      title="Job report"
      subtitle={qa.length ? `${answered} of ${qa.length} questions answered` : 'From the tech'}
      right={<button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={onEdit}><Edit2 size={14} /> Edit</button>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {qa.map((q) => {
          const a = (q.answer ?? '').trim();
          return (
            <div key={q.id}>
              <div style={{ fontWeight: 600 }}>{q.label}</div>
              {!a ? <div style={{ color: 'var(--wf-warning)', fontSize: 13 }}>Not answered yet</div>
                : isUrl(a) ? (
                  <a href={a} target="_blank" rel="noopener noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={a} alt={q.label} style={{ maxWidth: 220, maxHeight: 140, borderRadius: 8, border: '1px solid var(--wf-line)', marginTop: 4 }} />
                  </a>
                ) : <div style={{ whiteSpace: 'pre-wrap' }}>{a}</div>}
            </div>
          );
        })}
        {notes && (
          <div>
            <div style={{ fontWeight: 600 }}>Notes from the tech</div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{notes}</div>
          </div>
        )}
      </div>
    </Section>
  );
}

// ── Expenses from techs (migration-103) ─────────────────────────────────────

type ExpenseRow = {
  id: string; wo_id: string; wo_number: string; contractor_name: string; category: string; vendor: string | null;
  amount: number; expense_date: string; note: string | null; receipt_path: string | null;
  status: ExpenseStatus; decline_reason: string | null;
  /** 'faj': a receipt the office added itself (migration 117) — nothing to approve, nobody to pay back. */
  paid_by?: 'tech' | 'faj';
};

/** The receipts techs put on this job, with Approve / Decline. */
function OwnerExpenses({ woId, onDecided }: { woId: string; onDecided: () => void }) {
  const [rows, setRows] = useState<ExpenseRow[] | null>(null);
  const load = async () => {
    const { data } = await createClient().from('job_expenses')
      .select('id, wo_id, wo_number, contractor_name, category, vendor, amount, expense_date, note, receipt_path, status, decline_reason, paid_by')
      .eq('wo_id', woId).order('created_at', { ascending: false });
    setRows((data as ExpenseRow[] | null) ?? []);
  };
  useEffect(() => { void load(); }, [woId]); // eslint-disable-line react-hooks/exhaustive-deps
  // The office adds receipts from the Project day card.
  useEffect(() => {
    const again = () => { void load(); };
    window.addEventListener(EXPENSES_CHANGED, again);
    return () => window.removeEventListener(EXPENSES_CHANGED, again);
  }, [woId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!rows || rows.length === 0) return null;
  const waiting = rows.filter((r) => r.status === 'submitted').length;
  const approved = rows.filter((r) => r.status === 'approved' && r.paid_by !== 'faj').reduce((s, r) => s + Number(r.amount), 0);
  const office = rows.filter((r) => r.paid_by === 'faj').reduce((s, r) => s + Number(r.amount), 0);
  return (
    <Section title="Expenses" subtitle={`${waiting ? `${waiting} waiting · ` : ''}${fmtMoney(approved)} approved — paid back to the tech, not billed to the client${office ? ` · ${fmtMoney(office)} paid by FAJ` : ''}`}>
      <ExpenseList rows={rows} onDecided={async () => { await load(); onDecided(); }} />
    </Section>
  );
}

/**
 * Expense rows with the receipt photo and the decision buttons. Approving
 * adds a line to the job's pay (paid to that tech, not billed to the client —
 * switch "bill client" on in Edit job if the client is paying for it).
 */
function ExpenseList({ rows, showJob = false, onOpenJob, onDecided }: {
  rows: ExpenseRow[]; showJob?: boolean; onOpenJob?: (woId: string) => void; onDecided: () => void | Promise<void>;
}) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    const paths = rows.map((r) => r.receipt_path).filter((p): p is string => !!p && !urls[p]);
    if (paths.length === 0) return;
    createClient().storage.from('job-receipts').createSignedUrls(paths, 60 * 30).then(({ data }) => {
      const next: Record<string, string> = {};
      for (const d of data ?? []) if (d.path && d.signedUrl) next[d.path] = d.signedUrl;
      setUrls((u) => ({ ...u, ...next }));
    });
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  /** A receipt the office added itself: removed with its file (no tech is involved). */
  const removeOffice = async (r: ExpenseRow) => {
    if (!confirm(`Remove the ${fmtMoney(r.amount)} ${expenseCategoryLabel(r.category).toLowerCase()} receipt?`)) return;
    setBusy(r.id);
    try {
      const res = await fetch(`/api/owner/expense?id=${encodeURIComponent(r.id)}`, { method: 'DELETE' });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) { toastError(j.error ?? "Couldn't remove it."); return; }
      toastSuccess('Receipt removed.');
      await onDecided();
    } finally {
      setBusy(null);
    }
  };

  const decide = async (r: ExpenseRow, approve: boolean) => {
    let reason: string | null = null;
    if (!approve) {
      reason = window.prompt(`Decline ${fmtMoney(r.amount)} from ${r.contractor_name}? Tell them why (optional):`, '');
      if (reason === null) return;
    }
    setBusy(r.id);
    const { data, error } = await createClient().rpc('wf_owner_decide_expense', { p_id: r.id, p_approve: approve, p_reason: reason });
    setBusy(null);
    const res = (data ?? {}) as { ok?: boolean; reason?: string };
    if (error || !res.ok) { toastError(error ? "Couldn't save that. Check your connection." : expenseReasonText(res.reason ?? '')); return; }
    toastSuccess(approve ? `Approved — ${fmtMoney(r.amount)} added to what ${r.contractor_name} is owed on WO ${r.wo_number}.` : 'Declined. The tech can see why.');
    await onDecided();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {rows.map((r) => {
        const st = EXPENSE_STATUS[r.status];
        const url = r.receipt_path ? urls[r.receipt_path] : null;
        return (
          <div key={r.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', paddingBottom: 12, borderBottom: '1px solid var(--wf-line)' }}>
            {url ? (
              <a href={url} target="_blank" rel="noopener noreferrer" style={{ flexShrink: 0 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="Receipt" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--wf-line)' }} />
              </a>
            ) : (
              <span style={{ width: 64, height: 64, flexShrink: 0, borderRadius: 10, background: '#F1EEE6', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--wf-subtle)', fontSize: 11, textAlign: 'center' }}>
                {r.receipt_path ? '…' : 'No photo'}
              </span>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span className="wf-display" style={{ fontWeight: 700, fontSize: 16 }}>{fmtMoney(r.amount)}</span>
                <span style={{ fontWeight: 600 }}>{expenseCategoryLabel(r.category)}{r.vendor ? ` · ${r.vendor}` : ''}</span>
                {r.paid_by === 'faj'
                  ? <span className="wf-chip" style={{ color: 'var(--wf-navy)', background: 'rgba(14,27,46,0.08)' }}>Paid by FAJ</span>
                  : <span className="wf-chip" style={{ color: st.color, background: st.bg }}>{r.status === 'submitted' ? 'Waiting' : st.label}</span>}
              </div>
              <div className="wf-subtle" style={{ fontSize: 12.5 }}>
                {r.contractor_name} · {new Date(`${r.expense_date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}
                {showJob && <> · {onOpenJob ? <button onClick={() => onOpenJob(r.wo_id)} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--wf-navy)', textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}>WO {r.wo_number}</button> : `WO ${r.wo_number}`}</>}
              </div>
              {r.note && <div style={{ fontSize: 13, marginTop: 2 }}>{r.note}</div>}
              {r.status === 'declined' && r.decline_reason && <div style={{ fontSize: 12.5, color: 'var(--wf-danger)' }}>Declined: {r.decline_reason}</div>}
              {r.paid_by === 'faj' ? (
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  <button className="wf-btn wf-btn-ghost wf-btn-sm" disabled={busy === r.id} onClick={() => void removeOffice(r)}>
                    <Trash2 size={15} /> Remove
                  </button>
                </div>
              ) : (
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                {r.status !== 'approved' && (
                  <button className="wf-btn wf-btn-success wf-btn-sm" disabled={busy === r.id} onClick={() => void decide(r, true)}>
                    <CheckCircle2 size={15} /> {r.status === 'declined' ? 'Approve instead' : 'Approve'}
                  </button>
                )}
                {r.status !== 'declined' && (
                  <button className="wf-btn wf-btn-warn wf-btn-sm" disabled={busy === r.id} onClick={() => void decide(r, false)}>
                    {r.status === 'approved' ? 'Undo — decline' : 'Decline'}
                  </button>
                )}
              </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
