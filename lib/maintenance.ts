// Preventive maintenance: what is due, how badly, and what happens when it is done.
//
// The heart of a CMMS is one question — "what needs doing, and what is late" —
// so that is what this module answers. Everything is pure and takes today as an
// argument, because a scheduler that reads the clock internally cannot be
// tested and drifts across timezones.
//
// Dates are plain YYYY-MM-DD strings throughout. A maintenance interval is
// measured in whole days, and a Date built from an ISO date string is UTC
// midnight, so adding days never lands an hour early and shifts the day.
import type { Asset, MaintenancePlan } from './types';

const DAY = 86_400_000;

/** Today as YYYY-MM-DD in the reader's own timezone, not UTC. */
export function todayISO(now: Date = new Date()): string {
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function parse(date: string | null | undefined): number | null {
  if (!date) return null;
  const t = Date.parse(`${String(date).slice(0, 10)}T00:00:00Z`);
  return isNaN(t) ? null : t;
}

function iso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`. Negative when `to` is in the past. */
export function daysBetween(from: string, to: string): number | null {
  const a = parse(from);
  const b = parse(to);
  if (a == null || b == null) return null;
  return Math.round((b - a) / DAY);
}

export function addDays(date: string, days: number): string | null {
  const t = parse(date);
  return t == null ? null : iso(t + days * DAY);
}

/**
 * When a plan next falls due.
 *
 * An explicit next_due_on wins — a task deliberately pushed to next month
 * should stay there. Otherwise it is the interval after the last time it was
 * done. A plan never done and never scheduled has no due date at all, which is
 * a real state ("set up but not started"), not an error.
 */
export function nextDue(plan: Pick<MaintenancePlan, 'next_due_on' | 'last_done_on' | 'interval_days'>): string | null {
  if (plan.next_due_on) return String(plan.next_due_on).slice(0, 10);
  if (plan.last_done_on) return addDays(String(plan.last_done_on).slice(0, 10), plan.interval_days);
  return null;
}

export type DueState = 'paused' | 'unscheduled' | 'overdue' | 'due' | 'soon' | 'ok';

/** How many days ahead still counts as "coming up". */
export const SOON_DAYS = 14;

export const DUE_STATE_LABEL: Record<DueState, string> = {
  overdue:     'Overdue',
  due:         'Due now',
  soon:        'Coming up',
  ok:          'Scheduled',
  unscheduled: 'Not scheduled',
  paused:      'Paused',
};

export const DUE_STATE_COLOR: Record<DueState, { color: string; bg: string }> = {
  overdue:     { color: '#b91c1c', bg: 'rgba(239,68,68,0.13)' },
  due:         { color: '#c2410c', bg: 'rgba(249,115,22,0.15)' },
  soon:        { color: '#b45309', bg: 'rgba(245,158,11,0.15)' },
  ok:          { color: '#047857', bg: 'rgba(16,185,129,0.13)' },
  unscheduled: { color: '#6b7280', bg: 'rgba(0,0,0,0.06)' },
  paused:      { color: '#9ca3af', bg: 'rgba(0,0,0,0.04)' },
};

export function dueState(plan: MaintenancePlan, today: string = todayISO()): DueState {
  if (plan.active === false) return 'paused';
  const due = nextDue(plan);
  if (!due) return 'unscheduled';
  const days = daysBetween(today, due);
  if (days == null) return 'unscheduled';
  if (days < 0) return 'overdue';
  if (days === 0) return 'due';
  if (days <= SOON_DAYS) return 'soon';
  return 'ok';
}

/** Days until due — negative when late. Null when there is no due date. */
export function daysUntilDue(plan: MaintenancePlan, today: string = todayISO()): number | null {
  const due = nextDue(plan);
  return due ? daysBetween(today, due) : null;
}

/** "9 days late", "due today", "in 12 days" — the phrase for the screen. */
export function duePhrase(plan: MaintenancePlan, today: string = todayISO()): string {
  if (plan.active === false) return 'paused';
  const days = daysUntilDue(plan, today);
  if (days == null) return 'no date set';
  if (days === 0) return 'due today';
  if (days < 0) return `${-days} day${days === -1 ? '' : 's'} late`;
  return `in ${days} day${days === 1 ? '' : 's'}`;
}

const URGENCY: Record<DueState, number> = {
  overdue: 0, due: 1, soon: 2, ok: 3, unscheduled: 4, paused: 5,
};

/**
 * Worst first: overdue at the top, then due today, then coming up. Within a
 * state the earlier due date leads, so the list reads as a queue of work.
 */
export function sortByUrgency(plans: MaintenancePlan[], today: string = todayISO()): MaintenancePlan[] {
  return [...plans].sort((a, b) => {
    const ua = URGENCY[dueState(a, today)];
    const ub = URGENCY[dueState(b, today)];
    if (ua !== ub) return ua - ub;
    const da = nextDue(a) ?? '9999-12-31';
    const db = nextDue(b) ?? '9999-12-31';
    return da.localeCompare(db);
  });
}

export type DueSummary = Record<DueState, number> & { needsAttention: number };

/** The counts behind the tiles at the top of the maintenance screen. */
export function dueSummary(plans: MaintenancePlan[], today: string = todayISO()): DueSummary {
  const out = { overdue: 0, due: 0, soon: 0, ok: 0, unscheduled: 0, paused: 0, needsAttention: 0 } as DueSummary;
  for (const p of plans) out[dueState(p, today)]++;
  // What Fred would act on this week.
  out.needsAttention = out.overdue + out.due + out.soon;
  return out;
}

/**
 * The plan after a task is completed.
 *
 * The next one is scheduled an interval from the day it was DONE, not from the
 * day it was due. A quarterly clean done three weeks late is next due three
 * months after the clean — scheduling from the old due date would stack the
 * lateness up forever.
 */
export function markDone(
  plan: Pick<MaintenancePlan, 'interval_days'>,
  doneOn: string = todayISO(),
): { last_done_on: string; next_due_on: string | null } {
  return { last_done_on: doneOn, next_due_on: addDays(doneOn, plan.interval_days) };
}

/**
 * How a site is named on screen: "Hillside #1331".
 *
 * Anything carrying a site code and name uses this — plans, assets and visits —
 * so a site is never called one thing on one screen and another elsewhere.
 */
export function siteLabel(x: { site_code?: string | null; site_name?: string | null }): string {
  const code = x.site_code?.trim();
  const name = x.site_name?.trim();
  if (code && name) return `${name} #${code}`;
  return name || code || 'Unassigned site';
}

/**
 * The site visit a due task becomes.
 *
 * Maintenance that never turns into billable work is only a reminder, so a due
 * task drops straight into the pipeline that already exists — unpriced, so it
 * cannot quietly bill at a rate nobody chose.
 */
export function visitFromPlan(
  plan: MaintenancePlan,
  asset: Asset | null,
  on: string = todayISO(),
): Record<string, unknown> {
  const what = asset ? `${plan.task} — ${asset.name}` : plan.task;
  return {
    visit_date: on,
    program: plan.program ?? null,
    site_code: plan.site_code ?? null,
    site_name: plan.site_name ?? null,
    visit_type: 'Revisit',
    client_summary: what,
    notes: [
      `Preventive maintenance, every ${plan.interval_days} days.`,
      plan.last_done_on ? `Last done ${String(plan.last_done_on).slice(0, 10)}.` : 'Not done before.',
      plan.notes ?? '',
    ].filter(Boolean).join(' '),
    invoice_status: 'not_invoiced',
    payment_status: 'unpaid',
  };
}

/** Common intervals, so the usual cases are one click rather than arithmetic. */
export const INTERVAL_PRESETS: { label: string; days: number }[] = [
  { label: 'Monthly', days: 30 },
  { label: 'Quarterly', days: 90 },
  { label: 'Twice a year', days: 182 },
  { label: 'Yearly', days: 365 },
];

export const ASSET_TYPES = [
  'Rack', 'Switch', 'Camera', 'NVR / EnVR', 'Menu Board', 'Q-Board',
  'Access Point', 'Cradlepoint', 'Kiosk', 'POS', 'Music System',
  'Headset / Timer', 'Cabling', 'Other',
] as const;

export const ASSET_STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  needs_repair: 'Needs repair',
  retired: 'Retired',
};
