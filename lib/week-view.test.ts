import { describe, it, expect } from 'vitest';
import { addDays, dayOfJob, spanOf, undated, weekDays, weekJobs, weekLabel, weekStartOf } from './week-view';

const row = (number: string, date: string | null, endDate: string | null = null, startTime = '') => ({ job: { number, date, endDate, startTime } });

describe('the Work orders week calendar (Fred, 2026-10-18)', () => {
  it('starts each week on Sunday, so a Sunday evening shows the week ahead', () => {
    expect(weekStartOf('2026-10-18')).toBe('2026-10-18'); // a Sunday
    expect(weekStartOf('2026-10-21')).toBe('2026-10-18');
    expect(weekStartOf('2026-10-24')).toBe('2026-10-18'); // Saturday ends it
    expect(weekDays('2026-10-25')).toEqual(['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31']);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('shows a job on each of its days, Gaffney Oct 19 to 24 as Day 1 to Day 6', () => {
    const gaffney = { date: '2026-10-19', endDate: '2026-10-24' };
    expect(dayOfJob(gaffney, '2026-10-19')).toEqual({ n: 1, of: 6 });
    expect(dayOfJob(gaffney, '2026-10-22')).toEqual({ n: 4, of: 6 });
    expect(dayOfJob(gaffney, '2026-10-25')).toBeNull();
    expect(dayOfJob({ date: '2026-10-19' }, '2026-10-19')).toEqual({ n: 1, of: 1 });
  });

  it('treats a last day before the start, or months away, as a one-day job', () => {
    expect(spanOf({ date: '2026-10-19', endDate: '2026-10-01' })).toEqual({ start: '2026-10-19', end: '2026-10-19' });
    expect(spanOf({ date: '2026-10-19', endDate: '2027-06-01' })).toEqual({ start: '2026-10-19', end: '2026-10-19' });
    expect(spanOf({ date: null })).toBeNull();
  });

  it('puts each day in time order, and keeps the undated ones apart', () => {
    const rows = [row('3', '2026-10-20', null, '13:00'), row('1', '2026-10-19', '2026-10-24', '08:00'), row('2', '2026-10-20', null, '7:30'), row('4', null)];
    const week = weekJobs(rows, '2026-10-18');
    expect(week.map((d) => d.rows.map((r) => r.job.number))).toEqual([[], ['1'], ['2', '1', '3'], ['1'], ['1'], ['1'], ['1']]);
    expect(undated(rows).map((r) => r.job.number)).toEqual(['4']);
  });

  it('names the week', () => {
    expect(weekLabel('2026-10-18')).toBe('Oct 18 – 24, 2026');
    expect(weekLabel('2026-11-29')).toBe('Nov 29 – Dec 5, 2026');
  });
});
