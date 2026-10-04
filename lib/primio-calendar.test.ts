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
