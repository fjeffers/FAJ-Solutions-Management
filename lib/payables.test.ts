import { describe, it, expect } from 'vitest';
import { moneyTotals, payableSlices } from './payables';
import type { Invoice, InvoicePayment, Payment, WorkOrder } from './types';

const wo = (o: Partial<WorkOrder>): WorkOrder => ({
  id: o.wo_number ?? 'w', wo_number: 'w', contractor_name: null, contractor_names: null, contractor_pay: null, total_amount: 0,
  mileage_logs: null, materials_used: null, pay_addons: null, archived_at: null, ...o,
} as unknown as WorkOrder);
const pay = (wo_number: string, contractor_name: string, amount: number, payment_date = '2026-10-10'): Payment =>
  ({ id: `${wo_number}-${contractor_name}-${amount}`, wo_number, contractor_name, amount, payment_date } as unknown as Payment);

describe('what techs are owed, and the money totals', () => {
  const jobs = [
    wo({ wo_number: 'A', contractor_names: ['Dwayne', 'Raja'], contractor_pay: { Dwayne: 600, Raja: 400 }, total_amount: 1500 }),
    wo({ wo_number: 'B', contractor_name: 'Dwayne', contractor_pay: { Dwayne: 300 }, total_amount: 500 }),
    // No pay split: the legacy rule would call the whole client price owed, so it isn't counted.
    wo({ wo_number: 'C', contractor_name: 'Raja', total_amount: 900 }),
  ];
  const payments = [pay('A', 'Dwayne', 600), pay('A', 'Raja', 100), pay('B', 'Dwayne', 350), pay('B', 'Dwayne', 0, '2025-12-30')];

  it('owes each tech their share less what they were paid, keeps overpaid jobs apart, skips jobs with no split', () => {
    const { owed, over } = payableSlices(jobs, payments);
    expect([...owed.entries()].map(([n, l]) => [n, l.map((x) => [x.wo_number, x.shareRemaining])])).toEqual([['Raja', [['A', 300]]]]);
    expect([...over.entries()].map(([n, l]) => [n, l.map((x) => [x.wo_number, x.sharePaid - x.share])])).toEqual([['Dwayne', [['B', 50]]]]);
  });

  it('adds up money in and out for the year, what clients owe and what techs are owed', () => {
    const invoices = [
      { id: 'i1', status: 'sent', total: 1000 }, { id: 'i2', status: 'paid', total: 400 }, { id: 'i3', status: 'draft', total: 999 },
    ] as unknown as Invoice[];
    const invoicePayments = [
      { invoice_id: 'i1', amount: 250, payment_date: '2026-10-01' }, { invoice_id: 'i2', amount: 400, payment_date: '2026-03-01' },
      { invoice_id: 'i2', amount: 0, payment_date: '2025-11-01' },
    ] as unknown as InvoicePayment[];
    expect(moneyTotals({ invoices, invoicePayments, payments, workOrders: jobs, year: '2026' }))
      .toEqual({ receivedYtd: 650, clientsOwe: 750, paidOutYtd: 1050, techsOwed: 300 });
  });
});
