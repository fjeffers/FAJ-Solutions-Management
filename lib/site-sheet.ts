// Turning Site Sheet rows into something you can paste into Excel.
//
// The grid on screen owns the column list; this module owns what each cell
// becomes once it leaves the app. The two jobs are different: the grid shows
// "$1,234.00" and "Not Invoiced" because a person is reading it, whereas a
// spreadsheet wants 1234 so it can be summed.
import type { SiteVisit } from './types';
import { visitAmount, visitLineItem } from './visits';

/** Grid statuses are stored as slugs; these are the words on screen. */
export const STATUS_LABEL: Record<string, string> = {
  not_invoiced: 'Not Invoiced',
  invoiced: 'Invoiced',
  na: 'N/A',
  unpaid: 'Unpaid',
  paid: 'Paid',
};

/** hours × rate — the Total Pay column of the Projects sheet, computed. */
export const laborOf = (v: SiteVisit): number => {
  const li = visitLineItem(v);
  return Math.round(li.quantity * li.rate * 100) / 100;
};

/** An ISO instant as "2026-06-20 14:30" in the reader's own timezone. */
export function localStamp(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16).replace('T', ' ');
}

/**
 * One cell, ready for the clipboard.
 *
 * Money, hours and miles come out as bare numbers rather than formatted text.
 * "$1,234.00" pastes into Excel as a string and will not sum, which defeats
 * the point of moving the data there at all.
 */
export function sheetValue(v: SiteVisit, key: keyof SiteVisit): string | number {
  const raw = v[key];

  if (key === 'time_in' || key === 'time_out') return localStamp(raw as string | null);
  if (key === 'invoice_status' || key === 'payment_status') {
    return STATUS_LABEL[String(raw ?? '')] ?? String(raw ?? '');
  }
  if (key === 'hours' || key === 'miles' || key === 'travel_charge') {
    return raw == null || raw === '' ? '' : Number(raw);
  }
  return raw == null ? '' : String(raw);
}

/**
 * One visit as a row, in the column order given.
 *
 * The caller passes the grid's own column keys so the copied sheet always
 * matches what is on screen — there is no second column list to keep in sync.
 * Total Pay and Total are appended because the grid shows them too, and they
 * are the numbers Fred actually reconciles against.
 */
export function sheetRow(v: SiteVisit, keys: (keyof SiteVisit)[]): (string | number)[] {
  return [...keys.map((k) => sheetValue(v, k)), laborOf(v), visitAmount(v)];
}

/** Header row for the same column order, with the two computed columns. */
export function sheetHeader(labels: string[]): string[] {
  return [...labels, 'Total Pay', 'Total'];
}
