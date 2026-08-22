// Site Log → Invoice bridge: turn one visit into an invoice line item.
// The visit's rate is free text ("$55/hr", "2600", "$250 flat rate"), so we
// parse: hourly rates bill hours x rate, anything else numeric bills flat,
// unparseable leaves rate 0 for the user to price in the invoice editor.
import type { SiteVisit } from './types';

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
