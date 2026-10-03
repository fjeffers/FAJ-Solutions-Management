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
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Archive, ArchiveRestore, CalendarDays, CheckCircle2, Copy, DollarSign, Edit2, FileText, MessageSquare, MoreHorizontal, Navigation,
  Plus, Search, Send, Sparkles, Trash2, UserCog, Users, Wallet,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  wfJobFromOwner, matchesWf, sortWf, ownerCounts, bucketOf, bucketCounts, withTask, fullAddress, wfReasonText,
  type WfBucket, type WfJob, type WfTask,
} from '@/lib/wf';
import { fmtMoney, hasPaySplit, woProfitOrNull } from '@/lib/utils';
import { toastError, toastSuccess } from '@/lib/toast';
import type { Contractor, EnrichedWorkOrder } from '@/lib/types';
import WorkOrderChatPanel from '@/components/WorkOrderChatPanel';
import WOTimeLogs from '@/components/WOTimeLogs';
import JobLogReport from '@/components/JobLogReport';
import { mapLink } from '@/lib/geo';
import { Banner, BucketTabs, Dialog, Empty, Hero, JobCard, Section, greeting } from '@/components/wf/WfUi';
import WfJobDetail, { mapsDirections } from '@/components/wf/WfJobDetail';

type Row = { w: EnrichedWorkOrder; job: WfJob };

export default function WorkFlowView({
  workOrders, contractors, ownerFirstName, initialSearch = '', owedToTechs, modeSwitch,
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
  const [search, setSearch] = useState(initialSearch);
  // Available · Current · Pending · Closed — no "All jobs" (Fred, 2026-10-02).
  const [bucket, setBucket] = useState<WfBucket>('current');
  const setOpenId = onOpenChange;

  const rows: Row[] = useMemo(() => workOrders.map((w) => ({ w, job: wfJobFromOwner(w) })), [workOrders]);
  const counts = ownerCounts(rows.map((r) => r.job));

  // Closed reaches into the archive too; the other three are live jobs only.
  const searched = rows.filter((r) => matchesWf(r.job, search));
  const inBucket = searched.filter((r) => bucketOf(r.job.status, true) === bucket);
  const shown = sortWf(inBucket.map((r) => r.job))
    .map((j) => inBucket.find((r) => r.job.id === j.id)!)
    // Closed work reads newest first; everything else soonest first.
    .sort((a, b) => (bucket === 'closed' ? (b.w.updated_at ?? '').localeCompare(a.w.updated_at ?? '') : 0));
  const tabCounts = bucketCounts(searched.map((r) => r.job), true);

  const open = openId ? rows.find((r) => r.w.id === openId) ?? null : null;

  if (open) {
    return (
      <OwnerJob
        row={open}
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
          { value: String(counts.needTech), label: 'Need a tech', onClick: () => setBucket('available') },
          { value: String(counts.today), label: 'Today' },
          { value: String(counts.workDone), label: 'Work done', onClick: () => setBucket('pending') },
          { value: fmtMoney(owedToTechs), label: 'Owed to techs' },
        ]}
      />

      {counts.needTech > 0 && bucket !== 'available' && (
        <Banner
          tone="red"
          title="Needs a tech"
          subtitle={`${counts.needTech} ${counts.needTech === 1 ? 'job has' : 'jobs have'} nobody on it`}
          onClick={() => setBucket('available')}
        />
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h2 className="wf-title" style={{ flex: 1 }}>
          Work orders
        </h2>
        {modeSwitch}
      </div>

      <div style={{ position: 'relative' }}>
        <Search size={18} color="var(--wf-subtle)" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
        <input
          className="wf-input" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search WO number, client, city, tech…" aria-label="Search work orders" style={{ paddingLeft: 40 }}
        />
      </div>

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

// ── One job, from the office's side ─────────────────────────────────────────

function OwnerJob({
  row, contractors, onBack, onRefresh, onEdit, onDelete, onDuplicate, onPay, onSend, onSendPortal,
  onArchive, onUnarchive, onCloseJob, onReassign,
}: {
  row: Row;
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

  let job = row.job;
  for (const [id, done] of Object.entries(ticked)) job = withTask(job, id, done);

  const refresh = async () => {
    setRefreshing(true);
    try { await onRefresh(); setTicked({}); } finally { setRefreshing(false); }
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
        archived
          ? { label: 'Restore from Closed', icon: <ArchiveRestore size={15} />, onClick: () => onUnarchive(w.id) }
          : { label: 'Archive', icon: <Archive size={15} />, onClick: () => onArchive(w.id) },
        { label: 'Delete', icon: <Trash2 size={15} />, danger: true, onClick: () => { if (confirm(`Delete WO ${w.wo_number}? This cannot be undone.`)) onDelete(w.id); } },
      ]} />
    </>
  );

  return (
    <>
      <WfJobDetail
        job={job}
        ownerView
        onBack={onBack}
        onRefresh={refresh}
        refreshing={refreshing}
        actions={actions}
        onToggleTask={archived ? undefined : toggleTask}
        side={<>
          <TechsCard w={w} job={job} onChange={archived ? undefined : () => setPicking(true)} onReassign={() => onReassign(w)} />
          <MoneyCard w={w} />
        </>}
        below={<>
          {chatOpen && (
            <Section title="Messages" subtitle="The same thread the tech sees in their portal">
              <WorkOrderChatPanel woNumber={w.wo_number} />
            </Section>
          )}
          <OwnerReport w={w} onEdit={() => onEdit(w)} />
          <OwnerPhotos w={w} />
          <Section title="Time & GPS" subtitle="When each tech clocked in and out, and where they were">
            <WOTimeLogs woId={w.id} />
          </Section>
        </>}
      />
      {logOpen && <JobLogReport w={w} onClose={() => setLogOpen(false)} />}
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

const ANSWER: Record<string, { label: string; color: string }> = {
  accepted: { label: 'Accepted', color: 'var(--wf-success)' },
  declined: { label: 'Declined', color: 'var(--wf-danger)' },
};

/** Who is on the job, how each answered, what each gets — and a button to change it. */
function TechsCard({ w, job, onChange, onReassign }: {
  w: EnrichedWorkOrder; job: WfJob; onChange?: () => void; onReassign: () => void;
}) {
  const pay = w.contractor_pay ?? {};
  return (
    <Section title="Techs" right={<Users size={18} color="var(--wf-subtle)" />}>
      {job.techs.length === 0 ? (
        <div style={{ color: 'var(--wf-danger)', fontWeight: 700 }}>Nobody on this job yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {job.techs.map((t) => {
            const a = ANSWER[job.answers[t] ?? ''];
            const amount = pay[t];
            return (
              <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 600 }}>{t}</span>
                  <span style={{ display: 'block', fontSize: 12, color: a?.color ?? 'var(--wf-subtle)' }}>
                    {a?.label ?? (job.status === 'open' || job.status === 'offered' ? 'Has not answered yet' : 'On the job')}
                  </span>
                </span>
                {amount != null
                  ? <span className="wf-display" style={{ fontWeight: 600 }}>{fmtMoney(amount)}</span>
                  : <span className="wf-chip" style={{ color: 'var(--wf-warning)', background: 'rgba(180,83,9,0.1)' }}>Pay not set</span>}
              </div>
            );
          })}
        </div>
      )}
      {onChange && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <button className="wf-btn wf-btn-outline wf-btn-sm" style={{ flex: 1 }} onClick={onChange}>
            <UserCog size={15} /> {job.techs.length ? 'Change techs' : 'Assign techs'}
          </button>
          {job.techs.length > 0 && (
            <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={onReassign} title="Hand the job from one tech to another, splitting paid and unpaid money">
              Reassign…
            </button>
          )}
        </div>
      )}
    </Section>
  );
}

/** Only the office sees this: what the client pays, what the techs get, what FAJ keeps. */
function MoneyCard({ w }: { w: EnrichedWorkOrder }) {
  const paySet = hasPaySplit(w);
  const profit = woProfitOrNull(w);
  const line = (label: string, value: string, tone?: string, strong = false) => (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '4px 0' }}>
      <span style={{ flex: 1 }}>{label}</span>
      <span className="wf-display" style={{ fontWeight: strong ? 700 : 600, color: tone, fontSize: strong ? 17 : 15 }}>{value}</span>
    </div>
  );
  return (
    <Section title="Money" subtitle="Only you see this" right={<Wallet size={18} color="var(--wf-subtle)" />}>
      {line('Client pays', Number(w.total_amount) > 0 ? fmtMoney(w.total_amount) : 'No price yet')}
      {paySet ? line('Techs get', fmtMoney(w.payout_total)) : line('Techs get', 'Not set', 'var(--wf-warning)')}
      {line('Paid to techs', fmtMoney(w.paid))}
      {paySet && line('Still owed to techs', fmtMoney(w.remaining), w.remaining > 0 ? 'var(--wf-danger)' : 'var(--wf-success)')}
      <hr style={{ border: 'none', borderTop: '1px solid var(--wf-line)', margin: '8px 0' }} />
      {profit == null
        ? <div className="wf-subtle" style={{ fontSize: 12.5 }}>Set what the techs get to see what FAJ keeps.</div>
        : line('FAJ keeps', fmtMoney(profit), profit >= 0 ? 'var(--wf-success)' : 'var(--wf-danger)', true)}
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
    toastSuccess(techs.length ? `Techs saved on WO ${w.wo_number}` : `WO ${w.wo_number} now needs a tech`);
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
        {names.map((n) => (
          <button key={n} className="wf-filter" aria-pressed={n in picked} onClick={() => toggle(n)}>{n}</button>
        ))}
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
        New techs get the job as an offer to accept in their portal. Pay left blank shows as &ldquo;Pay not set&rdquo; until you fill it in.
      </div>
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
 */
function OwnerPhotos({ w }: { w: EnrichedWorkOrder }) {
  const [rows, setRows] = useState<PhotoRow[] | null>(null);
  useEffect(() => {
    createClient().from('wo_photos').select('id, url, taken_at, lat, lng, contractor_name').eq('wo_id', w.id)
      .order('taken_at', { ascending: false })
      .then(({ data }) => setRows((data as PhotoRow[] | null) ?? []));
  }, [w.id, w.doc_urls]);

  const tech = new Set((rows ?? []).map((r) => r.url));
  const others = (w.doc_urls ?? []).filter((u) => !tech.has(u) && /\.(jpe?g|png|gif|webp|heic)(\?|$)/i.test(u));
  if (rows === null) return null;
  if (rows.length === 0 && others.length === 0) return null;

  const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const tile = { width: '100%', aspectRatio: '1', objectFit: 'cover' as const, borderRadius: 10, display: 'block' };
  return (
    <Section title="Photos" subtitle={`${rows.length + others.length} on this job`}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10 }}>
        {rows.map((p) => (
          <div key={p.id}>
            <a href={p.url} target="_blank" rel="noopener noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={`Photo by ${p.contractor_name ?? 'tech'}, ${when(p.taken_at)}`} loading="lazy" style={tile} />
            </a>
            <div style={{ fontSize: 11.5, color: 'var(--wf-subtle)', marginTop: 3, lineHeight: 1.35 }}>
              {p.contractor_name && <div style={{ fontWeight: 600, color: 'var(--wf-text)' }}>{p.contractor_name}</div>}
              {when(p.taken_at)}
              {p.lat != null && p.lng != null && <> · <a href={mapLink(p.lat, p.lng)} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--wf-navy)' }}>map</a></>}
            </div>
          </div>
        ))}
        {others.map((u) => (
          <a key={u} href={u} target="_blank" rel="noopener noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={u} alt="Job photo" loading="lazy" style={tile} />
          </a>
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
