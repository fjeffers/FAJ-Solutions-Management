import { describe, expect, it } from 'vitest';
import { TODAY_KEY, boardColumns, columnOf, holdKey, moveTo, type BoardColumn } from './dispatch-columns';
import type { WfStatus } from './wf';

const STAGES: WfStatus[] = ['open', 'offered', 'scheduled', 'inProgress', 'workDone', 'closed', 'declined'];
const stages = STAGES.map((key) => ({ key, label: key, color: '#000' }));
const holds = [{ key: 'Revisit needed', label: 'Revisit needed' }, { key: 'On hold', label: 'On hold' }];
const cols = boardColumns(stages, holds);
const col = (key: string) => cols.find((c) => c.key === key) as BoardColumn;
const keys = new Set(holds.map((h) => h.key));
const TODAY = '2026-10-06';
type J = Parameters<typeof moveTo>[0];
const job = (over: Partial<J> = {}): J => ({ number: '101', status: 'scheduled', date: '2026-10-09', techs: ['Ann'], officeStatus: 'Assigned', hold: null, ...over });

describe('Dispatch board columns', () => {
  it('Today sits after Scheduled; Fred\'s own columns sit before Closed', () => {
    expect(cols.map((c) => c.key)).toEqual(['open', 'offered', 'scheduled', TODAY_KEY, 'inProgress', 'workDone', holdKey('Revisit needed'), holdKey('On hold'), 'closed', 'declined']);
  });

  it('a job sits in its hold column, Today, or its stage', () => {
    expect(columnOf(job(), TODAY, keys)).toBe('scheduled');
    expect(columnOf(job({ date: TODAY }), TODAY, keys)).toBe(TODAY_KEY);
    expect(columnOf(job({ date: TODAY, status: 'offered' }), TODAY, keys)).toBe(TODAY_KEY);
    expect(columnOf(job({ date: TODAY, status: 'inProgress' }), TODAY, keys)).toBe('inProgress'); // started: stays In progress
    expect(columnOf(job({ hold: 'On hold', date: TODAY }), TODAY, keys)).toBe(holdKey('On hold'));
    expect(columnOf(job({ hold: 'Removed column' }), TODAY, keys)).toBe('scheduled'); // Fred removed that column
    expect(columnOf(job({ hold: 'On hold', status: 'closed' }), TODAY, keys)).toBe('closed'); // closed beats a hold
  });

  it('into one of Fred\'s columns: only the board column changes', () => {
    expect(moveTo(job(), col(holdKey('On hold')), TODAY, keys)).toEqual({ kind: 'patch', patch: { board_stage: 'On hold' }, note: 'WO 101 moved to On hold.' });
    expect(moveTo(job({ hold: 'On hold' }), col(holdKey('On hold')), TODAY, keys)).toEqual({ kind: 'none' });
  });

  it('into In progress or Work done sets the office stage, and needs a tech', () => {
    expect(moveTo(job({ hold: 'On hold' }), col('inProgress'), TODAY, keys)).toMatchObject({ kind: 'patch', patch: { board_stage: null, wo_status: 'In Progress' } });
    expect(moveTo(job(), col('workDone'), TODAY, keys)).toMatchObject({ kind: 'patch', patch: { wo_status: 'Work Done' } });
    expect(moveTo(job({ techs: [], status: 'open' }), col('inProgress'), TODAY, keys).kind).toBe('blocked');
  });

  it('back to an earlier stage takes it off hold and un-starts it', () => {
    const started = job({ status: 'inProgress', officeStatus: 'In Progress' });
    expect(moveTo(started, col('scheduled'), TODAY, keys)).toMatchObject({ kind: 'patch', patch: { board_stage: null, wo_status: 'Assigned' } });
    expect(moveTo(job({ hold: 'On hold' }), col('scheduled'), TODAY, keys)).toMatchObject({ kind: 'patch', patch: { board_stage: null } });
    expect(moveTo(job({ hold: 'On hold' }), col('scheduled'), TODAY, keys)).not.toHaveProperty('patch.wo_status');
    // Who's on the job decides between Needs a tech / Awaiting / Scheduled — the note says so.
    const m = moveTo(job({ hold: 'On hold' }), col('open'), TODAY, keys);
    expect(m.kind === 'patch' && m.note).toMatch(/who's on it decides/);
  });

  it('Today only takes jobs dated today; Closed opens the Close window; closed jobs stay put', () => {
    expect(moveTo(job(), col(TODAY_KEY), TODAY, keys).kind).toBe('blocked');
    expect(moveTo(job({ date: TODAY, hold: 'On hold' }), col(TODAY_KEY), TODAY, keys)).toMatchObject({ kind: 'patch', patch: { board_stage: null } });
    expect(moveTo(job({ status: 'workDone', officeStatus: 'Work Done' }), col('closed'), TODAY, keys)).toEqual({ kind: 'close' });
    expect(moveTo(job({ status: 'closed' }), col('scheduled'), TODAY, keys).kind).toBe('blocked');
    expect(moveTo(job(), col('declined'), TODAY, keys).kind).toBe('blocked');
  });
});
