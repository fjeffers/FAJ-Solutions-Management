// Contracts (migration-070) — the last link in the chain.
//
// The contract used to live in Word and get hand-synced to the survey's
// numbers: change the labour estimate and someone had to remember to re-edit
// the document. A contract is now generated FROM the accepted quote, so it
// inherits the client, the scope and the money rather than restating them.
//
// The clause defaults below are a starting point written in plain language,
// not legal advice. Every field is editable per job, and the wording should be
// reviewed by a lawyer before it is relied on.
import type { Contract, Quote, Survey } from './types';

/** Next number in the C-<year>-NNN series, continuing the year already in use. */
export function nextContractNumber(contracts: Pick<Contract, 'contract_number'>[], now = new Date()): string {
  const year = now.getFullYear();
  const prefix = `C-${year}-`;
  const nums = contracts
    .filter((c) => c.contract_number?.startsWith(prefix))
    .map((c) => parseInt(c.contract_number.slice(prefix.length), 10))
    .filter((n) => !isNaN(n));
  return `${prefix}${String((nums.length > 0 ? Math.max(...nums) : 0) + 1).padStart(3, '0')}`;
}

/** A deposit read out of free-text payment terms: "50% deposit" → half. */
export function depositFromTerms(terms: string | null, total: number): number | null {
  if (!terms) return null;
  const pct = terms.match(/(\d{1,3})\s*%/);
  if (pct) {
    const n = Number(pct[1]);
    if (n > 0 && n <= 100) return Math.round(total * (n / 100) * 100) / 100;
  }
  const flat = terms.match(/\$\s*([\d,]+(?:\.\d{2})?)/);
  if (flat) {
    const n = Number(flat[1].replace(/,/g, ''));
    if (n > 0) return n;
  }
  return null;
}

export const DEFAULT_CLAUSES = {
  change_orders:
    'Any work outside the scope above is quoted separately and begins only after written approval. '
    + 'Conditions that could not be seen during the survey — concealed pathways, asbestos, structural '
    + 'obstructions — are treated as a change order.',
  warranty:
    'Workmanship is warranted for ninety (90) days from completion. Manufacturer warranties on supplied '
    + 'equipment pass through to the client and are not extended or altered by this agreement.',
  exclusions:
    'Excludes electrical work requiring a licensed electrician, permits, patching or painting, asbestos '
    + 'or hazardous-material handling, and any equipment not itemised above.',
  access_safety:
    'Client provides safe and timely access to all work areas during agreed hours, along with power and '
    + 'a secure location for materials. Delays caused by access being unavailable may be billed at the '
    + 'hourly rate above.',
  insurance:
    'FAJ Solutions LLC carries general liability insurance. A certificate is available on request.',
  termination:
    'Either party may terminate with written notice. The client pays for work completed and materials '
    + 'purchased up to the date of termination.',
  governing_law:
    'This agreement is governed by the laws of the Commonwealth of Pennsylvania.',
};

/**
 * Build a contract from an accepted quote, pulling site detail from the survey
 * behind it when there is one. Returned as a partial so the caller assigns the
 * number and does the insert — this stays pure and testable.
 */
export function contractFromQuote(
  quote: Quote,
  contractNumber: string,
  survey?: Survey | null,
): Partial<Contract> {
  const total = Number(quote.total) || 0;

  // The scope the client agreed to, line by line, so the contract and the
  // quote can never disagree about what was bought.
  const scope = (quote.line_items ?? [])
    .map((li) => `• ${li.description}${li.quantity > 1 ? ` (qty ${li.quantity})` : ''}`)
    .join('\n');

  const terms = extractPaymentTerms(quote.notes) ?? survey?.payment_terms ?? null;
  const deposit = depositFromTerms(terms, total);

  const site = survey
    ? [survey.site_address, [survey.site_city, survey.site_state].filter(Boolean).join(', '), survey.site_zip]
        .filter((p) => p && String(p).trim()).join(', ')
    : null;

  return {
    contract_number: contractNumber,
    quote_id: quote.id,
    survey_id: quote.survey_id ?? survey?.id ?? null,
    customer_id: quote.customer_id,
    client_name: quote.client_name,
    client_email: quote.client_email,
    site_name: survey?.site_name ?? null,
    site_address: site,
    title: quote.title ?? 'Service Agreement',
    status: 'draft',
    scope_of_work: scope || quote.description || null,
    deliverables: survey?.recommendations ?? null,
    schedule_terms:
      'Work is scheduled once this agreement is signed and any deposit is received. '
      + 'Dates are confirmed in writing and may shift with site access and material lead times.',
    price_terms: `Total: ${money(total)}.${deposit ? ` Deposit of ${money(deposit)} due on signing.` : ''}`,
    payment_terms: terms,
    change_orders: DEFAULT_CLAUSES.change_orders,
    warranty: DEFAULT_CLAUSES.warranty,
    exclusions: DEFAULT_CLAUSES.exclusions,
    access_safety: DEFAULT_CLAUSES.access_safety,
    insurance: DEFAULT_CLAUSES.insurance,
    termination: DEFAULT_CLAUSES.termination,
    governing_law: DEFAULT_CLAUSES.governing_law,
    total,
    deposit_amount: deposit,
    provider_signatory: 'FAJ Solutions LLC',
    client_signatory: quote.client_name,
  };
}

/** quoteFromSurvey writes "Payment terms: …" into the notes; read it back out. */
export function extractPaymentTerms(notes: string | null): string | null {
  if (!notes) return null;
  const m = notes.match(/Payment terms:\s*(.+)/i);
  return m ? m[1].split('\n')[0].trim() : null;
}

function money(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

/** Where a contract stands, for the badge on its card. */
export function contractStage(c: Pick<Contract, 'status' | 'signed_at'>): 'draft' | 'out' | 'signed' | 'dead' {
  if (c.signed_at) return 'signed';
  if (c.status === 'declined' || c.status === 'void') return 'dead';
  if (c.status === 'sent') return 'out';
  return 'draft';
}
