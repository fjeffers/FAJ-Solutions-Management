import { describe, expect, it } from 'vitest';
import { dueCheckoutDone, dueReminders, noTechSoon, parseRules, waitingInvoice } from './automations';
import type { WorkOrder } from './types';

const wo = (o: Partial<WorkOrder>) => ({
  id: o.wo_number ?? 'x', wo_number: 'x', wo_status: 'Open', archived_at: null, checked_in_at: null, checked_out_at: null,
  start_date: null, contractor_name: '', contractor_names: [], updated_at: '2026-10-01T12:00:00Z', ...o,
} as WorkOrder);
const rules = parseRules(null);

describe('Automations', () => {
  it('starts with every rule on and its default days, and keeps saved choices', () => {
    expect(rules.map((r) => [r.id, r.on, r.days])).toEqual([['checkout_done', true, 0], ['remind_tech', true, 1], ['no_tech', true, 3], ['done_invoice', true, 2]]);
    const saved = parseRules([{ id: 'remind_tech', on: false, days: 2 }, { id: 'no_tech', days: 999 }]);
    expect(saved[1]).toEqual({ id: 'remind_tech', on: false, days: 2 });
    expect(saved[2].days).toBe(3);
  });

  it('moves a checked-out In Progress job to Work Done, not a held or re-checked-in one', () => {
    const rows = [
      wo({ wo_number: '1', wo_status: 'In Progress', checked_in_at: '2026-10-31T13:00:00Z', checked_out_at: '2026-10-31T20:00:00Z' }),
      wo({ wo_number: '2', wo_status: 'In Progress', checked_in_at: '2026-11-01T13:00:00Z', checked_out_at: '2026-10-31T20:00:00Z' }),
      wo({ wo_number: '3', wo_status: 'On Hold', checked_out_at: '2026-10-31T20:00:00Z' }),
      wo({ wo_number: '4', wo_status: 'In Progress' }),
    ];
    expect(dueCheckoutDone(rows, rules).map((w) => w.wo_number)).toEqual(['1']);
    expect(dueCheckoutDone(rows, parseRules([{ id: 'checkout_done', on: false }]))).toEqual([]);
  });

  it('reminds the tech the set number of days before the start', () => {
    const rows = [
      wo({ wo_number: '1', wo_status: 'Assigned', start_date: '2026-11-01', contractor_names: ['Dwayne'] }),
      wo({ wo_number: '2', wo_status: 'Assigned', start_date: '2026-11-02', contractor_names: ['Dwayne'] }),
      wo({ wo_number: '3', wo_status: 'Open', start_date: '2026-11-01' }),
    ];
    expect(dueReminders(rows, rules, '2026-10-31').map((w) => w.wo_number)).toEqual(['1']);
  });

  it('flags jobs with no tech soon and Work Done jobs waiting to be invoiced', () => {
    const rows = [
      wo({ wo_number: '1', start_date: '2026-11-02' }),
      wo({ wo_number: '2', start_date: '2026-11-09' }),
      wo({ wo_number: '3', wo_status: 'Work Done', checked_out_at: '2026-10-28T20:00:00Z' }),
      wo({ wo_number: '4', wo_status: 'Work Done', checked_out_at: '2026-10-30T20:00:00Z' }),
    ];
    expect(noTechSoon(rows, rules, '2026-10-31').map((w) => w.wo_number)).toEqual(['1']);
    expect(waitingInvoice(rows, rules, '2026-10-31').map((w) => w.wo_number)).toEqual(['3']);
  });
});
