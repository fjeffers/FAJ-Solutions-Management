'use client';
// The Work orders week calendar (Fred, 2026-10-18: "the view sucks" ... "week
// calendar card like view"). Sunday to Saturday with each job as a clean card on
// its day, the tech app's look; a job over several days shows on each one.
// Jobs with no date wait above the calendar. Tap a card to open the job.
// The dates and the grouping are lib/week-view.ts.
import { useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Clock, MapPin, UserX, Users } from 'lucide-react';
import { WF_STATUS_COLOR, parseClockTime, fmtClock12, type WfJob } from '@/lib/wf';
import { todayISO } from '@/lib/utils';
import { dayOfJob, periodDays, periodJobs, periodLabel, periodStart, shiftPeriod, spanOf, undated, weekJobs, weekStartOf, type Span } from '@/lib/week-view';
import { StatusChip } from './WfUi';
import Timeline from './Timeline';

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

const shortDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const NOUN: Record<Span, string> = { day: 'today', week: 'this week', month: 'this month' };
const TODAY_BTN: Record<Span, string> = { day: 'Today', week: 'This week', month: 'This month' };

/** One row per job: its day (or days), then what and where (List on Home). */
function PeriodList({ rows, onOpen }: { rows: Row[]; onOpen: (job: WfJob) => void }) {
  const cell = { padding: '10px 12px', borderBottom: '1px solid var(--wf-line)', fontSize: 13.5, textAlign: 'left' as const, verticalAlign: 'top' as const };
  return (
    <div className="wf-card" style={{ padding: 0, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
        <thead><tr>{['Date', 'WO #', 'Job', 'Where', 'Tech', 'Stage'].map((h) => <th key={h} className="wf-subtle" style={{ ...cell, fontSize: 12, fontWeight: 700 }}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map(({ job }) => {
            const s = spanOf(job);
            const t = parseClockTime(job.startTime);
            return (
              <tr key={job.id} onClick={() => onOpen(job)} style={{ cursor: 'pointer', opacity: job.status === 'closed' ? 0.6 : 1 }}>
                <td style={{ ...cell, whiteSpace: 'nowrap' }}>{s ? (s.end !== s.start ? `${shortDay(s.start)} – ${shortDay(s.end)}` : shortDay(s.start)) : 'No date'}{t && <div className="wf-subtle" style={{ fontSize: 12 }}>{fmtClock12(t)}</div>}</td>
                <td style={{ ...cell, fontWeight: 700, whiteSpace: 'nowrap' }}>{job.highPriority && <AlertTriangle size={12} color="var(--wf-danger)" style={{ verticalAlign: '-2px', marginRight: 3 }} aria-label="High priority" />}{job.number}</td>
                <td style={cell}>{job.title}</td>
                <td style={cell}>{[job.city, job.state].filter(Boolean).join(', ') || '—'}</td>
                <td style={cell}>{job.techs.length ? job.techs.join(', ') : <b style={{ color: 'var(--wf-danger)' }}>No tech</b>}</td>
                <td style={cell}><StatusChip status={job.status} ownerView /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Home's calendar: a Day, a Week or a Month, as cards or a list (Fred, 2026-10-31:
 * "i need to see the view by week, day, month cards and list").
 */
export default function WeekCalendar({ rows, onOpen, span = 'week', layout = 'cards', sheet }: {
  rows: Row[]; onOpen: (job: WfJob) => void; span?: Span; layout?: 'cards' | 'list' | 'sheet' | 'timeline';
  /** The Sheet for these jobs (components/wf/JobSheet.tsx), when the office has it. */
  sheet?: (jobs: WfJob[]) => ReactNode;
}) {
  const today = todayISO();
  const [anchor, setAnchor] = useState(today);
  const start = periodStart(span, anchor);
  // Cancelled and declined jobs stay off the calendar; closed ones show dimmed.
  const live = useMemo(() => rows.filter((r) => r.job.status !== 'declined'), [rows]);
  const inPeriod = useMemo(() => periodJobs(live, span, start), [live, span, start]);
  const days = useMemo(() => periodDays(span, start).map((day) => ({ day, rows: weekJobs(inPeriod, weekStartOf(day)).find((d) => d.day === day)?.rows ?? [] })), [inPeriod, span, start]);
  const noDate = useMemo(() => undated(live).filter((r) => r.job.status !== 'closed'), [live]);
  const isNow = start === periodStart(span, today);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="wf-btn wf-btn-outline wf-btn-sm" onClick={() => setAnchor(shiftPeriod(span, start, -1))} aria-label={`${span} before`}><ChevronLeft size={16} /></button>
        <div style={{ fontWeight: 700, fontSize: 16, minWidth: 170, textAlign: 'center' }}>{periodLabel(span, start)}</div>
        <button type="button" className="wf-btn wf-btn-outline wf-btn-sm" onClick={() => setAnchor(shiftPeriod(span, start, 1))} aria-label={`${span} after`}><ChevronRight size={16} /></button>
        {!isNow && <button type="button" className="wf-btn wf-btn-ghost wf-btn-sm" onClick={() => setAnchor(today)}>{TODAY_BTN[span]}</button>}
        <span className="wf-subtle" style={{ marginLeft: 'auto', fontSize: 13 }}>{inPeriod.length} job{inPeriod.length === 1 ? '' : 's'} {isNow ? NOUN[span] : ''}</span>
      </div>

      {noDate.length > 0 && layout !== 'sheet' && (
        <section className="wf-card" style={{ padding: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 8 }}>No date yet ({noDate.length})</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 220px), 1fr))', gap: 8 }}>
            {noDate.map((r) => <WeekCard key={r.job.id} job={r.job} day={null} onOpen={() => onOpen(r.job)} />)}
          </div>
        </section>
      )}

      {layout === 'sheet' && sheet ? sheet([...noDate, ...inPeriod].map((r) => r.job))
      : layout === 'timeline' ? (
        inPeriod.length === 0
          ? <div className="wf-card wf-subtle" style={{ padding: 16, textAlign: 'center' }}>No jobs {isNow ? NOUN[span] : 'in this ' + span}</div>
          : <Timeline rows={inPeriod} days={periodDays(span, start)} today={today} onOpen={onOpen} />
      ) : layout === 'list' ? (
        inPeriod.length === 0
          ? <div className="wf-card wf-subtle" style={{ padding: 16, textAlign: 'center' }}>No jobs {isNow ? NOUN[span] : 'in this ' + span}</div>
          : <PeriodList rows={inPeriod} onOpen={onOpen} />
      ) : (
        // Week: Sunday to Saturday side by side. Day and Month: one day under another (a month only shows its days with jobs).
        <div className={span === 'week' ? 'wf-week' : 'wf-week wf-period'}>
          {days.filter((d) => span !== 'month' || d.rows.length > 0).map((d) => (
            <section key={d.day} className={`wf-week-day${d.day === today ? ' is-today' : ''}${d.rows.length === 0 ? ' is-empty' : ''}`} aria-label={d.day}>
              <div className="wf-week-head">
                <span>{DOW[new Date(`${d.day}T12:00:00Z`).getUTCDay()]}</span>
                <b>{span === 'week' ? dayNum(d.day) : shortDay(d.day).replace(/^\w+, /, '')}</b>
                {d.day === today && <span className="wf-week-today">Today</span>}
              </div>
              <div className="wf-week-list">
                {d.rows.length === 0
                  ? <div className="wf-subtle" style={{ fontSize: 12, textAlign: 'center', padding: '10px 0' }}>No jobs</div>
                  : d.rows.map((r) => <WeekCard key={r.job.id} job={r.job} day={d.day} onOpen={() => onOpen(r.job)} />)}
              </div>
            </section>
          ))}
          {span === 'month' && inPeriod.length === 0 && <div className="wf-card wf-subtle" style={{ padding: 16, textAlign: 'center' }}>No jobs this month</div>}
        </div>
      )}
    </div>
  );
}
