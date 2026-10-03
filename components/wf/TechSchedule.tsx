'use client';
// My schedule in the tech portal (Fred, 2026-10-02: "add my schedule to the
// tech portal"). The tech's week, day by day — their jobs with times, the crew
// sites booked for the week, jobs still waiting on a date — and a calendar
// file so the jobs land in the phone's own calendar. Week logic and the file
// are in lib/schedule.ts (tested). A tech's job carries no money.
import { useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Download, Users } from 'lucide-react';
import { addDaysISO, todayISO } from '@/lib/utils';
import { fmtClock12, parseClockTime, place, type WfJob } from '@/lib/wf';
import { crewThisWeek, mondayOf, scheduleIcs, scheduleWeek, undatedJobs, type CrewWeek } from '@/lib/schedule';
import { toastInfo, toastSuccess } from '@/lib/toast';
import { Section, StatusChip } from './WfUi';

const dayLabel = (d: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });

/** The tech's week, day by day: their jobs with times, crew-site weeks, and a calendar file for the phone. */
export default function TechSchedule({ jobs, crewWeeks, onOpen, onOpenCrew }: {
  jobs: WfJob[]; crewWeeks: CrewWeek[]; onOpen: (id: string) => void; onOpenCrew: (id: string) => void;
}) {
  const today = todayISO();
  const thisMonday = mondayOf(today);
  const [monday, setMonday] = useState(thisMonday);
  const days = scheduleWeek(jobs, monday);
  const weekCrew = crewThisWeek(crewWeeks, monday);
  const undated = undatedJobs(jobs);
  const count = days.reduce((n, d) => n + d.jobs.length, 0);
  const sunday = addDaysISO(monday, 6);
  const range = `${dayLabel(monday, { month: 'short', day: 'numeric' })} – ${dayLabel(sunday, { month: monday.slice(5, 7) === sunday.slice(5, 7) ? undefined : 'short', day: 'numeric' })}`;
  const weekName = monday === thisMonday ? 'This week' : monday === addDaysISO(thisMonday, 7) ? 'Next week' : monday === addDaysISO(thisMonday, -7) ? 'Last week' : '';

  const saveCalendar = () => {
    const ics = scheduleIcs(jobs, crewWeeks, today);
    if (!ics.includes('BEGIN:VEVENT')) { toastInfo('Nothing coming up to add yet.'); return; }
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'faj-jobs.ics';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    toastSuccess('Calendar file saved. Open it and your phone adds your jobs.');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="wf-card" style={{ padding: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
        <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={() => setMonday(addDaysISO(monday, -7))} aria-label="Week before"><ChevronLeft size={20} /></button>
        <div style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
          <div className="wf-label">{weekName || 'Week of'}</div>
          <div className="wf-title" style={{ fontSize: 17 }}>{range}</div>
          <div className="wf-subtle" style={{ fontSize: 12.5 }}>
            {count ? `${count} job${count === 1 ? '' : 's'}` : 'No jobs'}
            {weekCrew.length ? ` · ${weekCrew.length} crew site${weekCrew.length === 1 ? '' : 's'}` : ''}
          </div>
        </div>
        <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={() => setMonday(addDaysISO(monday, 7))} aria-label="Week after"><ChevronRight size={20} /></button>
      </div>
      {monday !== thisMonday && (
        <button className="wf-btn wf-btn-outline wf-btn-sm" style={{ alignSelf: 'center' }} onClick={() => setMonday(thisMonday)}>Back to this week</button>
      )}

      {weekCrew.length > 0 && (
        <Section title="All week" subtitle="Crew sites booked for this week">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {weekCrew.map((s) => (
              <button key={s.id} onClick={() => onOpenCrew(s.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', background: 'rgba(14,27,46,0.04)', border: '1px solid var(--wf-line)', borderLeft: '4px solid var(--wf-navy)', borderRadius: 10, padding: '9px 12px', cursor: 'pointer', font: 'inherit', color: 'inherit' }}>
                <Users size={16} color="var(--wf-navy)" style={{ flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 600 }}>{s.name}</span>
                  <span className="wf-subtle" style={{ display: 'block', fontSize: 12.5 }}>{[s.where, s.project].filter(Boolean).join(' · ')}</span>
                </span>
                <ChevronRight size={16} color="var(--wf-subtle)" />
              </button>
            ))}
          </div>
        </Section>
      )}

      <div className="wf-card" style={{ padding: 0, overflow: 'hidden' }}>
        {days.map((d, i) => {
          const isToday = d.date === today;
          const past = d.date < today;
          return (
            <div key={d.date} style={{ borderTop: i ? '1px solid var(--wf-line)' : 'none', background: isToday ? 'rgba(201,162,75,0.08)' : undefined }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px 4px', opacity: past ? 0.6 : 1 }}>
                <span className="wf-display" style={{ fontWeight: 700, fontSize: 14 }}>{dayLabel(d.date, { weekday: 'long' })}</span>
                <span className="wf-subtle" style={{ fontSize: 13 }}>{dayLabel(d.date, { month: 'short', day: 'numeric' })}</span>
                {isToday && <span className="wf-chip" style={{ color: 'var(--wf-gold-dark)', background: 'rgba(201,162,75,0.2)' }}>Today</span>}
              </div>
              {d.jobs.length === 0 ? (
                <div className="wf-subtle" style={{ fontSize: 12.5, padding: '0 14px 10px', opacity: past ? 0.6 : 1 }}>Nothing booked</div>
              ) : (
                <div style={{ paddingBottom: 4, opacity: past ? 0.75 : 1 }}>
                  {d.jobs.map((j) => <ScheduleRow key={j.id} job={j} onOpen={() => onOpen(j.id)} />)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {undated.length > 0 && (
        <Section title="No date yet" subtitle="Yours, waiting on a date from the office">
          <div style={{ margin: '0 -14px' }}>
            {undated.map((j) => <ScheduleRow key={j.id} job={j} onOpen={() => onOpen(j.id)} />)}
          </div>
        </Section>
      )}

      <div className="wf-card" style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <CalendarDays size={22} color="var(--wf-gold)" style={{ flexShrink: 0 }} />
        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>Put your jobs on your phone calendar</div>
          <div className="wf-subtle" style={{ fontSize: 12.5 }}>Saves your upcoming jobs as a calendar file. Open it to add them. Do it again when the office changes a date.</div>
        </div>
        <button className="wf-btn wf-btn-navy wf-btn-sm" onClick={saveCalendar}><Download size={15} /> Add to calendar</button>
      </div>
    </div>
  );
}

function ScheduleRow({ job, onOpen }: { job: WfJob; onOpen: () => void }) {
  const start = parseClockTime(job.startTime ?? '');
  const end = parseClockTime(job.endTime ?? '');
  const where = [place(job), job.siteName].filter(Boolean).join(' · ');
  return (
    <button onClick={onOpen}
      style={{ display: 'flex', alignItems: 'flex-start', gap: 12, width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '8px 14px', cursor: 'pointer', font: 'inherit', color: 'inherit' }}>
      <span style={{ width: 70, flexShrink: 0 }}>
        <span className="wf-display" style={{ display: 'block', fontWeight: 700, fontSize: 13.5 }}>{start ? fmtClock12(start) : 'Any time'}</span>
        {start && end && <span className="wf-subtle" style={{ display: 'block', fontSize: 11.5 }}>to {fmtClock12(end)}</span>}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', fontWeight: 600, fontSize: 14.5, lineHeight: 1.3 }}>{job.title}</span>
        <span className="wf-subtle" style={{ display: 'block', fontSize: 12.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          WO {job.number}{where ? ` · ${where}` : ''}
        </span>
        {/* Scheduled is the normal state; only say so when it is something else. */}
        {job.status !== 'scheduled' && <span style={{ display: 'inline-block', marginTop: 4 }}><StatusChip status={job.status} /></span>}
      </span>
      <ChevronRight size={16} color="var(--wf-subtle)" style={{ flexShrink: 0, marginTop: 2 }} />
    </button>
  );
}
