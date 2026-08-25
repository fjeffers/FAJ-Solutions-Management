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
import type {
  Quote, QuoteLineItem, Survey, SurveyCamera, SurveyDocument,
  SurveyDocumentKind, SurveyScopeItem,
} from './types';

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
  // Cameras lead: the schedule is what the client is actually buying, and each
  // line names the position, the area, how it mounts and its cable run.
  // Priced at zero so the rate is filled in on the quote rather than guessed
  // here — the survey records what goes where, not what it sells for.
  const lines = [
    ...camerasToQuoteLines(s.cameras ?? []),
    ...(s.scope_items ?? []).map(scopeItemToQuoteLine),
  ];
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
    description: [
      s.recommendations,
      site ? `Site: ${site}` : '',
      s.head_end_notes ? `Head-end: ${s.head_end_notes}` : '',
    ].filter((p) => p && p.trim()).join('\n\n') || null,
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

// ── Camera schedule (migration-068) ─────────────────────────────────────────

export function newCamera(position: number): SurveyCamera {
  return {
    id: `cam-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    position,
    location: '',
    camera_type: 'Dome',
    variant: null,
    placement: 'Indoor',
    mount: 'Ceiling',
    cable_run: 'TBD',
    mount_height_ft: null,
    resolution: 'TBD',
    status: 'New',
    notes: null,
    photos: [],
  };
}

/**
 * Rewrite positions to 1..n in list order.
 *
 * Insert a head-end camera at the top and every camera below it shifts down —
 * that is what "renumbered, everything else shifted down" means, and it has to
 * happen on insert, delete and reorder alike or the schedule stops matching
 * the labels written on site.
 */
export function renumberCameras(cameras: SurveyCamera[]): SurveyCamera[] {
  return cameras.map((c, i) => (c.position === i + 1 ? c : { ...c, position: i + 1 }));
}

/** Move a camera one slot up or down, renumbering the whole list. */
export function moveCamera(cameras: SurveyCamera[], id: string, dir: -1 | 1): SurveyCamera[] {
  const i = cameras.findIndex((c) => c.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= cameras.length) return cameras;
  const next = [...cameras];
  [next[i], next[j]] = [next[j], next[i]];
  return renumberCameras(next);
}

export function addCamera(cameras: SurveyCamera[]): SurveyCamera[] {
  return renumberCameras([...cameras, newCamera(cameras.length + 1)]);
}

export function removeCamera(cameras: SurveyCamera[], id: string): SurveyCamera[] {
  return renumberCameras(cameras.filter((c) => c.id !== id));
}

/**
 * The counts the rest of the job is sized from. A camera count that disagrees
 * with the scope lines is exactly the "7 or 8 cameras?" problem, so the UI
 * shows this rather than making anyone re-count the table.
 */
export function cameraCounts(cameras: SurveyCamera[]): {
  total: number; indoor: number; outdoor: number;
  newCams: number; existing: number; replace: number;
  /** Cameras needing a PoE port — everything not left in place as-is. */
  poePorts: number;
  runsUnknown: number;
} {
  const total = cameras.length;
  const indoor = cameras.filter((c) => c.placement === 'Indoor').length;
  const newCams = cameras.filter((c) => c.status === 'New').length;
  const existing = cameras.filter((c) => c.status === 'Existing').length;
  const replace = cameras.filter((c) => c.status === 'Replace').length;
  return {
    total, indoor, outdoor: total - indoor,
    newCams, existing, replace,
    poePorts: newCams + replace,
    runsUnknown: cameras.filter((c) => !c.cable_run.trim() || /tbd/i.test(c.cable_run)).length,
  };
}

/**
 * One schedule row, written the way the job gets described out loud:
 *
 *   "Camera 1 — Network room · Dome, ceiling mount · 25 ft cable"
 *   "Camera 2 — Inside office hallway · Dome, ceiling mount, tinted cover · 30 ft cable"
 *
 * A cable run still marked TBD is simply left off rather than printed as "TBD
 * cable" on a document a client reads.
 */
export function cameraToQuoteLine(c: SurveyCamera, rate = 0): QuoteLineItem {
  const where = c.location.trim() || `Camera ${c.position}`;

  const spec = [
    c.camera_type,
    c.mount ? `${c.mount.toLowerCase()} mount` : '',
    (c.variant ?? '').trim().toLowerCase(),
    c.resolution && c.resolution !== 'TBD' ? c.resolution : '',
    c.placement === 'Outdoor' ? 'outdoor' : '',
  ].filter((b) => b && b.trim()).join(', ');

  const run = c.cable_run.trim();
  const runPart = run && !/tbd/i.test(run) ? `${run} cable` : '';

  const description = [`Camera ${c.position} — ${where}`, spec, runPart]
    .filter(Boolean).join(' · ');

  return { id: `cam-${c.id}`, description, quantity: 1, rate };
}

/** Every camera as a quote line, in schedule order. */
export function camerasToQuoteLines(cameras: SurveyCamera[], ratePerCamera = 0): QuoteLineItem[] {
  return [...cameras]
    .sort((a, b) => a.position - b.position)
    .map((c) => cameraToQuoteLine(c, ratePerCamera));
}

// ── Documentation (migration-068) ───────────────────────────────────────────

/** Guess the kind from the file so the surveyor rarely has to set it. */
export function documentKindFor(fileName: string, mimeType: string): SurveyDocumentKind {
  if (mimeType.startsWith('image/')) return 'photo';
  const n = fileName.toLowerCase();
  if (/(floor)?plan|blueprint|layout|drawing|dwg/.test(n)) return 'plan';
  if (/spec|datasheet|cut ?sheet|submittal/.test(n)) return 'spec';
  if (/quote|proposal|estimate|invoice/.test(n)) return 'quote';
  return 'other';
}

export function isImageDocument(d: Pick<SurveyDocument, 'kind' | 'url'>): boolean {
  return d.kind === 'photo' || /\.(png|jpe?g|gif|webp|avif)$/i.test(d.url);
}

/** "2.4 MB" — a size a person can read. */
export function formatFileSize(bytes: number | null): string {
  if (bytes == null || !isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
