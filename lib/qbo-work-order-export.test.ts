import { describe, expect, it } from 'vitest';
import { fieldSheetImportRows, prepareQboCompletedJobs, qboInvoiceImportRows, siteBillBook, tabNames, type QboWorkOrderInput } from './qbo-work-order-export';

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
        { kind: 'labor', date: '2026-10-19', description: 'Mon, Oct 19 · Paul Gibbs · on site 10 h', qty: 10, rate: 100, amount: 1000 },
        { kind: 'mileage', date: '2026-10-19', description: 'Mon, Oct 19 · Paul Gibbs · mileage 8 mi', qty: 8, rate: 0.6, amount: 4.8 },
        { kind: 'meals', date: null, description: 'Meals: 9 tech-days × $50', qty: 9, rate: 50, amount: 450 },
        { kind: 'hotel', date: null, description: 'Hotel (receipts)', qty: 1, rate: 350.74, amount: 350.74 },
        { kind: 'receipt', date: '2026-10-20', description: "Materials — Lowe's", qty: 1, rate: 47.48, amount: 47.48 },
      ],
    }], '2026-10-25');

    expect(rows[0]).toEqual(qboInvoiceImportRows([])[0]);
    // Each on Fred's own Product/service: "cabling, traveling, meals, lodging".
    expect(rows.slice(1).map((r) => [r[0], r[2], r[3], r[6], r[7], r[8], r[9], r[10], r[11]])).toEqual([
      ['WO-19101401-1018', '10/25/2026', '11/24/2026', 'Cabling', 'Mon, Oct 19 · Paul Gibbs · on site 10 h', '10', '100.00', '1000.00', '10/19/2026'],
      ['WO-19101401-1018', '10/25/2026', '11/24/2026', 'Traveling', 'Mon, Oct 19 · Paul Gibbs · mileage 8 mi', '8', '0.60', '4.80', '10/19/2026'],
      ['WO-19101401-1018', '10/25/2026', '11/24/2026', 'Meals', 'Meals: 9 tech-days × $50', '9', '50.00', '450.00', ''],
      ['WO-19101401-1018', '10/25/2026', '11/24/2026', 'Lodging', 'Hotel (receipts)', '1', '350.74', '350.74', ''],
      ['WO-19101401-1018', '10/25/2026', '11/24/2026', 'Field Services', "Materials — Lowe's", '1', '47.48', '47.48', '10/20/2026'],
    ]);
    expect(new Set(rows.slice(1).map((r) => `${r[1]}|${r[4]}`))).toEqual(new Set(['LDS|Net 30']));
  });

  it('gives each week of a long job its own invoice number', () => {
    const bill = (from: string) => ({ woNumber: '19101401', customerName: 'LDS', from, to: from, memo: '', lines: [{ date: from, description: 'x', qty: 1, rate: 1, amount: 1 }] });
    const rows = fieldSheetImportRows([bill('2026-10-18'), bill('2026-10-25')], '2026-11-01');
    expect(rows.slice(1).map((r) => r[0])).toEqual(['WO-19101401-1018', 'WO-19101401-1025']);
  });
});

// Fred, 2026-10-25: "on the excel sheet each site on a separate page sheet one gaffney sheet two dover sheet 3 east orange".
describe('the week as an Excel workbook, a tab per site', () => {
  const bill = (woNumber: string, from: string, lines: { kind: string; description: string; qty: number; rate: number; amount: number }[]) =>
    ({ woNumber, customerName: 'LDS', from, to: from, memo: '', lines: lines.map((l) => ({ ...l, date: null })) });
  it('puts each site on its own tab in order, as its invoice, then every site’s total', () => {
    const book = siteBillBook([
      { name: 'Gaffney', site: 'LDS Site 5011876 — Gaffney, SC', clientWo: 'LDS-1110', bill: { ...bill('19101401', '2026-10-18', [
        { kind: 'labor', description: 'Hours on site: 72.56 h', qty: 72.56, rate: 100, amount: 7256 },
        { kind: 'hotel', description: 'Hotel (receipts)', qty: 1, rate: 701.48, amount: 701.48 },
      ]), to: '2026-10-23' } },
      { name: 'Dover', site: 'LDS Site 5007927 — Dover, NJ', clientWo: 'LDS-1065', bill: bill('19101403', '2026-10-19', [
        { kind: 'mileage', description: 'Mileage: 28 mi', qty: 28, rate: 0.6, amount: 16.8 },
      ]) },
    ], '2026-10-25');
    expect(book.map((t) => t.name)).toEqual(['Gaffney', 'Dover', 'All sites']);
    const [gaffney] = book;
    expect(gaffney.rows.slice(0, 6)).toEqual([
      ['FAJ Solutions', 'Invoice WO-19101401-1018'], ['Bill to', 'LDS'], ['Site', 'LDS Site 5011876 — Gaffney, SC'],
      ['Work order', 'WO 19101401 · Client # LDS-1110'], ['Service dates', '10/18/2026 – 10/23/2026'], ['Invoice date', '10/25/2026', 'Due', '11/24/2026'],
    ]);
    expect(gaffney.rows.slice(7)).toEqual([
      ['Product/service', 'Description', 'Qty', 'Rate', 'Amount'],
      ['Cabling', 'Hours on site: 72.56 h', 72.56, 100, 7256],
      ['Lodging', 'Hotel (receipts)', 1, 701.48, 701.48],
      [],
      ['', '', '', 'Total', 7957.48],
    ]);
    expect(book[2].rows).toEqual([
      ['Site', 'Invoice', 'Work order', 'Service dates', 'Total'],
      ['Gaffney', 'WO-19101401-1018', '19101401', '10/18/2026 – 10/23/2026', 7957.48],
      ['Dover', 'WO-19101403-1019', '19101403', '10/19/2026', 16.8],
      [],
      ['', '', '', 'All sites', 7974.28],
    ]);
  });

  // Fred, 2026-10-29: "I need a break down from each tech".
  it("puts each tech's hours, miles and materials under the site's bill when it has them", () => {
    const none = { hotels: [], hotelTotal: 0, mealReceipts: [], meals: 0, materials: [], materialsTotal: 0, materialsBilled: true };
    const perTech = [
      { ...none, tech: 'Kendell Newbold', days: 1, hours: 10, travel: 0, total: 10, labor: 1000, miles: 0, mileage: 0,
        lines: [{ day: '2026-10-19', arrived: '07:37', leftSite: '17:37', lunch: null, hours: 10, travel: 0, odoStart: null, odoEnd: null, miles: 0, meals: 0, note: '' }] },
      { ...none, tech: 'Paul Gibbs', days: 1, hours: 0, travel: 0, total: 0, labor: 0, miles: 244, mileage: 146.4,
        lines: [{ day: '2026-10-18', arrived: null, leftSite: null, lunch: null, hours: 0, travel: 0, odoStart: 141865, odoEnd: 142109, miles: 244, meals: 0, note: '' }],
        materials: [{ id: 'l', date: '2026-10-20', category: 'materials', vendor: "Lowe's", amount: 47.48 }], materialsTotal: 47.48 },
    ];
    const [gaffney] = siteBillBook([{ name: 'Gaffney', site: 'Gaffney, SC', clientWo: null, bill: { ...bill('19101401', '2026-10-18', [
      { kind: 'labor', description: 'Hours on site: 72.56 h', qty: 72.56, rate: 100, amount: 7256 },
    ]), perTech, mileRate: 0.6 } }], '2026-10-25');
    const rows = gaffney.rows.map((r) => r[0]);
    const total = gaffney.rows.findIndex((r) => r[3] === 'Total');
    expect(rows.slice(total + 1, total + 6)).toEqual([undefined, 'By tech', undefined, 'Hours', 'Technician']);
    expect(gaffney.rows).toContainEqual(['Kendell Newbold', 'Mon, 10/19', '7:37 AM', '5:37 PM', '', 10, 0, '', '']);
    expect(gaffney.rows).toContainEqual(['Paul Gibbs', 'Sun, 10/18', 141865, 142109, 244, '', 244, '']);
    expect(gaffney.rows).toContainEqual(['Paul Gibbs', 'Tue, 10/20', 'Materials', "Lowe's", 47.48]);
  });

  it('names tabs the way Excel allows, and two sites in one town apart', () => {
    expect(tabNames(['Newark', 'Newark', 'A/B: site [1]?', 'Winston-Salem Regional Distribution Center'])).toEqual(['Newark', 'Newark (2)', 'A B site 1', 'Winston-Salem Regional Distribu']);
  });
});
