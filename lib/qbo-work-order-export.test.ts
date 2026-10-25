import { describe, expect, it } from 'vitest';
import { fieldSheetImportRows, prepareQboCompletedJobs, qboInvoiceImportRows, type QboWorkOrderInput } from './qbo-work-order-export';

const workOrder = (overrides: Partial<QboWorkOrderInput> = {}): QboWorkOrderInput => ({
  id: 'wo-1',
  wo_number: '200',
  wo_status: 'Work Done',
  customer_name: 'Acme Stores',
  buyer_company: null,
  title: 'Network installation',
  site_name: 'Easton 14',
  total_amount: 425.5,
  start_date: '2026-09-12',
  end_date: '2026-09-13',
  scheduled_date: '2026-09-12',
  submitted_at: '2026-09-14T15:30:00.000Z',
  approved_at: null,
  created_at: '2026-09-01T12:00:00.000Z',
  ...overrides,
});

describe('QuickBooks completed work order export', () => {
  it('includes Work Done, Approved, and Paid jobs, with stable invoice dates and amounts', () => {
    const plan = prepareQboCompletedJobs([
      workOrder({ id: 'paid', wo_number: '202', wo_status: 'Paid', approved_at: '2026-09-30T10:00:00Z' }),
      workOrder({ id: 'open', wo_number: '203', wo_status: 'Open' }),
      workOrder({ id: 'approved', wo_number: '201', wo_status: 'Approved' }),
    ]);

    expect(plan.completedCount).toBe(2);
    expect(plan.jobs.map((job) => job.invoiceNumber)).toEqual(['WO-201', 'WO-202']);
    expect(plan.jobs[0]).toMatchObject({
      customerName: 'Acme Stores',
      invoiceDate: '2026-09-14',
      dueDate: '2026-10-14',
      serviceDate: '2026-09-13',
      amount: 425.5,
    });
  });

  it('skips completed jobs that cannot become valid invoices', () => {
    const plan = prepareQboCompletedJobs([
      workOrder({ id: 'no-customer', wo_number: '204', customer_name: null, buyer_company: ' ' }),
      workOrder({ id: 'no-price', wo_number: '205', total_amount: 0 }),
    ]);

    expect(plan.jobs).toHaveLength(0);
    expect(plan.skipped.map((job) => job.reason)).toEqual([
      'Add a customer name or buyer company.',
      'Add a positive client amount.',
    ]);
  });

  it('builds a QBO invoice-import row with numeric currency and US-formatted dates', () => {
    const plan = prepareQboCompletedJobs([workOrder({ customer_name: '', buyer_company: 'Acme LLC' })]);
    const [header, row] = qboInvoiceImportRows(plan.jobs);

    expect(header).toContain('ItemAmount');
    expect(row).toEqual([
      'WO-200', 'Acme LLC', '9/14/2026', '10/14/2026', 'Net 30',
      'Completed job WO #200', 'Field Services', 'Network installation — WO #200',
      '1', '425.50', '425.50', '9/13/2026',
    ]);
  });
});

// Fred, 2026-10-25: "i need a auto sheet to enter into quickbooks". A Field
// Sheet bill, line by line, the way QuickBooks' invoice import takes it.
describe('QuickBooks import file from the Field Sheet', () => {
  it('puts each line of a bill on its own row under one invoice number, the week\'s meals and hotel undated', () => {
    const rows = fieldSheetImportRows([{
      woNumber: '19101401', customerName: 'LDS', from: '2026-10-18', to: '2026-10-23',
      memo: 'LDS Site 5011876 — Gaffney, SC · WO 19101401 · Client # LDS-1110 · Oct 18, 2026 – Oct 23, 2026',
      lines: [
        { date: '2026-10-19', description: 'Mon, Oct 19 · Paul Gibbs · on site 10 h', qty: 10, rate: 100, amount: 1000 },
        { date: '2026-10-19', description: 'Mon, Oct 19 · Paul Gibbs · mileage 8 mi', qty: 8, rate: 0.6, amount: 4.8 },
        { date: null, description: 'Meals: 9 tech-days × $50', qty: 9, rate: 50, amount: 450 },
        { date: null, description: 'Hotel (receipts)', qty: 1, rate: 350.74, amount: 350.74 },
      ],
    }], '2026-10-25');

    expect(rows[0]).toEqual(qboInvoiceImportRows([])[0]);
    expect(rows.slice(1).map((r) => [r[0], r[2], r[3], r[7], r[8], r[9], r[10], r[11]])).toEqual([
      ['WO-19101401-1018', '10/25/2026', '11/24/2026', 'Mon, Oct 19 · Paul Gibbs · on site 10 h', '10', '100.00', '1000.00', '10/19/2026'],
      ['WO-19101401-1018', '10/25/2026', '11/24/2026', 'Mon, Oct 19 · Paul Gibbs · mileage 8 mi', '8', '0.60', '4.80', '10/19/2026'],
      ['WO-19101401-1018', '10/25/2026', '11/24/2026', 'Meals: 9 tech-days × $50', '9', '50.00', '450.00', ''],
      ['WO-19101401-1018', '10/25/2026', '11/24/2026', 'Hotel (receipts)', '1', '350.74', '350.74', ''],
    ]);
    expect(new Set(rows.slice(1).map((r) => `${r[1]}|${r[4]}|${r[6]}`))).toEqual(new Set(['LDS|Net 30|Field Services']));
  });

  it('gives each week of a long job its own invoice number', () => {
    const bill = (from: string) => ({ woNumber: '19101401', customerName: 'LDS', from, to: from, memo: '', lines: [{ date: from, description: 'x', qty: 1, rate: 1, amount: 1 }] });
    const rows = fieldSheetImportRows([bill('2026-10-18'), bill('2026-10-25')], '2026-11-01');
    expect(rows.slice(1).map((r) => r[0])).toEqual(['WO-19101401-1018', 'WO-19101401-1025']);
  });
});
