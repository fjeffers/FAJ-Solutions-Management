// Site Log → Invoice bridge: turn one visit into an invoice line item.
// The visit's rate is free text ("$55/hr", "2600", "$250 flat rate"), so we
// parse: hourly rates bill hours x rate, anything else numeric bills flat,
// unparseable leaves rate 0 for the user to price in the invoice editor.
import type { SiteVisit, MileageLog, MaterialUsed } from './types';

export type VisitLine = { description: string; quantity: number; rate: number };

/**
 * Site visit minimum. A visit shorter than this counts as this many hours —
 * the truck roll costs the same whether the job took 20 minutes or two.
 *
 * This is applied when hours are SAVED, not only when they are billed, so the
 * Site Log shows the two hours that will actually go on the invoice rather
 * than the twenty minutes the timer caught. The real clock time is not lost:
 * time_in, time_out and the sessions array still hold every stint exactly as
 * it happened, and the card shows it alongside.
 */
export const MINIMUM_BILLABLE_HOURS = 2;

/**
 * The hours to record for a visit: time on site, lifted to the minimum.
 *
 * Null means nobody has logged time yet — there is nothing to round up, and
 * inventing hours for a visit that has not happened would be worse than
 * leaving it blank. Zero is a deliberate no-charge visit (a revisit under
 * warranty), so it stays zero rather than becoming two billable hours.
 */
export function billableHours(hours: number | null | undefined): number | null {
  if (hours == null) return null;
  const h = Number(hours);
  if (!isFinite(h) || h <= 0) return h;
  return h < MINIMUM_BILLABLE_HOURS ? MINIMUM_BILLABLE_HOURS : h;
}

/**
 * What the Hours field should read, given the stints on a visit.
 *
 * Most jobs run across several days and several stints, so the stints are the
 * authority: hours is their sum, lifted to the minimum. Null when nothing has
 * been clocked yet, in which case a hand-typed figure is all there is.
 */
export function expectedHours(
  sessions: Array<{ in: string; out: string | null }> | null | undefined,
): number | null {
  return billableHours(actualHours(sessions));
}

/**
 * True when the stored hours disagree with the clocked stints.
 *
 * This is the check that would have caught Kellogg 5800 reading 94.79 hours
 * for 6.73 hours of work. A tenth of an hour of slack absorbs rounding.
 */
export function hoursDisagree(
  hours: number | null | undefined,
  sessions: Array<{ in: string; out: string | null }> | null | undefined,
): boolean {
  const expected = expectedHours(sessions);
  if (expected == null || hours == null) return false;
  return Math.abs(Number(hours) - expected) > 0.1;
}

/**
 * Push a typed Hours figure back onto the times, so the two always agree.
 *
 * Times and hours are the same fact written twice. Editing the times already
 * totals them into Hours; this is the other direction — type 8 hours and the
 * last stint's finish moves so the stints really do add up to 8.
 *
 * The LAST stint absorbs the change: on a multi-day job the earlier days
 * already happened, so the only end that can honestly move is the current one.
 * Returns null when there is nothing sensible to reshape — no stint started
 * yet, or the earlier days already exceed the figure typed.
 */
export function applyHoursToSessions(
  sessions: Array<{ in: string; out: string | null }> | null | undefined,
  hours: number | null | undefined,
): Array<{ in: string; out: string | null }> | null {
  if (hours == null || !isFinite(Number(hours)) || Number(hours) <= 0) return null;

  const started = (sessions ?? []).filter((s) => s.in);
  if (started.length === 0) return null;

  const earlier = started.slice(0, -1);
  const last = started[started.length - 1];

  const earlierHours = earlier.reduce((sum, s) => {
    if (!s.out) return sum;
    const ms = new Date(s.out).getTime() - new Date(s.in).getTime();
    return ms > 0 ? sum + ms / 3600000 : sum;
  }, 0);

  const remaining = Number(hours) - earlierHours;
  // The earlier days already account for more than this. Refuse rather than
  // inventing a finish time before the start.
  if (remaining <= 0) return null;

  const out = new Date(new Date(last.in).getTime() + remaining * 3600000).toISOString();
  return [...earlier, { in: last.in, out }];
}

/** Actual time on site from the recorded stints, ignoring the minimum. */
export function actualHours(
  sessions: Array<{ in: string; out: string | null }> | null | undefined,
): number | null {
  if (!sessions || sessions.length === 0) return null;
  const total = sessions.reduce((sum, s) => {
    if (!s.in || !s.out) return sum;
    const ms = new Date(s.out).getTime() - new Date(s.in).getTime();
    return ms > 0 ? sum + ms / 3600000 : sum;
  }, 0);
  return total > 0 ? Math.round(total * 100) / 100 : null;
}

/** An hourly rate in the free-text rate field: "$55/hr", "55 / h". */
const HOURLY_RATE_RE = /\$?\s*(\d+(?:\.\d+)?)\s*\/\s*h/i;

/**
 * The rate field is free text carrying two different meanings, and the
 * difference is money: "$55/hr" on a two-hour visit bills $110, while a bare
 * "55" bills $55 for the whole job. These three keep the entry form explicit
 * so the unit is always chosen rather than guessed from the text.
 */
export type RateUnit = 'hr' | 'flat';

/** The number out of a rate, whatever notation it was written in. */
export function rateAmount(rate: string | null | undefined): string {
  const m = (rate ?? '').match(/(\d+(?:\.\d+)?)/);
  return m ? m[1] : '';
}

/** Whether a stored rate reads as hourly. Anything else is treated as flat. */
export function rateUnit(rate: string | null | undefined): RateUnit {
  return HOURLY_RATE_RE.test((rate ?? '').trim()) ? 'hr' : 'flat';
}

/** Compose the canonical text the parser expects. Blank amount clears it. */
export function buildRate(amount: string | number | null | undefined, unit: RateUnit): string | null {
  const n = String(amount ?? '').trim();
  if (n === '') return null;
  return unit === 'hr' ? `$${n}/hr` : `$${n} flat`;
}

/**
 * How a visit is priced, as one answer rather than two competing fields.
 *
 * A flat price used to be settable in two places — the rate text and
 * total_project_price — and the second silently outranked the first. Pricing
 * a job meant knowing which box won. These two collapse it: read gives the
 * single current answer, write sets the pair so they can never disagree.
 */
export interface Pricing {
  amount: string;
  unit: RateUnit;
}

export function readPricing(
  v: Pick<SiteVisit, 'rate' | 'total_project_price'>,
): Pricing {
  // A typed project price is the explicit decision, so it wins on read too.
  if (v.total_project_price != null && !isNaN(Number(v.total_project_price))) {
    return { amount: String(v.total_project_price), unit: 'flat' };
  }
  const amount = rateAmount(v.rate);
  // Nothing priced yet — most jobs are T&M by the hour, so open on that
  // rather than making the common case the one you have to change.
  if (amount === '') return { amount: '', unit: 'hr' };
  return { amount, unit: rateUnit(v.rate) };
}

export function writePricing(
  amount: string | number | null | undefined,
  unit: RateUnit,
): Pick<SiteVisit, 'rate' | 'total_project_price'> {
  const n = String(amount ?? '').trim();
  // Clearing the amount clears both, so no stale price is left behind.
  if (n === '') return { rate: null, total_project_price: null };
  if (unit === 'hr') return { rate: `$${n}/hr`, total_project_price: null };
  // Flat lives in the numeric column — any custom amount, including zero for
  // a no-charge revisit.
  return { rate: null, total_project_price: Number(n) };
}

/**
 * True when the minimum is actually lifting what this visit bills.
 *
 * Only hourly visits qualify: a flat rate or a typed project price ignores
 * hours entirely, so the minimum cannot change what they bill.
 */
export function billsAtMinimum(
  v: Pick<SiteVisit, 'hours' | 'rate' | 'total_project_price'>,
): boolean {
  if (v.hours == null) return false;
  const billed = billableHours(v.hours);
  if (billed == null || billed <= Number(v.hours)) return false;
  if (v.total_project_price != null && !isNaN(Number(v.total_project_price))) return false;
  return HOURLY_RATE_RE.test((v.rate ?? '').trim());
}

/**
 * What a visit is worth.
 *
 * Mirrors the Line Total of the Invoice Tracker's Master Entry sheet,
 * `=SUM(I,L,N,O)`: labor + mileage + materials + other charges. The two are
 * meant to agree cell for cell, so a change here needs the same change there.
 */
export function visitAmount(
  v: Pick<SiteVisit, 'visit_date' | 'site_name' | 'site_code' | 'visit_type' | 'hours' | 'rate' | 'travel_charge' | 'total_project_price'>
    & Partial<Pick<SiteVisit, 'materials_cost' | 'other_charges'>>,
): number {
  const li = visitLineItem(v);
  const labor = li.quantity * li.rate;
  const extras = (v.travel_charge ?? 0) + (v.materials_cost ?? 0) + (v.other_charges ?? 0);
  return Math.round((labor + extras) * 100) / 100;
}

export function visitLineItem(
  v: Pick<SiteVisit, 'visit_date' | 'site_name' | 'site_code' | 'visit_type' | 'hours' | 'rate' | 'total_project_price'>,
): VisitLine {
  const date = v.visit_date
    ? new Date(v.visit_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })
    : null;
  const site = [v.site_name, v.site_code ? `#${v.site_code}` : null].filter(Boolean).join(' ') || null;
  const base = [date, site, v.visit_type].filter(Boolean).join(' — ');

  // A typed project price is an explicit decision and outranks the free-text
  // rate, which is a note to self as often as it is a number ("2600", "$55/hr",
  // "$250 flat rate"). Zero is a real answer — a no-charge revisit — so only
  // null/undefined falls through to parsing.
  const price = v.total_project_price;
  if (price != null && !isNaN(Number(price))) {
    return { description: `${base} — project price`, quantity: 1, rate: Number(price) };
  }

  const rateText = (v.rate ?? '').trim();
  const hourly = rateText.match(HOURLY_RATE_RE);
  if (hourly) {
    const rate   = Number(hourly[1]);
    const logged = v.hours ?? null;
    const qty    = billableHours(logged) ?? 1;
    // Say so on the line item. A client who sees "2h" against a 45-minute
    // visit asks questions; one who sees the minimum spelled out does not.
    const desc = logged != null && qty > logged
      ? `${base} — ${logged}h on site, ${qty}h minimum @ $${rate}/hr`
      : `${base} — ${qty}h @ $${rate}/hr`;
    return { description: desc, quantity: qty, rate };
  }
  const flat = rateText.match(/\$?\s*(\d+(?:\.\d+)?)/);
  if (flat) {
    return { description: `${base} — flat rate`, quantity: 1, rate: Number(flat[1]) };
  }
  // Unpriced: carry the billable hours so the minimum is already applied when
  // a rate gets typed into the invoice editor.
  return {
    description: `${base}${v.hours ? ` — ${v.hours}h` : ''} — set rate`,
    quantity: billableHours(v.hours) ?? 1,
    rate: 0,
  };
}

/**
 * Best-effort site label for a visit created from an import.
 *
 * Import titles come in two shapes. NetView sheet rows are already just the
 * location — "EDGEWATER II", "Mt. Laurel", "WOODBURY HTS". Email-parsed jobs
 * arrive as a slash-delimited path where the location is last:
 * "Wendy's / Site ID 5519 / NJ & Philly / Project / PERTH AMBOY".
 *
 * Casing is preserved rather than prettified — the source is what the client
 * calls the site, and re-casing "EDGEWATER II" mangles the numeral.
 */
export function deriveSiteName(
  title: string | null | undefined,
  fallback?: string | null,
): string | null {
  const raw = (title ?? '').trim();
  if (raw) {
    const parts = raw.split('/').map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts.at(-1)!;
  }
  return (fallback ?? '').trim() || null;
}

/**
 * Every billable line a visit produces: labour, travel, materials, other.
 *
 * visitAmount has always counted all four, but the invoice builder only wrote
 * labour and travel — so a visit with materials showed one total on screen and
 * billed a smaller one. These are the same four parts, in one place, and
 * visitInvoiceTotal is their sum, so an invoice raised from a visit cannot
 * come to less than the visit says it is worth.
 */
export function visitInvoiceLines(
  v: Pick<SiteVisit, 'visit_date' | 'site_name' | 'site_code' | 'visit_type' | 'hours' | 'rate' | 'travel_charge' | 'total_project_price'>
    & Partial<Pick<SiteVisit, 'materials_cost' | 'other_charges' | 'materials_description'>>,
): VisitLine[] {
  const site = [v.site_name, v.site_code ? `#${v.site_code}` : null].filter(Boolean).join(' ') || 'Site';
  const lines: VisitLine[] = [visitLineItem(v)];

  const extra = (amount: number | null | undefined, description: string) => {
    const n = Number(amount ?? 0);
    // Zero is not a line. A $0.00 row on a client's invoice invites a question
    // with no useful answer.
    if (!n) return;
    lines.push({ description, quantity: 1, rate: n });
  };

  extra(v.travel_charge, `${site} — travel charge`);
  extra(
    v.materials_cost,
    v.materials_description?.trim()
      ? `${site} — materials: ${v.materials_description.trim()}`
      : `${site} — materials`,
  );
  extra(v.other_charges, `${site} — other charges`);

  return lines;
}

/** What those lines come to — equal to visitAmount, by construction. */
export function visitInvoiceTotal(lines: VisitLine[]): number {
  return Math.round(lines.reduce((s, l) => s + l.quantity * l.rate, 0) * 100) / 100;
}

/**
 * What a visit carries onto the work order it becomes.
 *
 * The conversion used to send only the labour: hours, rate and a total_amount.
 * So a visit worth $168.70 arrived as a work order reading "2 hours at $55" —
 * $110 — with the other $58.70 of travel buried in the total and nothing on the
 * job to explain it. Materials and other charges vanished the same way.
 *
 * Every part of the visit's money now lands somewhere the work order can show:
 * mileage as a mileage log, materials as a material line, and anything left in
 * "other charges" spelled out in the description rather than silently folded in.
 */
export function workOrderMoneyFromVisit(
  v: Pick<SiteVisit, 'visit_date' | 'site_name' | 'site_code' | 'visit_type' | 'hours' | 'rate' | 'travel_charge' | 'total_project_price'>
    & Partial<Pick<SiteVisit, 'miles' | 'materials_cost' | 'other_charges' | 'materials_description'>>,
  contractorName: string,
): {
  total_amount: number;
  pay_type: 'Hourly' | 'Fixed';
  hourly_rate: number | null;
  hours_worked: number | null;
  /** What the CLIENT is billed on top of labour. Revenue. */
  billable_travel: number | null;
  billable_miles: number | null;
  billable_materials: number | null;
  billable_other: number | null;
  /**
   * Reimbursement to the tech, left EMPTY on conversion.
   *
   * Whether a tech gets the travel back varies by job, and billing a client
   * $58.70 of travel never meant handing the tech $58.70 — writing it here
   * automatically turned revenue into an expense and showed the job at a loss.
   */
  mileage_logs: MileageLog[];
  materials_used: MaterialUsed[];
  other_charges_note: string | null;
} {
  const hourly = (v.rate ?? '').match(/\$?\s*(\d+(?:\.\d+)?)\s*\/\s*h/i);
  const travel = Number(v.travel_charge ?? 0);
  const miles = Number(v.miles ?? 0);
  const materials = Number(v.materials_cost ?? 0);
  const other = Number(v.other_charges ?? 0);

  // The materials the visit recorded are what the job consumed. Most of what
  // Fred buys stays HIS, so a row is not marked as the client's unless he says
  // so — it is his cost until then.
  const materials_used: MaterialUsed[] = materials
    ? [{
        id: `sv-materials`,
        material_id: null,
        name: v.materials_description?.trim() || 'Materials',
        quantity: 1,
        unit_cost: materials,
        client_pays: false,
      }]
    : [];

  return {
    total_amount: visitAmount(v),
    pay_type: hourly ? 'Hourly' : 'Fixed',
    hourly_rate: hourly ? Number(hourly[1]) : null,
    hours_worked: hourly ? (v.hours ?? null) : null,
    billable_travel: travel || null,
    billable_miles: miles || null,
    // The visit's materials cost is Fred's spend, not automatically a sale.
    billable_materials: null,
    billable_other: other || null,
    mileage_logs: [],
    materials_used,
    other_charges_note: other ? `Other charges: ${other.toFixed(2)}` : null,
  };
}

/**
 * A rate that can be read two ways.
 *
 * The entry form writes "$55/hr" or "$55 flat" through buildRate, so anything
 * it produces is unambiguous. Rows imported or typed before that carry a bare
 * number — "55", "100" — and a bare number bills ONCE for the whole visit.
 * On a visit with hours logged that is very likely wrong: a two-hour call at
 * "55" bills $55, not $110.
 *
 * The app deliberately does not guess. It cannot know whether "540" meant
 * $540 for the job or $540 an hour, and quietly picking one is how money goes
 * missing. This only marks the visit as worth a look.
 */
export function rateIsAmbiguous(
  v: Pick<SiteVisit, 'hours' | 'rate' | 'total_project_price'>,
): boolean {
  const text = (v.rate ?? '').trim();
  if (!text) return false;
  // A typed project price is an explicit decision and settles it.
  if (v.total_project_price != null && !isNaN(Number(v.total_project_price))) return false;
  if (HOURLY_RATE_RE.test(text)) return false;   // says hourly
  if (/flat/i.test(text)) return false;          // says flat
  if (!/\d/.test(text)) return false;            // a note, not a price
  return Number(v.hours ?? 0) > 0;               // hours logged, so billing once is doubtful
}
