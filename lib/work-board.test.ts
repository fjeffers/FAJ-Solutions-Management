import { describe, it, expect } from 'vitest';
import { woColumn, crewColumn, taskProgress, boardCounts, mondayOfWeek, addDays, hasTech, BOARD_COLUMNS } from './work-board';
import { WO_STATUSES } from './types';

describe('which column a job sits in', () => {
  it('puts every work order status somewhere', () => {
    for (const s of WO_STATUSES) expect(BOARD_COLUMNS.map((c) => c.key)).toContain(woColumn(s));
    expect(woColumn(null, false)).toBe('open');
    expect(woColumn('Approved')).toBe('closed');
    expect(woColumn('Paid')).toBe('closed');
    expect(woColumn('Work Done')).toBe('done');
  });
  it('files a job by who is on it before the work starts (WO 19101293: Open, two techs)', () => {
    expect(woColumn('Open', true)).toBe('assigned');
    expect(woColumn('Open', false)).toBe('open');
    expect(woColumn('Assigned', false)).toBe('open');
    expect(woColumn('Assigned', true)).toBe('assigned');
    expect(hasTech({ contractor_names: ['Jere Jones', 'Mutema Desouza'], contractor_name: 'Jere Jones' })).toBe(true);
    expect(hasTech({ contractor_names: [], contractor_name: '' })).toBe(false);
    expect(hasTech({ contractor_names: [' '], contractor_name: null })).toBe(false);
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
        { wo_status: 'Open', scheduled_date: null, contractor_names: [], contractor_name: '' },
        { wo_status: 'Open', scheduled_date: null, contractor_names: ['Jere Jones'], contractor_name: 'Jere Jones', pay_set: false },
        { wo_status: 'Assigned', scheduled_date: '2026-10-28', contractor_names: ['Davis Sanders'], pay_set: true },
        { wo_status: 'Assigned', scheduled_date: '2026-11-05', contractor_names: ['Davis Sanders'], pay_set: true },
        { wo_status: 'Work Done', scheduled_date: '2026-10-20', contractor_names: ['Bryant Knight'], pay_set: false },
      ],
      [
        { status: 'scheduled', week_start: '2026-10-26' },
        { status: 'planned', week_start: '2026-11-02' },
      ],
      today,
    );
    expect(c).toEqual({ needsTech: 2, thisWeek: 2, readyToClose: 1, paySetMissing: 2 });
  });
  it('counts checklist progress', () => {
    expect(taskProgress([
      { id: '1', category: 'On Site', label: 'a', completed: true, completed_at: null },
      { id: '2', category: 'On Site', label: 'b', completed: false, completed_at: null },
    ])).toEqual({ done: 1, total: 2 });
    expect(taskProgress(null)).toEqual({ done: 0, total: 0 });
  });
});
