import { describe, expect, it } from 'vitest';
import { prepareQboCompletedJobs, qboInvoiceImportRows, type QboWorkOrderInput } from './qbo-work-order-export';

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
