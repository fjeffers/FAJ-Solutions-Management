import { describe, expect, it } from 'vitest';
import { dayStatus, groupLabel, groupOf, normalizeHoursLook, STANDARD_HOURS_LOOK } from './hours-look';

describe('normalizeHoursLook', () => {
  it('keeps good choices and drops anything else', () => {
    expect(normalizeHoursLook({ order: 'old', group: 'month', cards: 'short' })).toEqual({ order: 'old', group: 'month', cards: 'short' });
    expect(normalizeHoursLook({ cards: 'board' }).cards).toBe('board');
    expect(normalizeHoursLook({ order: 'sideways', group: 'year', cards: 3 })).toEqual(STANDARD_HOURS_LOOK);
    expect(normalizeHoursLook(null)).toEqual(STANDARD_HOURS_LOOK);
  });
});

describe('groupOf', () => {
  // Fred, 2026-10-29: "Need to add Sunday to Saturday" — the same weeks as the bill.
  it('puts a day in the week that starts on its Sunday', () => {
    expect(groupOf('2026-10-23', 'week')).toBe('2026-10-18'); // a Friday
    expect(groupOf('2026-10-18', 'week')).toBe('2026-10-18'); // the Sunday itself
    expect(groupOf('2026-10-24', 'week')).toBe('2026-10-18'); // Saturday ends the week
    expect(groupOf('2026-10-25', 'week')).toBe('2026-10-25'); // the next Sunday starts the next
    expect(groupOf('2026-11-02', 'week')).toBe('2026-11-01'); // across a month
  });
  it('puts a day in its month, or keeps it as itself', () => {
    expect(groupOf('2026-10-23', 'month')).toBe('2026-10');
    expect(groupOf('2026-10-23', 'day')).toBe('2026-10-23');
  });
});

describe('groupLabel', () => {
  it('names a week and a month', () => {
    expect(groupLabel('2026-10-25', 'week')).toBe('Week of Sun, Oct 25 – Sat, Oct 31');
    expect(groupLabel('2026-10', 'month')).toBe('October 2026');
  });
});

describe('dayStatus', () => {
  const day = (v: Partial<{ hours: number | null; arrived: string | null; leftSite: string | null }>, extra: Partial<Parameters<typeof dayStatus>[0]> = {}) =>
    dayStatus({ app: {}, edits: {}, source: {}, values: { hours: null, arrived: '08:00', leftSite: '16:00', ...v }, ...extra });
  it('reads a day the way the board labels it', () => {
    expect(day({})).toBe('app');
    expect(day({}, { edits: { meals: 50 } })).toBe('changed');
    expect(day({}, { source: { arrived: 'guess' } })).toBe('check');
    expect(day({}, { app: null })).toBe('typed');
    expect(day({ hours: 0, arrived: null, leftSite: null }, { edits: { hours: 0 } })).toBe('travel');
  });
});
