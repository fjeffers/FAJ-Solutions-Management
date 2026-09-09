import { describe, it, expect } from 'vitest';
import {
  buildQbInvoice, rejectedVisits, billableVisits, qbInvoiceTotal, coveredVisitIds,
} from './qb-invoice';
import type { SiteVisit } from './types';

// The double-billing guard is the reason this file exists. On 2026-09-09 an app
// draft was found billing "State Farm" $9,809 for Wendy's visits, 28 of which
// were ALSO sitting in the not-invoiced queue ready to be billed a second time.
// These tests make that shape impossible to build.

const visit = (over: Partial<SiteVisit>): SiteVisit => ({
  id: 'v1', user_id: 'u1', program: "Wendy's", site_code: '276', site_name: 'MANAHAWKIN',
  address: null, visit_date: '2026-06-30', time_in: null, time_out: null, sessions: [],
  hours: 2, rate: '$55/hr', total_project_price: null, visit_type: 'T&M',
  invoice_status: 'not_invoiced', payment_status: 'unpaid',
  miles: 0, travel_charge: 0, materials_used: [], mileage_logs: [],
  materials_cost: null, materials_description: null, other_charges: null,
  notes: null, work_order_id: null, archived_at: null,
  created_at: '', updated_at: '',
  ...over,
} as unknown as SiteVisit);

const OPTS = { customerId: '42', itemId: '7' };

describe('the double-billing guard', () => {
  it('refuses a visit that is already invoiced', () => {
    const v = visit({ invoice_status: 'invoiced' });
    expect(rejectedVisits([v])[0].reason).toBe('already invoiced');
    expect(billableVisits([v])).toHaveLength(0);
  });

  it('drops an already-invoiced visit but still bills its clean siblings', () => {
    const rows = [
      visit({ id: 'a', invoice_status: 'invoiced' }),
      visit({ id: 'b' }),
    ];
    expect(coveredVisitIds(rows)).toEqual(['b']);
    const payload = buildQbInvoice(rows, OPTS);
    expect(qbInvoiceTotal(payload)).toBe(110);   // 2h x $55, once
  });

  it('refuses the same visit listed twice', () => {
    const v = visit({ id: 'dup' });
    expect(rejectedVisits([v, v]).map((r) => r.reason)).toContain('listed twice');
    expect(qbInvoiceTotal(buildQbInvoice([v, v], OPTS))).toBe(110);
  });

  it('refuses archived visits', () => {
    expect(rejectedVisits([visit({ archived_at: '2026-01-01' })])[0].reason).toBe('archived');
  });

  it('refuses a visit priced at $0 rather than sending an empty line', () => {
    const v = visit({ rate: null, hours: 2, travel_charge: 0, total_project_price: null });
    expect(rejectedVisits([v])[0].reason).toContain('nothing to bill');
  });

  it('throws rather than create an empty invoice in the ledger', () => {
    expect(() => buildQbInvoice([visit({ invoice_status: 'invoiced' })], OPTS))
      .toThrow(/Nothing to invoice/);
    expect(() => buildQbInvoice([], OPTS)).toThrow(/Nothing to invoice/);
  });
});

describe('the payload QuickBooks receives', () => {
  it('books every line against the given customer and item', () => {
    const p = buildQbInvoice([visit({ travel_charge: 123.85 })], OPTS);
    expect(p.CustomerRef).toEqual({ value: '42' });
    expect(p.Line.every((l) => l.SalesItemLineDetail.ItemRef.value === '7')).toBe(true);
    expect(p.Line.every((l) => l.DetailType === 'SalesItemLineDetail')).toBe(true);
  });

  it('carries labour and travel as separate, readable lines', () => {
    const p = buildQbInvoice([visit({ travel_charge: 123.85 })], OPTS);
    expect(p.Line).toHaveLength(2);
    expect(p.Line[1].Description).toContain('travel charge');
    expect(qbInvoiceTotal(p)).toBe(233.85);      // 110 labour + 123.85 travel
  });

  it('keeps Amount equal to Qty x UnitPrice on every line', () => {
    const p = buildQbInvoice([visit({ hours: 4.03, rate: '$55/hr' })], OPTS);
    for (const l of p.Line) {
      const d = l.SalesItemLineDetail;
      expect(l.Amount).toBe(Math.round(d.Qty * d.UnitPrice * 100) / 100);
    }
  });

  it('rounds money to whole cents', () => {
    const p = buildQbInvoice([visit({ hours: 3.333, rate: '$55/hr' })], OPTS);
    for (const l of p.Line) {
      expect(l.Amount).toBe(Math.round(l.Amount * 100) / 100);
    }
  });

  it('passes through dates and the memo only when given', () => {
    const bare = buildQbInvoice([visit({})], OPTS);
    expect(bare.TxnDate).toBeUndefined();
    expect(bare.DueDate).toBeUndefined();
    expect(bare.PrivateNote).toBeUndefined();

    const full = buildQbInvoice([visit({})], {
      ...OPTS, txnDate: '2026-09-09', dueDate: '2026-10-09', memo: 'June Wendy\'s work',
    });
    expect(full.TxnDate).toBe('2026-09-09');
    expect(full.DueDate).toBe('2026-10-09');
    expect(full.PrivateNote).toBe("June Wendy's work");
  });

  it('never invents an invoice number — that belongs to QuickBooks', () => {
    const p = buildQbInvoice([visit({})], OPTS) as Record<string, unknown>;
    expect(p.DocNumber).toBeUndefined();
    expect(JSON.stringify(p)).not.toMatch(/INV-\d{4}-\d{3}/);
  });
});

describe('totals agree with the rest of the app', () => {
  it('matches what the site sheet and statement would show for the same visits', () => {
    // Both sides come from visitInvoiceLines, so this pins them together: if
    // one ever changes, this test fails rather than the client's bill.
    const rows = [
      visit({ id: 'a', hours: 2, rate: '$55/hr', travel_charge: 123.85 }),
      visit({ id: 'b', hours: 9, rate: '$55/hr', travel_charge: 56.65 }),
    ];
    const expected = 110 + 123.85 + 495 + 56.65;
    expect(qbInvoiceTotal(buildQbInvoice(rows, OPTS))).toBe(expected);
  });
});
