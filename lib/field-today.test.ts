import { describe, it, expect } from 'vitest';
import { addDays, comingUp, fieldItems, type LateRow } from './field-today';
import { wfJobFromOwner } from './wf';

const today = '2026-10-19';
const now = Date.parse('2026-10-19T14:00:00Z');
const job = (o: Record<string, unknown>) => wfJobFromOwner({
  wo_status: 'Assigned', contractor_names: ['Dana'], contractor_name: 'Dana', start_time: '08:00',
  assignment_responses: { Dana: { status: 'accepted' } }, ...o,
});
const jobs = [
  job({ id: 'a', wo_number: '101', site_name: 'Store 101', start_date: today, is_project: true, project_name: 'Refresh' }),
  job({ id: 'b', wo_number: '102', site_name: 'Store 102', start_date: today, is_project: true, project_name: 'Refresh' }),
  job({ id: 'c', wo_number: '103', start_date: addDays(today, 1), contractor_names: [], contractor_name: '', wo_status: 'Open', assignment_responses: {} }),
  job({ id: 'd', wo_number: '104', start_date: addDays(today, 5), contractor_names: [], contractor_name: '', wo_status: 'Open', assignment_responses: {} }),
  job({ id: 'e', wo_number: '105', start_date: addDays(today, 2), start_time: '07:30', assignment_responses: {},
    time_requests: { Dana: { date: addDays(today, 3), time: '9:00 AM', note: '', at: '2026-10-18T10:00:00Z', state: 'waiting' } } }),
  job({ id: 'f', wo_number: '106', start_date: today, archived_at: '2026-10-18T10:00:00Z' }),
  job({ id: 'g', wo_number: '107', start_date: addDays(today, 7) }),
];
const late = (o: Partial<LateRow>): LateRow => ({ id: 'l1', wo_id: 'a', tech: 'Dana', day: today, start_label: '8:00 AM', reason: null, eta_min: null, ...o });

describe('in the field', () => {
  it('puts stopped work and late techs first, then jobs with no tech, time asks and receipts', () => {
    const items = fieldItems({
      jobs, today, now,
      issues: [{ id: 'i1', work_order_id: '102', sender_name: 'Sam', reason: "Can't get in", content: 'Door locked', created_at: '2026-10-19T13:35:00Z' }],
      late: [late({ reason: 'Traffic', eta_min: 20 })],
      punchesIn: [],
      expenses: [{ amount: '42.50' }, { amount: 18 }],
    });
    expect(items.map((i) => [i.tone, i.title])).toEqual([
      ['red', 'Work stopped · WO 102 · Store 102'],
      ['red', 'Dana is late · WO 101 · Store 101'],
      ['amber', 'No tech yet · WO 103'],
      ['amber', 'Dana asks for another time · WO 105'],
      ['amber', '2 receipts to approve'],
    ]);
    expect(items[0].detail).toBe("Sam: Can't get in · 25 min ago");
    expect(items[1].detail).toBe('Started at 8:00 AM · Traffic, about 20 min');
    expect(items[2]).toMatchObject({ woId: 'c', detail: expect.stringMatching(/^Tomorrow/) });
    expect(items[4]).toMatchObject({ view: 'workorders', detail: '$61 from techs · approve or decline on Dispatch' });
  });

  it('keeps stopped work however old, until the job is finished', () => {
    const old = { id: 'i9', work_order_id: '101', sender_name: 'Sam', reason: 'No access', content: '', created_at: '2026-10-16T21:00:00Z' };
    const base = { today, now, late: [], punchesIn: [], expenses: [] };
    expect(fieldItems({ ...base, jobs, issues: [old] }).map((i) => i.title)).toContain('Work stopped · WO 101 · Store 101');
    const done = jobs.map((j) => (j.number === '101' ? { ...j, status: 'workDone' as const } : j));
    expect(fieldItems({ ...base, jobs: done, issues: [old] }).map((i) => i.title)).not.toContain('Work stopped · WO 101 · Store 101');
  });

  it('drops a late tech once they clock in here or on the same project', () => {
    const base = { jobs, today, now, issues: [], expenses: [] };
    expect(fieldItems({ ...base, late: [late({})], punchesIn: [] }).find((i) => i.key === 'late:l1')?.detail).toBe('Started at 8:00 AM · No answer yet');
    expect(fieldItems({ ...base, late: [late({})], punchesIn: [{ wo_id: 'b', contractor_name: 'Dana', at: '2026-10-19T12:50:00Z' }] })
      .some((i) => i.key.startsWith('late:'))).toBe(false);
    // Another tech's clock-in, or Dana's from yesterday, doesn't count.
    expect(fieldItems({ ...base, late: [late({})], punchesIn: [
      { wo_id: 'a', contractor_name: 'Sam', at: '2026-10-19T12:50:00Z' },
      { wo_id: 'a', contractor_name: 'Dana', at: '2026-10-18T12:50:00Z' },
    ] }).some((i) => i.key.startsWith('late:'))).toBe(true);
    // Yesterday's late row, and a closed job's, are history.
    expect(fieldItems({ ...base, late: [late({ day: addDays(today, -1) }), late({ id: 'l2', wo_id: 'f' })], punchesIn: [] })
      .some((i) => i.key.startsWith('late:'))).toBe(false);
  });

  it('says nothing when all is well', () => {
    expect(fieldItems({ jobs: jobs.filter((j) => j.techs.length && j.status !== 'offered'), today, now, late: [], issues: [], punchesIn: [], expenses: [] })).toEqual([]);
  });
});

describe('coming up', () => {
  it('lists jobs starting this week by day, earliest first, without closed jobs', () => {
    const days = comingUp(jobs, today);
    expect(days.map((d) => [d.date, d.jobs.map((j) => j.number)])).toEqual([
      [today, ['101', '102']],
      [addDays(today, 1), ['103']],
      [addDays(today, 2), ['105']],
      [addDays(today, 5), ['104']],
    ]);
  });
});
