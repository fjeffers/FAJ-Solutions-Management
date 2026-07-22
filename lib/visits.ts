// Site Log → Invoice bridge: turn one visit into an invoice line item.
// The visit's rate is free text ("$55/hr", "2600", "$250 flat rate"), so we
// parse: hourly rates bill hours x rate, anything else numeric bills flat,
// unparseable leaves rate 0 for the user to price in the invoice editor.
import type { SiteVisit } from './types';

export type VisitLine = { description: string; quantity: number; rate: number };

/** What a visit is worth: parsed rate (hours × hourly or flat) + travel charge. */
export function visitAmount(
  v: Pick<SiteVisit, 'visit_date' | 'site_name' | 'site_code' | 'visit_type' | 'hours' | 'rate' | 'travel_charge'>,
): number {
  const li = visitLineItem(v);
  return Math.round((li.quantity * li.rate + (v.travel_charge ?? 0)) * 100) / 100;
}

export function visitLineItem(
  v: Pick<SiteVisit, 'visit_date' | 'site_name' | 'site_code' | 'visit_type' | 'hours' | 'rate'>,
): VisitLine {
  const date = v.visit_date
    ? new Date(v.visit_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })
    : null;
  const site = [v.site_name, v.site_code ? `#${v.site_code}` : null].filter(Boolean).join(' ') || null;
  const base = [date, site, v.visit_type].filter(Boolean).join(' — ');

  const rateText = (v.rate ?? '').trim();
  const hourly = rateText.match(/\$?\s*(\d+(?:\.\d+)?)\s*\/\s*h/i);
  if (hourly) {
    const rate = Number(hourly[1]);
    const qty = v.hours ?? 1;
    return { description: `${base} — ${qty}h @ $${rate}/hr`, quantity: qty, rate };
  }
  const flat = rateText.match(/\$?\s*(\d+(?:\.\d+)?)/);
  if (flat) {
    return { description: `${base} — flat rate`, quantity: 1, rate: Number(flat[1]) };
  }
  return {
    description: `${base}${v.hours ? ` — ${v.hours}h` : ''} — set rate`,
    quantity: v.hours ?? 1,
    rate: 0,
  };
}
