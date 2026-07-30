import { describe, it, expect } from 'vitest';
import { customerBook, customerBooks, unlinkedCount, aliasKey } from './customers';
import type { Customer, WorkOrder, Invoice, InvoicePayment, SiteVisit } from './types';

const CID = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';

const customer = (over: Partial<Customer> = {}): Customer =>
  ({
    id: CID,
    user_id: 'u1',
    name: "Wendy's",
    status: 'active',
    industry: null, source: null, billing_email: null, billing_phone: null,
    address: null, city: null, state: null, zip: null,
    payment_terms: null, default_mileage_rate: null, notes: null,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    ...over,
  }) as Customer;

// total_amount is the CLIENT price; contractor_pay is the TECH's cut.
const wo = (over: Partial<WorkOrder> = {}): WorkOrder =>
  ({
    id: crypto.randomUUID(),
    user_id: 'u1',
    wo_number: 'WO-1',
    customer_id: CID,
    customer_name: "Wendy's",
    buyer_company: null,
    contractor_name: 'Tech A',
    wo_status: 'Open',
    pay_type: 'Fixed',
    total_amount: 1000,
    contractor_pay: { 'Tech A': 600 },
    mileage_logs: null,
    scheduled_date: '2026-06-01',
    created_at: '2026-06-01T00:00:00Z',
    ...over,
  }) as unknown as WorkOrder;

const visit = (over: Partial<SiteVisit> = {}): SiteVisit =>
  ({
    id: crypto.randomUUID(),
    user_id: 'u1',
    customer_id: CID,
    program: "Wendy's",
    site_name: 'Roselle',
    site_code: '5798',
    visit_date: '2026-06-10',
    visit_type: 'T&M',
    hours: 4,
    rate: '$55/hr',
    travel_charge: 0,
    miles: 20,
    invoice_status: 'not_invoiced',
    payment_status: 'unpaid',
    ...over,
  }) as unknown as SiteVisit;

const invoice = (over: Partial<Invoice> = {}): Invoice =>
  ({
    id: crypto.randomUUID(),
    user_id: 'u1',
    customer_id: CID,
    invoice_number: 'INV-1',
    client_name: "Wendy's",
    status: 'sent',
    total: 1000,
    created_at: '2026-06-15T00:00:00Z',
    ...over,
  }) as unknown as Invoice;

const inputs = (over: Partial<Parameters<typeof customerBook>[1]> = {}) => ({
  workOrders: [], invoices: [], invoicePayments: [], visits: [], ...over,
});

describe('customerBook', () => {
  it('separates client revenue from tech cost and keeps the difference as profit', () => {
    const book = customerBook(customer(), inputs({ workOrders: [wo()] }));
    expect(book.woRevenue).toBe(1000); // what the client pays
    expect(book.techCost).toBe(600);   // what the tech gets
    expect(book.profit).toBe(400);     // what FAJ keeps
    expect(book.margin).toBe(0.4);
  });

  it('never counts another customer\'s work', () => {
    const book = customerBook(
      customer(),
      inputs({
        workOrders: [wo(), wo({ customer_id: OTHER, total_amount: 9999 })],
        visits: [visit(), visit({ customer_id: OTHER })],
        invoices: [invoice(), invoice({ customer_id: OTHER, total: 5000 })],
      }),
    );
    expect(book.woRevenue).toBe(1000);
    expect(book.visitCount).toBe(1);
    expect(book.invoiceCount).toBe(1);
  });

  it('leaves margin null rather than dividing by zero revenue', () => {
    const book = customerBook(customer(), inputs({ workOrders: [wo({ total_amount: 0, contractor_pay: null })] }));
    expect(book.margin).toBeNull();
  });

  it('keeps drafts out of outstanding — never-sent money is its own bucket', () => {
    const book = customerBook(
      customer(),
      inputs({
        invoices: [
          invoice({ status: 'draft', total: 4100 }),
          invoice({ status: 'sent', total: 1000 }),
        ],
      }),
    );
    expect(book.neverSent).toBe(4100);
    expect(book.outstanding).toBe(1000);
    expect(book.invoiced).toBe(5100);
  });

  it('nets payments against sent invoices', () => {
    const inv = invoice({ status: 'sent', total: 1000 });
    const pay: InvoicePayment[] = [
      { invoice_id: inv.id, amount: 400 } as InvoicePayment,
      { invoice_id: inv.id, amount: 100 } as InvoicePayment,
    ];
    const book = customerBook(customer(), inputs({ invoices: [inv], invoicePayments: pay }));
    expect(book.received).toBe(500);
    expect(book.outstanding).toBe(500);
  });

  it('never reports negative outstanding when a client overpays', () => {
    const inv = invoice({ status: 'sent', total: 500 });
    const book = customerBook(
      customer(),
      inputs({ invoices: [inv], invoicePayments: [{ invoice_id: inv.id, amount: 800 } as InvoicePayment] }),
    );
    expect(book.outstanding).toBe(0);
  });

  it('counts only not_invoiced visits as unbilled — "na" is deliberately not billable', () => {
    const book = customerBook(
      customer(),
      inputs({
        visits: [
          visit({ invoice_status: 'not_invoiced' }),
          visit({ invoice_status: 'na' }),
          visit({ invoice_status: 'invoiced' }),
        ],
      }),
    );
    expect(book.unbilledVisits).toBe(1);
    expect(book.unbilled).toBe(220); // 4h x $55
    expect(book.visitCount).toBe(3); // all three are still their visits
  });

  it('totals hours and miles across visits', () => {
    const book = customerBook(
      customer(),
      inputs({ visits: [visit({ hours: 4, miles: 20 }), visit({ hours: 2.5, miles: 10 })] }),
    );
    expect(book.hours).toBe(6.5);
    expect(book.miles).toBe(30);
  });

  it('reports the most recent activity date', () => {
    const book = customerBook(
      customer(),
      inputs({ visits: [visit({ visit_date: '2026-06-10' }), visit({ visit_date: '2026-07-22' })] }),
    );
    expect(book.lastActivity).toBe('2026-07-22');
  });
});

describe('customerBooks', () => {
  it('ranks customers by total business, biggest first', () => {
    const small = customer({ id: CID, name: 'Small' });
    const big = customer({ id: OTHER, name: 'Big' });
    const books = customerBooks([small, big], inputs({
      workOrders: [wo({ customer_id: CID, total_amount: 100 }), wo({ customer_id: OTHER, total_amount: 9000 })],
    }));
    expect(books.map((b) => b.customer.name)).toEqual(['Big', 'Small']);
  });
});

describe('unlinkedCount', () => {
  it('counts rows that have a customer name but no customer_id', () => {
    const n = unlinkedCount(inputs({
      workOrders: [
        wo({ customer_id: null, customer_name: 'Someone' }),   // counted
        wo({ customer_id: null, customer_name: null, buyer_company: 'Xerox' }), // counted
        wo({ customer_id: null, customer_name: null, buyer_company: null }),    // no name, not counted
        wo(),                                                   // linked, not counted
      ],
      visits: [visit({ customer_id: null, program: 'Wendys' })], // counted
      invoices: [invoice({ customer_id: null, client_name: null })], // no name
    }));
    expect(n).toBe(3);
  });
});

describe('aliasKey', () => {
  it('folds every spelling of one customer onto the same key', () => {
    expect(aliasKey("Wendy's ")).toBe('wendys');
    expect(aliasKey('Wendys')).toBe('wendys');
    expect(aliasKey("WENDY'S")).toBe('wendys');
    expect(aliasKey('State Farm')).toBe('statefarm');
  });
});
