import { describe, it, expect } from 'vitest';
import { woColumn, crewColumn, taskProgress, boardCounts, mondayOfWeek, addDays, BOARD_COLUMNS } from './work-board';
import { WO_STATUSES } from './types';

describe('which column a job sits in', () => {
  it('puts every work order status somewhere, with no status reading as Open', () => {
    for (const s of WO_STATUSES) expect(BOARD_COLUMNS.map((c) => c.key)).toContain(woColumn(s));
    expect(woColumn(null)).toBe('open');
    expect(woColumn('Approved')).toBe('closed');
    expect(woColumn('Paid')).toBe('closed');
    expect(woColumn('Work Done')).toBe('done');
  });
  it('maps every crew site status', () => {
    expect(crewColumn('planned')).toBe('open');
    expect(crewColumn('scheduled')).toBe('assigned');
    expect(crewColumn('in_progress')).toBe('progress');
    expect(crewColumn('done')).toBe('done');
    expect(crewColumn('deliverables_in')).toBe('done');
    expect(crewColumn('audited')).toBe('closed');
  });
});

describe('dates', () => {
  it('finds Monday and adds days', () => {
    expect(mondayOfWeek('2026-10-02')).toBe('2026-09-28'); // Friday → Monday
    expect(mondayOfWeek('2026-10-04')).toBe('2026-09-28'); // Sunday belongs to the week before
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
  });
});

describe('the numbers across the top', () => {
  it('counts jobs needing a tech, this week, and ready to close', () => {
    const today = '2026-10-26'; // a Monday
    const c = boardCounts(
      [
        { wo_status: 'Open', scheduled_date: null },
        { wo_status: 'Assigned', scheduled_date: '2026-10-28' },
        { wo_status: 'Assigned', scheduled_date: '2026-11-05' },
        { wo_status: 'Work Done', scheduled_date: '2026-10-20' },
      ],
      [
        { status: 'scheduled', week_start: '2026-10-26' },
        { status: 'planned', week_start: '2026-11-02' },
      ],
      today,
    );
    expect(c).toEqual({ needsTech: 2, thisWeek: 2, readyToClose: 1 });
  });
  it('counts checklist progress', () => {
    expect(taskProgress([
      { id: '1', category: 'On Site', label: 'a', completed: true, completed_at: null },
      { id: '2', category: 'On Site', label: 'b', completed: false, completed_at: null },
    ])).toEqual({ done: 1, total: 2 });
    expect(taskProgress(null)).toEqual({ done: 0, total: 0 });
  });
});
