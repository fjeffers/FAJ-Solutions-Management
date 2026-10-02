'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  addStaffMember, setStaffEnabled, removeStaffMember, staffReasonText, todayEastern,
  type StaffMember, type StaffTask,
} from '@/lib/assistant';
import { fmtDate } from '@/lib/utils';
import { toastError, toastSuccess } from '@/lib/toast';
import { UserPlus, Copy, Trash2, Plus, CheckCircle2, Circle, Power } from 'lucide-react';

/**
 * Fred's side of the assistant section (migration-092): who the assistant is,
 * whether their login is on, and the to-do list they work from.
 *
 * Nothing here emails anyone. Fred copies the sign-in link and sends it
 * himself, and the assistant picks their own password.
 */
export default function AssistantAdminView() {
  const supabase = createClient();
  const [staff, setStaff] = useState<StaffMember[]>([]);
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

  const signInLink = typeof window !== 'undefined' ? `${window.location.origin}/assistant/login` : '/assistant/login';

  const load = async () => {
    const [s, t, a] = await Promise.all([
      supabase.from('staff_members').select('id, name, email, enabled, auth_user_id, last_login_at, created_at').order('created_at'),
      supabase.from('staff_tasks').select('id, staff_id, title, details, due_date, status, done_at, done_note, created_at')
        .order('status').order('due_date', { ascending: true, nullsFirst: false }).order('created_at'),
      // Every sign-in, job change and finished task (migrations 092-093).
      supabase.from('audit_log').select('id, action, entity_type, details, created_at')
        .not('details->by_assistant', 'is', null)
        .order('created_at', { ascending: false }).limit(200),
    ]);
    if (s.error || t.error) toastError("Couldn't load the assistant screen. Refresh to try again.");
    setStaff((s.data ?? []) as StaffMember[]);
    setTasks((t.data ?? []) as (StaffTask & { staff_id: string | null })[]);
    setActivity((a.data ?? []) as ActivityRow[]);
    setLoaded(true);
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true);
    try {
      const r = await addStaffMember(name, email);
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

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(signInLink);
      toastSuccess('Sign-in link copied.');
    } catch {
      toastError(`Couldn't copy. The link is ${signInLink}`);
    }
  };

  const today = todayEastern();
  const open = tasks.filter((t) => t.status === 'open');
  const done = tasks.filter((t) => t.status === 'done');

  return (
    <div style={{ maxWidth: 980 }}>
      <div style={{ marginBottom: 22 }}>
        <div className="display" style={{ fontSize: 11, color: 'var(--teal)', letterSpacing: 2, marginBottom: 4 }}>YOUR TEAM</div>
        <h1 className="serif" style={{ fontSize: 32, margin: 0, fontWeight: 600 }}>Assistant</h1>
        <p style={{ color: '#666', fontSize: 13, margin: '6px 0 0', lineHeight: 1.6, maxWidth: 680 }}>
          Your assistant sees the work, the schedule, the techs&apos; contact details and their to-do list.
          They never see money: no client prices, no tech pay, no profit, no invoices, no bank or tax details.
          They can change a job&apos;s date, times, site contact and access notes. Status, which tech is on a
          job, and anything priced stay with you.
        </p>
      </div>

      {/* ── People ── */}
      <div className="glass card" style={{ padding: 20, marginBottom: 18 }}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>Who has an assistant login</div>
        {loaded && staff.length === 0 && (
          <div style={{ fontSize: 13, color: '#888', marginBottom: 14 }}>Nobody yet. Add your assistant below.</div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          {staff.map((m) => (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '10px 12px', borderRadius: 10, background: 'rgba(0,0,0,0.025)' }}>
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

        <form onSubmit={add} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr)) auto', gap: 10, alignItems: 'end' }}>
          <div>
            <label style={LABEL} htmlFor="staff-name">Name</label>
            <input id="staff-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Their full name" required />
          </div>
          <div>
            <label style={LABEL} htmlFor="staff-email">Their email</label>
            <input id="staff-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" required />
          </div>
          <button className="btn btn-primary" type="submit" disabled={adding} style={{ height: 42 }}>
            <UserPlus size={14} /> {adding ? 'Adding…' : 'Add assistant'}
          </button>
        </form>

        <div style={{ marginTop: 16, padding: '12px 14px', borderRadius: 10, background: 'rgba(13,115,119,0.06)', fontSize: 12.5, lineHeight: 1.6 }}>
          <b>How they get in:</b> send them this link. They tap &ldquo;First time? Create your login&rdquo;, use the
          email you added, and choose their own password. You never need to know it.
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
            <code style={{ background: 'white', padding: '6px 10px', borderRadius: 6, fontSize: 12 }}>{signInLink}</code>
            <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={copyLink}><Copy size={13} /> Copy link</button>
          </div>
        </div>
      </div>

      {/* ── To-do list ── */}
      <div className="glass card" style={{ padding: 20 }}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>Their to-do list ({open.length} open)</div>
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
        <div style={{ fontWeight: 700, marginBottom: 4 }}>Everything they did</div>
        <div style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>
          Every sign-in, every change to a job, and every task they finished or reopened. Newest first.
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

const LABEL: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: '#555',
  textTransform: 'uppercase', display: 'block', marginBottom: 5,
};
