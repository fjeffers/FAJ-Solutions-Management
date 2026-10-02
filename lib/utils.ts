import type { WorkOrder, EnrichedWorkOrder, Payment, WorkOrderStatus, MaterialUsed, PayAddon, PayAddonKind } from './types';
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

/** What the client is billed on top of the labour: travel, materials, other. */
export function billableExtras(
  wo: Pick<WorkOrder, 'billable_travel' | 'billable_materials' | 'billable_other'> & { pay_addons?: PayAddon[] | null },
): number {
  // Add-ons are the way these are recorded now. The three columns remain for
  // work orders raised before the rebuild, and are only consulted when a job
  // has no add-ons at all — otherwise the same travel would count twice.
  const addons = wo.pay_addons ?? [];
  if (addons.length > 0) return billableAddons(addons);
  return Math.round((
    Number(wo.billable_travel ?? 0) + Number(wo.billable_materials ?? 0) + Number(wo.billable_other ?? 0)
  ) * 100) / 100;
}

// The techs' pay pool for a WO (before mileage)
/**
 * Has a real tech pay figure been recorded on this job?
 *
 * The difference is the whole margin. With no figure the app used to assume
 * the tech gets the entire client price, so a $1,138 Wendy's job read as
 * $1,138 owed and $0 profit — on a job Fred had not paid a penny on yet. Eight
 * of nine live jobs were in that state.
 *
 * Payables already refused to raise a payable without one (a guess like that
 * produced $9,125 of payments that never happened on 7 Aug 2026). Everything
 * else kept believing it.
 */
export function hasPaySplit(wo: Pick<WorkOrder, 'contractor_pay'>): boolean {
  return Boolean(wo.contractor_pay && Object.keys(wo.contractor_pay).length > 0);
}

export function woTechPayTotal(wo: WorkOrder): number {
  if (wo.contractor_pay && Object.keys(wo.contractor_pay).length > 0) {
    return Object.values(wo.contractor_pay).reduce((s, v) => s + (Number(v) || 0), 0);
  }
  // Legacy fallback: no tech pay recorded means the tech gets the client price.
  // Charges passed on to the CLIENT are not part of that — billing a client
  // $58.70 of travel never meant handing the tech $58.70. On older work orders
  // these are all zero, so this is exactly the behaviour it always had.
  return Math.round((Number(wo.total_amount) - billableExtras(wo)) * 100) / 100;
}

// Everything that goes out the door on a WO: tech pay plus mileage.
// This is the number "paid in full" is measured against.
export function woPayoutTotal(wo: WorkOrder): number {
  return Math.round((
    woTechPayTotal(wo)
    + mileageReimbursement(wo.mileage_logs)
    + materialsReimbursement(wo.materials_used)
    + payAddonsTotal(wo.pay_addons)
  ) * 100) / 100;
}

// What FAJ keeps: client price minus tech pay and mileage
/**
 * What the job makes — or null when nobody has said what the tech gets.
 *
 * Null is the honest answer to an unanswered question. Reporting $0 made a
 * profitable job look break-even; reporting the full client price would make
 * an unpaid job look like pure margin. Callers show "not set" and offer to
 * fix it, rather than printing either lie.
 */
export function woProfitOrNull(wo: WorkOrder): number | null {
  if (!hasPaySplit(wo)) return null;
  return Math.round((Number(wo.total_amount) - woPayoutTotal(wo)) * 100) / 100;
}

export function woProfit(wo: WorkOrder): number {
  // Rounded to the cent: this is money on screen, and a subtraction of two
  // decimals otherwise reads as 58.69999999999999.
  return Math.round((Number(wo.total_amount) - woPayoutTotal(wo)) * 100) / 100;
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
      // With no agreed tech pay there is no debt to state. Valuing the tech's
      // share at the whole client price turned every unpriced job into a large
      // fictional payable — $22,465 of it across the archived import stubs
      // alone — and made the profit on real work read as exactly zero.
      const pay_set = hasPaySplit(wo);
      // With no agreed labour figure, what the tech is owed is UNKNOWN — but
      // what they laid out is not. Mileage, materials and add-ons are real
      // money they are owed back whether or not the labour has been settled,
      // so those still count; only the guessed labour drops out.
      const payout_total = pay_set
        ? woPayoutTotal(wo)
        : Math.round((
            mileageReimbursement(wo.mileage_logs)
            + materialsReimbursement(wo.materials_used)
            + payAddonsTotal(wo.pay_addons)
          ) * 100) / 100;
      const remaining = Math.max(0, payout_total - paid);
      const payment_status: 'paid' | 'partial' | 'pending' =
        // Nothing can be called settled while the labour figure is missing.
        !pay_set ? 'pending'
        : paid <= 0 ? 'pending'
        : paid >= payout_total ? 'paid'
        : 'partial';
      return { ...wo, paid, remaining, payment_status, payout_total, pay_set };
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
  return Math.round((
    contractorShareOfWO(wo, name)
    + mileageForTech(wo.mileage_logs, name)
    + materialsForTech(wo.materials_used, name, wo.contractor_name)
    + payAddonsForTech(wo.pay_addons, name, wo.contractor_name)
  ) * 100) / 100;
}

export const STATUS_COLORS: Record<WorkOrderStatus, { bg: string; color: string }> = {
  Open:        { bg: 'rgba(156,163,175,0.2)',  color: '#4B5563' },
  Assigned:    { bg: 'rgba(59,130,246,0.15)',  color: '#1D4ED8' },
  'In Progress':{ bg: 'rgba(245,158,11,0.15)', color: '#B45309' },
  'Work Done': { bg: 'rgba(16,185,129,0.15)',  color: '#047857' },
  Approved:    { bg: 'rgba(14,27,46,0.15)',  color: 'var(--teal)' },
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

// ─── What a work order is made of ─────────────────────────────────────────────

/**
 * The parts behind a work order's client price.
 *
 * The board showed one number and nothing else, so a job converted from a
 * $168.70 visit read "2 hours at $55" with no sign of the $58.70 of travel that
 * made up the difference.
 *
 * `other` is deliberately the REMAINDER rather than a stored field: if the named
 * parts do not account for the total, that gap is real and belongs on screen,
 * not rounded away. On a fixed-price job the whole fee lands there.
 */
export type WOBreakdown = {
  labor: number;
  mileage: number;
  materials: number;
  other: number;
  total: number;
  /** True when labour is an hourly calculation worth spelling out. */
  hourly: boolean;
  hours: number;
  rate: number;
};

export function workOrderBreakdown(w: Pick<WorkOrder,
  'pay_type' | 'hourly_rate' | 'hours_worked' | 'total_amount'
  | 'billable_travel' | 'billable_miles' | 'billable_materials' | 'billable_other' | 'materials_used'
>): WOBreakdown {
  // Normalise -0: the remainder is a subtraction, and floating point makes
  // "nothing left over" come out as -0, which reads oddly and compares badly.
  const r2 = (n: number) => { const v = Math.round(n * 100) / 100; return v === 0 ? 0 : v; };
  const hours = Number(w.hours_worked ?? 0);
  const rate = Number(w.hourly_rate ?? 0);
  const hourly = w.pay_type === 'Hourly' && hours > 0 && rate > 0;

  const labor = hourly ? r2(hours * rate) : 0;
  // The CLIENT side: what they are billed. Tech mileage reimbursement and the
  // materials Fred keeps are costs, and belong nowhere near this figure.
  const mileage = r2(Number(w.billable_travel ?? 0));
  const materials = r2(Number(w.billable_materials ?? 0) || clientPaidMaterials(w.materials_used));
  const total = r2(Number(w.total_amount ?? 0));

  return { labor, mileage, materials, other: r2(total - labor - mileage - materials), total, hourly, hours, rate };
}

/** The breakdown as one readable line: "2h × $55 = $110 + Mileage $58.70". */
export function workOrderBreakdownText(w: Parameters<typeof workOrderBreakdown>[0]): string {
  const b = workOrderBreakdown(w);
  const parts: string[] = [];
  if (b.hourly) parts.push(`${b.hours}h × ${fmtMoney(b.rate)} = ${fmtMoney(b.labor)}`);
  if (b.mileage) {
    const mi = Number(w.billable_miles ?? 0);
    parts.push(mi > 0 ? `Travel ${mi} mi = ${fmtMoney(b.mileage)}` : `Travel ${fmtMoney(b.mileage)}`);
  }
  if (b.materials) parts.push(`Materials ${fmtMoney(b.materials)}`);
  // Name the remainder for what it is, rather than leaving a silent gap.
  if (b.other) parts.push(`${b.hourly || b.mileage || b.materials ? 'Other' : 'Job price'} ${fmtMoney(b.other)}`);
  return parts.join('  +  ');
}

/**
 * Materials the CLIENT is buying — the ones left on site or bought outright.
 *
 * Most of what Fred loads into the van stays his: carried to a job, used, and
 * brought back. Billing those would charge a client for something they never
 * received, so only rows explicitly marked as the client's are counted.
 */
export function clientPaidMaterials(rows: MaterialUsed[] | null | undefined): number {
  return Math.round(
    (rows ?? [])
      .filter((r) => r.client_pays)
      .reduce((s, r) => s + Number(r.quantity ?? 0) * Number(r.unit_cost ?? 0), 0) * 100,
  ) / 100;
}

/** What Fred spent on materials that stay his — stock, not a sale. */
export function ownStockMaterials(rows: MaterialUsed[] | null | undefined): number {
  return Math.round(
    (rows ?? [])
      .filter((r) => !r.client_pays)
      .reduce((s, r) => s + Number(r.quantity ?? 0) * Number(r.unit_cost ?? 0), 0) * 100,
  ) / 100;
}

/**
 * Materials to be paid back to whoever bought them.
 *
 * The payout counted labour and mileage but never materials, so a tech who put
 * $120 of their own money into a job was out of pocket by exactly that much and
 * nothing on the work order said so.
 */
export function materialsReimbursement(rows: MaterialUsed[] | null | undefined): number {
  return Math.round(
    (rows ?? [])
      .filter((r) => r.reimburse)
      .reduce((s, r) => s + Number(r.quantity ?? 0) * Number(r.unit_cost ?? 0), 0) * 100,
  ) / 100;
}

/** One person's materials reimbursement. Unattributed rows go to the lead tech. */
export function materialsForTech(
  rows: MaterialUsed[] | null | undefined,
  name: string,
  leadTech?: string | null,
): number {
  return Math.round(
    (rows ?? [])
      .filter((r) => r.reimburse && ((r.bought_by || leadTech || '') === name))
      .reduce((s, r) => s + Number(r.quantity ?? 0) * Number(r.unit_cost ?? 0), 0) * 100,
  ) / 100;
}

// ─── Pay add-ons ──────────────────────────────────────────────────────────────

/** The kinds of line a payout can carry, and which way each one goes. */
export const PAY_ADDON_KINDS: { kind: PayAddonKind; label: string; deduct: boolean; metered?: boolean }[] = [
  // metered: normally written as an amount x a rate rather than a flat figure.
  { kind: 'labour',        label: 'Labour',               deduct: false, metered: true },
  { kind: 'materials',     label: 'Materials',            deduct: false },
  { kind: 'mileage',       label: 'Mileage',              deduct: false, metered: true },
  { kind: 'per_diem',      label: 'Per diem',             deduct: false },
  { kind: 'tolls_parking', label: 'Tolls / parking',      deduct: false },
  { kind: 'permit',        label: 'Permit',               deduct: false },
  { kind: 'equipment',     label: 'Equipment rental',     deduct: false },
  { kind: 'bonus',         label: 'Bonus',                deduct: false },
  { kind: 'tax',           label: 'Tax',                  deduct: true  },
  { kind: 'service_fee',   label: 'Service / platform fee', deduct: true },
  { kind: 'deduction',     label: 'Deduction',            deduct: true  },
  { kind: 'other',         label: 'Other',                deduct: false },
];

export const payAddonLabel = (kind: PayAddonKind): string =>
  PAY_ADDON_KINDS.find((k) => k.kind === kind)?.label ?? 'Other';

/** What a line comes to: qty x rate when both are given, else the flat amount. */
export function payAddonAmount(a: Pick<PayAddon, 'amount' | 'qty' | 'rate'>): number {
  if (a.qty != null && a.rate != null) {
    return Math.round((Number(a.qty) || 0) * (Number(a.rate) || 0) * 100) / 100;
  }
  return Math.round((Number(a.amount) || 0) * 100) / 100;
}

/** Signed value: what this line does to the payout. */
export const payAddonSigned = (a: PayAddon): number =>
  (a.deduct ? -1 : 1) * payAddonAmount(a);

/** Everything the add-ons add to, or take off, the TECH's payout. */
export function payAddonsTotal(addons: PayAddon[] | null | undefined): number {
  return Math.round(
    (addons ?? []).filter((a) => a.pay_tech !== false).reduce((s, a) => s + payAddonSigned(a), 0) * 100,
  ) / 100;
}

/** What the add-ons put on the CLIENT's bill. Deductions are never revenue. */
export function billableAddons(addons: PayAddon[] | null | undefined): number {
  return Math.round(
    (addons ?? [])
      .filter((a) => a.bill_client && !a.deduct)
      .reduce((s, a) => s + payAddonAmount(a), 0) * 100,
  ) / 100;
}

/** The add-on lines belonging to one tech. Unattributed go to the lead. */
export function payAddonsForTech(
  addons: PayAddon[] | null | undefined,
  name: string,
  leadTech?: string | null,
): number {
  return Math.round(
    (addons ?? [])
      .filter((a) => a.pay_tech !== false && (a.contractor_name || leadTech || '') === name)
      .reduce((s, a) => s + payAddonSigned(a), 0) * 100,
  ) / 100;
}

/** The pay panel, in the order it reads on screen. */
export function payBreakdown(wo: WorkOrder): {
  labour: number;
  additions: PayAddon[];
  deductions: PayAddon[];
  mileage: number;
  materials: number;
  total: number;
} {
  const labour = woTechPayTotal(wo);
  const mileage = mileageReimbursement(wo.mileage_logs);
  const materials = materialsReimbursement(wo.materials_used);
  const addons = wo.pay_addons ?? [];
  return {
    labour,
    additions: addons.filter((a) => !a.deduct),
    deductions: addons.filter((a) => a.deduct),
    mileage,
    materials,
    total: Math.round((labour + mileage + materials + payAddonsTotal(addons)) * 100) / 100,
  };
}
