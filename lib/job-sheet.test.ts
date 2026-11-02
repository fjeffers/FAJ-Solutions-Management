import { describe, expect, it } from 'vitest';
import { assignPatch, datePatch, describeChanges, groupSheet, jobsBefore, sheetTotals, techsOf, type SheetWo } from './job-sheet';

const wo = (o: Partial<SheetWo>): SheetWo => ({
  id: o.wo_number ?? 'x', wo_number: 'x', wo_status: 'Open', customer_name: null, contractor_name: '', contractor_names: [],
  start_date: null, total_amount: 0, contractor_pay: null, billable_miles: null, ...o,
} as SheetWo);

describe('Sheet', () => {
  it('reads the techs on a job', () => {
    expect(techsOf({ contractor_name: 'A', contractor_names: ['A', 'B'] })).toEqual(['A', 'B']);
    expect(techsOf({ contractor_name: 'A', contractor_names: [] })).toEqual(['A']);
    expect(techsOf({ contractor_name: '', contractor_names: null })).toEqual([]);
  });

  it('adds up client pay, tech pay and miles', () => {
    const t = sheetTotals([wo({ total_amount: 100, contractor_pay: { A: 40, B: 10 }, billable_miles: 12 }), wo({ total_amount: 50 })]);
    expect(t).toEqual({ jobs: 2, clientPays: 150, techPay: 50, miles: 12 });
  });

  it('groups by status in the office order, by client, by tech and by week', () => {
    const rows = [
      wo({ wo_number: '1', wo_status: 'Work Done', customer_name: 'LDS', contractor_names: ['Dwayne', 'Kendel'], start_date: '2026-11-02' }),
      wo({ wo_number: '2', wo_status: 'Open', customer_name: '', start_date: '2026-11-04' }),
      wo({ wo_number: '3', wo_status: 'Assigned', customer_name: 'Dunkin', contractor_name: 'Kendel', start_date: null }),
    ];
    expect(groupSheet(rows, 'stage').map((g) => g.label)).toEqual(['Open', 'Assigned', 'Work Done']);
    expect(groupSheet(rows, 'client').map((g) => g.label)).toEqual(['Dunkin', 'LDS', 'No client']);
    const tech = groupSheet(rows, 'tech');
    expect(tech.map((g) => [g.label, g.rows.length])).toEqual([['Dwayne', 1], ['Kendel', 2], ['No tech', 1]]);
    const week = groupSheet(rows, 'week');
    expect(week.map((g) => g.rows.length)).toEqual([2, 1]);
    expect(week[1].label).toBe('No date');
    expect(groupSheet(rows, 'none')[0].totals.jobs).toBe(3);
  });

  it('assigning a tech to an Open job makes it Assigned', () => {
    expect(assignPatch({ wo_status: 'Open' }, ['Dwayne'])).toEqual({ contractor_name: 'Dwayne', contractor_names: ['Dwayne'], lead_contractor_name: 'Dwayne', wo_status: 'Assigned' });
    expect(assignPatch({ wo_status: 'In Progress' }, ['Dwayne']).wo_status).toBeUndefined();
  });

  it('moving the start date keeps a multi-day job its length and moves the calendar', () => {
    expect(datePatch({ start_date: '2026-11-02', end_date: '2026-11-06' }, '2026-11-09')).toEqual({ start_date: '2026-11-09', scheduled_date: '2026-11-09', end_date: '2026-11-13' });
    expect(datePatch({ start_date: null, end_date: null }, '2026-11-09')).toEqual({ start_date: '2026-11-09', scheduled_date: '2026-11-09' });
    expect(datePatch({ start_date: '2026-11-02', end_date: null }, null)).toEqual({ start_date: null, scheduled_date: null });
  });

  it('writes the change lines for the Updates feed', () => {
    expect(describeChanges({ wo_status: 'Open', total_amount: 100, contractor_names: [] }, { wo_status: 'Assigned', total_amount: 250, contractor_names: ['Dwayne'], updated_at: 'x' }))
      .toEqual(['Status: Open → Assigned', 'Client pays: $100.00 → $250.00', 'Techs: — → Dwayne']);
    expect(describeChanges({ wo_status: 'Open' }, { wo_status: 'Open' })).toEqual([]);
  });

  it('Close old jobs: open jobs dated before the day, by start, calendar day or when made', () => {
    const rows = [
      { id: 'a', start_date: '2026-09-30', scheduled_date: null, created_at: '2026-09-01T00:00:00Z', archived_at: null },
      { id: 'b', start_date: '2026-10-01', scheduled_date: null, created_at: '2026-09-01T00:00:00Z', archived_at: null },
      { id: 'c', start_date: null, scheduled_date: '2026-09-15', created_at: '2026-10-05T00:00:00Z', archived_at: null },
      { id: 'd', start_date: null, scheduled_date: null, created_at: '2026-08-20T00:00:00Z', archived_at: null },
      { id: 'e', start_date: '2026-09-01', scheduled_date: null, created_at: '2026-09-01T00:00:00Z', archived_at: '2026-09-02T00:00:00Z' },
    ];
    expect(jobsBefore(rows, '2026-10-01').map((w) => w.id)).toEqual(['a', 'c', 'd']);
  });
});
