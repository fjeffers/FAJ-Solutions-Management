'use client';
// The Work orders week calendar (Fred, 2026-10-18: "the view sucks" ... "week
// calendar card like view"). Sunday to Saturday with each job as a clean card on
// its day, the tech app's look; a job over several days shows on each one.
// Jobs with no date wait above the calendar. Tap a card to open the job.
// The dates and the grouping are lib/week-view.ts.
import { useMemo, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Clock, MapPin, UserX, Users } from 'lucide-react';
import { WF_STATUS_COLOR, parseClockTime, fmtClock12, type WfJob } from '@/lib/wf';
import { todayISO } from '@/lib/utils';
import { addDays, dayOfJob, undated, weekJobs, weekLabel, weekStartOf } from '@/lib/week-view';
import { StatusChip } from './WfUi';

type Row = { job: WfJob };

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayNum = (d: string) => Number(d.slice(8, 10));

function WeekCard({ job, day, onOpen }: { job: WfJob; day: string | null; onOpen: () => void }) {
  const accent = WF_STATUS_COLOR[job.status];
  const t = parseClockTime(job.startTime);
  const part = day ? dayOfJob(job, day) : null;
  const where = [job.city, job.state].filter(Boolean).join(', ');
  return (
    <button type="button" onClick={onOpen} className="wf-week-card" aria-label={`Open WO ${job.number}: ${job.title}`}
      style={{ borderLeft: `4px solid ${accent}`, opacity: job.status === 'closed' ? 0.6 : 1 }}>
      <span className="wf-subtle" style={{ fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {job.highPriority && <AlertTriangle size={12} color="var(--wf-danger)" style={{ verticalAlign: '-2px', marginRight: 3 }} aria-label="High priority" />}
        WO {job.number}
      </span>
      <span style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', fontWeight: 600, fontSize: 13.5, lineHeight: 1.3 }}>
        {job.title}
      </span>
      {where && (
        <span className="wf-subtle" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
          <MapPin size={12} style={{ flexShrink: 0 }} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{where}</span>
        </span>
      )}
      {(t || (part && part.of > 1)) && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
          <Clock size={12} color="var(--wf-gold)" style={{ flexShrink: 0 }} />
          {[t ? fmtClock12(t) : '', part && part.of > 1 ? `Day ${part.n} of ${part.of}` : ''].filter(Boolean).join(' · ')}
        </span>
      )}
      <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
        {job.techs.length === 0
          ? <><UserX size={12} color="var(--wf-danger)" style={{ flexShrink: 0 }} /><b style={{ color: 'var(--wf-danger)' }}>No tech</b></>
          : <><Users size={12} color="var(--wf-subtle)" style={{ flexShrink: 0 }} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{job.techs.join(', ')}</span></>}
      </span>
      <span style={{ display: 'flex', marginTop: 2 }}><StatusChip status={job.status} ownerView /></span>
    </button>
  );
}

export default function WeekCalendar({ rows, onOpen }: { rows: Row[]; onOpen: (job: WfJob) => void }) {
  const today = todayISO();
  const [start, setStart] = useState(() => weekStartOf(today));
  // Cancelled and declined jobs stay off the calendar; closed ones show dimmed.
  const live = useMemo(() => rows.filter((r) => r.job.status !== 'declined'), [rows]);
  const week = useMemo(() => weekJobs(live, start), [live, start]);
  const noDate = useMemo(() => undated(live).filter((r) => r.job.status !== 'closed'), [live]);
  const total = new Set(week.flatMap((d) => d.rows.map((r) => r.job.id))).size;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="wf-btn wf-btn-outline wf-btn-sm" onClick={() => setStart(addDays(start, -7))} aria-label="Week before"><ChevronLeft size={16} /></button>
        <div style={{ fontWeight: 700, fontSize: 16, minWidth: 170, textAlign: 'center' }}>{weekLabel(start)}</div>
        <button type="button" className="wf-btn wf-btn-outline wf-btn-sm" onClick={() => setStart(addDays(start, 7))} aria-label="Week after"><ChevronRight size={16} /></button>
        {start !== weekStartOf(today) && <button type="button" className="wf-btn wf-btn-ghost wf-btn-sm" onClick={() => setStart(weekStartOf(today))}>This week</button>}
        <span className="wf-subtle" style={{ marginLeft: 'auto', fontSize: 13 }}>{total} job{total === 1 ? '' : 's'} this week</span>
      </div>

      {noDate.length > 0 && (
        <section className="wf-card" style={{ padding: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 8 }}>No date yet ({noDate.length})</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 220px), 1fr))', gap: 8 }}>
            {noDate.map((r) => <WeekCard key={r.job.id} job={r.job} day={null} onOpen={() => onOpen(r.job)} />)}
          </div>
        </section>
      )}

      <div className="wf-week">
        {week.map((d, i) => (
          <section key={d.day} className={`wf-week-day${d.day === today ? ' is-today' : ''}${d.rows.length === 0 ? ' is-empty' : ''}`} aria-label={`${DOW[i]} ${d.day}`}>
            <div className="wf-week-head">
              <span>{DOW[i]}</span>
              <b>{dayNum(d.day)}</b>
              {d.day === today && <span className="wf-week-today">Today</span>}
            </div>
            <div className="wf-week-list">
              {d.rows.length === 0
                ? <div className="wf-subtle" style={{ fontSize: 12, textAlign: 'center', padding: '10px 0' }}>No jobs</div>
                : d.rows.map((r) => <WeekCard key={r.job.id} job={r.job} day={d.day} onOpen={() => onOpen(r.job)} />)}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
