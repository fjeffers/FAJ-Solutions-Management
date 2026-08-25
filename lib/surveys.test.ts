import { describe, it, expect } from 'vitest';
import {
  nextSurveyNumber, scopeLineTotal, surveyLabor, surveyTotals,
  scopeItemToQuoteLine, quoteFromSurvey, surveyStage,
} from './surveys';
import type { Survey, SurveyScopeItem } from './types';

const scope = (over: Partial<SurveyScopeItem> = {}): SurveyScopeItem =>
  ({ id: 'sc1', description: 'Dome camera', quantity: 1, unit: null, rate: 0, notes: null, ...over });

const survey = (over: Partial<Survey> = {}): Survey => ({
  id: 'sv-1', user_id: 'u1', survey_number: 'S-2026-001',
  customer_id: null, client_name: 'New Beginnings', client_email: 'n@example.com', client_phone: null,
  poc_name: null, poc_phone: null,
  site_name: 'Chester', site_address: '100 Main St', site_city: 'Chester', site_state: 'PA', site_zip: '19013',
  title: null, survey_date: '2026-08-20', surveyed_by: 'Fred', status: 'draft',
  existing_conditions: null, findings: null, recommendations: null, notes: null,
  scope_items: [], labor_rate: null, labor_hours: null, tax_rate: 0, payment_terms: null,
  photos: [], quote_id: null, work_order_id: null, share_token: null, archived_at: null,
  created_at: '2026-08-20T00:00:00Z', updated_at: '2026-08-20T00:00:00Z',
  ...over,
});

describe('survey numbering', () => {
  const now = new Date('2026-05-01T12:00:00Z');

  it('starts a fresh year at 001', () => {
    expect(nextSurveyNumber([], now)).toBe('S-2026-001');
  });

  it('continues the highest number in the current year', () => {
    const existing = [{ survey_number: 'S-2026-001' }, { survey_number: 'S-2026-007' }, { survey_number: 'S-2026-003' }];
    expect(nextSurveyNumber(existing, now)).toBe('S-2026-008');
  });

  it('ignores other years and malformed numbers', () => {
    const existing = [{ survey_number: 'S-2025-042' }, { survey_number: 'S-2026-oops' }, { survey_number: '' }];
    expect(nextSurveyNumber(existing, now)).toBe('S-2026-001');
  });
});

describe('survey money', () => {
  it('prices a scope line as qty x rate', () => {
    expect(scopeLineTotal(scope({ quantity: 7, rate: 245 }))).toBe(1715);
  });

  it('treats missing numbers as zero rather than NaN', () => {
    expect(scopeLineTotal({ quantity: NaN, rate: 100 })).toBe(0);
    expect(surveyLabor({ labor_hours: null, labor_rate: 85 })).toBe(0);
  });

  it('prices labour as hours x rate', () => {
    expect(surveyLabor({ labor_hours: 16, labor_rate: 85 })).toBe(1360);
  });

  it('totals scope + labour and applies tax to the subtotal', () => {
    const s = survey({
      scope_items: [scope({ quantity: 7, rate: 245 }), scope({ id: 'sc2', quantity: 1, rate: 300 })],
      labor_hours: 16, labor_rate: 85, tax_rate: 6,
    });
    const t = surveyTotals(s);
    expect(t.scope).toBe(1715 + 300);
    expect(t.labor).toBe(1360);
    expect(t.subtotal).toBe(3375);
    expect(t.tax).toBeCloseTo(202.5, 2);
    expect(t.total).toBeCloseTo(3577.5, 2);
  });

  it('a survey with nothing on it is worth nothing, not NaN', () => {
    const t = surveyTotals(survey());
    expect(t.subtotal).toBe(0);
    expect(t.total).toBe(0);
  });
});

describe('scope line → quote line', () => {
  it('carries qty and rate straight across', () => {
    const line = scopeItemToQuoteLine(scope({ quantity: 7, rate: 245 }));
    expect(line.quantity).toBe(7);
    expect(line.rate).toBe(245);
  });

  it('folds unit and notes into the description so nothing is lost', () => {
    const line = scopeItemToQuoteLine(scope({ description: 'Dome camera', unit: 'ea', notes: 'existing conduit reusable' }));
    expect(line.description).toBe('Dome camera (existing conduit reusable) [ea]');
  });

  it('leaves a plain line plain', () => {
    expect(scopeItemToQuoteLine(scope({ description: 'Dome camera' })).description).toBe('Dome camera');
  });
});

describe('quote built from a survey', () => {
  const s = survey({
    scope_items: [scope({ description: 'Dome camera', quantity: 7, rate: 245, unit: 'ea' })],
    labor_hours: 16, labor_rate: 85, tax_rate: 0,
    recommendations: 'Replace all seven cameras.',
    payment_terms: '50% deposit, 50% on completion',
  });

  it('links back to the survey it came from', () => {
    expect(quoteFromSurvey(s, 'Q-2026-014').survey_id).toBe('sv-1');
    expect(quoteFromSurvey(s, 'Q-2026-014').quote_number).toBe('Q-2026-014');
  });

  it('adds labour as its own visible line', () => {
    const lines = quoteFromSurvey(s, 'Q-1').line_items!;
    expect(lines).toHaveLength(2);
    expect(lines[1].description).toBe('Labor — 16 hrs @ $85/hr');
    expect(lines[1].quantity).toBe(16);
    expect(lines[1].rate).toBe(85);
  });

  it('omits the labour line when no labour was priced', () => {
    const lines = quoteFromSurvey(survey({ scope_items: [scope({ quantity: 1, rate: 10 })] }), 'Q-1').line_items!;
    expect(lines).toHaveLength(1);
  });

  it('quote total matches the survey total', () => {
    const q = quoteFromSurvey(s, 'Q-1');
    expect(q.total).toBe(surveyTotals(s).total);
    expect(q.total).toBe(1715 + 1360);
  });

  it('starts as a draft and carries the payment terms into the notes', () => {
    const q = quoteFromSurvey(s, 'Q-1');
    expect(q.status).toBe('draft');
    expect(q.notes).toContain('50% deposit, 50% on completion');
  });

  it('carries the client and site through', () => {
    const q = quoteFromSurvey(s, 'Q-1');
    expect(q.client_name).toBe('New Beginnings');
    expect(q.description).toContain('Chester, PA');
  });
});

describe('pipeline stage', () => {
  it('walks survey → quoted → job', () => {
    expect(surveyStage({ status: 'draft', quote_id: null, work_order_id: null })).toBe('survey');
    expect(surveyStage({ status: 'quoted', quote_id: 'q1', work_order_id: null })).toBe('quoted');
    expect(surveyStage({ status: 'won', quote_id: 'q1', work_order_id: 'w1' })).toBe('job');
  });

  it('a lost survey reads lost no matter what it produced', () => {
    expect(surveyStage({ status: 'lost', quote_id: 'q1', work_order_id: null })).toBe('lost');
  });
});
