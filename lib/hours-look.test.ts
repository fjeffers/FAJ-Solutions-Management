import { describe, expect, it } from 'vitest';
import { groupLabel, groupOf, normalizeHoursLook, STANDARD_HOURS_LOOK } from './hours-look';

describe('normalizeHoursLook', () => {
  it('keeps good choices and drops anything else', () => {
    expect(normalizeHoursLook({ order: 'old', group: 'month', cards: 'short' })).toEqual({ order: 'old', group: 'month', cards: 'short' });
    expect(normalizeHoursLook({ order: 'sideways', group: 'year', cards: 3 })).toEqual(STANDARD_HOURS_LOOK);
    expect(normalizeHoursLook(null)).toEqual(STANDARD_HOURS_LOOK);
  });
});

describe('groupOf', () => {
  it('puts a day in the week that starts on its Monday', () => {
    expect(groupOf('2026-10-23', 'week')).toBe('2026-10-19'); // a Friday
    expect(groupOf('2026-10-19', 'week')).toBe('2026-10-19'); // the Monday itself
    expect(groupOf('2026-10-25', 'week')).toBe('2026-10-19'); // Sunday ends the week
    expect(groupOf('2026-11-01', 'week')).toBe('2026-10-26'); // across a month
  });
  it('puts a day in its month, or keeps it as itself', () => {
    expect(groupOf('2026-10-23', 'month')).toBe('2026-10');
    expect(groupOf('2026-10-23', 'day')).toBe('2026-10-23');
  });
});

describe('groupLabel', () => {
  it('names a week and a month', () => {
    expect(groupLabel('2026-10-19', 'week')).toBe('Week of Mon, Oct 19 – Sun, Oct 25');
    expect(groupLabel('2026-10', 'month')).toBe('October 2026');
  });
});
