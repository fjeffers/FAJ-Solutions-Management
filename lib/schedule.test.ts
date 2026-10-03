import { describe, expect, it } from 'vitest';
import { crewThisWeek, mondayOf, scheduleIcs, scheduleWeek, undatedJobs, weekDays } from './schedule';
import { wfJobFromTech, type WfJob } from './wf';

const job = (over: Record<string, unknown>): WfJob => wfJobFromTech({
  id: String(over.wo_number ?? 'x'), wo_number: '1', title: 'Network install', wo_status: 'Assigned', my_response: 'accepted',
  site_name: "Wendy's #123", site_address: '1 Main St', site_city: 'Easton', site_state: 'PA', ...over,
});

describe('the week', () => {
  it('starts on Monday whatever day you ask from', () => {
    expect(mondayOf('2026-10-02')).toBe('2026-09-28'); // a Friday
    expect(mondayOf('2026-10-05')).toBe('2026-10-05'); // a Monday
    expect(mondayOf('2026-10-11')).toBe('2026-10-05'); // a Sunday
    expect(weekDays('2026-10-05')).toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']);
  });

  it("puts each of the tech's jobs on its day, earliest first", () => {
    const days = scheduleWeek([
      job({ wo_number: 'B', scheduled_date: '2026-10-06', start_time: '1:00 PM' }),
      job({ wo_number: 'A', scheduled_date: '2026-10-06', start_time: '08:30' }),
      job({ wo_number: 'C', scheduled_date: '2026-10-06' }),
      job({ wo_number: 'D', scheduled_date: '2026-10-13' }), // next week
    ], '2026-10-05');
    expect(days).toHaveLength(7);
    expect(days[1].jobs.map((j) => j.number)).toEqual(['C', 'A', 'B']); // any time, 8:30, 1:00
    expect(days.flatMap((d) => d.jobs).map((j) => j.number)).not.toContain('D');
  });

  it("leaves out jobs that aren't theirs: declined, or open for anyone", () => {
    const days = scheduleWeek([
      job({ wo_number: 'X', scheduled_date: '2026-10-06', my_response: 'declined' }),
      { ...job({ wo_number: 'O', scheduled_date: '2026-10-06' }), status: 'open' as const },
      job({ wo_number: 'F', scheduled_date: '2026-10-06', my_response: '' }), // an offer still counts — it's on their plate
    ], '2026-10-05');
    expect(days[1].jobs.map((j) => j.number)).toEqual(['F']);
  });

  it('lists live jobs with no date, but not finished ones', () => {
    const list = undatedJobs([job({ wo_number: 'U' }), job({ wo_number: 'Z', wo_status: 'Paid' }), job({ wo_number: 'S', scheduled_date: '2026-10-06' })]);
    expect(list.map((j) => j.number)).toEqual(['U']);
  });

  it('finds the crew sites booked for the week', () => {
    const sites = [
      { id: '1', name: 'Rockingham', where: 'Rockingham, NC', project: 'LDS refresh', weekStart: '2026-10-26' },
      { id: '2', name: 'Pinehurst', where: 'Pinehurst, NC', project: 'LDS refresh', weekStart: '2026-11-02' },
    ];
    expect(crewThisWeek(sites, '2026-10-26').map((s) => s.name)).toEqual(['Rockingham']);
  });
});

describe('the calendar file', () => {
  const now = new Date('2026-10-02T23:00:00Z');
  const crew = [{ id: 's1', name: 'Rockingham', where: 'Rockingham, NC', project: 'LDS refresh', weekStart: '2026-10-26' }];

  it('timed jobs keep their clock time; untimed ones are all-day; crew weeks run Mon–Fri', () => {
    const ics = scheduleIcs([
      job({ wo_number: '19101370', scheduled_date: '2026-10-06', start_time: '8:00 AM', end_time: '12:30 PM' }),
      job({ wo_number: '19101371', scheduled_date: '2026-10-07' }),
    ], crew, '2026-10-02', now);
    expect(ics).toContain('DTSTART:20261006T080000');
    expect(ics).toContain('DTEND:20261006T123000');
    expect(ics).toContain('DTSTART;VALUE=DATE:20261007');
    expect(ics).toContain('DTEND;VALUE=DATE:20261008');
    expect(ics).toContain('DTSTART;VALUE=DATE:20261026');
    expect(ics).toContain('DTEND;VALUE=DATE:20261031');
    expect(ics).toContain('SUMMARY:WO 19101370 · Network install');
    expect(ics).toContain('LOCATION:1 Main St\\, Easton\\, PA');
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
  });

  it('a job with no end time gets two hours', () => {
    const ics = scheduleIcs([job({ wo_number: '1', scheduled_date: '2026-10-06', start_time: '22:30' })], [], '2026-10-01', now);
    expect(ics).toContain('DTEND:20261006T235900'); // capped at the end of the day
  });

  it('skips past jobs, closed jobs and jobs with no date', () => {
    const ics = scheduleIcs([
      job({ wo_number: 'PAST', scheduled_date: '2026-09-30' }),
      job({ wo_number: 'DONE', scheduled_date: '2026-10-06', wo_status: 'Paid' }),
      job({ wo_number: 'NODATE' }),
    ], [], '2026-10-02', now);
    expect(ics).not.toContain('BEGIN:VEVENT');
  });

  it('never carries money', () => {
    const ics = scheduleIcs([job({ wo_number: '1', scheduled_date: '2026-10-06', total_amount: 1138.25, contractor_pay: { Fred: 500 } })], [], '2026-10-01', now);
    expect(ics).not.toMatch(/1138|500|\$/);
  });

  it('folds long lines as calendars require', () => {
    const ics = scheduleIcs([job({ wo_number: '1', scheduled_date: '2026-10-06', title: 'A'.repeat(200) })], [], '2026-10-01', now);
    for (const line of ics.split('\r\n')) expect(line.length).toBeLessThanOrEqual(75);
  });
});
