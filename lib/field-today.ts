// The field on the office Dashboard, as in Field Service LIVE (Fred,
// 2026-10-18: "fix the majority of field services into FAJ"). Two blocks:
//
//  - In the field: what is going wrong right now. Work a tech stopped, a tech
//    late to site, a job starting soon with nobody on it, and techs waiting on
//    Fred (receipts, another time).
//  - Coming up: the jobs starting in the next week, and who is going.
//
// Pure and unit-tested (lib/field-today.test.ts). components/FieldToday.tsx
// loads the rows and draws them.

import { waitingRequests } from './closeout';
import { isFinished, requestWhen, whenText, type WfJob } from './wf';
import { todayISO } from './utils';

/** project_late (migration 122): not on site 30 minutes after the start. */
export type LateRow = {
  id: string;
  wo_id: string;
  tech: string;
  day: string;
  start_label: string | null;
  reason: string | null;
  eta_min: number | null;
};
/** An open "issue" on work_order_messages (migration 121): the tech stopped work. */
export type IssueRow = {
  id: string;
  /** The job's number (messages are keyed by number). */
  work_order_id: string;
  sender_name: string;
  reason: string | null;
  content: string;
  created_at: string;
};
/** A clock-in on job_punches (migration 102). */
export type PunchRow = { wo_id: string; contractor_name: string; at: string };
/** A receipt waiting for Fred's yes or no (job_expenses, status 'submitted'). */
export type WaitingExpense = { amount: number | string };

export type FieldItem = {
  key: string;
  /** red = work is stopped or a tech is missing; amber = someone is waiting on you. */
  tone: 'red' | 'amber';
  title: string;
  detail: string;
  /** The job it opens, or else the screen. */
  woId?: string;
  view?: string;
};

/** Jobs starting today and the next two days with no tech count as "starts soon". */
export const SOON_DAYS = 3;
/** "Coming up" covers today and the next six days. */
export const COMING_DAYS = 7;

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);
const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const ago = (iso: string, now: number) => {
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min ago`;
};
export function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** Live jobs that still have work ahead: not closed, finished or turned down. */
const ahead = (j: WfJob) => !j.archived && ['open', 'offered', 'scheduled', 'inProgress'].includes(j.status);
const label = (j: WfJob) => `WO ${j.number}${j.siteName ? ` · ${j.siteName}` : ''}`;

export function fieldItems({ jobs, late, issues, punchesIn, expenses, today = todayISO(), now = Date.now() }: {
  jobs: WfJob[];
  late: LateRow[];
  issues: IssueRow[];
  punchesIn: PunchRow[];
  expenses: WaitingExpense[];
  today?: string;
  now?: number;
}): FieldItem[] {
  const items: FieldItem[] = [];
  const byId = new Map(jobs.map((j) => [j.id, j]));
  const byNumber = new Map(jobs.map((j) => [j.number, j]));

  // Work stopped: the tech reported a problem and hasn't said they're back to work.
  for (const i of issues) {
    const j = byNumber.get(i.work_order_id);
    // However old: it stays until resolved, or until the job is finished or archived.
    if (!j || j.archived || isFinished(j)) continue;
    items.push({
      key: `issue:${i.id}`, tone: 'red', woId: j.id,
      title: `Work stopped · ${label(j)}`,
      detail: `${i.sender_name}: ${i.reason || i.content} · ${ago(i.created_at, now)}`,
    });
  }

  // Late: flagged today and still not clocked in here, or anywhere on the same project.
  const inToday = punchesIn.filter((p) => todayISO(new Date(p.at)) === today);
  for (const l of late) {
    const j = byId.get(l.wo_id);
    if (l.day !== today || !j || j.archived) continue;
    const arrived = inToday.some((p) => p.contractor_name === l.tech
      && (p.wo_id === j.id || (!!j.projectName && byId.get(p.wo_id)?.projectName === j.projectName)));
    if (arrived) continue;
    const said = l.reason ? `${l.reason}${l.eta_min ? `, about ${l.eta_min} min` : ''}` : 'No answer yet';
    items.push({
      key: `late:${l.id}`, tone: 'red', woId: j.id,
      title: `${l.tech} is late · ${label(j)}`,
      detail: `${l.start_label ? `Started at ${l.start_label}` : 'Not on site'} · ${said}`,
    });
  }

  // Starts soon with nobody on it.
  const soon = addDays(today, SOON_DAYS - 1);
  for (const j of jobs) {
    if (!ahead(j) || !j.date || j.date < today || j.date > soon || j.techs.length > 0) continue;
    items.push({ key: `notech:${j.id}`, tone: 'amber', woId: j.id, title: `No tech yet · ${label(j)}`, detail: whenText(j, today) });
  }

  // A tech asking for another date or time on an offer.
  for (const j of jobs) {
    if (j.archived || j.status !== 'offered') continue;
    for (const [name, r] of waitingRequests(j.timeRequests, j.techs)) {
      items.push({
        key: `ask:${j.id}:${name}`, tone: 'amber', woId: j.id,
        title: `${name} asks for another time · WO ${j.number}`,
        detail: `Asks for ${requestWhen(r)}`,
      });
    }
  }

  if (expenses.length > 0) {
    const total = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
    items.push({
      key: 'expenses', tone: 'amber', view: 'workorders',
      title: `${expenses.length} ${plural(expenses.length, 'receipt')} to approve`,
      detail: `${money(total)} from techs · approve or decline on Dispatch`,
    });
  }
  return items;
}

export type ComingDay = { date: string; jobs: WfJob[] };

/** Jobs starting today and the next six days, by day, earliest first. */
export function comingUp(jobs: WfJob[], today: string = todayISO(), days = COMING_DAYS): ComingDay[] {
  const last = addDays(today, days - 1);
  const list = jobs
    .filter((j) => ahead(j) && !!j.date && j.date >= today && j.date <= last)
    .sort((a, b) => (a.date! < b.date! ? -1 : a.date! > b.date! ? 1 : (a.startTime || '99').localeCompare(b.startTime || '99')));
  const out: ComingDay[] = [];
  for (const j of list) {
    const day = out.at(-1);
    if (day?.date === j.date) day.jobs.push(j);
    else out.push({ date: j.date!, jobs: [j] });
  }
  return out;
}
