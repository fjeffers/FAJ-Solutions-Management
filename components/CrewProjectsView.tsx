'use client';
// Crew Projects (migrations 087/088) — the owner side of multi-team T&M jobs
// such as the LDS meetinghouse refresh FAJ runs for NetView.
//
//   Schedule  teams × weeks; drop an open site into a cell, or let leads pick
//   Sites     upload the list (paste or spreadsheet), edit, set status
//   Hours     the leads' daily entries; approve what gets billed and paid
//   Receipts  travel photos, totals against the per-site cap, expense report
//   Money     what the client owes and paid, what each lead is owed and paid
//   Messages  the project channel, to everyone or one lead
//   Setup     the project, its rates, and the teams
//
// Self-contained like NetworkView: it loads and saves its own data. All money
// is computed by lib/crew.ts (unit-tested), never inline here.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toastError, toastSuccess } from '@/lib/toast';
import { fmtMoney, fmtDate } from '@/lib/utils';
import {
  projectWeeks, projectMoney, teamMoney, siteTravel, parseSiteRows, splitPasted, ymd,
  SITE_STATUS_META, RECEIPT_CATEGORIES,
  type CrewProject, type CrewTeam, type CrewSite, type CrewTimeEntry, type CrewReceipt,
  type CrewPayment, type CrewSiteStatus, type SiteDraft,
} from '@/lib/crew';
import {
  Users, Calendar, MapPin, Clock, Receipt, Wallet, MessageSquare, Settings, Plus, Trash2,
  Upload, Check, X, FileText, Send, Loader2,
} from 'lucide-react';

type Tab = 'schedule' | 'sites' | 'hours' | 'receipts' | 'money' | 'messages' | 'setup';
type ContractorLite = { id: string; name: string; email: string | null; auth_user_id: string | null };
type CrewMessage = {
  id: string; from_contractor_id: string | null; to_contractor_id: string | null;
  to_office: boolean; content: string; created_at: string;
};

const LAST_PROJECT_KEY = 'faj-crew-project';

export default function CrewProjectsView() {
  const supabase = useMemo(() => createClient(), []);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [projects, setProjects] = useState<CrewProject[]>([]);
  const [projectId, setProjectId] = useState<string>('');
  const [tab, setTab] = useState<Tab>('schedule');
  const [loading, setLoading] = useState(true);

  const [teams, setTeams] = useState<CrewTeam[]>([]);
  const [sites, setSites] = useState<CrewSite[]>([]);
  const [entries, setEntries] = useState<CrewTimeEntry[]>([]);
  const [receipts, setReceipts] = useState<CrewReceipt[]>([]);
  const [payments, setPayments] = useState<CrewPayment[]>([]);
  const [messages, setMessages] = useState<CrewMessage[]>([]);
  const [contractors, setContractors] = useState<ContractorLite[]>([]);

  const project = projects.find((p) => p.id === projectId) ?? null;

  const loadProjects = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    setOwnerId(user?.id ?? null);
    const [{ data: ps, error }, { data: cs }] = await Promise.all([
      supabase.from('crew_projects').select('*').is('archived_at', null).order('created_at'),
      supabase.from('contractors').select('id, name, email, auth_user_id').order('name'),
    ]);
    if (error) toastError(error.message);
    const list = (ps ?? []) as CrewProject[];
    setProjects(list);
    setContractors((cs ?? []) as ContractorLite[]);
    let saved = '';
    try { saved = localStorage.getItem(LAST_PROJECT_KEY) ?? ''; } catch { /* private mode */ }
    setProjectId((cur) => cur || (list.find((p) => p.id === saved)?.id ?? list[0]?.id ?? ''));
    if (list.length === 0) setTab('setup');
    setLoading(false);
  }, [supabase]);

  const loadProject = useCallback(async (pid: string) => {
    if (!pid) return;
    const [t, s, e, r, p, m] = await Promise.all([
      supabase.from('crew_teams').select('*').eq('project_id', pid).order('sort').order('name'),
      supabase.from('crew_sites').select('*').eq('project_id', pid).order('state').order('city').order('name'),
      supabase.from('crew_time_entries').select('*, crew_sites!inner(project_id)').eq('crew_sites.project_id', pid).order('work_date', { ascending: false }),
      supabase.from('crew_receipts').select('*, crew_sites!inner(project_id)').eq('crew_sites.project_id', pid).order('receipt_date', { ascending: false }),
      supabase.from('crew_payments').select('*').eq('project_id', pid).order('paid_on', { ascending: false }),
      supabase.from('crew_messages').select('*').eq('project_id', pid).order('created_at'),
    ]);
    for (const res of [t, s, e, r, p, m]) if (res.error) { toastError(res.error.message); break; }
    setTeams((t.data ?? []) as CrewTeam[]);
    setSites((s.data ?? []) as CrewSite[]);
    setEntries((e.data ?? []) as CrewTimeEntry[]);
    setReceipts((r.data ?? []) as CrewReceipt[]);
    setPayments((p.data ?? []) as CrewPayment[]);
    setMessages((m.data ?? []) as CrewMessage[]);
  }, [supabase]);

  useEffect(() => { loadProjects(); }, [loadProjects]);
  useEffect(() => {
    if (!projectId) return;
    try { localStorage.setItem(LAST_PROJECT_KEY, projectId); } catch { /* ignore */ }
    loadProject(projectId);
  }, [projectId, loadProject]);

  const reload = useCallback(() => loadProject(projectId), [loadProject, projectId]);

  const pendingHours = entries.filter((e) => e.status === 'submitted').length;
  const pendingReceipts = receipts.filter((r) => r.status === 'submitted').length;

  if (loading) return <div style={{ padding: 30, color: '#999' }}>Loading crew projects…</div>;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <h1 className="serif" style={{ fontSize: 28, margin: 0 }}>Crew Projects</h1>
          <div style={{ fontSize: 13, color: '#777' }}>Teams, schedule, hours, receipts and pay for T&amp;M crew work</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {projects.length > 0 && (
            <select className="select" value={projectId} onChange={(e) => setProjectId(e.target.value)} style={{ minWidth: 240 }}>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}{p.client ? ` · ${p.client}` : ''}</option>)}
            </select>
          )}
          <button className="btn btn-ghost" onClick={() => { setProjectId(''); setTab('setup'); }}><Plus size={14} /> New project</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        <TabBtn on={tab === 'schedule'} onClick={() => setTab('schedule')} icon={<Calendar size={14} />} label="Schedule" disabled={!project} />
        <TabBtn on={tab === 'sites'} onClick={() => setTab('sites')} icon={<MapPin size={14} />} label={`Sites (${sites.length})`} disabled={!project} />
        <TabBtn on={tab === 'hours'} onClick={() => setTab('hours')} icon={<Clock size={14} />} label="Hours" badge={pendingHours} disabled={!project} />
        <TabBtn on={tab === 'receipts'} onClick={() => setTab('receipts')} icon={<Receipt size={14} />} label="Receipts" badge={pendingReceipts} disabled={!project} />
        <TabBtn on={tab === 'money'} onClick={() => setTab('money')} icon={<Wallet size={14} />} label="Money" disabled={!project} />
        <TabBtn on={tab === 'messages'} onClick={() => setTab('messages')} icon={<MessageSquare size={14} />} label="Messages" disabled={!project} />
        <TabBtn on={tab === 'setup'} onClick={() => setTab('setup')} icon={<Settings size={14} />} label="Setup" />
      </div>

      {tab === 'setup' && (
        <SetupTab project={project} teams={teams} contractors={contractors}
          onSavedProject={async (id) => { await loadProjects(); setProjectId(id); }}
          onChanged={reload} supabase={supabase} />
      )}
      {project && tab === 'schedule' && <ScheduleTab project={project} teams={teams} sites={sites} contractors={contractors} supabase={supabase} onChanged={reload} />}
      {project && tab === 'sites' && <SitesTab project={project} teams={teams} sites={sites} entries={entries} receipts={receipts} supabase={supabase} onChanged={reload} />}
      {project && tab === 'hours' && <HoursTab project={project} teams={teams} sites={sites} entries={entries} ownerId={ownerId} supabase={supabase} onChanged={reload} />}
      {project && tab === 'receipts' && <ReceiptsTab project={project} teams={teams} sites={sites} receipts={receipts} supabase={supabase} onChanged={reload} />}
      {project && tab === 'money' && <MoneyTab project={project} teams={teams} sites={sites} entries={entries} receipts={receipts} payments={payments} contractors={contractors} supabase={supabase} onChanged={reload} />}
      {project && tab === 'messages' && <MessagesTab project={project} teams={teams} contractors={contractors} messages={messages} ownerId={ownerId} supabase={supabase} onChanged={reload} />}
    </div>
  );
}

type Sb = ReturnType<typeof createClient>;

// ── Schedule ────────────────────────────────────────────────────────────────

function ScheduleTab({ project, teams, sites, contractors, supabase, onChanged }: {
  project: CrewProject; teams: CrewTeam[]; sites: CrewSite[]; contractors: ContractorLite[]; supabase: Sb; onChanged: () => void;
}) {
  const weeks = projectWeeks(project);
  const open = sites.filter((s) => !s.team_id || !s.week_start);
  const leadName = (t: CrewTeam) => contractors.find((c) => c.id === t.lead_contractor_id)?.name ?? 'No lead';

  const place = async (siteId: string, teamId: string, monday: string) => {
    const { error } = await supabase.from('crew_sites')
      .update({ team_id: teamId, week_start: monday, status: 'scheduled', updated_at: new Date().toISOString() })
      .eq('id', siteId);
    if (error) { toastError(error.message); return; }
    onChanged();
  };
  const unplace = async (s: CrewSite) => {
    if (s.status !== 'planned' && s.status !== 'scheduled' && !confirm(`${s.name} is already ${SITE_STATUS_META[s.status].label.toLowerCase()}. Unschedule it anyway?`)) return;
    const { error } = await supabase.from('crew_sites')
      .update({ team_id: null, week_start: null, status: s.status === 'scheduled' ? 'planned' : s.status, updated_at: new Date().toISOString() })
      .eq('id', s.id);
    if (error) { toastError(error.message); return; }
    onChanged();
  };

  if (weeks.length === 0) return <Empty>Set a start date in Setup to see the weeks.</Empty>;
  if (teams.length === 0) return <Empty>Add your teams in Setup first.</Empty>;

  return (
    <div>
      <div className="glass card" style={{ padding: 12, overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 140 + weeks.length * 130, fontSize: 12.5 }}>
          <thead>
            <tr>
              <th style={TH}>Team</th>
              {weeks.map((w) => (
                <th key={w.monday} style={{ ...TH, color: w.skipped ? '#bbb' : undefined }}>
                  {w.label}{w.skipped ? ' · off' : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {teams.map((t) => (
              <tr key={t.id}>
                <td style={{ ...TD, fontWeight: 700, whiteSpace: 'nowrap' }}>
                  {leadName(t)}
                  {t.helper_name && <div style={{ fontWeight: 400, fontSize: 11, color: '#999' }}>+ {t.helper_name}</div>}
                </td>
                {weeks.map((w) => {
                  if (w.skipped) return <td key={w.monday} style={{ ...TD, background: 'rgba(0,0,0,0.03)' }} />;
                  const here = sites.filter((s) => s.team_id === t.id && s.week_start?.slice(0, 10) === w.monday);
                  return (
                    <td key={w.monday} style={TD}>
                      {here.map((s) => {
                        const meta = SITE_STATUS_META[s.status];
                        return (
                          <div key={s.id} style={{ background: meta.bg, color: meta.color, borderRadius: 8, padding: '5px 7px', marginBottom: 4, display: 'flex', alignItems: 'flex-start', gap: 4 }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 700, lineHeight: 1.25 }}>{s.name}</div>
                              <div style={{ fontSize: 10.5, opacity: 0.85 }}>{[s.city, s.state].filter(Boolean).join(', ')} · {meta.label}</div>
                            </div>
                            <button onClick={() => unplace(s)} title="Unschedule" style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0 }}><X size={12} /></button>
                          </div>
                        );
                      })}
                      {here.length === 0 && open.length > 0 && (
                        <select className="select" value="" onChange={(e) => e.target.value && place(e.target.value, t.id, w.monday)}
                          style={{ fontSize: 12, padding: '5px 6px', color: '#999' }}>
                          <option value="">+ add site</option>
                          {open.map((s) => <option key={s.id} value={s.id}>{s.name}{s.city ? ` · ${s.city}` : ''}</option>)}
                        </select>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="glass card" style={{ padding: 14, marginTop: 14 }}>
        <SectionHead>Not scheduled yet ({open.length})</SectionHead>
        {open.length === 0 ? <div style={{ fontSize: 13, color: '#999' }}>Every site has a team and a week.</div> : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {open.map((s) => (
              <span key={s.id} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 999, background: 'rgba(13,115,119,0.07)', color: '#333' }}>
                {s.name}{s.city ? ` · ${s.city}, ${s.state ?? ''}` : ''}
              </span>
            ))}
          </div>
        )}
        <div style={{ fontSize: 12, color: '#888', marginTop: 10 }}>
          Leads can also pick open sites themselves from their phone (Crew Project → Pick sites). One site per team per week; holiday weeks are blocked.
        </div>
      </div>
    </div>
  );
}

// ── Sites ───────────────────────────────────────────────────────────────────

function SitesTab({ project, teams, sites, entries, receipts, supabase, onChanged }: {
  project: CrewProject; teams: CrewTeam[]; sites: CrewSite[]; entries: CrewTimeEntry[]; receipts: CrewReceipt[];
  supabase: Sb; onChanged: () => void;
}) {
  const [paste, setPaste] = useState('');
  const [preview, setPreview] = useState<SiteDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const weeks = projectWeeks(project).filter((w) => !w.skipped);

  const readFile = async (file: File) => {
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, { header: 1, blankrows: false });
      const parsed = parseSiteRows(rows);
      if (parsed.length === 0) toastError('No sites found. The sheet needs a Name (or Site) column.');
      setPreview(parsed);
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Couldn't read that file");
    }
  };

  const existingKey = new Set(sites.map((s) => `${s.name}|${s.city ?? ''}`.toLowerCase()));
  const fresh = preview.filter((d) => !existingKey.has(`${d.name}|${d.city ?? ''}`.toLowerCase()));

  const save = async () => {
    if (fresh.length === 0) { toastError('Nothing new to add.'); return; }
    setSaving(true);
    const { error } = await supabase.from('crew_sites').insert(fresh.map((d) => ({ ...d, project_id: project.id })));
    setSaving(false);
    if (error) { toastError(error.message); return; }
    toastSuccess(`${fresh.length} site${fresh.length === 1 ? '' : 's'} added`);
    setPreview([]); setPaste('');
    onChanged();
  };

  const update = async (id: string, patch: Partial<CrewSite>) => {
    const { error } = await supabase.from('crew_sites').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { toastError(error.message); return; }
    onChanged();
  };
  const remove = async (s: CrewSite) => {
    const used = entries.some((e) => e.site_id === s.id) || receipts.some((r) => r.site_id === s.id);
    if (!confirm(used
      ? `${s.name} has hours or receipts logged. Deleting it deletes those too. Delete anyway?`
      : `Delete ${s.name}?`)) return;
    const { error } = await supabase.from('crew_sites').delete().eq('id', s.id);
    if (error) { toastError(error.message); return; }
    onChanged();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="glass card" style={{ padding: 16 }}>
        <SectionHead>Upload sites</SectionHead>
        <div style={{ fontSize: 13, color: '#666', marginBottom: 10, lineHeight: 1.5 }}>
          Drop in the spreadsheet NetView sends (Excel or CSV with a Name or Site column), or paste lines:
          <span style={{ fontFamily: 'monospace', fontSize: 12 }}> Name, Address, City, State</span>. Sites already on the project are skipped.
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}><Upload size={14} /> Choose spreadsheet</button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f); e.target.value = ''; }} />
        </div>
        <textarea className="input" rows={4} value={paste}
          onChange={(e) => { setPaste(e.target.value); setPreview(parseSiteRows(splitPasted(e.target.value))); }}
          placeholder={'Wilmington Ward, 123 Market St, Wilmington, NC\nGaffney Branch, 4 Main St, Gaffney, SC'} />
        {preview.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>
              {fresh.length} new site{fresh.length === 1 ? '' : 's'} ready{preview.length > fresh.length ? ` (${preview.length - fresh.length} already on the project)` : ''}
            </div>
            <div style={{ maxHeight: 200, overflowY: 'auto', fontSize: 12.5, border: '1px solid #eee', borderRadius: 8 }}>
              {fresh.map((d, i) => (
                <div key={i} style={{ padding: '5px 8px', borderBottom: '1px solid #f3f3f3' }}>
                  <b>{d.name}</b> <span style={{ color: '#888' }}>{[d.address, d.city, d.state].filter(Boolean).join(', ')}</span>
                </div>
              ))}
            </div>
            <button className="btn btn-primary" onClick={save} disabled={saving || fresh.length === 0} style={{ marginTop: 10 }}>
              {saving ? <Loader2 size={14} /> : <Plus size={14} />} Add {fresh.length} site{fresh.length === 1 ? '' : 's'}
            </button>
          </div>
        )}
      </div>

      <div className="glass card" style={{ padding: 12, overflowX: 'auto' }}>
        {sites.length === 0 ? <Empty>No sites yet. Upload the list above.</Empty> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 820 }}>
            <thead><tr>
              <th style={TH}>Site</th><th style={TH}>Team</th><th style={TH}>Week</th>
              <th style={TH}>Status</th><th style={TH}>Hours</th><th style={TH}>Travel</th><th style={TH} />
            </tr></thead>
            <tbody>
              {sites.map((s) => {
                const hrs = entries.filter((e) => e.site_id === s.id && e.status !== 'rejected').reduce((a, e) => a + Number(e.hours), 0);
                const tr = siteTravel(receipts, s.id, Number(project.travel_cap));
                return (
                  <tr key={s.id}>
                    <td style={TD}>
                      <div style={{ fontWeight: 700 }}>{s.name}</div>
                      <div style={{ fontSize: 11, color: '#888' }}>{[s.address, s.city, s.state].filter(Boolean).join(', ')}</div>
                    </td>
                    <td style={TD}>
                      <select className="select" value={s.team_id ?? ''} style={SMALL_SELECT}
                        onChange={(e) => update(s.id, { team_id: e.target.value || null })}>
                        <option value="">—</option>
                        {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </td>
                    <td style={TD}>
                      <select className="select" value={s.week_start?.slice(0, 10) ?? ''} style={SMALL_SELECT}
                        onChange={(e) => update(s.id, { week_start: e.target.value || null, ...(e.target.value && s.status === 'planned' ? { status: 'scheduled' as CrewSiteStatus } : {}) })}>
                        <option value="">—</option>
                        {weeks.map((w) => <option key={w.monday} value={w.monday}>{w.label}</option>)}
                      </select>
                    </td>
                    <td style={TD}>
                      <select className="select" value={s.status} style={SMALL_SELECT}
                        onChange={(e) => update(s.id, { status: e.target.value as CrewSiteStatus })}>
                        {(Object.keys(SITE_STATUS_META) as CrewSiteStatus[]).map((k) => <option key={k} value={k}>{SITE_STATUS_META[k].label}</option>)}
                      </select>
                    </td>
                    <td style={TD}>{hrs || '—'}</td>
                    <td style={{ ...TD, color: tr.overCap > 0 ? '#b91c1c' : undefined }}>
                      {tr.submitted ? fmtMoney(tr.submitted) : '—'}
                    </td>
                    <td style={TD}><button onClick={() => remove(s)} style={ICON_BTN} aria-label="Delete site"><Trash2 size={14} /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Hours ───────────────────────────────────────────────────────────────────

function HoursTab({ project, teams, sites, entries, ownerId, supabase, onChanged }: {
  project: CrewProject; teams: CrewTeam[]; sites: CrewSite[]; entries: CrewTimeEntry[]; ownerId: string | null;
  supabase: Sb; onChanged: () => void;
}) {
  const [filter, setFilter] = useState<'submitted' | 'approved' | 'rejected' | 'all'>('submitted');
  const shown = entries.filter((e) => filter === 'all' || e.status === filter);
  const siteName = (id: string) => sites.find((s) => s.id === id)?.name ?? '—';
  const teamName = (id: string) => teams.find((t) => t.id === id)?.name ?? '—';

  const setStatus = async (ids: string[], status: 'approved' | 'rejected' | 'submitted') => {
    if (ids.length === 0) return;
    const { error } = await supabase.from('crew_time_entries').update({ status, updated_at: new Date().toISOString() }).in('id', ids);
    if (error) { toastError(error.message); return; }
    toastSuccess(`${ids.length} day${ids.length === 1 ? '' : 's'} ${status === 'submitted' ? 'reopened' : status}`);
    onChanged();
  };

  // The office can log a day too (a lead with a dead phone).
  const [siteId, setSiteId] = useState('');
  const [date, setDate] = useState(ymd(new Date()));
  const [hours, setHours] = useState('');
  const addDay = async () => {
    const site = sites.find((s) => s.id === siteId);
    const h = Number(hours);
    if (!site?.team_id) { toastError('Pick a site that has a team.'); return; }
    if (!(h > 0 && h <= 16)) { toastError('Hours must be between 0 and 16.'); return; }
    const { error } = await supabase.from('crew_time_entries').upsert({
      user_id: ownerId, site_id: site.id, team_id: site.team_id, work_date: date, hours: h,
      status: 'approved', entered_by: 'office',
    }, { onConflict: 'site_id,work_date' });
    if (error) { toastError(error.message); return; }
    setHours('');
    toastSuccess('Day added and approved');
    onChanged();
  };

  const totals = teams.map((t) => ({ t, hrs: entries.filter((e) => e.team_id === t.id && e.status === 'approved').reduce((a, e) => a + Number(e.hours), 0) }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {(['submitted', 'approved', 'rejected', 'all'] as const).map((f) => (
          <TabBtn key={f} on={filter === f} onClick={() => setFilter(f)} label={f === 'submitted' ? 'Waiting for you' : f[0].toUpperCase() + f.slice(1)}
            badge={f === 'submitted' ? entries.filter((e) => e.status === 'submitted').length : undefined} />
        ))}
        {filter === 'submitted' && shown.length > 0 && (
          <button className="btn btn-primary" onClick={() => setStatus(shown.map((e) => e.id), 'approved')} style={{ marginLeft: 'auto' }}>
            <Check size={14} /> Approve all {shown.length}
          </button>
        )}
      </div>

      <div className="glass card" style={{ padding: 12, overflowX: 'auto' }}>
        {shown.length === 0 ? <Empty>Nothing here.</Empty> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 760 }}>
            <thead><tr>
              <th style={TH}>Date</th><th style={TH}>Site</th><th style={TH}>Team</th><th style={TH}>Times</th>
              <th style={TH}>Hours</th><th style={TH}>Helper</th><th style={TH}>Note</th><th style={TH} />
            </tr></thead>
            <tbody>
              {shown.map((e) => (
                <tr key={e.id}>
                  <td style={TD}>{fmtDate(e.work_date)}</td>
                  <td style={TD}>{siteName(e.site_id)}</td>
                  <td style={TD}>{teamName(e.team_id)}</td>
                  <td style={TD}>{e.start_time ? `${e.start_time.slice(0, 5)}–${e.end_time?.slice(0, 5) ?? '?'}` : '—'}</td>
                  <td style={{ ...TD, fontWeight: 700 }}>{Number(e.hours)}</td>
                  <td style={TD}>{e.helper_present ? 'Yes' : <span style={{ color: '#b45309' }}>No</span>}</td>
                  <td style={{ ...TD, maxWidth: 220 }}>{e.note ?? ''}{e.entered_by ? <div style={{ fontSize: 10.5, color: '#aaa' }}>by {e.entered_by}</div> : null}</td>
                  <td style={{ ...TD, whiteSpace: 'nowrap' }}>
                    {e.status !== 'approved' && <button onClick={() => setStatus([e.id], 'approved')} style={{ ...ICON_BTN, color: '#047857' }} title="Approve"><Check size={15} /></button>}
                    {e.status !== 'rejected' && <button onClick={() => setStatus([e.id], 'rejected')} style={{ ...ICON_BTN, color: '#b91c1c' }} title="Reject"><X size={15} /></button>}
                    {e.status !== 'submitted' && <button onClick={() => setStatus([e.id], 'submitted')} style={{ ...ICON_BTN, fontSize: 11 }} title="Reopen">↺</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
        <div className="glass card" style={{ padding: 14 }}>
          <SectionHead>Approved hours by team</SectionHead>
          {totals.map(({ t, hrs }) => (
            <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0' }}>
              <span>{t.name}</span><b>{hrs}</b>
            </div>
          ))}
          <div style={{ fontSize: 11.5, color: '#999', marginTop: 6 }}>Only approved hours are billed to {project.client || 'the client'} and paid to leads.</div>
        </div>
        <div className="glass card" style={{ padding: 14 }}>
          <SectionHead>Add a day from the office</SectionHead>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <select className="select" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
              <option value="">Pick a site</option>
              {sites.filter((s) => s.team_id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              <input className="input" inputMode="decimal" placeholder="Hours" value={hours} onChange={(e) => setHours(e.target.value)} />
            </div>
            <button className="btn btn-ghost" onClick={addDay}><Plus size={14} /> Add day</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Receipts ────────────────────────────────────────────────────────────────

function ReceiptsTab({ project, teams, sites, receipts, supabase, onChanged }: {
  project: CrewProject; teams: CrewTeam[]; sites: CrewSite[]; receipts: CrewReceipt[]; supabase: Sb; onChanged: () => void;
}) {
  const cap = Number(project.travel_cap);
  const withReceipts = sites.filter((s) => receipts.some((r) => r.site_id === s.id));
  const teamName = (id: string) => teams.find((t) => t.id === id)?.name ?? '—';

  const setStatus = async (ids: string[], status: CrewReceipt['status']) => {
    if (ids.length === 0) return;
    const { error } = await supabase.from('crew_receipts').update({ status, updated_at: new Date().toISOString() }).in('id', ids);
    if (error) { toastError(error.message); return; }
    onChanged();
  };
  const view = async (path: string) => {
    const { data } = await supabase.storage.from('crew-receipts').createSignedUrl(path, 600);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank'); else toastError("Couldn't open that photo.");
  };

  // Printable expense report for one site: the list, the total against the
  // cap, and every receipt photo — what NetView asks for with the invoice.
  const report = async (site: CrewSite) => {
    const rs = receipts.filter((r) => r.site_id === site.id && r.status !== 'rejected')
      .sort((a, b) => a.receipt_date.localeCompare(b.receipt_date));
    const urls = await Promise.all(rs.map(async (r) => r.file_path
      ? (await supabase.storage.from('crew-receipts').createSignedUrl(r.file_path, 3600)).data?.signedUrl ?? null
      : null));
    const t = siteTravel(receipts, site.id, cap);
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
    const rows = rs.map((r) => `<tr><td>${fmtDate(r.receipt_date)}</td><td>${esc(RECEIPT_CATEGORIES.find((c) => c.value === r.category)?.label ?? r.category)}</td><td>${esc(r.vendor ?? '')}</td><td>${esc(r.note ?? '')}</td><td style="text-align:right">${fmtMoney(Number(r.amount))}</td></tr>`).join('');
    const imgs = rs.map((r, i) => urls[i]
      ? (r.file_path?.toLowerCase().endsWith('.pdf')
        ? `<div class="ph"><div>${fmtDate(r.receipt_date)} · ${fmtMoney(Number(r.amount))}</div><a href="${urls[i]}">PDF receipt (open)</a></div>`
        : `<div class="ph"><div>${fmtDate(r.receipt_date)} · ${esc(r.vendor ?? '')} · ${fmtMoney(Number(r.amount))}</div><img src="${urls[i]}"/></div>`)
      : '').join('');
    const w = window.open('', '_blank');
    if (!w) { toastError('Allow pop-ups to open the report.'); return; }
    w.document.write(`<!doctype html><html><head><title>Expense report · ${esc(site.name)}</title><style>
      body{font-family:Arial,sans-serif;margin:32px;color:#222}h1{font-size:20px;margin:0}table{width:100%;border-collapse:collapse;margin-top:14px;font-size:13px}
      th,td{border-bottom:1px solid #ddd;padding:6px;text-align:left}.tot td{font-weight:bold;border-top:2px solid #222}
      .ph{page-break-inside:avoid;margin-top:18px;font-size:12px}.ph img{max-width:100%;max-height:900px;border:1px solid #ccc;margin-top:4px}
      .muted{color:#666;font-size:13px}@media print{button{display:none}}</style></head><body>
      <button onclick="window.print()" style="float:right;padding:8px 14px">Print / Save PDF</button>
      <h1>Travel expense report</h1>
      <div class="muted">FAJ Solutions LLC · ${esc(project.name)}${project.client ? ` · ${esc(project.client)}` : ''}</div>
      <div class="muted">Site: <b>${esc(site.name)}</b>${site.city ? ` · ${esc(site.city)}, ${esc(site.state ?? '')}` : ''}${site.week_start ? ` · week of ${fmtDate(site.week_start)}` : ''}</div>
      <table><thead><tr><th>Date</th><th>Type</th><th>Vendor</th><th>Note</th><th style="text-align:right">Amount</th></tr></thead>
      <tbody>${rows}<tr class="tot"><td colspan="4">Total</td><td style="text-align:right">${fmtMoney(t.submitted)}</td></tr>
      <tr><td colspan="4">Reimbursable (cap ${fmtMoney(cap)} per site)</td><td style="text-align:right">${fmtMoney(Math.min(t.submitted, cap))}</td></tr></tbody></table>
      ${imgs}</body></html>`);
    w.document.close();
  };

  if (receipts.length === 0) return <Empty>No receipts yet. Leads add them from their phone: Crew Project → My sites → Add receipt.</Empty>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {withReceipts.map((site) => {
        const rs = receipts.filter((r) => r.site_id === site.id);
        const t = siteTravel(receipts, site.id, cap);
        const pending = rs.filter((r) => r.status === 'submitted');
        return (
          <div key={site.id} className="glass card" style={{ padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{site.name}</div>
                <div style={{ fontSize: 12, color: t.overCap > 0 ? '#b91c1c' : '#777', fontWeight: t.overCap > 0 ? 700 : 400 }}>
                  {fmtMoney(t.submitted)} of {fmtMoney(cap)} cap{t.overCap > 0 ? ` · ${fmtMoney(t.overCap)} over, not reimbursable` : ` · ${fmtMoney(t.remaining)} left`}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {pending.length > 0 && <button className="btn btn-primary" onClick={() => setStatus(pending.map((r) => r.id), 'approved')}><Check size={14} /> Approve {pending.length}</button>}
                <button className="btn btn-ghost" onClick={() => report(site)}><FileText size={14} /> Expense report</button>
              </div>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <tbody>
                {rs.map((r) => (
                  <tr key={r.id}>
                    <td style={TD}>{fmtDate(r.receipt_date)}</td>
                    <td style={TD}>{RECEIPT_CATEGORIES.find((c) => c.value === r.category)?.label}</td>
                    <td style={TD}>{r.vendor ?? ''}{r.note ? <div style={{ fontSize: 11, color: '#999' }}>{r.note}</div> : null}</td>
                    <td style={TD}>{teamName(r.team_id)}</td>
                    <td style={{ ...TD, fontWeight: 700, textAlign: 'right' }}>{fmtMoney(Number(r.amount))}</td>
                    <td style={TD}>
                      <select className="select" value={r.status} style={SMALL_SELECT}
                        onChange={(e) => setStatus([r.id], e.target.value as CrewReceipt['status'])}>
                        <option value="submitted">Waiting</option><option value="approved">Approved</option>
                        <option value="reimbursed">Reimbursed</option><option value="rejected">Rejected</option>
                      </select>
                    </td>
                    <td style={TD}>{r.file_path && <button onClick={() => view(r.file_path!)} style={ICON_BTN} title="View photo"><Receipt size={15} /></button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

// ── Money ───────────────────────────────────────────────────────────────────

function MoneyTab({ project, teams, sites, entries, receipts, payments, contractors, supabase, onChanged }: {
  project: CrewProject; teams: CrewTeam[]; sites: CrewSite[]; entries: CrewTimeEntry[]; receipts: CrewReceipt[];
  payments: CrewPayment[]; contractors: ContractorLite[]; supabase: Sb; onChanged: () => void;
}) {
  const m = projectMoney(project, teams, sites, entries, receipts, payments);
  const leadName = (t: CrewTeam) => contractors.find((c) => c.id === t.lead_contractor_id)?.name ?? t.name;

  const [dir, setDir] = useState<'to_lead' | 'from_client'>('to_lead');
  const [teamId, setTeamId] = useState('');
  const [kind, setKind] = useState<'labor' | 'travel'>('labor');
  const [amount, setAmount] = useState('');
  const [paidOn, setPaidOn] = useState(ymd(new Date()));
  const [method, setMethod] = useState('');
  const [note, setNote] = useState('');

  const record = async () => {
    const amt = Number(amount.replace(/[$,]/g, ''));
    if (!(amt > 0)) { toastError('Enter an amount.'); return; }
    if (dir === 'to_lead' && !teamId) { toastError('Pick which lead you paid.'); return; }
    const { error } = await supabase.from('crew_payments').insert({
      project_id: project.id, team_id: dir === 'to_lead' ? teamId : null, direction: dir, kind,
      amount: amt, paid_on: paidOn, method: method || null, note: note || null,
    });
    if (error) { toastError(error.message); return; }
    toastSuccess(dir === 'to_lead' ? 'Payment to lead recorded' : `Payment from ${project.client || 'client'} recorded`);
    setAmount(''); setNote('');
    onChanged();
  };
  const remove = async (id: string) => {
    if (!confirm('Delete this payment record?')) return;
    const { error } = await supabase.from('crew_payments').delete().eq('id', id);
    if (error) { toastError(error.message); return; }
    onChanged();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
        <Stat label={`Billable to ${project.client || 'client'}`} value={fmtMoney(m.totalBillable)} sub={`${m.hours} hrs labor ${fmtMoney(m.laborBilled)} + travel ${fmtMoney(m.travelBillable)}`} />
        <Stat label={`${project.client || 'Client'} has paid`} value={fmtMoney(m.receivedFromClient)} sub={`${fmtMoney(m.clientBalance)} still owed to FAJ`} warn={m.clientBalance > 0} />
        <Stat label="Owed to leads" value={fmtMoney(m.owedToLeads)} sub={`${fmtMoney(m.paidToLeads)} paid · ${fmtMoney(m.leadBalance)} due`} warn={m.leadBalance > 0} />
        <Stat label="FAJ keeps (labor)" value={fmtMoney(m.margin)} accent sub="Approved hours × (bill rate − lead rate)" />
      </div>

      {teams.some((t) => Number(t.pay_rate) === 0) && (
        <div style={{ background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 12, padding: '10px 14px', fontSize: 13, color: '#92400e' }}>
          No lead rate set for {teams.filter((t) => Number(t.pay_rate) === 0).map(leadName).join(', ')}. Until you set it in Setup, their hours count as $0 owed and the full {fmtMoney(Number(project.bill_rate))}/hr shows as FAJ&apos;s.
        </div>
      )}

      <div className="glass card" style={{ padding: 12, overflowX: 'auto' }}>
        <SectionHead>By team</SectionHead>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 760 }}>
          <thead><tr>
            <th style={TH}>Lead</th><th style={TH}>Rate</th><th style={TH}>Hours</th><th style={TH}>Labor owed</th>
            <th style={TH}>Travel owed</th><th style={TH}>Paid</th><th style={TH}>Due now</th><th style={TH}>FAJ keeps</th>
          </tr></thead>
          <tbody>
            {teams.map((t) => {
              const tm = teamMoney(t, project, entries, receipts, payments);
              return (
                <tr key={t.id}>
                  <td style={{ ...TD, fontWeight: 700 }}>{leadName(t)}</td>
                  <td style={{ ...TD, color: Number(t.pay_rate) === 0 ? '#b45309' : undefined }}>{Number(t.pay_rate) === 0 ? 'not set' : `${fmtMoney(Number(t.pay_rate))}/hr`}</td>
                  <td style={TD}>{tm.hours}</td>
                  <td style={TD}>{fmtMoney(tm.laborOwed)}</td>
                  <td style={TD}>{fmtMoney(tm.travelOwed)}</td>
                  <td style={TD}>{fmtMoney(tm.paidLabor + tm.paidTravel)}</td>
                  <td style={{ ...TD, fontWeight: 700, color: tm.balance > 0 ? '#b45309' : '#047857' }}>{fmtMoney(tm.balance)}</td>
                  <td style={TD}>{fmtMoney(tm.margin)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ fontSize: 11.5, color: '#999', marginTop: 8 }}>
          Leads pay their own helpers out of their rate. Travel owed is every approved receipt the lead fronted; only the first {fmtMoney(Number(project.travel_cap))} per site is billable to {project.client || 'the client'}.
        </div>
      </div>

      <div className="glass card" style={{ padding: 14 }}>
        <SectionHead>Record a payment</SectionHead>
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <TabBtn on={dir === 'to_lead'} onClick={() => setDir('to_lead')} label="FAJ paid a lead" />
          <TabBtn on={dir === 'from_client'} onClick={() => setDir('from_client')} label={`${project.client || 'Client'} paid FAJ`} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
          {dir === 'to_lead' && (
            <select className="select" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              <option value="">Which lead</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{leadName(t)}</option>)}
            </select>
          )}
          <select className="select" value={kind} onChange={(e) => setKind(e.target.value as 'labor' | 'travel')}>
            <option value="labor">Labor</option><option value="travel">Travel reimbursement</option>
          </select>
          <input className="input" inputMode="decimal" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <input className="input" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
          <input className="input" placeholder="Method (Zelle, check…)" value={method} onChange={(e) => setMethod(e.target.value)} />
          <input className="input" placeholder="Note / week" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <button className="btn btn-primary" onClick={record} style={{ marginTop: 10 }}><Plus size={14} /> Record payment</button>
      </div>

      {payments.length > 0 && (
        <div className="glass card" style={{ padding: 12, overflowX: 'auto' }}>
          <SectionHead>Payment history</SectionHead>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <tbody>
              {payments.map((p) => {
                const t = teams.find((x) => x.id === p.team_id);
                return (
                  <tr key={p.id}>
                    <td style={TD}>{fmtDate(p.paid_on)}</td>
                    <td style={TD}>{p.direction === 'from_client' ? `${project.client || 'Client'} → FAJ` : `FAJ → ${t ? leadName(t) : 'lead'}`}</td>
                    <td style={TD}>{p.kind === 'travel' ? 'Travel' : 'Labor'}</td>
                    <td style={TD}>{[p.method, p.note].filter(Boolean).join(' · ')}</td>
                    <td style={{ ...TD, fontWeight: 700, textAlign: 'right', color: p.direction === 'from_client' ? '#047857' : '#333' }}>{fmtMoney(Number(p.amount))}</td>
                    <td style={TD}><button onClick={() => remove(p.id)} style={ICON_BTN} aria-label="Delete"><Trash2 size={14} /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Messages ────────────────────────────────────────────────────────────────

function MessagesTab({ project, teams, contractors, messages, ownerId, supabase, onChanged }: {
  project: CrewProject; teams: CrewTeam[]; contractors: ContractorLite[]; messages: CrewMessage[];
  ownerId: string | null; supabase: Sb; onChanged: () => void;
}) {
  const [to, setTo] = useState('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const name = (id: string | null) => (id ? contractors.find((c) => c.id === id)?.name ?? 'Tech' : 'You (office)');
  const leads = teams.filter((t) => t.lead_contractor_id);

  useEffect(() => {
    const t = setInterval(onChanged, 20000);
    return () => clearInterval(t);
  }, [onChanged]);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length]);

  const send = async () => {
    const body = draft.trim();
    if (!body || !ownerId) return;
    setSending(true);
    const { error } = await supabase.from('crew_messages').insert({
      user_id: ownerId, project_id: project.id, from_contractor_id: null,
      to_contractor_id: to || null, to_office: false, content: body,
    });
    setSending(false);
    if (error) { toastError(error.message); return; }
    setDraft('');
    onChanged();
  };

  return (
    <div className="glass card" style={{ padding: 14 }}>
      <div style={{ maxHeight: '58vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 8 }}>
        {messages.length === 0 && <Empty>No messages yet. Post the first update for the crew.</Empty>}
        {messages.map((m) => {
          const mine = !m.from_contractor_id;
          const privateNote = m.to_office ? ' → you only' : m.to_contractor_id ? ` → ${name(m.to_contractor_id)} only` : ' → everyone';
          return (
            <div key={m.id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '80%' }}>
              <div style={{ fontSize: 10.5, color: '#999', marginBottom: 2, textAlign: mine ? 'right' : 'left' }}>
                {name(m.from_contractor_id)}{privateNote} · {new Date(m.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </div>
              <div style={{
                padding: '8px 12px', borderRadius: 12, fontSize: 13.5, lineHeight: 1.45, whiteSpace: 'pre-wrap',
                background: mine ? 'var(--teal)' : (m.to_office || m.to_contractor_id) ? 'rgba(245,158,11,0.12)' : 'rgba(13,115,119,0.08)',
                color: mine ? 'white' : '#333',
              }}>{m.content}</div>
            </div>
          );
        })}
        <div ref={bottom} />
      </div>
      <div style={{ display: 'flex', gap: 8, borderTop: '1px solid #eee', paddingTop: 10, flexWrap: 'wrap' }}>
        <select className="select" value={to} onChange={(e) => setTo(e.target.value)} style={{ maxWidth: 240 }}>
          <option value="">To: everyone on the project</option>
          {leads.map((t) => <option key={t.id} value={t.lead_contractor_id!}>To: {name(t.lead_contractor_id)} only</option>)}
        </select>
        <textarea className="input" rows={2} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Type a message" style={{ flex: 1, minWidth: 220 }} />
        <button className="btn btn-primary" onClick={send} disabled={sending || !draft.trim()}><Send size={14} /> Send</button>
      </div>
    </div>
  );
}

// ── Setup ───────────────────────────────────────────────────────────────────

function SetupTab({ project, teams, contractors, onSavedProject, onChanged, supabase }: {
  project: CrewProject | null; teams: CrewTeam[]; contractors: ContractorLite[];
  onSavedProject: (id: string) => void; onChanged: () => void; supabase: Sb;
}) {
  const [name, setName] = useState(project?.name ?? 'LDS Meetinghouse Refresh');
  const [client, setClient] = useState(project?.client ?? 'NetView');
  const [billRate, setBillRate] = useState(String(project?.bill_rate ?? 90));
  const [cap, setCap] = useState(String(project?.travel_cap ?? 3000));
  const [start, setStart] = useState(project?.start_date ?? '2026-10-19');
  const [weeks, setWeeks] = useState(String(project?.weeks ?? 7));
  const [skip, setSkip] = useState((project?.skip_weeks ?? (project ? [] : ['2026-11-23'])).join(', '));
  const [notes, setNotes] = useState(project?.notes ?? '');

  useEffect(() => {
    setName(project?.name ?? 'LDS Meetinghouse Refresh'); setClient(project?.client ?? 'NetView');
    setBillRate(String(project?.bill_rate ?? 90)); setCap(String(project?.travel_cap ?? 3000));
    setStart(project?.start_date ?? '2026-10-19'); setWeeks(String(project?.weeks ?? 7));
    setSkip((project?.skip_weeks ?? (project ? [] : ['2026-11-23'])).join(', ')); setNotes(project?.notes ?? '');
  }, [project]);

  const saveProject = async () => {
    const skipList = skip.split(/[,\s]+/).map((s) => s.trim()).filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s));
    const row = {
      name: name.trim(), client: client.trim() || null, bill_rate: Number(billRate) || 0,
      travel_cap: Number(cap) || 0, start_date: start || null, weeks: Math.max(1, Math.min(52, Number(weeks) || 1)),
      skip_weeks: skipList, notes: notes.trim() || null, updated_at: new Date().toISOString(),
    };
    if (!row.name) { toastError('Give the project a name.'); return; }
    const res = project
      ? await supabase.from('crew_projects').update(row).eq('id', project.id).select('id').single()
      : await supabase.from('crew_projects').insert(row).select('id').single();
    if (res.error) { toastError(res.error.message); return; }
    toastSuccess(project ? 'Project saved' : 'Project created');
    onSavedProject(res.data.id);
  };

  // New team
  const [leadId, setLeadId] = useState('');
  const [helper, setHelper] = useState('');
  const [payRate, setPayRate] = useState('');
  const addTeam = async () => {
    if (!project) return;
    const lead = contractors.find((c) => c.id === leadId);
    if (!lead) { toastError('Pick the lead tech.'); return; }
    const { error } = await supabase.from('crew_teams').insert({
      project_id: project.id, lead_contractor_id: lead.id, name: `Team ${lead.name.split(' ')[0]}`,
      helper_name: helper.trim() || null, pay_rate: Number(payRate) || 0, sort: teams.length,
    });
    if (error) { toastError(error.message); return; }
    setLeadId(''); setHelper(''); setPayRate('');
    onChanged();
  };
  const updateTeam = async (id: string, patch: Partial<CrewTeam>) => {
    const { error } = await supabase.from('crew_teams').update(patch).eq('id', id);
    if (error) { toastError(error.message); return; }
    onChanged();
  };
  const removeTeam = async (t: CrewTeam) => {
    if (!confirm(`Remove ${t.name}? Their sites become unscheduled. Hours and receipts they logged are deleted.`)) return;
    const { error } = await supabase.from('crew_teams').delete().eq('id', t.id);
    if (error) { toastError(error.message); return; }
    onChanged();
  };

  const takenLeads = new Set(teams.map((t) => t.lead_contractor_id));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="glass card" style={{ padding: 16 }}>
        <SectionHead>{project ? 'Project' : 'New project'}</SectionHead>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
          <Labeled label="Project name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Labeled>
          <Labeled label="Client (who pays FAJ)"><input className="input" value={client} onChange={(e) => setClient(e.target.value)} /></Labeled>
          <Labeled label="Bill rate per team-hour ($)"><input className="input" inputMode="decimal" value={billRate} onChange={(e) => setBillRate(e.target.value)} /></Labeled>
          <Labeled label="Travel cap per site ($)"><input className="input" inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} /></Labeled>
          <Labeled label="First week (Monday)"><input className="input" type="date" value={start ?? ''} onChange={(e) => setStart(e.target.value)} /></Labeled>
          <Labeled label="Number of weeks"><input className="input" inputMode="numeric" value={weeks} onChange={(e) => setWeeks(e.target.value)} /></Labeled>
          <Labeled label="Weeks off (Mondays, comma-separated)"><input className="input" value={skip} onChange={(e) => setSkip(e.target.value)} placeholder="2026-11-23" /></Labeled>
        </div>
        <Labeled label="Notes"><textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Mon–Fri only, no weekends. Site code of conduct: no tobacco, coffee or tea on the property." /></Labeled>
        <button className="btn btn-primary" onClick={saveProject} style={{ marginTop: 10 }}><Check size={14} /> {project ? 'Save project' : 'Create project'}</button>
      </div>

      {project && (
        <div className="glass card" style={{ padding: 16 }}>
          <SectionHead>Teams</SectionHead>
          <div style={{ fontSize: 12.5, color: '#777', marginBottom: 10, lineHeight: 1.5 }}>
            Each team is a lead with a portal login plus their helper. The <b>lead rate</b> is what FAJ pays the lead per team-hour; the lead pays their own helper from it. Leads never see the bill rate or anyone else&apos;s rate.
          </div>
          {teams.map((t) => {
            const lead = contractors.find((c) => c.id === t.lead_contractor_id);
            return (
              <div key={t.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(150px,1.3fr) minmax(130px,1fr) 110px auto', gap: 8, alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f0ede6' }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{lead?.name ?? 'No lead'}</div>
                  <div style={{ fontSize: 11, color: lead?.auth_user_id ? '#047857' : '#b45309' }}>
                    {lead?.auth_user_id ? 'Portal login active' : `No login yet${lead?.email ? ` · invite ${lead.email}` : ' · add an email'}`}
                  </div>
                </div>
                <input className="input" defaultValue={t.helper_name ?? ''} placeholder="Helper name"
                  onBlur={(e) => e.target.value !== (t.helper_name ?? '') && updateTeam(t.id, { helper_name: e.target.value || null })} />
                <input className="input" inputMode="decimal" defaultValue={String(t.pay_rate)}
                  onBlur={(e) => Number(e.target.value) !== Number(t.pay_rate) && updateTeam(t.id, { pay_rate: Number(e.target.value) || 0 })} />
                <button onClick={() => removeTeam(t)} style={ICON_BTN} aria-label="Remove team"><Trash2 size={14} /></button>
              </div>
            );
          })}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(150px,1.3fr) minmax(130px,1fr) 110px auto', gap: 8, alignItems: 'center', marginTop: 10 }}>
            <select className="select" value={leadId} onChange={(e) => setLeadId(e.target.value)}>
              <option value="">Add a lead…</option>
              {contractors.filter((c) => !takenLeads.has(c.id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input className="input" placeholder="Helper name" value={helper} onChange={(e) => setHelper(e.target.value)} />
            <input className="input" inputMode="decimal" placeholder="Lead $/hr" value={payRate} onChange={(e) => setPayRate(e.target.value)} />
            <button className="btn btn-ghost" onClick={addTeam}><Users size={14} /> Add</button>
          </div>
          <div style={{ fontSize: 11.5, color: '#999', marginTop: 8 }}>
            Lead not in the list? Add them under Contractors with their email, then they sign up at app.fajsolutions.com/tech/login with that same email.
          </div>
        </div>
      )}
    </div>
  );
}

// ── Small pieces ────────────────────────────────────────────────────────────

const TH: React.CSSProperties = { textAlign: 'left', padding: '7px 8px', fontSize: 10.5, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: '#888', borderBottom: '1px solid #eee', whiteSpace: 'nowrap' };
const TD: React.CSSProperties = { padding: '7px 8px', borderBottom: '1px solid #f3f1ea', verticalAlign: 'top' };
const SMALL_SELECT: React.CSSProperties = { fontSize: 12.5, padding: '5px 8px', minWidth: 110 };
const ICON_BTN: React.CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--teal)', padding: 4, display: 'inline-flex' };

function TabBtn({ on, onClick, icon, label, badge, disabled }: {
  on: boolean; onClick: () => void; icon?: React.ReactNode; label: string; badge?: number; disabled?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 13px', borderRadius: 999,
      fontSize: 12.5, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1,
      border: on ? '1px solid var(--teal)' : '1px solid rgba(13,115,119,0.2)',
      background: on ? 'var(--teal)' : 'white', color: on ? 'white' : 'var(--teal)',
    }}>
      {icon}{label}
      {badge != null && badge > 0 && (
        <span style={{ background: on ? 'rgba(255,255,255,0.25)' : 'rgba(245,158,11,0.18)', color: on ? 'white' : '#92400e', borderRadius: 999, fontSize: 10, padding: '1px 6px' }}>{badge}</span>
      )}
    </button>
  );
}

function Stat({ label, value, sub, accent, warn }: { label: string; value: string; sub?: string; accent?: boolean; warn?: boolean }) {
  return (
    <div className="glass card" style={{ padding: '12px 14px' }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, color: '#999', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 21, fontWeight: 800, color: accent ? '#047857' : warn ? '#b45309' : '#333', marginTop: 3 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function SectionHead({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 1.2, color: 'var(--teal)', textTransform: 'uppercase', marginBottom: 10 }}>{children}</div>;
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, color: '#555', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ textAlign: 'center', padding: '24px 16px', color: '#aaa', fontSize: 13 }}>{children}</div>;
}
