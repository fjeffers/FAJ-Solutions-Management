// Automations (Fred, 2026-10-31: the Monday.com "when this happens, do that" rules).
// A fixed set Fred switches on or off, each with its number of days. They run in the
// office app while it is open (components/useAutomations.ts); the rules live on his
// user_settings row (migration 151) and on this device.
import type { WorkOrder } from './types';
import { addDays } from './week-view';
import { techsOf } from './job-sheet';

export type AutoRuleId = 'checkout_done' | 'remind_tech' | 'no_tech' | 'done_invoice';
export type AutoRule = { id: AutoRuleId; on: boolean; days: number };

export const AUTO_RULES: { id: AutoRuleId; when: string; then: string; days: number | null; on: boolean }[] = [
  { id: 'checkout_done', when: 'When the tech checks out', then: 'move the job to Work Done', days: null, on: true },
  { id: 'remind_tech', when: 'Days before the start date', then: 'send the tech a reminder (phone alert, or email)', days: 1, on: true },
  { id: 'no_tech', when: 'A job starts within these days with no tech', then: 'show it under Automations on Home', days: 3, on: true },
  { id: 'done_invoice', when: 'Work Done for this many days', then: 'remind me to invoice it on Home', days: 2, on: true },
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
