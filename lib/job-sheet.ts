// The work order Sheet (Fred, 2026-10-31: "smart sheet features in the work order or
// monday.com features" ... "you can give me all 8"): grouping with totals, who is on a
// job, what an edit from the sheet writes, and the change lines the Updates feed shows.
import { WO_STATUSES, type WorkOrder, type WorkOrderStatus } from './types';
import { addDays, weekLabel, weekStartOf } from './week-view';

export type SheetGroupBy = 'none' | 'stage' | 'client' | 'tech' | 'week';
export const SHEET_GROUPS: { key: SheetGroupBy; label: string }[] = [
  { key: 'none', label: 'No groups' },
  { key: 'stage', label: 'Status' },
  { key: 'client', label: 'Client' },
  { key: 'tech', label: 'Tech' },
  { key: 'week', label: 'Week' },
];

export type SheetWo = Pick<WorkOrder, 'id' | 'wo_number' | 'wo_status' | 'customer_name' | 'contractor_name' | 'contractor_names'
  | 'start_date' | 'total_amount' | 'contractor_pay' | 'billable_miles'>;

export function techsOf(w: Pick<WorkOrder, 'contractor_name' | 'contractor_names'>): string[] {
  const list = (w.contractor_names ?? []).filter(Boolean);
  return list.length ? list : w.contractor_name ? [w.contractor_name] : [];
}

export type SheetTotals = { jobs: number; clientPays: number; techPay: number; miles: number };

export function sheetTotals(rows: readonly SheetWo[]): SheetTotals {
  const t: SheetTotals = { jobs: 0, clientPays: 0, techPay: 0, miles: 0 };
  for (const w of rows) {
    t.jobs += 1;
    t.clientPays += Number(w.total_amount) || 0;
    t.techPay += Object.values(w.contractor_pay ?? {}).reduce((s, v) => s + (Number(v) || 0), 0);
    t.miles += Number(w.billable_miles) || 0;
  }
  return t;
}

export type SheetGroup<T> = { key: string; label: string; rows: T[]; totals: SheetTotals };

/** Rows in groups, each with its totals. A job with two techs sits under both when grouped by tech. */
export function groupSheet<T extends SheetWo>(rows: readonly T[], by: SheetGroupBy): SheetGroup<T>[] {
  const make = (key: string, label: string, list: T[]): SheetGroup<T> => ({ key, label, rows: list, totals: sheetTotals(list) });
  if (by === 'none') return [make('all', 'All jobs', [...rows])];
  const buckets = new Map<string, T[]>();
  const put = (k: string, w: T) => { const b = buckets.get(k); if (b) b.push(w); else buckets.set(k, [w]); };
  for (const w of rows) {
    if (by === 'stage') put(w.wo_status || 'Open', w);
    else if (by === 'client') put(w.customer_name?.trim() || '', w);
    else if (by === 'week') put(w.start_date ? weekStartOf(w.start_date) : '', w);
    else { const t = techsOf(w); if (t.length) t.forEach((n) => put(n, w)); else put('', w); }
  }
  let keys = [...buckets.keys()];
  if (by === 'stage') keys = (WO_STATUSES as readonly string[]).filter((s) => buckets.has(s)).concat(keys.filter((k) => !(WO_STATUSES as readonly string[]).includes(k)));
  else keys.sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
  const empty: Record<Exclude<SheetGroupBy, 'none' | 'stage'>, string> = { client: 'No client', tech: 'No tech', week: 'No date' };
  return keys.map((k) => make(k || '-', k === '' ? empty[by as keyof typeof empty] : by === 'week' ? weekLabel(k) : k, buckets.get(k)!));
}

/** Giving a job with no tech its tech(s) from the sheet: Open becomes Assigned. */
export function assignPatch(w: Pick<WorkOrder, 'wo_status'>, names: string[]): Partial<WorkOrder> {
  return {
    contractor_name: names[0] ?? '',
    contractor_names: names,
    lead_contractor_name: names[0] ?? null,
    ...(names.length && (!w.wo_status || w.wo_status === 'Open') ? { wo_status: 'Assigned' as WorkOrderStatus } : {}),
  };
}

const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

/** A new start date; a job over several days keeps its length, and the calendar follows. */
export function datePatch(w: Pick<WorkOrder, 'start_date' | 'end_date'>, start: string | null): Partial<WorkOrder> {
  if (!start) return { start_date: null, scheduled_date: null };
  const p: Partial<WorkOrder> = { start_date: start, scheduled_date: start };
  if (w.end_date && w.start_date) p.end_date = addDays(w.end_date, dayDiff(w.start_date, start));
  else if (w.end_date && w.end_date < start) p.end_date = start;
  return p;
}

const LABELS: Record<string, string> = {
  wo_status: 'Status', title: 'Title', customer_name: 'Client', contractor_names: 'Techs', start_date: 'Start date',
  end_date: 'End date', start_time: 'Start time', end_time: 'End time', total_amount: 'Client pays', site_name: 'Site',
  site_address: 'Address', site_city: 'City', pay_type: 'Pay type', billable_miles: 'Billable miles', description: 'Scope',
  custom: 'Your fields', archived_at: 'Closed',
};

const shown = (k: string, v: unknown): string => {
  if (v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) return '—';
  if (Array.isArray(v)) return v.join(', ');
  if (k === 'total_amount') return `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (k === 'description') return String(v).length > 60 ? `${String(v).slice(0, 57)}…` : String(v);
  return typeof v === 'object' ? 'changed' : String(v);
};

/** "Status: Open → Assigned" for each field that changed (the Updates feed). */
export function describeChanges(prev: Partial<WorkOrder>, next: Partial<WorkOrder>): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(next)) {
    if (!(k in LABELS)) continue;
    const before = (prev as Record<string, unknown>)[k];
    if (JSON.stringify(before ?? null) === JSON.stringify(v ?? null)) continue;
    if (k === 'contractor_names' && JSON.stringify(before ?? []) === JSON.stringify(v ?? [])) continue;
    out.push(k === 'custom' ? 'Your fields changed' : `${LABELS[k]}: ${shown(k, before)} → ${shown(k, v)}`);
  }
  return out;
}

/** The day a job counts as: its start, else its calendar day, else the day it was made. */
export const jobDay = (w: Pick<WorkOrder, 'start_date' | 'scheduled_date' | 'created_at'>): string =>
  (w.start_date || w.scheduled_date || w.created_at || '').slice(0, 10);

/** Open jobs dated before a day (Close old jobs; Fred, 2026-10-31: everything before October). */
export function jobsBefore<T extends Pick<WorkOrder, 'start_date' | 'scheduled_date' | 'created_at' | 'archived_at'>>(rows: readonly T[], cutoff: string): T[] {
  return rows.filter((w) => !w.archived_at && !!jobDay(w) && jobDay(w) < cutoff);
}
