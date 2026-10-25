// The week to bill: every site with work in a week, and whether it is billed
// (Fred, 2026-10-24: he bills on the weekend, "but I got to do it for each day
// and also for each tech. So that's what's taking forever").
//
// A site has a day in the week when a tech tapped on it (job_day_events,
// job_punches) or the office typed a day on its Field Sheet (field_sheet_days,
// not hidden). It is billed when QuickBooks has an invoice from the Field
// Sheet covering those days; partly billed when some days are left over.
//
// Weeks run Sunday to Saturday, as on the Field Sheet's week picker.
// Pure and unit-tested (lib/week-to-bill.test.ts). The screen is FieldSheetView.

import { dayOf } from './project-day';
import { blocksBilling, inDates } from './field-sheet';

const DAY = 86_400_000;
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** Sunday of the week a day is in. */
export const sundayOf = (day: string) => addDays(day, -new Date(`${day}T12:00:00Z`).getUTCDay());

/**
 * The week Fred is most likely billing: on a weekend, the week ending this
 * Saturday (Saturday) or last Saturday (Sunday); on a weekday, last week.
 */
export function weekToBillFor(today: string): { from: string; to: string } {
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  const from = dow === 6 ? sundayOf(today) : sundayOf(addDays(today, -7));
  return { from, to: addDays(from, 6) };
}

export type WeekTap = { wo_id: string; at: string };
export type WeekTyped = { wo_id: string; day: string; hidden?: boolean | null };
export type WeekInvoice = { wo_id: string; from_day: string; to_day: string; qbo_invoice_id: string | null; qbo_invoice_number: string | null; created_at: string };

export type WeekSite = {
  woId: string;
  /** Days with work, oldest first. */
  days: string[];
  /** Days no invoice covers. */
  unbilled: string[];
  /** QuickBooks invoice numbers covering some of the days. */
  invoices: string[];
  status: 'to_bill' | 'partly' | 'billed';
};

export function weekSites(input: {
  from: string; to: string; taps: WeekTap[]; typed: WeekTyped[]; invoices: WeekInvoice[]; timeZone?: string; now?: number;
}): WeekSite[] {
  const days = new Map<string, Set<string>>();
  const add = (wo: string, day: string) => {
    if (!wo || !inDates(day, input.from, input.to)) return;
    if (!days.has(wo)) days.set(wo, new Set());
    days.get(wo)!.add(day);
  };
  for (const t of input.taps) add(t.wo_id, dayOf(t.at, input.timeZone));
  for (const t of input.typed) if (!t.hidden) add(t.wo_id, t.day);

  const holds = input.invoices.filter((i) => blocksBilling(i, input.now));
  const out: WeekSite[] = [];
  for (const [woId, set] of days) {
    const list = [...set].sort();
    const mine = holds.filter((i) => i.wo_id === woId);
    const covered = (d: string) => mine.some((i) => inDates(d, i.from_day, i.to_day));
    const unbilled = list.filter((d) => !covered(d));
    const invoices = [...new Set(mine.filter((i) => list.some((d) => inDates(d, i.from_day, i.to_day)))
      .map((i) => i.qbo_invoice_number || (i.qbo_invoice_id ? 'QuickBooks' : 'being created')))];
    out.push({ woId, days: list, unbilled, invoices, status: unbilled.length === 0 ? 'billed' : unbilled.length < list.length ? 'partly' : 'to_bill' });
  }
  // What still needs billing first, then by the first day worked.
  const rank = { to_bill: 0, partly: 1, billed: 2 } as const;
  return out.sort((a, b) => rank[a.status] - rank[b.status] || a.days[0].localeCompare(b.days[0]) || a.woId.localeCompare(b.woId));
}

/** The time window to fetch taps for, wide enough for any US time zone. */
export const tapWindow = (from: string, to: string) => ({ gte: `${addDays(from, -1)}T00:00:00Z`, lt: `${addDays(to, 2)}T00:00:00Z` });
