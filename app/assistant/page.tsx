'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  fetchAssistantMe, fetchAssistantJobs, fetchAssistantCrewSites, fetchAssistantTechs, fetchAssistantTasks,
  saveAssistantJob, setAssistantTask, staffReasonText, mergeWork, groupWork, matchesWork, todayEastern,
  openTaskCount, jobAddress, BUCKET_LABEL,
  type AssistantMe, type AssistantJob, type AssistantCrewSite, type AssistantTech, type StaffTask,
  type WorkItem, type AssistantJobPatch,
} from '@/lib/assistant';
import { fmtDate } from '@/lib/utils';
import { backdropClose } from '@/lib/backdrop';
import { useInactivityLogout } from '@/lib/useInactivityLogout';
import { toastError, toastSuccess } from '@/lib/toast';
import Toaster from '@/components/Toaster';
import {
  ClipboardList, LogOut, CheckCircle2, Circle, Briefcase, Users, Search, MapPin, Phone, Mail,
  X, Save, RotateCcw, CalendarDays,
} from 'lucide-react';

type Tab = 'tasks' | 'work' | 'techs';

export default function AssistantPage() {
  const router = useRouter();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [tab, setTab] = useState<Tab>('tasks');
  const [me, setMe] = useState<AssistantMe | null>(null);
  const [jobs, setJobs] = useState<AssistantJob[]>([]);
  const [sites, setSites] = useState<AssistantCrewSite[]>([]);
  const [techs, setTechs] = useState<AssistantTech[]>([]);
  const [tasks, setTasks] = useState<StaffTask[]>([]);

  const signOut = async () => {
    await supabase.auth.signOut();
    router.replace('/assistant/login');
  };
  useInactivityLogout(signOut);

  const loadAll = async () => {
    const [j, s, t, k] = await Promise.all([
      fetchAssistantJobs(), fetchAssistantCrewSites(), fetchAssistantTechs(), fetchAssistantTasks(),
    ]);
    setJobs(j); setSites(s); setTechs(t); setTasks(k);
  };

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace('/assistant/login'); return; }
      try {
        const who = await fetchAssistantMe();
        if (!who) { setDenied(true); setLoading(false); return; }
        setMe(who);
        await loadAll();
      } catch {
        setDenied(true);
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openTasks = openTaskCount(tasks);

  if (loading) {
    return (
      <Centered>
        <ClipboardList size={26} color="var(--gold)" style={{ marginBottom: 12 }} />
        <div className="serif" style={{ fontSize: 20, color: 'var(--teal)' }}>Loading…</div>
      </Centered>
    );
  }

  if (denied) {
    return (
      <Centered>
        <div className="glass card" style={{ maxWidth: 420, padding: 32, textAlign: 'center' }}>
          <ClipboardList size={26} color="#bbb" style={{ marginBottom: 10 }} />
          <div className="serif" style={{ fontSize: 22, marginBottom: 8 }}>Not an assistant account</div>
          <p style={{ color: '#666', fontSize: 13, lineHeight: 1.6, margin: '0 0 18px' }}>
            You&apos;re signed in, but this login isn&apos;t set up as an assistant, or it has been turned off.
            Ask Fred to check the Assistant screen in the main app.
          </p>
          <button className="btn btn-primary" onClick={signOut}>Sign out</button>
        </div>
      </Centered>
    );
  }

  return (
    <div style={{ minHeight: '100vh', paddingBottom: 40 }}>
      <Toaster />
      <header style={{
        background: 'linear-gradient(135deg, #0E1B2E 0%, #13284A 100%)', color: 'white',
        padding: '18px 16px 0', position: 'sticky', top: 0, zIndex: 20,
      }}>
        <div style={{ maxWidth: 900, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <ClipboardList size={15} color="var(--gold-light)" />
              <span className="display" style={{ fontSize: 10, color: 'var(--gold-light)', fontWeight: 700, letterSpacing: 1.5 }}>FAJ SOLUTIONS · ASSISTANT</span>
            </div>
            <div className="serif" style={{ fontSize: 21, fontWeight: 600, lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {me?.name}
            </div>
          </div>
          <button
            onClick={signOut}
            style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: 'white', cursor: 'pointer', borderRadius: 999, padding: '8px 13px', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, flexShrink: 0 }}
          >
            <LogOut size={14} /> Sign out
          </button>
        </div>
        <nav style={{ maxWidth: 900, margin: '14px auto 0', display: 'flex', gap: 4 }}>
          <TabBtn active={tab === 'tasks'} onClick={() => setTab('tasks')} icon={<CheckCircle2 size={15} />} label="To-do" badge={openTasks} />
          <TabBtn active={tab === 'work'} onClick={() => setTab('work')} icon={<Briefcase size={15} />} label="Work" />
          <TabBtn active={tab === 'techs'} onClick={() => setTab('techs')} icon={<Users size={15} />} label="Techs" />
        </nav>
      </header>

      <main style={{ maxWidth: 900, margin: '0 auto', padding: '18px 16px 0' }}>
        {tab === 'tasks' && <TasksTab tasks={tasks} onChanged={async () => setTasks(await fetchAssistantTasks())} />}
        {tab === 'work' && <WorkTab jobs={jobs} sites={sites} onSaved={async () => setJobs(await fetchAssistantJobs())} />}
        {tab === 'techs' && <TechsTab techs={techs} />}
      </main>
    </div>
  );
}

// ─── To-do ──────────────────────────────────────────────────────────────────

function TasksTab({ tasks, onChanged }: { tasks: StaffTask[]; onChanged: () => Promise<void> }) {
  const [finishing, setFinishing] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const today = todayEastern();
  const open = tasks.filter((t) => t.status === 'open');
  const done = tasks.filter((t) => t.status === 'done');

  const markDone = async (id: string) => {
    setBusy(true);
    try {
      const r = await setAssistantTask(id, true, note);
      if (!r.ok) { toastError(staffReasonText(r.reason)); return; }
      toastSuccess('Marked done. Fred can see it.');
      setFinishing(null); setNote('');
      await onChanged();
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'Could not save.');
    } finally { setBusy(false); }
  };

  const reopen = async (id: string) => {
    try {
      const r = await setAssistantTask(id, false, '');
      if (!r.ok) { toastError(staffReasonText(r.reason)); return; }
      await onChanged();
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'Could not save.');
    }
  };

  return (
    <div>
      <SectionTitle>To do ({open.length})</SectionTitle>
      {open.length === 0 && <Empty>Nothing on your list. Fred adds tasks from the main app.</Empty>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {open.map((t) => {
          const late = t.due_date && t.due_date < today;
          return (
            <div key={t.id} className="glass card" style={{ padding: 16 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <Circle size={20} color="var(--teal)" style={{ flexShrink: 0, marginTop: 2 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{t.title}</div>
                  {t.due_date && (
                    <div style={{ fontSize: 12, marginTop: 3, color: late ? '#b91c1c' : '#777', fontWeight: late ? 700 : 500 }}>
                      {late ? 'Was due ' : 'Due '}{fmtDate(t.due_date)}
                    </div>
                  )}
                  {t.details && <div style={{ fontSize: 13, color: '#555', marginTop: 8, whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{t.details}</div>}
                  {finishing === t.id ? (
                    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <textarea
                        className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)}
                        placeholder="What did you do? (optional — Fred sees this)"
                      />
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button className="btn btn-primary" disabled={busy} onClick={() => markDone(t.id)}>
                          <CheckCircle2 size={14} /> {busy ? 'Saving…' : 'Mark done'}
                        </button>
                        <button className="btn btn-ghost" onClick={() => { setFinishing(null); setNote(''); }}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <button className="btn btn-ghost" style={{ marginTop: 12, fontSize: 12 }} onClick={() => { setFinishing(t.id); setNote(''); }}>
                      <CheckCircle2 size={14} /> Done
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {done.length > 0 && (
        <>
          <SectionTitle style={{ marginTop: 26 }}>Finished ({done.length})</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {done.map((t) => (
              <div key={t.id} className="glass card" style={{ padding: '12px 16px', display: 'flex', gap: 12, alignItems: 'flex-start', opacity: 0.85 }}>
                <CheckCircle2 size={18} color="#10b981" style={{ flexShrink: 0, marginTop: 1 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, textDecoration: 'line-through', color: '#777' }}>{t.title}</div>
                  {t.done_note && <div style={{ fontSize: 12, color: '#555', marginTop: 3 }}>{t.done_note}</div>}
                  {t.done_at && <div style={{ fontSize: 11, color: '#999', marginTop: 3 }}>Done {fmtDate(t.done_at)}</div>}
                </div>
                <button onClick={() => reopen(t.id)} title="Put back on the list" style={ICON_BTN}><RotateCcw size={14} /></button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Work ───────────────────────────────────────────────────────────────────

function WorkTab({ jobs, sites, onSaved }: { jobs: AssistantJob[]; sites: AssistantCrewSite[]; onSaved: () => Promise<void> }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<WorkItem | null>(null);
  const today = todayEastern();
  const items = useMemo(() => mergeWork(jobs, sites), [jobs, sites]);
  const groups = useMemo(() => groupWork(items.filter((i) => matchesWork(i, query)), today), [items, query, today]);

  return (
    <div>
      <div style={{ position: 'relative', marginBottom: 16 }}>
        <Search size={16} color="#999" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
        <input
          className="input" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search client, site, city, tech, WO number…" style={{ paddingLeft: 36 }}
          aria-label="Search work"
        />
      </div>

      {groups.length === 0 && <Empty>{query ? 'Nothing matches that search.' : 'No open work right now.'}</Empty>}

      {groups.map((g) => (
        <div key={g.bucket} style={{ marginBottom: 22 }}>
          <SectionTitle>{BUCKET_LABEL[g.bucket]} ({g.items.length})</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {g.items.map((i) => (
              <button
                key={`${i.kind}-${i.id}`} onClick={() => setOpen(i)} className="glass card"
                style={{ padding: '12px 14px', textAlign: 'left', cursor: 'pointer', border: '1px solid rgba(0,0,0,0.06)', width: '100%' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.8, color: i.kind === 'crew' ? '#6B2D8B' : 'var(--teal)', textTransform: 'uppercase' }}>
                      {i.kind === 'crew' ? 'Crew project' : 'Work order'}
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 14, marginTop: 2 }}>{i.title}</div>
                    {i.place && <div style={{ fontSize: 12, color: '#666', marginTop: 3, display: 'flex', alignItems: 'center', gap: 4 }}><MapPin size={12} /> {i.place}</div>}
                    <div style={{ fontSize: 12, color: '#666', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}><Users size={12} /> {i.who}</div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    {i.date && <div style={{ fontSize: 12, fontWeight: 700 }}>{i.kind === 'crew' ? 'Week of ' : ''}{fmtDate(i.date)}</div>}
                    <div style={{ fontSize: 11, color: '#777', marginTop: 4 }}>{i.status}</div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}

      {open && (
        <WorkDetail
          item={open}
          onClose={() => setOpen(null)}
          onSaved={async () => { await onSaved(); setOpen(null); }}
        />
      )}
    </div>
  );
}

const EDITABLE: { key: keyof AssistantJobPatch; label: string; type: 'date' | 'text' | 'tel' | 'email' | 'area' }[] = [
  { key: 'scheduled_date', label: 'Scheduled date', type: 'date' },
  { key: 'start_time', label: 'Start time', type: 'text' },
  { key: 'end_time', label: 'End time', type: 'text' },
  { key: 'poc_name', label: 'Site contact', type: 'text' },
  { key: 'poc_phone', label: 'Contact phone', type: 'tel' },
  { key: 'poc_email', label: 'Contact email', type: 'email' },
  { key: 'access_instructions', label: 'How to get in', type: 'area' },
  { key: 'parking_instructions', label: 'Parking', type: 'area' },
  { key: 'special_instructions', label: 'Special instructions', type: 'area' },
];

function WorkDetail({ item, onClose, onSaved }: { item: WorkItem; onClose: () => void; onSaved: () => Promise<void> }) {
  const job = item.kind === 'job' ? item.job : null;
  const site = item.kind === 'crew' ? item.site : null;
  const [form, setForm] = useState<Record<string, string>>(() =>
    Object.fromEntries(EDITABLE.map((f) => [f.key, job ? String(job[f.key] ?? '').slice(0, f.type === 'date' ? 10 : undefined) : ''])));
  const [saving, setSaving] = useState(false);

  const address = job ? jobAddress(job) : site ? [site.address, site.city, [site.state, site.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ') : '';

  const save = async () => {
    if (!job) return;
    const patch: Record<string, string> = {};
    for (const f of EDITABLE) {
      const before = String(job[f.key] ?? '').slice(0, f.type === 'date' ? 10 : undefined);
      if ((form[f.key] ?? '') !== before) patch[f.key] = form[f.key] ?? '';
    }
    if (Object.keys(patch).length === 0) { onClose(); return; }
    setSaving(true);
    try {
      const r = await saveAssistantJob(job.id, patch as AssistantJobPatch);
      if (!r.ok) { toastError(staffReasonText(r.reason)); return; }
      toastSuccess('Saved. Fred sees the change.');
      await onSaved();
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'Could not save.');
    } finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay" {...backdropClose(onClose)}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', marginBottom: 16 }}>
          <div style={{ minWidth: 0 }}>
            <div className="display" style={{ fontSize: 11, color: 'var(--teal)', letterSpacing: 2, marginBottom: 4 }}>
              {item.kind === 'crew' ? 'CREW PROJECT SITE' : 'WORK ORDER'}
            </div>
            <h2 className="serif" style={{ fontSize: 24, margin: 0, fontWeight: 600 }}>{item.title}</h2>
            <div style={{ fontSize: 12, color: '#777', marginTop: 4 }}>{item.status}</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={ICON_BTN}><X size={18} /></button>
        </div>

        <div style={{ display: 'grid', gap: 10, fontSize: 13, marginBottom: 18 }}>
          {job?.customer_name && <Row label="Client">{job.customer_name}</Row>}
          {site && <Row label="Client">{[site.client, site.project].filter(Boolean).join(' · ')}</Row>}
          {address && (
            <Row label="Address">
              <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`} target="_blank" rel="noreferrer" style={{ color: 'var(--teal)' }}>
                {address}
              </a>
            </Row>
          )}
          <Row label={item.kind === 'crew' ? 'Team' : 'Tech'}>{item.who}</Row>
          {site?.property_id && <Row label="Property ID">{site.property_id}</Row>}
          {site?.survey_date && <Row label="Survey">{fmtDate(site.survey_date)}</Row>}
          {site?.week_start && <Row label="Cabling week">Week of {fmtDate(site.week_start)}</Row>}
          {job?.external_wo_id && <Row label="Client WO #">{job.external_wo_id}</Row>}
          {job?.scope_of_work && <Row label="Scope">{job.scope_of_work}</Row>}
          {!job?.scope_of_work && job?.description && <Row label="Details">{job.description}</Row>}
          {job?.deliverables && <Row label="Deliverables">{job.deliverables}</Row>}
          {job?.tools_required && <Row label="Tools">{job.tools_required}</Row>}
          {job?.arrived_at && <Row label="Tech arrived">{new Date(job.arrived_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</Row>}
          {job?.checked_out_at && <Row label="Tech left">{new Date(job.checked_out_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</Row>}
        </div>

        {job ? (
          <>
            <SectionTitle><CalendarDays size={13} style={{ verticalAlign: -2 }} /> Schedule &amp; site details</SectionTitle>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              {EDITABLE.map((f) => (
                <div key={f.key} style={f.type === 'area' ? { gridColumn: '1 / -1' } : undefined}>
                  <label style={LABEL} htmlFor={`f-${f.key}`}>{f.label}</label>
                  {f.type === 'area' ? (
                    <textarea id={`f-${f.key}`} className="input" rows={2} value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
                  ) : (
                    <input
                      id={`f-${f.key}`} className="input" type={f.type} value={form[f.key]}
                      placeholder={f.key.endsWith('_time') ? 'e.g. 8:00 AM' : undefined}
                      onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                    />
                  )}
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18, flexWrap: 'wrap' }}>
              <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" disabled={saving} onClick={save}><Save size={14} /> {saving ? 'Saving…' : 'Save'}</button>
            </div>
            <div style={{ fontSize: 11, color: '#999', marginTop: 12, lineHeight: 1.5 }}>
              Status, which tech is on the job, and anything to do with pay or billing stay with Fred.
            </div>
          </>
        ) : (
          <div style={{ fontSize: 12, color: '#777', lineHeight: 1.6 }}>
            Crew sites are scheduled by the team leads and Fred in Crew Projects.
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Techs ──────────────────────────────────────────────────────────────────

function TechsTab({ techs }: { techs: AssistantTech[] }) {
  const [query, setQuery] = useState('');
  const shown = techs.filter((t) => !query.trim() || [t.name, t.business_name, t.city, t.state, t.email, t.phone]
    .some((s) => (s ?? '').toLowerCase().includes(query.trim().toLowerCase())));
  return (
    <div>
      <div style={{ position: 'relative', marginBottom: 16 }}>
        <Search size={16} color="#999" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
        <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search techs…" style={{ paddingLeft: 36 }} aria-label="Search techs" />
      </div>
      {shown.length === 0 && <Empty>No techs match.</Empty>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
        {shown.map((t) => (
          <div key={t.id} className="glass card" style={{ padding: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{t.name}</div>
            {t.business_name && t.business_name !== t.name && <div style={{ fontSize: 12, color: '#777' }}>{t.business_name}</div>}
            {(t.city || t.state) && <div style={{ fontSize: 12, color: '#777', marginTop: 2 }}>{[t.city, t.state].filter(Boolean).join(', ')}</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 10, fontSize: 13 }}>
              {t.phone && <a href={`tel:${t.phone}`} style={{ color: 'var(--teal)', display: 'flex', gap: 6, alignItems: 'center' }}><Phone size={13} /> {t.phone}</a>}
              {t.email && <a href={`mailto:${t.email}`} style={{ color: 'var(--teal)', display: 'flex', gap: 6, alignItems: 'center', wordBreak: 'break-all' }}><Mail size={13} /> {t.email}</a>}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
              <Pill ok={t.w9_received}>{t.w9_received ? 'W-9 on file' : 'W-9 missing'}</Pill>
              <Pill ok={t.agreement_signed}>{t.agreement_signed ? 'Agreement signed' : 'Agreement not signed'}</Pill>
              <Pill ok={t.has_login}>{t.has_login ? 'Has tech login' : 'No tech login yet'}</Pill>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Small pieces ───────────────────────────────────────────────────────────

function TabBtn({ active, onClick, icon, label, badge }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; badge?: number }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        padding: '11px 6px', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700,
        borderRadius: '10px 10px 0 0',
        background: active ? 'var(--cream, #faf7f0)' : 'transparent',
        color: active ? 'var(--teal)' : 'rgba(255,255,255,0.85)',
      }}
    >
      {icon} {label}
      {badge != null && badge > 0 && (
        <span style={{ background: 'var(--gold)', color: '#3b2f10', borderRadius: 999, fontSize: 10, fontWeight: 800, padding: '1px 7px' }}>{badge}</span>
      )}
    </button>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 10 }}>
      <div style={{ color: '#999', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, paddingTop: 2 }}>{label}</div>
      <div style={{ whiteSpace: 'pre-wrap', minWidth: 0, wordBreak: 'break-word' }}>{children}</div>
    </div>
  );
}

function Pill({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span style={{
      fontSize: 10.5, fontWeight: 700, padding: '3px 9px', borderRadius: 999,
      background: ok ? 'rgba(16,185,129,0.12)' : 'rgba(245,158,11,0.15)',
      color: ok ? '#047857' : '#b45309',
    }}>{children}</span>
  );
}

function SectionTitle({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, color: '#888', textTransform: 'uppercase', margin: '0 0 10px', ...style }}>{children}</div>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="glass card" style={{ padding: 22, textAlign: 'center', color: '#888', fontSize: 13 }}>{children}</div>;
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20 }}>{children}</div>;
}

const LABEL: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: '#555',
  textTransform: 'uppercase', display: 'block', marginBottom: 5,
};

const ICON_BTN: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer', color: '#999', padding: 6, display: 'flex', alignItems: 'center',
};
