import { describe, it, expect } from 'vitest';
import { buildStatementRows, statementMatrix, statementTotal, STATEMENT_HEADERS } from './site-statement';
import type { SiteVisit } from './types';

const visit = (over: Partial<SiteVisit>): SiteVisit => ({
  id: 'v1', user_id: 'u1', program: 'Wendys', site_code: '5798', site_name: 'Roselle',
  address: '210 West First Ave, Roselle, NJ', visit_date: '2026-06-20',
  time_in: null, time_out: null, sessions: null, hours: 9, rate: '$55/hr',
  total_project_price: null, visit_type: 'T&M', invoice_status: 'not_invoiced',
  payment_status: 'unpaid', miles: 100, travel_charge: 50, notes: 'Replaced data lines',
  materials_description: null, materials_cost: null, other_charges: null, additional_details: null,
  client_summary: null, work_order_id: null, customer_id: null, contractor_id: null, tech_ids: [],
  created_at: '', updated_at: '',
  ...over,
});

describe('client statement', () => {
  it('bills hours at the hourly rate and adds travel on top', () => {
    const [r] = buildStatementRows([visit({})]);
    expect(r.labor).toBe(495);      // 9h × $55
    expect(r.travel).toBe(50);
    expect(r.amount).toBe(545);     // labor + travel
  });

  it('never lets Labor and Amount disagree about the hours', () => {
    for (const v of [
      visit({}),
      visit({ hours: 3.25, rate: '$55/hr', travel_charge: null }),
      visit({ hours: null, rate: '2600', travel_charge: 12.5 }),
      visit({ total_project_price: 2600, rate: '$55/hr', hours: 9, travel_charge: 0 }),
    ]) {
      const [r] = buildStatementRows([v]);
      expect(r.amount).toBeCloseTo(r.labor + Number(r.travel ?? 0), 2);
    }
  });

  it('prices a fixed-price visit off the project price, not the hourly text', () => {
    const [r] = buildStatementRows([visit({ total_project_price: 2600, travel_charge: 50 })]);
    expect(r.labor).toBe(2600);
    expect(r.amount).toBe(2650);
  });

  it('shows an unpriced visit as zero rather than guessing a rate', () => {
    const [r] = buildStatementRows([visit({ rate: null, total_project_price: null, travel_charge: null })]);
    expect(r.labor).toBe(0);
    expect(r.amount).toBe(0);
    expect(r.rate).toContain('priced');
  });

  it('totals every column a client would add up, and the total row lines up with the headers', () => {
    const rows = buildStatementRows([
      visit({ id: 'a', hours: 2, miles: 10, travel_charge: 5 }),
      visit({ id: 'b', hours: 3, miles: 20, travel_charge: 10 }),
    ]);
    const m = statementMatrix(rows);
    const total = m[m.length - 1];
    expect(m[0]).toEqual(STATEMENT_HEADERS);
    expect(total.length).toBe(STATEMENT_HEADERS.length);
    expect(total[STATEMENT_HEADERS.indexOf('Total Time')]).toBe(5);
    expect(total[STATEMENT_HEADERS.indexOf('Round Trip Miles')]).toBe(30);
    expect(total[STATEMENT_HEADERS.indexOf('Travel Charge')]).toBe(15);
    expect(total[STATEMENT_HEADERS.indexOf('Total Pay')]).toBe(275); // (2+3)h × $55
    expect(total[STATEMENT_HEADERS.indexOf('Total')]).toBe(statementTotal(rows));
    expect(statementTotal(rows)).toBe(290); // 275 labor + 15 travel
  });

  it('reads oldest first, like a running account', () => {
    const rows = buildStatementRows([
      visit({ id: 'b', visit_date: '2026-07-01' }),
      visit({ id: 'a', visit_date: '2026-06-01' }),
    ]);
    expect(rows.map((r) => r.date)).toEqual(['2026-06-01', '2026-07-01']);
  });
});

describe('the columns add up to the bottom line', () => {
  it('carries materials and other charges in their own column', () => {
    const [r] = buildStatementRows([visit({ materials_cost: 120, other_charges: 40 })]);
    expect(r.extras).toBe(160);
  });

  it('labour + travel + materials equals the amount on every row', () => {
    const rows = buildStatementRows([
      visit({ hours: 2, rate: '$55/hr', travel_charge: 58.7 }),
      visit({ hours: 9, rate: '$55/hr', travel_charge: 56.65, materials_cost: 120 }),
      visit({ rate: null, total_project_price: 2600, travel_charge: 80.9, other_charges: 40 }),
    ]);
    for (const r of rows) {
      expect(Math.round((r.labor + Number(r.travel ?? 0) + r.extras) * 100) / 100).toBe(r.amount);
    }
  });

  it('the exported grid has a Materials & Other column that totals', () => {
    const m = statementMatrix(buildStatementRows([
      visit({ hours: 2, rate: '$55/hr', travel_charge: 58.7, materials_cost: 120 }),
    ]));
    const i = m[0].indexOf('Materials & Other');
    expect(i).toBeGreaterThan(-1);
    expect(m[1][i]).toBe(120);
    expect(m[2][i]).toBe(120);           // the TOTAL row
    // And the row still reads across: 110 + 58.70 + 120 = 288.70
    expect(m[1][m[0].indexOf('Total')]).toBe(288.7);
  });
});
