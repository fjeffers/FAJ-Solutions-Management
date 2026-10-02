'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  addStaffMember, setStaffEnabled, removeStaffMember, staffReasonText, todayEastern, ROLES,
  type StaffMember, type StaffTask, type StaffRole,
} from '@/lib/assistant';
import { fmtDate } from '@/lib/utils';
import { toastError, toastSuccess } from '@/lib/toast';
import { UserPlus, Copy, Trash2, Plus, CheckCircle2, Circle, Power, ExternalLink, Code2 } from 'lucide-react';

/**
 * Everyone who can sign in to the app, with their role (migrations 092-094):
 * Fred as owner, every tech with a login, and every assistant. Fred adds and
 * turns off assistants here, gives them their to-do list, and sees everything
 * they did. Techs are still added on the Contractors screen.
 *
 * Nothing here emails anyone. Fred copies the sign-in link and sends it
 * himself, and each person picks their own password.
 */
interface TechLogin {
  id: string;
  name: string;
  email: string | null;
  auth_user_id: string | null;
  portal_enabled: boolean | null;
  portal_last_login_at: string | null;
}

export default function TeamView({ onOpenContractors }: { onOpenContractors?: () => void }) {
  const supabase = createClient();
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [techs, setTechs] = useState<TechLogin[]>([]);
  const [role, setRole] = useState<StaffRole>('assistant');
  const [tasks, setTasks] = useState<(StaffTask & { staff_id: string | null })[]>([]);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [adding, setAdding] = useState(false);

  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [due, setDue] = useState('');
  const [savingTask, setSavingTask] = useState(false);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const signInLinks: [string, string][] = [
    ['Assistant', `${origin}/assistant/login`],
    ['Accountant', `${origin}/accountant/login`],
  ];

  const load = async () => {
    const [s, t, a, c] = await Promise.all([
      supabase.from('staff_members').select('id, name, email, role, enabled, auth_user_id, last_login_at, created_at').order('created_at'),
      supabase.from('staff_tasks').select('id, staff_id, title, details, due_date, status, done_at, done_note, created_at')
        .order('status').order('due_date', { ascending: true, nullsFirst: false }).order('created_at'),
      // Every sign-in, job change and finished task (migrations 092-093).
      supabase.from('audit_log').select('id, action, entity_type, details, created_at')
        .not('details->by_assistant', 'is', null)
        .order('created_at', { ascending: false }).limit(200),
      supabase.from('contractors').select('id, name, email, auth_user_id, portal_enabled, portal_last_login_at').order('name'),
    ]);
    if (s.error || t.error) toastError("Couldn't load the assistant screen. Refresh to try again.");
    setStaff((s.data ?? []) as StaffMember[]);
    setTasks((t.data ?? []) as (StaffTask & { staff_id: string | null })[]);
    setActivity((a.data ?? []) as ActivityRow[]);
    setTechs((c.data ?? []) as TechLogin[]);
    setLoaded(true);
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true);
    try {
      const r = await addStaffMember(name, email, role);
      if (!r.ok) { toastError(staffReasonText(r.reason)); return; }
      toastSuccess(`${name.trim()} added. Send them the sign-in link below.`);
      setName(''); setEmail('');
      await load();
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Could not add.');
    } finally { setAdding(false); }
  };

  const toggle = async (m: StaffMember) => {
    try {
      const r = await setStaffEnabled(m.id, !m.enabled);
      if (!r.ok) { toastError(staffReasonText(r.reason)); return; }
      toastSuccess(m.enabled ? `${m.name}'s login is off. They can't get in.` : `${m.name}'s login is back on.`);
      await load();
    } catch (err) { toastError(err instanceof Error ? err.message : 'Could not save.'); }
  };

  const remove = async (m: StaffMember) => {
    if (!window.confirm(`Remove ${m.name}? Their login stops working right away. Their finished tasks stay on your list.`)) return;
    try {
      const r = await removeStaffMember(m.id);
      if (!r.ok) { toastError(staffReasonText(r.reason)); return; }
      toastSuccess(`${m.name} removed.`);
      await load();
    } catch (err) { toastError(err instanceof Error ? err.message : 'Could not remove.'); }
  };

  const addTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSavingTask(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSavingTask(false); return; }
    const { error } = await supabase.from('staff_tasks').insert({
      owner_id: user.id, title: title.trim(), details: details.trim() || null, due_date: due || null,
    });
    setSavingTask(false);
    if (error) { toastError(`Couldn't add the task: ${error.message}`); return; }
    setTitle(''); setDetails(''); setDue('');
    toastSuccess('Task added to the assistant’s list.');
    await load();
  };

  const deleteTask = async (t: StaffTask) => {
    if (!window.confirm(`Delete "${t.title}"?`)) return;
    const { error } = await supabase.from('staff_tasks').delete().eq('id', t.id);
    if (error) { toastError(`Couldn't delete: ${error.message}`); return; }
    await load();
  };

  const copyLink = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      toastSuccess('Sign-in link copied.');
    } catch {
      toastError(`Couldn't copy. The link is ${link}`);
    }
  };

  // A tech's login on or off, right here — the same switch the tech portal
  // checks (contractors.portal_enabled, migration-067). Off is immediate.
  const toggleTech = async (t: TechLogin) => {
    const turningOff = t.portal_enabled !== false;
    if (turningOff && !window.confirm(`Turn off ${t.name}'s tech login? They can't sign in until you turn it back on.`)) return;
    const { error } = await supabase.from('contractors').update({ portal_enabled: !turningOff }).eq('id', t.id);
    if (error) { toastError(`Couldn't change it: ${error.message}`); return; }
    toastSuccess(turningOff ? `${t.name}'s login is off.` : `${t.name}'s login is back on.`);
    await load();
  };

  const techSignIn = typeof window !== 'undefined' ? `${window.location.origin}/tech/login` : '/tech/login';
  const roleLabel = (key: string) => ROLES.find((r) => r.key === key)?.label ?? key;
  const today = todayEastern();
  const open = tasks.filter((t) => t.status === 'open');
  const done = tasks.filter((t) => t.status === 'done');

  return (
    <div style={{ maxWidth: 980 }}>
      <div style={{ marginBottom: 22 }}>
        <div className="display" style={{ fontSize: 11, color: 'var(--teal)', letterSpacing: 2, marginBottom: 4 }}>WHO CAN SIGN IN</div>
        <h1 className="serif" style={{ fontSize: 32, margin: 0, fontWeight: 600 }}>Team</h1>
        <p style={{ color: '#666', fontSize: 13, margin: '6px 0 0', lineHeight: 1.6, maxWidth: 680 }}>
          Everyone who can sign in to your app, and what their role lets them see. Each person has their own
          login and picks their own password. You see everything.
        </p>
      </div>

      {/* ── Roles ── */}
      <div className="glass card" style={{ padding: 20, marginBottom: 18 }}>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>Roles</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {ROLES.map((r) => (
            <div key={r.key} style={{ display: 'flex', gap: 12, fontSize: 13, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <span style={{ ...ROLE_PILL, ...(ROLE_COLORS[r.key] ?? {}) }}>{r.label}</span>
              <span style={{ color: '#555', flex: 1, minWidth: 220 }}>
                {r.sees}{r.addedWhere ? ` Added on the ${r.addedWhere}.` : ''}
              </span>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 12, color: '#777', marginTop: 12, lineHeight: 1.6 }}>
          An assistant can change a job&apos;s date, times, site contact and access notes. Status, which tech is
          on a job, and anything priced stay with you.
        </div>
      </div>

      {/* ── People ── */}
      <div className="glass card" style={{ padding: 20, marginBottom: 18 }}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>People</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          <div style={PERSON_ROW}>
            <span style={{ ...ROLE_PILL, ...ROLE_COLORS.owner }}>Owner</span>
            <div style={{ flex: 1, minWidth: 200, fontWeight: 700 }}>You</div>
            <div style={{ fontSize: 12, color: '#047857', fontWeight: 700 }}>Everything</div>
          </div>
          {loaded && staff.length === 0 && (
            <div style={{ fontSize: 13, color: '#888', padding: '4px 12px' }}>No assistants yet. Add one below.</div>
          )}
          {staff.map((m) => (
            <div key={m.id} style={PERSON_ROW}>
              <span style={{ ...ROLE_PILL, ...(ROLE_COLORS[m.role] ?? {}) }}>{roleLabel(m.role)}</span>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 700 }}>{m.name}</div>
                <div style={{ fontSize: 12, color: '#777' }}>{m.email}</div>
              </div>
              <div style={{ fontSize: 12, color: !m.enabled ? '#b91c1c' : m.auth_user_id ? '#047857' : '#b45309', fontWeight: 700 }}>
                {!m.enabled ? 'Login turned off'
                  : m.auth_user_id ? `Active${m.last_login_at ? ` · last in ${fmtDate(m.last_login_at)}` : ''}`
                  : 'Has not set up their login yet'}
              </div>
              <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => toggle(m)}>
                <Power size={13} /> {m.enabled ? 'Turn off' : 'Turn on'}
              </button>
              <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => remove(m)} aria-label={`Remove ${m.name}`}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>

        {/* Techs: one row each, managed on the Contractors screen. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          {techs.map((t) => (
            <div key={t.id} style={PERSON_ROW}>
              <span style={{ ...ROLE_PILL, ...ROLE_COLORS.tech }}>Tech</span>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 700 }}>{t.name}</div>
                {t.email && <div style={{ fontSize: 12, color: '#777' }}>{t.email}</div>}
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: t.portal_enabled === false ? '#b91c1c' : t.auth_user_id ? '#047857' : '#b45309' }}>
                {t.portal_enabled === false ? 'Login turned off'
                  : t.auth_user_id ? `Has a login${t.portal_last_login_at ? ` · last in ${fmtDate(t.portal_last_login_at)}` : ''}`
                  : 'No login yet'}
              </div>
              <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => toggleTech(t)}>
                <Power size={13} /> {t.portal_enabled === false ? 'Turn on' : 'Turn off'}
              </button>
            </div>
          ))}
          {onOpenContractors && (
            <button className="btn btn-ghost" style={{ fontSize: 12, alignSelf: 'flex-start' }} onClick={onOpenContractors}>
              <ExternalLink size={13} /> Add or change techs on the Contractors screen
            </button>
          )}
        </div>

        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Add a person</div>
        <form onSubmit={add} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: '2 1 200px' }}>
            <label style={LABEL} htmlFor="staff-name">Name</label>
            <input id="staff-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Their full name" required />
          </div>
          <div style={{ flex: '2 1 200px' }}>
            <label style={LABEL} htmlFor="staff-email">Their email</label>
            <input id="staff-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" required />
          </div>
          <div style={{ flex: '1 1 160px' }}>
            <label style={LABEL} htmlFor="staff-role">Role</label>
            <select id="staff-role" className="select input" value={role} onChange={(e) => setRole(e.target.value as StaffRole)}>
              {ROLES.filter((r) => r.key !== 'owner').map((r) => (
                <option key={r.key} value={r.key} disabled={!r.canAdd}>
                  {r.label}{r.canAdd ? '' : r.addedWhere ? ` (add on the ${r.addedWhere})` : ' (not set up yet)'}
                </option>
              ))}
            </select>
          </div>
          <button className="btn btn-primary" type="submit" disabled={adding} style={{ height: 42 }}>
            <UserPlus size={14} /> {adding ? 'Adding…' : `Add ${roleLabel(role).toLowerCase()}`}
          </button>
        </form>

        <div style={{ marginTop: 16, padding: '12px 14px', borderRadius: 10, background: 'rgba(13,115,119,0.06)', fontSize: 12.5, lineHeight: 1.6 }}>
          <b>How they get in:</b> send each person the link for their role. They tap &ldquo;First time? Create your
          login&rdquo;, use the email you added, and choose their own password. You never need to know it.
          {signInLinks.map(([label, link]) => (
            <div key={label} style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
              <span style={{ width: 84, fontWeight: 700 }}>{label}</span>
              <code style={{ background: 'white', padding: '6px 10px', borderRadius: 6, fontSize: 12, wordBreak: 'break-all' }}>{link}</code>
              <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => copyLink(link)}><Copy size={13} /> Copy</button>
            </div>
          ))}
          <div style={{ marginTop: 10 }}>
            <b>Techs</b> sign in at <code style={{ background: 'white', padding: '2px 6px', borderRadius: 4 }}>{techSignIn}</code> with
            the email on their contractor record. Each tech sees only their own jobs and pay.
          </div>
        </div>
      </div>

      {/* ── Developer ── */}
      <div className="glass card" style={{ padding: 20, marginBottom: 18 }}>
        <div style={{ fontWeight: 700, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}><Code2 size={16} /> Developer</div>
        <div style={{ fontSize: 13, color: '#555', lineHeight: 1.65 }}>
          A developer fixes and improves the app as you direct. They work in the app&apos;s code on GitHub, not inside
          your live app, so they never see your clients, money or techs&apos; tax details. Every change they make waits
          for review before it goes live.
          <ol style={{ margin: '10px 0 0', paddingLeft: 20 }}>
            <li>Have them sign an agreement (confidentiality and who owns the code) before you give access.</li>
            <li>
              Give or take away access on GitHub: <a href="https://github.com/fjeffers/faj-payment-solutions/settings/access"
                target="_blank" rel="noreferrer" style={{ color: 'var(--teal)', fontWeight: 700 }}>Collaborators for your app&apos;s code</a>.
              Add their GitHub username to give access; press Remove to take it away. It takes effect at once.
            </li>
            <li>Ask Claude to set up a practice copy of the app with fake data for them to test on.</li>
          </ol>
        </div>
      </div>

      {/* ── To-do list ── */}
      <div className="glass card" style={{ padding: 20 }}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>Assistants&apos; to-do list ({open.length} open)</div>
        <form onSubmit={addTask} style={{ display: 'grid', gap: 10, marginBottom: 18 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ flex: '3 1 260px' }}>
              <label style={LABEL} htmlFor="task-title">Task</label>
              <input id="task-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Update our Google profile photos" required />
            </div>
            <div style={{ flex: '1 1 160px' }}>
              <label style={LABEL} htmlFor="task-due">Due (optional)</label>
              <input id="task-due" className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            </div>
          </div>
          <div>
            <label style={LABEL} htmlFor="task-details">Details (optional)</label>
            <textarea id="task-details" className="input" rows={2} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Anything they need to know to get it done" />
          </div>
          <div>
            <button className="btn btn-primary" type="submit" disabled={savingTask}><Plus size={14} /> {savingTask ? 'Adding…' : 'Add task'}</button>
          </div>
        </form>

        {loaded && tasks.length === 0 && <div style={{ fontSize: 13, color: '#888' }}>No tasks yet.</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[...open, ...done].map((t) => {
            const late = t.status === 'open' && t.due_date && t.due_date < today;
            return (
              <div key={t.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', borderRadius: 10, background: 'rgba(0,0,0,0.025)', opacity: t.status === 'done' ? 0.8 : 1 }}>
                {t.status === 'done'
                  ? <CheckCircle2 size={18} color="#10b981" style={{ flexShrink: 0, marginTop: 1 }} />
                  : <Circle size={18} color="var(--teal)" style={{ flexShrink: 0, marginTop: 1 }} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, textDecoration: t.status === 'done' ? 'line-through' : 'none' }}>{t.title}</div>
                  {t.details && <div style={{ fontSize: 12, color: '#666', marginTop: 3, whiteSpace: 'pre-wrap' }}>{t.details}</div>}
                  <div style={{ fontSize: 11.5, marginTop: 4, color: late ? '#b91c1c' : '#888', fontWeight: late ? 700 : 500 }}>
                    {t.status === 'done'
                      ? `Done ${t.done_at ? fmtDate(t.done_at) : ''}${t.done_note ? ` — "${t.done_note}"` : ''}`
                      : t.due_date ? `${late ? 'Overdue — was due' : 'Due'} ${fmtDate(t.due_date)}` : 'No due date'}
                  </div>
                </div>
                <button onClick={() => deleteTask(t)} aria-label={`Delete ${t.title}`} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#bbb', padding: 4 }}>
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Everything they did ── */}
      <div className="glass card" style={{ padding: 20, marginTop: 18 }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>Everything your team did</div>
        <div style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>
          Every sign-in by an assistant or accountant, every change to a job, every task finished or reopened, and
          every time the accountant showed a tax ID or opened a W-9. Newest first. Only you see this.
        </div>
        {loaded && activity.length === 0 && <div style={{ fontSize: 13, color: '#888' }}>Nothing yet.</div>}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {activity.map((row) => (
            <div key={row.id} style={{ display: 'flex', gap: 12, padding: '9px 0', borderBottom: '1px solid rgba(0,0,0,0.05)', fontSize: 13 }}>
              <div style={{ width: 132, flexShrink: 0, color: '#999', fontSize: 12 }}>
                {new Date(row.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </div>
              <div style={{ minWidth: 0 }}>
                <div>{row.details?.label ?? row.action}</div>
                {activityChanges(row).length > 0 && (
                  <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
                    {activityChanges(row).map(([k, v]) => <div key={k}>{k}: <b>{v || '(cleared)'}</b></div>)}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

interface ActivityRow {
  id: string;
  action: string;
  entity_type: string;
  created_at: string;
  details: Record<string, string | null> & { label?: string; by_assistant?: string };
}

/** The changed fields on a job edit, in words, e.g. ["Scheduled date", "2026-10-20"]. */
const FIELD_NAMES: Record<string, string> = {
  scheduled_date: 'Scheduled date', start_time: 'Start time', end_time: 'End time',
  poc_name: 'Site contact', poc_phone: 'Contact phone', poc_email: 'Contact email',
  access_instructions: 'How to get in', parking_instructions: 'Parking',
  special_instructions: 'Special instructions', note: 'Their note',
};
function activityChanges(row: ActivityRow): [string, string][] {
  return Object.entries(row.details ?? {})
    .filter(([k, v]) => k in FIELD_NAMES && !(k === 'note' && !v))
    .map(([k, v]) => [FIELD_NAMES[k], String(v ?? '')]);
}

const PERSON_ROW: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
  padding: '10px 12px', borderRadius: 10, background: 'rgba(0,0,0,0.025)',
};

const ROLE_PILL: React.CSSProperties = {
  fontSize: 10.5, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase',
  padding: '3px 10px', borderRadius: 999, minWidth: 82, textAlign: 'center', flexShrink: 0,
  background: 'rgba(0,0,0,0.06)', color: '#555',
};

const ROLE_COLORS: Record<string, React.CSSProperties> = {
  owner: { background: 'rgba(212,175,55,0.2)', color: '#7a5c00' },
  tech: { background: 'rgba(13,115,119,0.12)', color: 'var(--teal)' },
  assistant: { background: 'rgba(107,45,139,0.12)', color: '#6B2D8B' },
  accountant: { background: 'rgba(28,40,51,0.1)', color: '#1c2833' },
};

const LABEL: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: '#555',
  textTransform: 'uppercase', display: 'block', marginBottom: 5,
};
