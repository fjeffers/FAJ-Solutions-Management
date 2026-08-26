import { describe, it, expect } from 'vitest';
import {
  nextContractNumber, depositFromTerms, contractFromQuote,
  extractPaymentTerms, contractStage,
} from './contracts';
import type { Contract, Quote, Survey } from './types';

const quote = (over: Partial<Quote> = {}): Quote => ({
  id: 'q1', user_id: 'u1', quote_number: 'Q-2026-001',
  client_name: 'New Beginnings', client_email: 'n@example.com', client_phone: null,
  title: 'Camera system replacement', description: 'Replace the analog system.',
  line_items: [
    { id: 'cam-1', description: 'Camera 1 — Network room · Dome, ceiling mount · 25 ft cable', quantity: 1, rate: 245 },
    { id: 'cam-2', description: 'Camera 2 — Hallway · Dome, ceiling mount', quantity: 1, rate: 245 },
    { id: 'mat', description: 'Cat6 box', quantity: 2, rate: 180 },
  ],
  subtotal: 850, tax_rate: 0, tax_amount: 0, total: 850,
  status: 'accepted', valid_until: null,
  notes: 'Payment terms: 50% deposit, 50% on completion',
  sent_at: null, accepted_at: null, work_order_id: null,
  survey_id: 'sv-1', contract_id: null, customer_id: null, share_token: null,
  created_at: '2026-08-25T00:00:00Z', updated_at: '2026-08-25T00:00:00Z',
  ...over,
});

const survey = (over: Partial<Survey> = {}): Survey => ({
  id: 'sv-1', user_id: 'u1', survey_number: 'S-2026-001',
  customer_id: null, client_name: 'New Beginnings', client_email: null, client_phone: null,
  poc_name: null, poc_phone: null,
  site_name: 'New Beginnings Chester', site_address: '2600 W 9th St',
  site_city: 'Chester', site_state: 'PA', site_zip: '19013',
  title: null, survey_date: '2026-08-25', surveyed_by: 'Fred', status: 'quoted',
  existing_conditions: null, findings: null,
  recommendations: 'Replace all seven cameras with IP domes.', notes: null,
  scope_items: [], labor_rate: 85, labor_hours: 8, tax_rate: 0,
  payment_terms: '50% deposit, 50% on completion',
  photos: [], cameras: [], documents: [], cable_drops: [], custom_qa: [],
  survey_type: 'camera', last_page: 4,
  head_end_notes: null, rack_space: null, switch_notes: null, access_notes: null,
  quote_id: 'q1', work_order_id: null, share_token: null, archived_at: null,
  created_at: '2026-08-25T00:00:00Z', updated_at: '2026-08-25T00:00:00Z',
  ...over,
});

describe('contract numbering', () => {
  const now = new Date('2026-05-01T12:00:00Z');

  it('starts a fresh year at 001', () => {
    expect(nextContractNumber([], now)).toBe('C-2026-001');
  });

  it('continues the highest number in the current year', () => {
    expect(nextContractNumber(
      [{ contract_number: 'C-2026-004' }, { contract_number: 'C-2026-002' }], now,
    )).toBe('C-2026-005');
  });

  it('ignores other years and malformed numbers', () => {
    expect(nextContractNumber(
      [{ contract_number: 'C-2025-099' }, { contract_number: 'C-2026-x' }], now,
    )).toBe('C-2026-001');
  });
});

describe('deposit from payment terms', () => {
  it('reads a percentage', () => {
    expect(depositFromTerms('50% deposit, 50% on completion', 850)).toBe(425);
    expect(depositFromTerms('25% up front', 1000)).toBe(250);
  });

  it('reads a flat dollar amount', () => {
    expect(depositFromTerms('$500 deposit, balance on completion', 2000)).toBe(500);
    expect(depositFromTerms('$1,250 on signing', 5000)).toBe(1250);
  });

  it('rounds to the cent', () => {
    expect(depositFromTerms('33% deposit', 1000)).toBe(330);
  });

  it('returns nothing when terms name no deposit', () => {
    expect(depositFromTerms('Net 30', 850)).toBeNull();
    expect(depositFromTerms(null, 850)).toBeNull();
    expect(depositFromTerms('150% nonsense', 850)).toBeNull();
  });
});

describe('payment terms round-trip', () => {
  it('reads terms back out of the quote notes quoteFromSurvey wrote', () => {
    expect(extractPaymentTerms('Payment terms: 50% deposit, 50% on completion'))
      .toBe('50% deposit, 50% on completion');
  });

  it('takes only the first line when other notes follow', () => {
    expect(extractPaymentTerms('Payment terms: Net 30\n\nClient prefers mornings.'))
      .toBe('Net 30');
  });

  it('returns nothing when there are no terms', () => {
    expect(extractPaymentTerms('Just a note.')).toBeNull();
    expect(extractPaymentTerms(null)).toBeNull();
  });
});

describe('contract built from a quote', () => {
  const c = contractFromQuote(quote(), 'C-2026-001', survey());

  it('links back to the quote and the walk-through behind it', () => {
    expect(c.quote_id).toBe('q1');
    expect(c.survey_id).toBe('sv-1');
    expect(c.contract_number).toBe('C-2026-001');
  });

  it('carries the money across exactly, so the two can never disagree', () => {
    expect(c.total).toBe(850);
    expect(c.deposit_amount).toBe(425);
    expect(c.price_terms).toContain('$850.00');
    expect(c.price_terms).toContain('$425.00');
  });

  it('writes the scope from the quote lines the client agreed to', () => {
    expect(c.scope_of_work).toContain('Camera 1 — Network room');
    expect(c.scope_of_work).toContain('Cat6 box (qty 2)');
  });

  it('pulls the site address from the survey', () => {
    expect(c.site_name).toBe('New Beginnings Chester');
    expect(c.site_address).toBe('2600 W 9th St, Chester, PA, 19013');
  });

  it('starts as a draft with both signatories named', () => {
    expect(c.status).toBe('draft');
    expect(c.provider_signatory).toBe('FAJ Solutions LLC');
    expect(c.client_signatory).toBe('New Beginnings');
  });

  it('seeds the standard clauses', () => {
    expect(c.warranty).toContain('ninety (90) days');
    expect(c.governing_law).toContain('Pennsylvania');
    expect(c.change_orders).toContain('written approval');
  });

  it('works without a survey behind the quote', () => {
    const bare = contractFromQuote(quote({ survey_id: null }), 'C-1', null);
    expect(bare.site_name).toBeNull();
    expect(bare.total).toBe(850);
    expect(bare.scope_of_work).toContain('Camera 1');
  });

  it('omits the deposit sentence when terms name none', () => {
    const net30 = contractFromQuote(quote({ notes: 'Payment terms: Net 30' }), 'C-1', survey());
    expect(net30.deposit_amount).toBeNull();
    expect(net30.price_terms).not.toContain('Deposit');
  });
});

describe('contract stage', () => {
  const c = (over: Partial<Contract>) => ({ status: 'draft', signed_at: null, ...over } as Contract);

  it('walks draft → out → signed', () => {
    expect(contractStage(c({}))).toBe('draft');
    expect(contractStage(c({ status: 'sent' }))).toBe('out');
    expect(contractStage(c({ status: 'sent', signed_at: '2026-08-26T00:00:00Z' }))).toBe('signed');
  });

  it('a signed contract reads signed whatever the status says', () => {
    expect(contractStage(c({ status: 'draft', signed_at: '2026-08-26T00:00:00Z' }))).toBe('signed');
  });

  it('declined and void read as dead', () => {
    expect(contractStage(c({ status: 'declined' }))).toBe('dead');
    expect(contractStage(c({ status: 'void' }))).toBe('dead');
  });
});
