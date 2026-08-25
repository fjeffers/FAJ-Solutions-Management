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
  CableDrop, Quote, QuoteLineItem, Survey, SurveyCamera, SurveyDocument,
  SurveyDocumentKind, SurveyScopeItem, SurveyType,
} from './types';
import { scheduleKindFor } from './types';

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
  const kind = scheduleKindFor(s.survey_type ?? 'camera');
  const lines = [
    ...(kind === 'cameras' ? camerasToQuoteLines(s.cameras ?? []) : []),
    ...(kind === 'drops' ? dropsToQuoteLines(s.cable_drops ?? []) : []),
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

// ── Numbered schedules ──────────────────────────────────────────────────────
// Cameras and cable drops are both numbered lists whose numbering has to hold.
// The ordering lives here once and both schedules use it.

type Positioned = { id: string; position: number };

/**
 * Rewrite positions to 1..n in list order.
 *
 * Insert a head-end camera at the top and every camera below it shifts down —
 * that is what "renumbered, everything else shifted down" means, and it has to
 * happen on insert, delete and reorder alike or the schedule stops matching
 * the labels written on site.
 */
export function renumber<T extends Positioned>(items: T[]): T[] {
  return items.map((it, i) => (it.position === i + 1 ? it : { ...it, position: i + 1 }));
}

/** Move one row up or down, renumbering the whole list. */
export function movePositioned<T extends Positioned>(items: T[], id: string, dir: -1 | 1): T[] {
  const i = items.findIndex((it) => it.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= items.length) return items;
  const next = [...items];
  [next[i], next[j]] = [next[j], next[i]];
  return renumber(next);
}

export function removePositioned<T extends Positioned>(items: T[], id: string): T[] {
  return renumber(items.filter((it) => it.id !== id));
}

export const renumberCameras = renumber<SurveyCamera>;
export const moveCamera = movePositioned<SurveyCamera>;
export const removeCamera = removePositioned<SurveyCamera>;

export function addCamera(cameras: SurveyCamera[]): SurveyCamera[] {
  return renumber([...cameras, newCamera(cameras.length + 1)]);
}

// ── Cable drops (migration-069) ─────────────────────────────────────────────

export function newDrop(position: number): CableDrop {
  return {
    id: `drop-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    position,
    location: '',
    jack_count: 1,
    cable_type: 'Cat6',
    run_length: 'TBD',
    termination: '',
    mount: 'Wall plate',
    notes: null,
    photos: [],
  };
}

export const renumberDrops = renumber<CableDrop>;
export const moveDrop = movePositioned<CableDrop>;
export const removeDrop = removePositioned<CableDrop>;

export function addDrop(drops: CableDrop[]): CableDrop[] {
  return renumber([...drops, newDrop(drops.length + 1)]);
}

/** The counts a cabling job is materialled and priced from. */
export function dropCounts(drops: CableDrop[]): {
  total: number; jacks: number; runsUnknown: number; byCable: { type: string; jacks: number }[];
} {
  const byCable = new Map<string, number>();
  let jacks = 0;
  for (const d of drops) {
    const n = Number(d.jack_count) || 0;
    jacks += n;
    byCable.set(d.cable_type, (byCable.get(d.cable_type) ?? 0) + n);
  }
  return {
    total: drops.length,
    jacks,
    runsUnknown: drops.filter((d) => !d.run_length.trim() || /tbd/i.test(d.run_length)).length,
    byCable: [...byCable.entries()].map(([type, j]) => ({ type, jacks: j })).sort((a, b) => b.jacks - a.jacks),
  };
}

/** One drop, as the line a client reads on the quote. */
export function dropToQuoteLine(d: CableDrop, rate = 0): QuoteLineItem {
  const where = d.location.trim() || `Drop ${d.position}`;
  const jacks = Number(d.jack_count) || 0;
  const spec = [
    jacks > 0 ? `${jacks} jack${jacks !== 1 ? 's' : ''}` : '',
    d.cable_type && d.cable_type !== 'TBD' ? d.cable_type : '',
    d.mount ? d.mount.toLowerCase() : '',
  ].filter((b) => b && b.trim()).join(', ');

  const run = d.run_length.trim();
  const runPart = run && !/tbd/i.test(run) ? `${run} run` : '';
  const term = d.termination.trim() ? `terminates ${d.termination.trim()}` : '';

  const description = [`Drop ${d.position} — ${where}`, spec, runPart, term]
    .filter(Boolean).join(' · ');

  return { id: `drop-${d.id}`, description, quantity: jacks || 1, rate };
}

export function dropsToQuoteLines(drops: CableDrop[], ratePerJack = 0): QuoteLineItem[] {
  return [...drops].sort((a, b) => a.position - b.position).map((d) => dropToQuoteLine(d, ratePerJack));
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

// ── The wizard's pages (migration-069) ──────────────────────────────────────

export type SurveyPage = 1 | 2 | 3 | 4;

export const SURVEY_PAGES: { page: SurveyPage; title: string; blurb: string }[] = [
  { page: 1, title: 'Client & Site',  blurb: 'Who it is for and where' },
  { page: 2, title: 'Survey Details', blurb: 'What the job needs' },
  { page: 3, title: 'Placements',     blurb: 'Photos of the recommended spots' },
  { page: 4, title: 'Summary',        blurb: 'Findings, labour and pricing' },
];

/** Every schedule row that can carry placement photos, whatever the type. */
export type PlacementRow = {
  id: string;
  position: number;
  label: string;
  detail: string;
  photos: string[];
};

export function placementRows(s: Pick<Survey, 'survey_type' | 'cameras' | 'cable_drops'>): PlacementRow[] {
  const kind = scheduleKindFor(s.survey_type ?? 'camera');
  if (kind === 'cameras') {
    return [...(s.cameras ?? [])].sort((a, b) => a.position - b.position).map((c) => ({
      id: c.id,
      position: c.position,
      label: `Camera ${c.position}`,
      detail: [c.location, c.camera_type, c.mount ? `${c.mount.toLowerCase()} mount` : '']
        .filter((x) => x && x.trim()).join(' · '),
      photos: c.photos ?? [],
    }));
  }
  if (kind === 'drops') {
    return [...(s.cable_drops ?? [])].sort((a, b) => a.position - b.position).map((d) => ({
      id: d.id,
      position: d.position,
      label: `Drop ${d.position}`,
      detail: [d.location, d.cable_type, `${d.jack_count} jack${Number(d.jack_count) !== 1 ? 's' : ''}`]
        .filter((x) => x && String(x).trim()).join(' · '),
      photos: d.photos ?? [],
    }));
  }
  return [];
}

/**
 * What is still missing, per page. This is what turns "is the survey done?"
 * into a list instead of a memory test — and it gates Build Quote, so a quote
 * cannot be produced from a walk-through that never recorded the work.
 */
export function pageStatus(s: Survey): { page: SurveyPage; done: boolean; missing: string[] }[] {
  const kind = scheduleKindFor(s.survey_type ?? 'camera');
  const rows = placementRows(s);

  const p1: string[] = [];
  if (!(s.client_name ?? '').trim()) p1.push('client name');
  if (!(s.site_name ?? '').trim() && !(s.site_address ?? '').trim()) p1.push('site name or address');

  const p2: string[] = [];
  if (kind === 'cameras') {
    if ((s.cameras ?? []).length === 0) p2.push('at least one camera');
    else {
      const unnamed = (s.cameras ?? []).filter((c) => !c.location.trim()).length;
      if (unnamed > 0) p2.push(`${unnamed} camera location${unnamed !== 1 ? 's' : ''}`);
      const tbd = cameraCounts(s.cameras ?? []).runsUnknown;
      if (tbd > 0) p2.push(`${tbd} cable run${tbd !== 1 ? 's' : ''} still TBD`);
    }
  } else if (kind === 'drops') {
    if ((s.cable_drops ?? []).length === 0) p2.push('at least one drop');
    else {
      const unnamed = (s.cable_drops ?? []).filter((d) => !d.location.trim()).length;
      if (unnamed > 0) p2.push(`${unnamed} drop location${unnamed !== 1 ? 's' : ''}`);
      const tbd = dropCounts(s.cable_drops ?? []).runsUnknown;
      if (tbd > 0) p2.push(`${tbd} run length${tbd !== 1 ? 's' : ''} still TBD`);
    }
  } else if (!(s.findings ?? '').trim() && !(s.recommendations ?? '').trim()) {
    p2.push('findings or recommendations');
  }

  const p3: string[] = [];
  if (rows.length > 0) {
    const noPhoto = rows.filter((r) => r.photos.length === 0).length;
    if (noPhoto > 0) p3.push(`${noPhoto} of ${rows.length} without a photo`);
  }

  const p4: string[] = [];
  if (!(s.recommendations ?? '').trim()) p4.push('recommendations');
  if (surveyLabor(s) === 0 && (s.scope_items ?? []).every((i) => scopeLineTotal(i) === 0)) {
    p4.push('labour or a priced scope line');
  }

  return [
    { page: 1, done: p1.length === 0, missing: p1 },
    { page: 2, done: p2.length === 0, missing: p2 },
    { page: 3, done: p3.length === 0, missing: p3 },
    { page: 4, done: p4.length === 0, missing: p4 },
  ];
}

/**
 * Ready to quote? Pages 1, 2 and 4 must be clear. Page 3 is deliberately NOT
 * required — a missing placement photo is worth flagging, not worth blocking a
 * quote over.
 */
export function readyToQuote(s: Survey): boolean {
  return pageStatus(s).filter((p) => p.page !== 3).every((p) => p.done);
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
