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

import { sortBoardRows, rowsForStage, type BoardRow } from '../components/wf/PrimioScreens';

const row = (number: string, date: string | null, status: string, price: number, client = 'X'): BoardRow =>
  ({ job: { number, date, status, clientPrice: price, client } } as unknown as BoardRow);

describe('Dispatch Grid and List', () => {
  const rows = [row('10', '2026-10-09', 'scheduled', 300, 'B'), row('2', null, 'open', 0, 'A'), row('7', '2026-10-05', 'closed', 900, 'C'), row('3', '2026-10-05', 'workDone', 150, 'A')];
  it('dates soonest first, no date last in both directions', () => {
    expect(sortBoardRows(rows, 'date', 'asc').map((r) => r.job.number)).toEqual(['3', '7', '10', '2']);
    expect(sortBoardRows(rows, 'date', 'desc').map((r) => r.job.number)).toEqual(['10', '3', '7', '2']);
  });
  it('sorts by WO number as numbers, price and client', () => {
    expect(sortBoardRows(rows, 'number', 'asc').map((r) => r.job.number)).toEqual(['2', '3', '7', '10']);
    expect(sortBoardRows(rows, 'price', 'desc')[0].job.number).toBe('7');
    expect(sortBoardRows(rows, 'client', 'asc').map((r) => r.job.client)).toEqual(['A', 'A', 'B', 'C']);
  });
  it('"All jobs" leaves out closed; a stage shows only that stage', () => {
    expect(rowsForStage(rows, 'all').map((r) => r.job.number).sort()).toEqual(['10', '2', '3']);
    expect(rowsForStage(rows, 'closed').map((r) => r.job.number)).toEqual(['7']);
  });
});
