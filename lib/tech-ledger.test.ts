import { describe, expect, it } from 'vitest';
import {
  hoursOnJob, inRange, ledgerTotals, periodRange, techJobs, techLedger, tenure, unmatchedPayments,
  type ClockRecord, type Punch,
} from './tech-ledger';
import type { EnrichedWorkOrder, Payment } from './types';

const wo = (o: Partial<EnrichedWorkOrder>): EnrichedWorkOrder => ({
  id: o.wo_number ?? 'x', wo_number: 'x', contractor_name: 'Davis', contractor_names: null, contractor_pay: null,
  total_amount: 500, start_date: '2026-10-01', scheduled_date: null, created_at: '2026-09-01T00:00:00Z',
  hours_worked: null, mileage_logs: [], materials_used: [], pay_addons: [], archived_at: null, ...o,
} as unknown as EnrichedWorkOrder);
const pay = (wo_number: string, contractor_name: string, amount: number): Payment =>
  ({ id: `${wo_number}-${amount}`, wo_number, contractor_name, amount, payment_date: '2026-10-02' } as unknown as Payment);

describe("a tech's time & pay log", () => {
  it('finds every job the tech is on, main tech or second tech', () => {
    const jobs = [
      wo({ wo_number: '1', contractor_name: 'Davis' }),
      wo({ wo_number: '2', contractor_name: 'Paul', contractor_names: ['Paul', 'Davis'] }),
      wo({ wo_number: '3', contractor_name: 'Paul' }),
    ];
    expect(techJobs(jobs, 'Davis').map((w) => w.wo_number)).toEqual(['1', '2']);
  });

  it('pay comes from the tech pay on the job; no tech pay means "Pay not set", never owed', () => {
    const rows = techLedger('Davis', [
      wo({ wo_number: '1', contractor_pay: { Davis: 300 }, total_amount: 500 }),
      wo({ wo_number: '2', contractor_pay: null, total_amount: 900, start_date: '2026-09-01' }),
      wo({ wo_number: '3', contractor_name: 'Paul', contractor_names: ['Paul', 'Davis'], contractor_pay: { Paul: 200, Davis: 150 }, start_date: '2026-08-01' }),
    ], [pay('1', 'Davis', 100), pay('3', 'Davis', 200), pay('3', 'Paul', 200)]);
    expect(rows.map((r) => [r.wo.wo_number, r.earned, r.paid, r.owed, r.overpaid])).toEqual([
      ['1', 300, 100, 200, 0],
      ['2', null, 0, 0, 0],       // never the $900 client price
      ['3', 150, 200, 0, 50],     // only Davis's own payments count
    ]);
    expect(ledgerTotals(rows)).toEqual({ jobs: 3, hours: 0, earned: 450, paid: 300, owed: 200, overpaid: 50, payNotSet: 1 });
  });

  it('hours: clock-ins first, then the clock record, then hours on the job', () => {
    const job = wo({ id: 'j', wo_number: 'j', hours_worked: 8 });
    const punches: Punch[] = [
      { wo_id: 'j', contractor_name: 'Davis', kind: 'in', at: '2026-10-01T13:00:00Z' },
      { wo_id: 'j', contractor_name: 'Davis', kind: 'out', at: '2026-10-01T17:30:00Z' },
      { wo_id: 'j', contractor_name: 'Davis', kind: 'in', at: '2026-10-02T13:00:00Z' },
      { wo_id: 'j', contractor_name: 'Davis', kind: 'in', at: '2026-10-02T13:05:00Z' }, // a double tap
      { wo_id: 'j', contractor_name: 'Davis', kind: 'out', at: '2026-10-02T15:00:00Z' },
      { wo_id: 'j', contractor_name: 'Paul', kind: 'in', at: '2026-10-02T13:00:00Z' },
    ];
    expect(hoursOnJob(job, 'Davis', punches, [])).toEqual({ hours: 6.5, from: 'clock', onTheClock: false });
    expect(hoursOnJob(job, 'Paul', punches, [])).toEqual({ hours: 0, from: 'clock', onTheClock: true });
    const rec: ClockRecord[] = [{ wo_id: 'j', contractor_name: 'Ann', checked_in_at: '2026-10-01T13:00:00Z', checked_out_at: '2026-10-01T16:00:00Z', adjusted_hours: null }];
    expect(hoursOnJob(job, 'Ann', [], rec)).toEqual({ hours: 3, from: 'record', onTheClock: false });
    expect(hoursOnJob(job, 'Ann', [], [{ ...rec[0], adjusted_hours: 2.5 }]).hours).toBe(2.5);
    expect(hoursOnJob(job, 'Davis', [], [])).toEqual({ hours: 8, from: 'job', onTheClock: false });
    expect(hoursOnJob(wo({}), 'Davis', [], [])).toEqual({ hours: null, from: null, onTheClock: false });
  });

  it('payments that match none of the tech\'s jobs are called out', () => {
    const jobs = [wo({ wo_number: '1' })];
    expect(unmatchedPayments('Davis', jobs, [pay('1', 'Davis', 50), pay('999', 'Davis', 75), pay('999', 'Paul', 10)]).map((p) => p.amount)).toEqual([75]);
  });

  it('periods: weeks run Monday to Sunday', () => {
    // 2026-10-06 is a Tuesday
    expect(periodRange('week', '2026-10-06')).toEqual({ from: '2026-10-05', to: '2026-10-11' });
    expect(periodRange('lastWeek', '2026-10-06')).toEqual({ from: '2026-09-28', to: '2026-10-04' });
    expect(periodRange('month', '2026-10-06')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(periodRange('lastMonth', '2026-01-15')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(periodRange('year', '2026-10-06')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(periodRange('all', '2026-10-06')).toBeNull();
    expect(inRange('2026-10-05', periodRange('week', '2026-10-06'))).toBe(true);
    expect(inRange('2026-10-04', periodRange('week', '2026-10-06'))).toBe(false);
  });

  it('time with FAJ since the hire date', () => {
    expect(tenure('2024-07-15', '2026-10-06')).toBe('2 yrs 2 mos');
    expect(tenure('2025-10-06', '2026-10-06')).toBe('1 yr');
    expect(tenure('2026-09-01', '2026-10-06')).toBe('1 mo');
    expect(tenure('2026-09-24', '2026-10-06')).toBe('12 days');
    expect(tenure('2026-10-06', '2026-10-06')).toBe('Started today');
    expect(tenure('2026-11-01', '2026-10-06')).toBe('Starts soon');
    expect(tenure(null, '2026-10-06')).toBe('');
  });
});
