import { describe, expect, it } from 'vitest';
import { accountingTracking, billingDetail, billingWaiting, type AccountingJob, type BillingJob, type BillingRow } from './billing-waiting';

const job = (over: Partial<BillingJob> = {}): BillingJob => ({ id: 'w1', wo_number: '191', site_name: 'Site 5006643', customer_name: 'Acme', ...over });
const row = (over: Partial<BillingRow> = {}): BillingRow => ({
  wo_id: 'w1', rates: { 'Paul Gibbs': { hour: 50, mile: 0.6 } }, all_hours_rate: null, invoice: {}, updated_at: '2026-11-08T15:00:00Z', ...over,
});

describe('accountingTracking', () => {
  it('keeps the QuickBooks invoice and technician payment separate on each finished job', () => {
    const jobs = [
      job({ id: 'w1', wo_status: 'Work Done', paid: 125, remaining: 75, pay_set: true, scheduled_date: '2026-11-08' } as Partial<AccountingJob>),
      job({ id: 'w2', wo_number: '192', wo_status: 'Paid', paid: 200, remaining: 0, pay_set: true, scheduled_date: '2026-11-09' } as Partial<AccountingJob>),
    ] as AccountingJob[];
    const rows = [
      row(),
      row({ wo_id: 'w2', invoice: { qbo: { id: '7', number: '1042', total: 500, at: '2026-11-09T15:00:00Z' } } }),
    ];
    expect(accountingTracking(rows, jobs)).toEqual([
      expect.objectContaining({ woId: 'w2', invoice: 'sent', invoiceNumber: '1042', techPaid: 200, techDue: 0 }),
      expect.objectContaining({ woId: 'w1', invoice: 'not_sent', techPaid: 125, techDue: 75 }),
    ]);
  });

  it('labels a finished job with no invoice or tech pay setup', () => {
    const [item] = accountingTracking([], [job({ wo_status: 'Approved' } as Partial<AccountingJob>) as AccountingJob]);
    expect(item).toMatchObject({ invoice: 'not_prepared', techPaid: 0, techDue: 0, paySet: false });
  });
});

describe('billingWaiting', () => {
  it('lists a saved invoice that is not in QuickBooks yet', () => {
    const items = billingWaiting([row()], [job()]);
    expect(items).toEqual([{ woId: 'w1', title: 'WO 191 · Site 5006643', quickbooks: true, netview: false }]);
    expect(billingDetail(items[0])).toBe('Not in QuickBooks');
  });

  it('drops it once it is sent from here or marked by hand', () => {
    const sent = { id: '7', number: '1042', total: 10, at: '2026-11-08T16:00:00Z' };
    expect(billingWaiting([row({ invoice: { qbo: sent } })], [job()])).toEqual([]);
    expect(billingWaiting([row({ invoice: { billed: '2026-11-08T16:00:00Z' } })], [job()])).toEqual([]);
  });

  it('asks for NetView on a NetView job until that is marked too', () => {
    const nv = job({ customer_name: 'TeamNetView' });
    const billed = { billed: '2026-11-08T16:00:00Z' };
    const [item] = billingWaiting([row({ invoice: billed })], [nv]);
    expect(item).toMatchObject({ quickbooks: false, netview: true });
    expect(billingDetail(item)).toBe('NetView not sent');
    expect(billingWaiting([row({ invoice: { ...billed, netview: '2026-11-08T16:10:00Z' } })], [nv])).toEqual([]);
  });

  it('skips invoices with no rate, older invoices, and jobs not loaded', () => {
    expect(billingWaiting([row({ rates: {} })], [job()])).toEqual([]);
    expect(billingWaiting([row({ rates: {}, all_hours_rate: 60 })], [job()])).toHaveLength(1);
    expect(billingWaiting([row({ updated_at: '2026-11-07T23:00:00Z' })], [job()])).toEqual([]);
    expect(billingWaiting([row({ wo_id: 'gone' })], [job()])).toEqual([]);
  });
});
