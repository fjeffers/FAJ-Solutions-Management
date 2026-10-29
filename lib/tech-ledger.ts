// A tech's time & pay log (Fred, 2026-10-06: "time log for payment, something
// to keep track of them"). One row per job the tech is on — as the main tech
// or one of several — with the hours they worked, what they earned, what has
// been paid and what is still owed.
//
// Money comes only from lib/utils (contractorOwedOnWO), the same way Pay Techs
// does it: a job with no agreed tech pay (contractor_pay empty) shows "Pay not
// set" and counts as nothing owed, because the legacy fallback values it at
// the full client price — a guess that once produced $9,125 of payments that
// never happened (see components/PayablesView.tsx).
//
// Hours, best source first: the tech's own clock-ins (job_punches, every tap),
// then the older one-row clock record (contractor_time_logs, with Fred's
// adjusted hours if he set them), then the hours typed on the job.

import { contractorOwedOnWO } from './utils';
import type { EnrichedWorkOrder, Payment } from './types';

export type Punch = { wo_id: string; contractor_name: string; kind: 'in' | 'out'; at: string };
export type ClockRecord = {
  wo_id: string; contractor_name: string;
  checked_in_at: string | null; checked_out_at: string | null; adjusted_hours: number | null;
};
export type HoursFrom = 'clock' | 'record' | 'job';

export type LedgerRow = {
  wo: EnrichedWorkOrder;
  /** The job's date (start, else scheduled, else created), YYYY-MM-DD. */
  date: string;
  hours: number | null;
  hoursFrom: HoursFrom | null;
  /** Clocked in and not out yet. */
  onTheClock: boolean;
  paySet: boolean;
  /** What the tech earns on this job; null when the pay isn't set. */
  earned: number | null;
  paid: number;
  owed: number;
  overpaid: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const hoursBetween = (a: string, b: string) => Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / 3_600_000);

export function techNamesOn(wo: Pick<EnrichedWorkOrder, 'contractor_name' | 'contractor_names'>): string[] {
  return wo.contractor_names && wo.contractor_names.length > 0
    ? wo.contractor_names
    : (wo.contractor_name ? [wo.contractor_name] : []);
}

/** Every job the tech is on, as the main tech or one of several. */
export function techJobs(workOrders: EnrichedWorkOrder[], name: string): EnrichedWorkOrder[] {
  return workOrders.filter((w) => techNamesOn(w).includes(name));
}

export function jobDate(wo: Pick<EnrichedWorkOrder, 'start_date' | 'scheduled_date' | 'created_at'>): string {
  return (wo.start_date || wo.scheduled_date || wo.created_at || '').slice(0, 10);
}

/** Hours a tech worked on one job, and where the number came from. */
export function hoursOnJob(
  wo: EnrichedWorkOrder, name: string, punches: Punch[], records: ClockRecord[],
): { hours: number | null; from: HoursFrom | null; onTheClock: boolean } {
  const mine = punches
    .filter((p) => p.wo_id === wo.id && p.contractor_name === name)
    .sort((a, b) => (a.at < b.at ? -1 : 1));
  if (mine.length > 0) {
    let start: string | null = null;
    let total = 0;
    for (const p of mine) {
      if (p.kind === 'in') { if (!start) start = p.at; }
      else if (start) { total += hoursBetween(start, p.at); start = null; }
    }
    return { hours: round2(total), from: 'clock', onTheClock: start !== null };
  }
  const rec = records.find((r) => r.wo_id === wo.id && r.contractor_name === name);
  if (rec) {
    if (rec.adjusted_hours != null && Number(rec.adjusted_hours) > 0) return { hours: round2(Number(rec.adjusted_hours)), from: 'record', onTheClock: false };
    if (rec.checked_in_at && rec.checked_out_at) return { hours: round2(hoursBetween(rec.checked_in_at, rec.checked_out_at)), from: 'record', onTheClock: false };
    if (rec.checked_in_at && !rec.checked_out_at) return { hours: null, from: 'record', onTheClock: true };
  }
  if (wo.hours_worked != null && Number(wo.hours_worked) > 0) return { hours: round2(Number(wo.hours_worked)), from: 'job', onTheClock: false };
  return { hours: null, from: null, onTheClock: false };
}

/** The tech's log, newest job first. */
export function techLedger(
  name: string, workOrders: EnrichedWorkOrder[], payments: Payment[], punches: Punch[] = [], records: ClockRecord[] = [],
): LedgerRow[] {
  return techJobs(workOrders, name)
    .map((wo) => {
      const paySet = Boolean(wo.contractor_pay && Object.keys(wo.contractor_pay).length > 0);
      const paid = round2(payments
        .filter((p) => p.wo_number === wo.wo_number && p.contractor_name === name)
        .reduce((s, p) => s + Number(p.amount), 0));
      const earned = paySet ? contractorOwedOnWO(wo, name) : null;
      const owed = earned != null ? round2(Math.max(0, earned - paid)) : 0;
      const overpaid = earned != null ? round2(Math.max(0, paid - earned)) : 0;
      const h = hoursOnJob(wo, name, punches, records);
      return { wo, date: jobDate(wo), hours: h.hours, hoursFrom: h.from, onTheClock: h.onTheClock, paySet, earned, paid, owed, overpaid };
    })
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.wo.wo_number.localeCompare(a.wo.wo_number)));
}

export type LedgerTotals = { jobs: number; hours: number; earned: number; paid: number; owed: number; overpaid: number; payNotSet: number };

export function ledgerTotals(rows: LedgerRow[]): LedgerTotals {
  return {
    jobs: rows.length,
    hours: round2(rows.reduce((s, r) => s + (r.hours ?? 0), 0)),
    earned: round2(rows.reduce((s, r) => s + (r.earned ?? 0), 0)),
    paid: round2(rows.reduce((s, r) => s + r.paid, 0)),
    owed: round2(rows.reduce((s, r) => s + r.owed, 0)),
    overpaid: round2(rows.reduce((s, r) => s + r.overpaid, 0)),
    payNotSet: rows.filter((r) => !r.paySet).length,
  };
}

/** Payments to this tech that don't match any of their jobs by WO number. */
export function unmatchedPayments(name: string, workOrders: EnrichedWorkOrder[], payments: Payment[]): Payment[] {
  const numbers = new Set(techJobs(workOrders, name).map((w) => w.wo_number));
  return payments.filter((p) => p.contractor_name === name && !numbers.has(p.wo_number));
}

// ── Periods ─────────────────────────────────────────────────────────────────

export type Period = 'week' | 'lastWeek' | 'month' | 'lastMonth' | 'year' | 'all';
export const PERIODS: { key: Period; label: string }[] = [
  { key: 'week', label: 'This week' },
  { key: 'lastWeek', label: 'Last week' },
  { key: 'month', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
  { key: 'year', label: 'This year' },
  { key: 'all', label: 'All time' },
];

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * First and last day (YYYY-MM-DD) of a period around `today`; null for all time. Weeks run Sunday
 * to Saturday, like the bill (Fred, 2026-10-29: "Need to add Sunday to Saturday").
 */
export function periodRange(p: Period, today: string): { from: string; to: string } | null {
  if (p === 'all') return null;
  const [y, m, d] = today.split('-').map(Number);
  const t = new Date(y, m - 1, d);
  if (p === 'week' || p === 'lastWeek') {
    const sunday = new Date(t);
    sunday.setDate(t.getDate() - t.getDay() - (p === 'lastWeek' ? 7 : 0));
    const saturday = new Date(sunday);
    saturday.setDate(sunday.getDate() + 6);
    return { from: iso(sunday), to: iso(saturday) };
  }
  if (p === 'month' || p === 'lastMonth') {
    const first = new Date(y, m - 1 - (p === 'lastMonth' ? 1 : 0), 1);
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
    return { from: iso(first), to: iso(last) };
  }
  return { from: `${y}-01-01`, to: `${y}-12-31` };
}

export function inRange(date: string, range: { from: string; to: string } | null): boolean {
  return !range || (date >= range.from && date <= range.to);
}

/** "2 yrs 3 mos", "7 mos", "12 days" — how long since the hire date. Empty when there's none. */
export function tenure(hireDate: string | null | undefined, today: string): string {
  if (!hireDate) return '';
  const [hy, hm, hd] = hireDate.slice(0, 10).split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  let months = (ty - hy) * 12 + (tm - hm) - (td < hd ? 1 : 0);
  if (months < 0) return 'Starts soon';
  if (months === 0) {
    const days = Math.round((new Date(ty, tm - 1, td).getTime() - new Date(hy, hm - 1, hd).getTime()) / 86_400_000);
    return days <= 0 ? 'Started today' : `${days} day${days === 1 ? '' : 's'}`;
  }
  const years = Math.floor(months / 12);
  months %= 12;
  const parts = [];
  if (years) parts.push(`${years} yr${years === 1 ? '' : 's'}`);
  if (months) parts.push(`${months} mo${months === 1 ? '' : 's'}`);
  return parts.join(' ');
}
