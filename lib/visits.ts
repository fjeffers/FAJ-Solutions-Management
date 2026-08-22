// Site Log → Invoice bridge: turn one visit into an invoice line item.
// The visit's rate is free text ("$55/hr", "2600", "$250 flat rate"), so we
// parse: hourly rates bill hours x rate, anything else numeric bills flat,
// unparseable leaves rate 0 for the user to price in the invoice editor.
import type { SiteVisit } from './types';

export type VisitLine = { description: string; quantity: number; rate: number };

/**
 * Client billing minimum. A visit shorter than this still bills this many
 * hours — the truck roll costs the same whether the job took 20 minutes or
 * two hours. Only affects what the client is billed: the hours logged on the
 * visit stay exactly as recorded, and contractor pay is unchanged.
 */
export const MINIMUM_BILLABLE_HOURS = 2;

/**
 * The hours a visit bills at: time actually on site, floored at the minimum.
 *
 * Null hours mean nobody logged time yet, so there is nothing to bill and
 * nothing to round up — we never invent time that was not recorded. Zero and
 * negative stay as-is for the same reason.
 */
export function billableHours(hours: number | null | undefined): number | null {
  if (hours == null) return null;
  const h = Number(hours);
  if (!isFinite(h) || h <= 0) return h;
  return h < MINIMUM_BILLABLE_HOURS ? MINIMUM_BILLABLE_HOURS : h;
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
