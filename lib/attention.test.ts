import { describe, it, expect } from 'vitest';
import { attentionItems, attentionSummary, daysUntil, type AttentionInput } from './attention';
import type {
  Contract, EnrichedWorkOrder, Invoice, InvoicePayment, Quote, SiteVisit, Survey,
} from './types';

const TODAY = '2026-08-25';

const empty: AttentionInput = {
  surveys: [], quotes: [], contracts: [], workOrders: [], invoices: [], invoicePayments: [],
  today: TODAY,
};

const survey = (over: Partial<Survey> = {}): Survey => ({
  id: 's1', user_id: 'u', survey_number: 'S-2026-001',
  customer_id: null, client_name: 'New Beginnings', client_email: null, client_phone: null,
  poc_name: null, poc_phone: null,
  site_name: 'Chester', site_address: null, site_city: null, site_state: null, site_zip: null,
  title: null, survey_date: null, surveyed_by: null, status: 'draft',
  existing_conditions: null, findings: null, recommendations: 'Do it.', notes: null,
  scope_items: [], labor_rate: 85, labor_hours: 8, tax_rate: 0, payment_terms: null,
  photos: [], cameras: [], documents: [], cable_drops: [], custom_qa: [],
  survey_type: 'camera', last_page: 1,
  head_end_notes: null, rack_space: null, switch_notes: null, access_notes: null,
  quote_id: null, work_order_id: null, share_token: null, archived_at: null,
  created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
  ...over,
});

const quote = (over: Partial<Quote> = {}): Quote => ({
  id: 'q1', user_id: 'u', quote_number: 'Q-2026-001',
  client_name: 'New Beginnings', client_email: null, client_phone: null,
  title: null, description: null, line_items: [],
  subtotal: 1000, tax_rate: 0, tax_amount: 0, total: 1000,
  status: 'sent', valid_until: null, notes: null, sent_at: null, accepted_at: null,
  work_order_id: null, survey_id: null, contract_id: null, customer_id: null, share_token: null,
  created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
  ...over,
});

const wo = (over: Partial<EnrichedWorkOrder> = {}): EnrichedWorkOrder => ({
  id: 'w1', wo_number: '1001', user_id: 'u',
  contractor_name: '', total_amount: 1000, wo_status: 'Open',
  assignment_responses: null, archived_at: null,
  paid: 0, remaining: 0, payment_status: 'pending', payout_total: 0,
  ...over,
} as EnrichedWorkOrder);

const invoice = (over: Partial<Invoice> = {}): Invoice => ({
  id: 'i1', user_id: 'u', invoice_number: 'INV-1',
  client_name: null, client_email: null, client_phone: null, title: null, description: null,
  line_items: [], subtotal: 500, tax_rate: 0, tax_amount: 0, total: 500,
  status: 'sent', due_date: '2026-08-01', notes: null, sent_at: null, paid_at: null,
  work_order_ids: [], quote_id: null,
  ...over,
} as Invoice);

const visit = (over: Partial<SiteVisit> = {}): SiteVisit => ({
  id: 'v1', user_id: 'u', program: "Wendy's", site_code: '1217', site_name: 'Cherry Hill',
  address: null, visit_date: '2026-08-20', time_in: null, time_out: null,
  hours: 2, rate: '$55/hr', visit_type: null,
  invoice_status: 'not_invoiced', payment_status: null,
  miles: null, travel_charge: null, notes: null, work_order_id: null,
  created_at: '2026-08-20T00:00:00Z', updated_at: '2026-08-20T00:00:00Z',
  sessions: [], customer_id: null, client_summary: null, contractor_id: null,
  total_project_price: null, materials_description: null, materials_cost: null,
  other_charges: null, additional_details: null, tech_ids: null, archived_at: null,
  ...over,
} as SiteVisit);

describe('daysUntil', () => {
  it('is negative for a date already past', () => {
    expect(daysUntil('2026-08-20', TODAY)).toBe(-5);
  });
  it('is positive for a future date, zero for today', () => {
    expect(daysUntil('2026-08-30', TODAY)).toBe(5);
    expect(daysUntil('2026-08-25', TODAY)).toBe(0);
  });
  it('handles a missing or malformed date', () => {
    expect(daysUntil(null, TODAY)).toBeNull();
    expect(daysUntil('not a date', TODAY)).toBeNull();
  });
});

describe('nothing to report', () => {
  it('says nothing when the business is clean', () => {
    expect(attentionItems(empty)).toEqual([]);
    expect(attentionSummary([])).toBeNull();
  });
});

describe('surveys', () => {
  it('flags a walked survey that was never quoted, with its value', () => {
    const items = attentionItems({ ...empty, surveys: [survey()] });
    const it0 = items.find((i) => i.kind === 'survey_unquoted')!;
    expect(it0.count).toBe(1);
    expect(it0.amount).toBe(680);           // 8 hrs x $85
    expect(it0.detail).toContain('$680');
  });

  it('ignores a survey that already produced a quote, or was lost', () => {
    const items = attentionItems({
      ...empty,
      surveys: [survey({ id: 'a', quote_id: 'q1' }), survey({ id: 'b', status: 'lost' })],
    });
    expect(items.find((i) => i.kind === 'survey_unquoted')).toBeUndefined();
  });

  it('flags positions with no price, because they block the quote', () => {
    const s = survey({
      cameras: [
        { id: 'c1', position: 1, location: 'Lobby', camera_type: 'Dome', variant: null,
          placement: 'Indoor', mount: 'Ceiling', cable_run: '25 ft', mount_height_ft: null,
          resolution: '4MP', status: 'New', unit_price: 0, origin_point: null,
          pathway_notes: null, materials_needed: null, notes: null, photos: [] },
      ],
    });
    const item = attentionItems({ ...empty, surveys: [s] }).find((i) => i.kind === 'survey_unpriced')!;
    expect(item.count).toBe(1);
    expect(item.severity).toBe('action');
  });
});

describe('quotes', () => {
  it('flags a quote that has been out more than two weeks', () => {
    const items = attentionItems({
      ...empty,
      quotes: [quote({ created_at: '2026-08-01T00:00:00Z', total: 2400 })],
    });
    const stale = items.find((i) => i.kind === 'quote_stale')!;
    expect(stale.amount).toBe(2400);
  });

  it('leaves a recent quote alone', () => {
    const items = attentionItems({
      ...empty,
      quotes: [quote({ created_at: '2026-08-20T00:00:00Z' })],
    });
    expect(items.find((i) => i.kind === 'quote_stale')).toBeUndefined();
  });

  it('flags an accepted quote that never became a job', () => {
    const items = attentionItems({
      ...empty,
      quotes: [quote({ status: 'accepted', work_order_id: null })],
    });
    expect(items.find((i) => i.kind === 'quote_unbuilt')!.count).toBe(1);
  });
});

describe('money owed and money not asked for', () => {
  it('says nothing about a job having no invoice in this app', () => {
    // Fred bills clients through QuickBooks and the NetView portal, never from
    // here — three invoices exist and all three are still drafts against $54k
    // of work. A warning read off this app's invoice table was permanently
    // true and permanently useless, so it is gone. What HE marks as billed on
    // a site visit is still reported; see 'the site log reaching the dashboard'.
    const items = attentionItems({
      ...empty,
      workOrders: [wo({ id: 'w1', wo_status: 'Approved', total_amount: 1840 })],
    });
    expect(items.some((i) => i.kind.includes('unbilled') && i.view === 'invoices')).toBe(false);
  });

  it('flags an overdue invoice for the unpaid balance only', () => {
    const items = attentionItems({
      ...empty,
      invoices: [invoice({ id: 'i1', total: 1000, due_date: '2026-08-01' })],
      invoicePayments: [{ id: 'p', invoice_id: 'i1', amount: 400 } as InvoicePayment],
    });
    expect(items.find((i) => i.kind === 'invoice_overdue')!.amount).toBe(600);
  });

  it('does not call a fully paid invoice overdue', () => {
    const items = attentionItems({
      ...empty,
      invoices: [invoice({ id: 'i1', total: 1000, due_date: '2026-08-01' })],
      invoicePayments: [{ id: 'p', invoice_id: 'i1', amount: 1000 } as InvoicePayment],
    });
    expect(items.find((i) => i.kind === 'invoice_overdue')).toBeUndefined();
  });

  it('totals what techs are still owed', () => {
    const items = attentionItems({
      ...empty,
      workOrders: [wo({ id: 'a', remaining: 300 }), wo({ id: 'b', remaining: 150 })],
    });
    const owed = items.find((i) => i.kind === 'tech_owed')!;
    expect(owed.amount).toBe(450);
    expect(owed.count).toBe(2);
  });
});

describe('assignments', () => {
  it('flags a job sent to a tech who has not answered', () => {
    const items = attentionItems({
      ...empty,
      workOrders: [wo({ contractor_name: 'Jere Jones', assignment_responses: null })],
    });
    expect(items.find((i) => i.kind === 'assignment_unanswered')!.count).toBe(1);
  });

  it('goes quiet once they answer', () => {
    const items = attentionItems({
      ...empty,
      workOrders: [wo({
        contractor_name: 'Jere Jones',
        assignment_responses: { 'Jere Jones': { status: 'accepted', at: '2026-08-20' } },
      })],
    });
    expect(items.find((i) => i.kind === 'assignment_unanswered')).toBeUndefined();
  });

  it('ignores an unassigned job — nobody is being waited on', () => {
    const items = attentionItems({ ...empty, workOrders: [wo({ contractor_name: '' })] });
    expect(items.find((i) => i.kind === 'assignment_unanswered')).toBeUndefined();
  });
});

describe('ordering and summary', () => {
  it('puts money above actions, and bigger money first', () => {
    const items = attentionItems({
      ...empty,
      surveys: [survey({ labor_hours: 100, labor_rate: 85 })],   // $8,500 unquoted
      quotes: [quote({ status: 'accepted', work_order_id: null })], // an action
      workOrders: [wo({ id: 'a', remaining: 300 })],              // $300 owed
    });
    expect(items[0].kind).toBe('survey_unquoted');
    expect(items[1].kind).toBe('tech_owed');
    expect(items[items.length - 1].severity).toBe('action');
  });

  it('sums the cash sitting still into one line', () => {
    // $200 owed to a tech, plus a $1,000 overdue invoice.
    const items = attentionItems({
      ...empty,
      workOrders: [wo({ id: 'a', remaining: 200 })],
      invoices: [invoice({ id: 'i1', total: 1000, due_date: '2026-08-01' })],
    });
    expect(attentionSummary(items)).toContain('$1,200');
  });
});

describe('the handoff back from the field', () => {
  it('flags a job a tech marked Work Done as waiting on you', () => {
    const items = attentionItems({
      ...empty,
      workOrders: [wo({ wo_status: 'Work Done', total_amount: 1138.25 })],
    });
    const item = items.find((i) => i.kind === 'work_awaiting_review')!;
    expect(item.count).toBe(1);
    expect(item.amount).toBe(1138.25);
    expect(item.detail).toContain('$1,138');
  });

  it('stops flagging it once it is closed and archived', () => {
    const items = attentionItems({
      ...empty,
      workOrders: [wo({ wo_status: 'Work Done', archived_at: '2026-08-30T00:00:00Z' })],
    });
    expect(items.find((i) => i.kind === 'work_awaiting_review')).toBeUndefined();
  });

  it('a job still in progress is not waiting on anyone', () => {
    const items = attentionItems({ ...empty, workOrders: [wo({ wo_status: 'In Progress' })] });
    expect(items.find((i) => i.kind === 'work_awaiting_review')).toBeUndefined();
  });
});

describe('the site log reaching the dashboard', () => {
  it('flags visits walked but never invoiced, with what they are worth', () => {
    const items = attentionItems({
      ...empty,
      siteVisits: [visit({ id: 'a' }), visit({ id: 'b', hours: 3 })],
    });
    const item = items.find((i) => i.kind === 'visit_unbilled')!;
    expect(item.count).toBe(2);
    expect(item.amount).toBe(275);          // 2h + 3h at $55
    expect(item.view).toBe('sitelog');
  });

  it('says how long the oldest has been sitting once it is over a month', () => {
    const items = attentionItems({
      ...empty,
      siteVisits: [visit({ visit_date: '2026-06-01' })],   // 85 days before TODAY
    });
    expect(items.find((i) => i.kind === 'visit_unbilled')!.detail).toContain('85 days');
  });

  it('leaves an invoiced visit alone', () => {
    const items = attentionItems({
      ...empty,
      siteVisits: [visit({ invoice_status: 'invoiced' })],
    });
    expect(items.find((i) => i.kind === 'visit_unbilled')).toBeUndefined();
  });

  it('ignores an archived visit', () => {
    const items = attentionItems({
      ...empty,
      siteVisits: [visit({ archived_at: '2026-08-21T00:00:00Z' })],
    });
    expect(items.find((i) => i.kind === 'visit_unbilled')).toBeUndefined();
  });

  it('flags a bare rate on a visit with hours, because it bills only once', () => {
    // Cherry Hill, 2026-06-01: rate "55" on a 2-hour visit bills $55, not $110.
    const items = attentionItems({ ...empty, siteVisits: [visit({ rate: '55' })] });
    const item = items.find((i) => i.kind === 'visit_rate_unclear')!;
    expect(item.count).toBe(1);
    expect(item.severity).toBe('action');
  });

  it('does not flag a rate that says what it means', () => {
    const items = attentionItems({
      ...empty,
      siteVisits: [visit({ rate: '$55/hr' }), visit({ id: 'x', rate: '$540 flat' })],
    });
    expect(items.find((i) => i.kind === 'visit_rate_unclear')).toBeUndefined();
  });

  it('does not flag a bare rate when a project price was typed', () => {
    // The typed price is the explicit decision; the rate text is then a note.
    const items = attentionItems({
      ...empty,
      siteVisits: [visit({ rate: '2600', total_project_price: 2600 })],
    });
    expect(items.find((i) => i.kind === 'visit_rate_unclear')).toBeUndefined();
  });

  it('says nothing about the site log when none was passed', () => {
    const items = attentionItems(empty);
    expect(items.find((i) => i.kind === 'visit_unbilled')).toBeUndefined();
    expect(items.find((i) => i.kind === 'visit_rate_unclear')).toBeUndefined();
  });
});

describe('a clock nobody stopped', () => {
  it('flags the visit and says what it would bill', () => {
    // The real Swedesboro visit: a stint from 31 July to 1 September.
    const items = attentionItems({
      ...empty,
      siteVisits: [visit({
        rate: '$55/hr', hours: 787.5,
        sessions: [{ in: '2026-07-31T10:30:00Z', out: '2026-09-01T12:00:00Z' }],
      })],
    });
    const item = items.find((i) => i.kind === 'visit_hours_wrong')!;
    expect(item.count).toBe(1);
    expect(item.detail).toContain('770 hours');
    expect(item.detail).toContain('$43,313');
    expect(item.severity).toBe('money');
  });

  it('says nothing about an ordinary long day', () => {
    const items = attentionItems({
      ...empty,
      siteVisits: [visit({
        sessions: [{ in: '2026-08-20T11:00:00Z', out: '2026-08-20T23:00:00Z' }],
      })],
    });
    expect(items.find((i) => i.kind === 'visit_hours_wrong')).toBeUndefined();
  });
});

describe('Waiting on you', () => {
  const base: AttentionInput = { surveys: [], quotes: [], contracts: [], workOrders: [], invoices: [], invoicePayments: [], today: TODAY };

  it('lists a job a tech turned down, and leaves out one that is closed', () => {
    const wo = (id: string, status: string) => ({
      id, wo_status: status, archived_at: null, contractor_name: 'Paul Gibbs', contractor_names: ['Paul Gibbs'],
      assignment_responses: { 'Paul Gibbs': { status: 'declined', at: '2026-08-24T12:00:00Z' } },
    }) as unknown as EnrichedWorkOrder;
    const items = attentionItems({ ...base, workOrders: [wo('a', 'Assigned'), wo('b', 'Paid')] });
    const d = items.find((i) => i.kind === 'assignment_declined');
    expect(d).toMatchObject({ count: 1, view: 'workorders', title: '1 job turned down' });
    expect(items.some((i) => i.kind === 'assignment_unanswered')).toBe(false);
  });

  it('adds unread messages, support tickets and imports, each opening its own screen', () => {
    const items = attentionItems({ ...base, waiting: { messages: 2, support: 1, imports: 0 } });
    expect(items.map((i) => [i.kind, i.view, i.title])).toEqual([
      ['messages_unread', 'messages', '2 unread tech messages'],
      ['support_waiting', 'support', '1 support ticket'],
    ]);
  });
});
