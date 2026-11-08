import { describe, expect, it } from 'vitest';
import { billingDetail, billingWaiting, type BillingJob, type BillingRow } from './billing-waiting';

const job = (over: Partial<BillingJob> = {}): BillingJob => ({ id: 'w1', wo_number: '191', site_name: 'Site 5006643', customer_name: 'Acme', ...over });
const row = (over: Partial<BillingRow> = {}): BillingRow => ({
  wo_id: 'w1', rates: { 'Paul Gibbs': { hour: 50, mile: 0.6 } }, all_hours_rate: null, invoice: {}, updated_at: '2026-11-08T15:00:00Z', ...over,
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
