'use client';
// "In the field" and "Coming up" on the Dashboard, as in Field Service LIVE.
// The lists are worked out in lib/field-today.ts; this loads the rows they need
// and keeps them fresh while the Dashboard is open.
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarDays, CheckCircle2, ChevronRight, Clock } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { addDays, comingUp, fieldItems, type FieldItem, type IssueRow, type LateRow, type PunchRow, type WaitingExpense } from '@/lib/field-today';
import { fmtClock12, parseClockTime, place, type WfJob } from '@/lib/wf';
import { todayISO } from '@/lib/utils';
import { useLiveRows } from './wf/useLive';

type Rows = { late: LateRow[]; issues: IssueRow[]; punchesIn: PunchRow[]; expenses: WaitingExpense[] };
const NONE: Rows = { late: [], issues: [], punchesIn: [], expenses: [] };

/** The rows behind "In the field". Late checks run every 5 minutes, so it looks again as often. */
export function useFieldRows(jobs: WfJob[]): Rows {
  const [rows, setRows] = useState<Rows>(NONE);
  const load = async () => {
    const db = createClient();
    const today = todayISO();
    const since = new Date(Date.now() - 2 * 86_400_000).toISOString();
    const [late, issues, punches, expenses] = await Promise.all([
      db.from('project_late').select('id, wo_id, tech, day, start_label, reason, eta_min').gte('day', addDays(today, -1)),
      // An open problem stays until it's resolved or the job is finished, however old (lib/field-today.ts).
      db.from('work_order_messages').select('id, work_order_id, sender_name, reason, content, created_at')
        .eq('kind', 'issue').eq('sender_role', 'contractor').is('resolved_at', null).order('created_at', { ascending: false }).limit(200),
      db.from('job_punches').select('wo_id, contractor_name, at').eq('kind', 'in').gte('at', since),
      db.from('job_expenses').select('amount').eq('status', 'submitted'),
    ]);
    setRows({
      late: (late.data as LateRow[] | null) ?? [],
      issues: (issues.data as IssueRow[] | null) ?? [],
      punchesIn: (punches.data as PunchRow[] | null) ?? [],
      expenses: (expenses.data as WaitingExpense[] | null) ?? [],
    });
  };
  // A job change is a reason to look again.
  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const t = setInterval(() => void load(), 5 * 60_000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [jobs]);
  useLiveRows('job_punches', null, () => void load());
  useLiveRows('job_expenses', null, () => void load());
  useLiveRows('work_order_messages', null, () => void load());
  return rows;
}

const TONE = {
  red: { edge: 'rgba(198,40,40,0.35)', bg: 'rgba(198,40,40,0.10)', ink: '#b91c1c' },
  amber: { edge: '#eae5d8', bg: 'rgba(245,158,11,0.12)', ink: '#b45309' },
} as const;

export function FieldAttention({ jobs, onOpenJob, onGo }: {
  jobs: WfJob[];
  onOpenJob: (woId: string) => void;
  onGo: (view: string) => void;
}) {
  const rows = useFieldRows(jobs);
  const items = useMemo(() => fieldItems({ jobs, ...rows }), [jobs, rows]);
  const open = (i: FieldItem) => (i.woId ? onOpenJob(i.woId) : i.view && onGo(i.view));
  return (
    <div>
      <h2 className="serif" style={{ fontSize: 21, fontWeight: 600, margin: '0 0 10px' }}>In the field</h2>
      {items.length === 0 ? (
        <div className="glass card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 18px' }}>
          <CheckCircle2 size={20} color="#047857" style={{ flexShrink: 0 }} />
          <div style={{ fontWeight: 700, fontSize: 14 }}>Nobody is late or stopped, and every job starting soon has a tech.</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 9 }}>
          {items.map((i) => {
            const t = TONE[i.tone];
            return (
              <button key={i.key} onClick={() => open(i)} style={{
                display: 'flex', alignItems: 'center', gap: 11, textAlign: 'left', cursor: 'pointer', padding: '13px 14px',
                borderRadius: 13, background: 'white', border: `1px solid ${t.edge}`, boxShadow: '0 1px 6px rgba(0,0,0,0.03)',
              }}>
                <span style={{ width: 32, height: 32, borderRadius: 9, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: t.bg }}>
                  {i.tone === 'red' ? <AlertTriangle size={16} color={t.ink} /> : <Clock size={16} color={t.ink} />}
                </span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: 'block', fontSize: 14, fontWeight: 700, lineHeight: 1.3, overflowWrap: 'anywhere' }}>{i.title}</span>
                  <span style={{ display: 'block', fontSize: 12, color: '#8a8578', marginTop: 2, overflowWrap: 'anywhere' }}>{i.detail}</span>
                </span>
                <ChevronRight size={16} color="#c9c3b4" style={{ flexShrink: 0 }} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const dayName = (date: string, today: string) => {
  if (date === today) return 'Today';
  if (date === addDays(today, 1)) return 'Tomorrow';
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
};

export function ComingUp({ jobs, onOpenJob }: { jobs: WfJob[]; onOpenJob: (woId: string) => void }) {
  const today = todayISO();
  const days = useMemo(() => comingUp(jobs, today), [jobs, today]);
  return (
    <div className="glass card">
      <div style={{ fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <CalendarDays size={15} color="var(--teal)" /> Coming up
        <span style={{ fontWeight: 400, fontSize: 12, color: '#888' }}>· next 7 days</span>
      </div>
      {days.length === 0 && <div style={{ color: '#aaa', fontSize: 13, textAlign: 'center', padding: '16px 0' }}>Nothing starts in the next 7 days.</div>}
      {days.map((d) => (
        <div key={d.date} style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--teal)', padding: '6px 0' }}>{dayName(d.date, today)}</div>
          {d.jobs.map((j) => {
            const t = parseClockTime(j.startTime);
            return (
              <button key={j.id} className="row-hover" onClick={() => onOpenJob(j.id)} style={{
                display: 'flex', width: '100%', gap: 12, alignItems: 'center', textAlign: 'left', cursor: 'pointer',
                padding: '9px 0', background: 'none', border: 'none', borderBottom: '1px solid #f5f5f5',
              }}>
                <span style={{ width: 64, flexShrink: 0, fontSize: 13, fontWeight: 700 }}>{t ? fmtClock12(t) : '—'}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: 'var(--teal)', overflowWrap: 'anywhere' }}>
                    WO#{j.number}{j.siteName ? ` · ${j.siteName}` : ''}
                  </span>
                  {place(j) && <span style={{ display: 'block', fontSize: 12, color: '#888' }}>{place(j)}</span>}
                </span>
                {j.techs.length > 0
                  ? <span style={{ fontSize: 12, color: '#555', textAlign: 'right', maxWidth: '40%', overflowWrap: 'anywhere' }}>{j.techs.join(', ')}</span>
                  : <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: 'rgba(245,158,11,0.15)', color: '#b45309', flexShrink: 0 }}>No tech yet</span>}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
