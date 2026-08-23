import type { WorkOrder, EnrichedWorkOrder, Payment, WorkOrderStatus } from './types';
import { mileageReimbursement, mileageForTech } from './mileage';

export function fmtMoney(n: number | null | undefined): string {
  if (n == null) return '$0.00';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

export function fmtDate(d: string | null | undefined): string {
  if (!d) return '';
  const [y, m, day] = d.split('T')[0].split('-');
  return new Date(Number(y), Number(m) - 1, Number(day)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// The money model: total_amount is what the CLIENT pays FAJ (revenue).
// contractor_pay records what each tech gets — usually less; the difference
// is profit. Legacy WOs with no contractor_pay assume techs get the full amount.

// The techs' pay pool for a WO (before mileage)
export function woTechPayTotal(wo: WorkOrder): number {
  if (wo.contractor_pay && Object.keys(wo.contractor_pay).length > 0) {
    return Object.values(wo.contractor_pay).reduce((s, v) => s + (Number(v) || 0), 0);
  }
  return Number(wo.total_amount);
}

// Everything that goes out the door on a WO: tech pay plus mileage.
// This is the number "paid in full" is measured against.
export function woPayoutTotal(wo: WorkOrder): number {
  return woTechPayTotal(wo) + mileageReimbursement(wo.mileage_logs);
}

// What FAJ keeps: client price minus tech pay and mileage
export function woProfit(wo: WorkOrder): number {
  return Number(wo.total_amount) - woPayoutTotal(wo);
}

export function getStatus(wo: WorkOrder, payments: Payment[]): 'paid' | 'partial' | 'pending' {
  const paid = payments
    .filter((p) => p.wo_number === wo.wo_number)
    .reduce((s, p) => s + Number(p.amount), 0);
  if (paid <= 0) return 'pending';
  if (paid >= woPayoutTotal(wo)) return 'paid';
  return 'partial';
}

export function sortByWO<T extends WorkOrder>(wos: T[]): T[] {
  return [...wos].sort((a, b) => {
    // Newest first by created_at
    if (a.created_at && b.created_at) {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    }
    const na = parseInt(a.wo_number, 10);
    const nb = parseInt(b.wo_number, 10);
    if (!isNaN(na) && !isNaN(nb)) return nb - na;
    return b.wo_number.localeCompare(a.wo_number);
  });
}

export function enrichWorkOrders(workOrders: WorkOrder[], payments: Payment[]): EnrichedWorkOrder[] {
  return sortByWO(
    workOrders.map((wo) => {
      const paid = payments
        .filter((p) => p.wo_number === wo.wo_number)
        .reduce((s, p) => s + Number(p.amount), 0);
      const payout_total = woPayoutTotal(wo);
      const remaining = Math.max(0, payout_total - paid);
      const payment_status: 'paid' | 'partial' | 'pending' =
        paid <= 0 ? 'pending' : paid >= payout_total ? 'paid' : 'partial';
      return { ...wo, paid, remaining, payment_status, payout_total };
    })
  ) as EnrichedWorkOrder[];
}

// How much of a work order's pay belongs to one contractor.
// Single tech: the whole total. Multi-tech with a split: their entry (missing entry = 0).
// Multi-tech without a split: primary contractor carries the full total (legacy behavior).
export function contractorShareOfWO(wo: WorkOrder, name: string): number {
  const names = (wo.contractor_names && wo.contractor_names.length > 0)
    ? wo.contractor_names
    : (wo.contractor_name ? [wo.contractor_name] : []);
  if (!names.includes(name)) return 0;
  // Explicit tech pay wins — for one tech or many (missing entry = 0)
  if (wo.contractor_pay && Object.keys(wo.contractor_pay).length > 0) {
    return Number(wo.contractor_pay[name] ?? 0);
  }
  // Legacy fallback: no tech pay recorded means the tech gets the client price
  if (names.length === 1) return Number(wo.total_amount);
  return name === wo.contractor_name ? Number(wo.total_amount) : 0;
}

// Everything a tech is owed on a WO: their pay share plus their logged mileage.
// This is what Payables, payment auto-fill, and the overpay check measure against.
export function contractorOwedOnWO(wo: WorkOrder, name: string): number {
  return contractorShareOfWO(wo, name) + mileageForTech(wo.mileage_logs, name);
}

export const STATUS_COLORS: Record<WorkOrderStatus, { bg: string; color: string }> = {
  Open:        { bg: 'rgba(156,163,175,0.2)',  color: '#4B5563' },
  Assigned:    { bg: 'rgba(59,130,246,0.15)',  color: '#1D4ED8' },
  'In Progress':{ bg: 'rgba(245,158,11,0.15)', color: '#B45309' },
  'Work Done': { bg: 'rgba(16,185,129,0.15)',  color: '#047857' },
  Approved:    { bg: 'rgba(13,115,119,0.15)',  color: 'var(--teal)' },
  Paid:        { bg: 'rgba(5,150,105,0.2)',    color: '#065F46' },
};

// ─── Dates in the timezone the business actually runs in ──────────────────────

/**
 * FAJ Solutions works out of Easton, PA. A visit date, an invoice due date and
 * a payment date are facts about the BUSINESS, not about whichever machine is
 * asking — so they are all resolved in Eastern, on the server and in the
 * browser alike.
 */
export const BUSINESS_TZ = 'America/New_York';

/**
 * Today's date in Eastern, as YYYY-MM-DD.
 *
 * `new Date().toISOString().slice(0, 10)` is the UTC date, which is a different
 * DAY from about 8pm Eastern onwards. Fred works nights — several visits check
 * in at 11pm and out at 6am — so a visit added at 11pm was being dated
 * tomorrow, and an invoice could show overdue a day early.
 *
 * Intl handles daylight saving, so this is right in both EDT and EST without a
 * twice-yearly correction.
 */
export function todayISO(now: Date = new Date()): string {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * A YYYY-MM-DD date shifted by whole days.
 *
 * Parsed at UTC midnight so adding days can never land an hour short and slip
 * back a day across a daylight-saving boundary.
 */
export function addDaysISO(date: string, days: number): string {
  const t = Date.parse(`${String(date).slice(0, 10)}T00:00:00Z`);
  if (isNaN(t)) return date;
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
}

/** The current time in Eastern, for stamping and for "is it overdue" checks. */
export function nowInBusinessTZ(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TZ, dateStyle: 'medium', timeStyle: 'short',
  }).format(now);
}
