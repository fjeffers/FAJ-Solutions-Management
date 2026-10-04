import { describe, expect, it } from 'vitest';
import { calendarDays } from '../components/wf/PrimioScreens';

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('Primio schedule calendar', () => {
  it('a month page is whole weeks, Sunday first, covering the month', () => {
    const days = calendarDays(new Date(2026, 9, 4), 'month'); // October 2026 starts on a Thursday
    expect(days.length % 7).toBe(0);
    expect(days[0].getDay()).toBe(0);
    expect(ymd(days[0])).toBe('2026-09-27');
    expect(days.some((d) => ymd(d) === '2026-10-31')).toBe(true);
    expect(days.length).toBe(35);
  });
  it('a week page is the seven days around the date', () => {
    const days = calendarDays(new Date(2026, 9, 7), 'week');
    expect(days.map(ymd)).toEqual(['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10']);
  });
});

import { boardGroups, type BoardRow } from '../components/wf/PrimioScreens';

const row = (number: string, date: string | null, status: string, updatedAt = ''): BoardRow =>
  ({ job: { number, date, status }, updatedAt } as unknown as BoardRow);

describe('Dispatch Board, Grid and List draw the same groups', () => {
  const rows = [
    row('10', '2026-10-09', 'scheduled'), row('2', null, 'open'), row('7', '2026-10-05', 'closed', '2026-10-01'),
    row('8', '2026-09-01', 'closed', '2026-10-03'), row('3', '2026-10-05', 'scheduled'), row('4', '2026-10-05', 'scheduled'),
  ];
  const g = boardGroups(rows);
  it('every Board stage, in the Board order, even when empty', () => {
    expect(g.map((x) => x.key)).toEqual(['open', 'offered', 'scheduled', 'inProgress', 'workDone', 'closed', 'declined']);
    expect(g.find((x) => x.key === 'offered')!.list).toEqual([]);
  });
  it('soonest first (ties by WO number); Closed newest first', () => {
    expect(g.find((x) => x.key === 'scheduled')!.list.map((r) => r.job.number)).toEqual(['3', '4', '10']);
    expect(g.find((x) => x.key === 'closed')!.list.map((r) => r.job.number)).toEqual(['8', '7']);
  });
  it('no job is lost or doubled', () => {
    expect(g.reduce((n, x) => n + x.list.length, 0)).toBe(rows.length);
  });
});
