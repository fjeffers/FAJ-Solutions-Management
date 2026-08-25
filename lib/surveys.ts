// Survey → quote hand-off (migration-066).
//
// A survey is the walk-through: what's on site, what's wrong, what FAJ
// proposes, and what each piece costs. Its scope lines are deliberately the
// same shape as quote lines, so producing the quote is a copy — the whole
// point of the tab is that nothing gets re-typed between the site visit and
// the number the client sees.
//
// All money math lives here and is unit-tested. Views call it; they never
// re-derive a total inline.
import type { Quote, QuoteLineItem, Survey, SurveyScopeItem } from './types';

/** Next number in the S-<year>-NNN series, continuing the year already in use. */
export function nextSurveyNumber(surveys: Pick<Survey, 'survey_number'>[], now = new Date()): string {
  const year = now.getFullYear();
  const prefix = `S-${year}-`;
  const nums = surveys
    .filter((s) => s.survey_number?.startsWith(prefix))
    .map((s) => parseInt(s.survey_number.slice(prefix.length), 10))
    .filter((n) => !isNaN(n));
  const next = (nums.length > 0 ? Math.max(...nums) : 0) + 1;
  return `${prefix}${String(next).padStart(3, '0')}`;
}

export function newScopeItem(): SurveyScopeItem {
  return {
    id: `sc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    description: '', quantity: 1, unit: null, rate: 0, notes: null,
  };
}

/** One scope line's money: qty x rate. */
export function scopeLineTotal(item: Pick<SurveyScopeItem, 'quantity' | 'rate'>): number {
  return (Number(item.quantity) || 0) * (Number(item.rate) || 0);
}

/** Labour captured on the walk-through: hours x rate. Either missing = zero. */
export function surveyLabor(s: Pick<Survey, 'labor_hours' | 'labor_rate'>): number {
  return (Number(s.labor_hours) || 0) * (Number(s.labor_rate) || 0);
}

/**
 * What the survey says the job is worth.
 *
 * Labour is a line of its own so a survey can price hourly work (the $85/hr
 * kind) alongside fixed scope lines without double-counting either.
 */
export function surveyTotals(s: Pick<Survey, 'scope_items' | 'labor_hours' | 'labor_rate' | 'tax_rate'>): {
  scope: number; labor: number; subtotal: number; tax: number; total: number;
} {
  const scope = (s.scope_items ?? []).reduce((sum, i) => sum + scopeLineTotal(i), 0);
  const labor = surveyLabor(s);
  const subtotal = scope + labor;
  const tax = subtotal * ((Number(s.tax_rate) || 0) / 100);
  return { scope, labor, subtotal, tax, total: subtotal + tax };
}

/**
 * Fold a scope line into a quote line. `unit` and `notes` are survey-only, so
 * they get written into the description — the client should see "7 ea —
 * Dome camera, interior (existing conduit reusable)", not lose that detail.
 */
export function scopeItemToQuoteLine(item: SurveyScopeItem): QuoteLineItem {
  const unit = (item.unit ?? '').trim();
  const notes = (item.notes ?? '').trim();
  const desc = [item.description.trim(), notes ? `(${notes})` : ''].filter(Boolean).join(' ');
  return {
    id: `sv-${item.id}`,
    description: unit ? `${desc} [${unit}]` : desc,
    quantity: Number(item.quantity) || 0,
    rate: Number(item.rate) || 0,
  };
}

/**
 * Every quote field a survey can fill in. Returned as a partial so the caller
 * decides the quote_number and does the insert — this stays pure and testable.
 *
 * Labour becomes its own line rather than a lump in the subtotal, so the
 * client sees the hours and the rate they agreed to.
 */
export function quoteFromSurvey(s: Survey, quoteNumber: string): Partial<Quote> {
  const lines = (s.scope_items ?? []).map(scopeItemToQuoteLine);
  const labor = surveyLabor(s);
  if (labor > 0) {
    lines.push({
      id: `sv-labor-${s.id}`,
      description: `Labor — ${s.labor_hours} hr${Number(s.labor_hours) === 1 ? '' : 's'} @ ${formatRate(s.labor_rate)}/hr`,
      quantity: Number(s.labor_hours) || 0,
      rate: Number(s.labor_rate) || 0,
    });
  }

  const t = surveyTotals(s);
  const site = [s.site_name, s.site_address, [s.site_city, s.site_state].filter(Boolean).join(', '), s.site_zip]
    .filter((p) => p && String(p).trim()).join(' · ');

  return {
    quote_number: quoteNumber,
    survey_id: s.id,
    customer_id: s.customer_id,
    client_name: s.client_name,
    client_email: s.client_email,
    client_phone: s.client_phone,
    title: s.title ?? (s.site_name ? `${s.site_name} — Proposed Work` : null),
    description: [s.recommendations, site ? `Site: ${site}` : ''].filter((p) => p && p.trim()).join('\n\n') || null,
    line_items: lines,
    subtotal: t.subtotal,
    tax_rate: Number(s.tax_rate) || 0,
    tax_amount: t.tax,
    total: t.total,
    status: 'draft',
    notes: [s.payment_terms ? `Payment terms: ${s.payment_terms}` : '', s.notes ?? '']
      .filter((p) => p && p.trim()).join('\n\n') || null,
  };
}

function formatRate(n: number | null): string {
  const v = Number(n) || 0;
  return `$${v.toFixed(2).replace(/\.00$/, '')}`;
}

/** Where a survey stands in the chain, for the pipeline badge on each card. */
export function surveyStage(s: Pick<Survey, 'status' | 'quote_id' | 'work_order_id'>):
  'survey' | 'quoted' | 'job' | 'lost' {
  if (s.status === 'lost') return 'lost';
  if (s.work_order_id) return 'job';
  if (s.quote_id) return 'quoted';
  return 'survey';
}
