// Automations (Fred, 2026-10-31: the Monday.com "when this happens, do that" rules).
// A fixed set Fred switches on or off, each with its number of days. They run in the
// office app while it is open (components/useAutomations.ts); the rules live on his
// user_settings row (migration 151) and on this device.
import type { WorkOrder } from './types';
import { addDays } from './week-view';
import { techsOf } from './job-sheet';

export type AutoRuleId = 'checkout_done' | 'remind_tech' | 'no_tech' | 'done_invoice' | 'upload_photos';
export type AutoRule = { id: AutoRuleId; on: boolean; days: number };

export const AUTO_RULES: { id: AutoRuleId; when: string; then: string; days: number | null; on: boolean }[] = [
  { id: 'checkout_done', when: 'When the tech checks out', then: 'move the job to Work Done', days: null, on: true },
  { id: 'remind_tech', when: 'Days before the start date', then: 'send the tech a reminder (phone alert, or email)', days: 1, on: true },
  { id: 'no_tech', when: 'A job starts within these days with no tech', then: 'show it under Automations on Home', days: 3, on: true },
  { id: 'done_invoice', when: 'Work Done for this many days', then: 'remind me to invoice it on Home', days: 2, on: true },
  { id: 'upload_photos', when: 'At 5 PM on a day a tech worked a job', then: 'send him a phone reminder to upload his pictures', days: null, on: true },
];

export function parseRules(raw: unknown): AutoRule[] {
  const list = Array.isArray(raw) ? raw : [];
  return AUTO_RULES.map((d) => {
    const r = list.find((x) => x && typeof x === 'object' && (x as AutoRule).id === d.id) as Partial<AutoRule> | undefined;
    const days = Number(r?.days);
    return { id: d.id, on: typeof r?.on === 'boolean' ? r.on : d.on, days: d.days === null ? 0 : Number.isFinite(days) && days >= 0 && days <= 60 ? Math.round(days) : d.days };
  });
}

type Wo = Pick<WorkOrder, 'id' | 'wo_number' | 'wo_status' | 'archived_at' | 'checked_in_at' | 'checked_out_at' | 'start_date'
  | 'contractor_name' | 'contractor_names' | 'updated_at'>;

const rule = (rules: AutoRule[], id: AutoRuleId) => rules.find((r) => r.id === id && r.on);
const live = (w: Wo) => !w.archived_at && w.wo_status !== 'On Hold';

/** Jobs a tech has checked out of that still say In Progress. */
export function dueCheckoutDone<T extends Wo>(rows: readonly T[], rules: AutoRule[]): T[] {
  if (!rule(rules, 'checkout_done')) return [];
  return rows.filter((w) => live(w) && w.wo_status === 'In Progress' && !!w.checked_out_at
    && (!w.checked_in_at || w.checked_in_at <= w.checked_out_at));
}

/** Jobs whose techs get their reminder today. */
export function dueReminders<T extends Wo>(rows: readonly T[], rules: AutoRule[], today: string): T[] {
  const r = rule(rules, 'remind_tech');
  if (!r) return [];
  const day = addDays(today, r.days);
  return rows.filter((w) => live(w) && w.start_date === day && techsOf(w).length > 0 && !w.checked_in_at
    && (w.wo_status === 'Assigned' || w.wo_status === 'Open'));
}

/** Jobs starting soon with nobody on them. */
export function noTechSoon<T extends Wo>(rows: readonly T[], rules: AutoRule[], today: string): T[] {
  const r = rule(rules, 'no_tech');
  if (!r) return [];
  const last = addDays(today, r.days);
  return rows.filter((w) => live(w) && !!w.start_date && w.start_date >= today && w.start_date <= last && techsOf(w).length === 0);
}

/** Work Done jobs that have waited too long for an invoice. */
export function waitingInvoice<T extends Wo>(rows: readonly T[], rules: AutoRule[], today: string): T[] {
  const r = rule(rules, 'done_invoice');
  if (!r) return [];
  const cutoff = addDays(today, -r.days);
  return rows.filter((w) => live(w) && w.wo_status === 'Work Done' && (w.checked_out_at || w.updated_at || '').slice(0, 10) <= cutoff
    && !!(w.checked_out_at || w.updated_at));
}

/** The day (YYYY-MM-DD) and hour of a moment in Eastern time, where the business runs. */
export function easternNow(d: Date = new Date()): { day: string; hour: number } {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return { day: `${v('year')}-${v('month')}-${v('day')}`, hour: Number(v('hour')) };
}

/**
 * Jobs whose techs get the "upload your pictures" reminder now (Fred, 2026-11-01: "just reminders for
 * them to upload the pictures"): from 5 PM Eastern, on a day the tech checked in or the job is in progress.
 */
export function dueUploadReminders<T extends Wo>(rows: readonly T[], rules: AutoRule[], now: Date = new Date()): T[] {
  if (!rule(rules, 'upload_photos')) return [];
  const { day, hour } = easternNow(now);
  if (hour < 17) return [];
  return rows.filter((w) => live(w) && techsOf(w).length > 0
    && (w.wo_status === 'In Progress' || (!!w.checked_in_at && easternNow(new Date(w.checked_in_at)).day === day)));
}
