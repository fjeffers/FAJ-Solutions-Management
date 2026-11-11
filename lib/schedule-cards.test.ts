import { describe, expect, it } from 'vitest';
import { plusDays, scheduleCardGroups } from './schedule-cards';

type J = { n: string; date?: string; open?: boolean };
const groups = (jobs: J[]) => scheduleCardGroups(jobs, '2026-11-09', (j) => j.date, (j) => j.open !== false)
  .map((g) => [g.label, g.items.map((j) => j.n)]);

describe('schedule card groups', () => {
  it('adds days across a month end', () => {
    expect(plusDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(plusDays('2026-12-31', 7)).toBe('2027-01-07');
  });

  it('puts each dated job in Today, Tomorrow, Next 7 days or Later', () => {
    expect(groups([
      { n: 'later', date: '2026-11-17' },
      { n: 'today', date: '2026-11-09' },
      { n: 'week', date: '2026-11-16' },
      { n: 'tomorrow', date: '2026-11-10' },
      { n: 'undated' },
    ])).toEqual([
      ['Today', ['today']],
      ['Tomorrow', ['tomorrow']],
      ['Next 7 days', ['week']],
      ['Later', ['later']],
    ]);
  });

  it('keeps past jobs only while they are still open', () => {
    expect(groups([
      { n: 'old-open', date: '2026-11-02' },
      { n: 'old-done', date: '2026-11-02', open: false },
    ])).toEqual([['Earlier, not done', ['old-open']]]);
  });
});
