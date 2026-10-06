// WorkFlow inside the FAJ app (Fred, 2026-10-02: "all one app with a tech
// portal", "look and feel into work order").
//
// One shape for a job, shared by the management Work Orders screen and the tech
// portal, so both read a job the same way. It is built either from a tech's own
// row (`wf_tech_jobs()`, migration-096, which carries no money) or from the
// owner's work order, which also keeps the client price and each tech's pay.
//
// Everything here is pure and unit-tested (lib/wf.test.ts). Money totals are
// NOT worked out here: the owner screens take them from lib/utils, the one place
// the money rules live.
import { isUrgent, labelOf, stageName } from './app-lists';
import type { EnrichedWorkOrder } from './types';
import { todayISO } from './utils';
import {
  parseCloseout, parseTimeRequest, parseTimeRequests, applyCloseoutOp,
  type Closeout, type CloseoutOp, type TimeRequest,
} from './closeout';

export type WfStatus = 'open' | 'offered' | 'scheduled' | 'inProgress' | 'workDone' | 'closed' | 'declined';

/** Order the filter chips appear in. */
export const WF_STATUS_ORDER: WfStatus[] = ['open', 'offered', 'scheduled', 'inProgress', 'workDone', 'closed', 'declined'];

/** What a tech reads. */
export const WF_STATUS_LABEL: Record<WfStatus, string> = {
  open: 'Needs a tech',
  offered: 'Needs your answer',
  scheduled: 'Scheduled',
  inProgress: 'In progress',
  workDone: 'Work done',
  closed: 'Closed',
  declined: 'Declined',
};

/** What the office reads: the same states, said from its side — and named
 *  the way Fred chose in Settings -> Lists & stages. */
export function wfStatusLabel(s: WfStatus, ownerView: boolean): string {
  return ownerView ? stageName(s) : WF_STATUS_LABEL[s];
}

/** WorkFlow's colours: the left bar on a card and the status chip. */
export const WF_STATUS_COLOR: Record<WfStatus, string> = {
  open: '#C62828',
  offered: '#5B6B82',
  scheduled: '#0E1B2E',
  inProgress: '#B45309',
  workDone: '#A8862F',
  closed: '#047857',
  declined: '#B3261E',
};

export type WfTask = { id: string; label: string; category: string; done: boolean };

/** A question the office put on the job (custom_qa), and the tech's answer. */
export type WfQuestionType = 'text' | 'number' | 'yes_no' | 'textarea' | 'photo' | 'document' | 'signature';
export type WfQuestion = { id: string; label: string; type: WfQuestionType; answer: string };

export type WfJob = {
  /** Database id (uuid). */
  id: string;
  /** The work order number. Payments, messages and tech actions use it. */
  number: string;
  title: string;
  client: string;
  siteName: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  /** The site on the map (looked up from the address), for "12 mi away". */
  siteLat: number | null;
  siteLng: number | null;
  /** YYYY-MM-DD, or null when not scheduled. */
  date: string | null;
  startTime: string;
  endTime: string;
  status: WfStatus;
  /** The office's own status word ('Assigned', 'Work Done'…), kept for the owner. */
  officeStatus: string;
  highPriority: boolean;
  priorityLabel: string;
  description: string;
  serviceType: string;
  techs: string[];
  pocName: string;
  pocPhone: string;
  pocEmail: string;
  access: string;
  parking: string;
  special: string;
  deliverables: string;
  tools: string;
  skills: string;
  tasks: WfTask[];
  /** The office's questions for this job, with any answers (migration-101). */
  questions: WfQuestion[];
  photoRequired: boolean;
  signatureRequired: boolean;
  deliverableInstructions: string;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  closeoutNotes: string;
  /** Owner only: each tech's own answer to the offer ('accepted' / 'declined'). */
  answers: Record<string, string>;
  /** Deliverables ticked, delays, customer sign-off (migration-105). */
  closeout: Closeout;
  /** Tech only: their own ask for another date and time. */
  myTimeRequest: TimeRequest | null;
  /** Owner only: every tech's ask for another time, by name. */
  timeRequests: Record<string, TimeRequest>;
  archived: boolean;
  /** Owner only. Null on a tech's job — a tech never sees money. */
  clientPrice: number | null;
};

type Row = Record<string, unknown>;

const s = (r: Row, k: string): string => {
  const v = r[k];
  return v == null ? '' : String(v).trim();
};

function techList(r: Row): string[] {
  const list = (r.techs ?? r.contractor_names) as unknown;
  if (Array.isArray(list) && list.length > 0) {
    return list.map((x) => String(x ?? '').trim()).filter(Boolean);
  }
  const one = s(r, 'contractor_name');
  return one ? [one] : [];
}

function taskList(r: Row): WfTask[] {
  const raw = r.wo_tasks;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t): t is Row => !!t && typeof t === 'object')
    .map((t) => ({ id: s(t, 'id'), label: s(t, 'label'), category: s(t, 'category'), done: t.completed === true }))
    .filter((t) => t.id && t.label);
}

const QUESTION_TYPES: WfQuestionType[] = ['text', 'number', 'yes_no', 'textarea', 'photo', 'document', 'signature'];

function questionList(r: Row): WfQuestion[] {
  const raw = r.custom_qa;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((q): q is Row => !!q && typeof q === 'object')
    .map((q) => {
      const t = s(q, 'type') as WfQuestionType;
      return { id: s(q, 'id'), label: s(q, 'label'), type: QUESTION_TYPES.includes(t) ? t : 'text', answer: s(q, 'answer') };
    })
    .filter((q) => q.id && q.label);
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function dateOnly(v: string): string | null {
  const d = v.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

/** The office's status (and, for a tech, their own answer) as WorkFlow shows it. */
export function wfStatusFor(woStatus: string | null | undefined, myResponse = '', hasTechs = true): WfStatus {
  if (myResponse === 'declined') return 'declined';
  switch (woStatus) {
    case 'Approved':
    case 'Paid':
      return 'closed';
    case 'Work Done':
      return 'workDone';
    case 'In Progress':
      return 'inProgress';
  }
  // Open or Assigned: nobody on it, waiting on an answer, or accepted.
  if (!hasTechs) return 'open';
  return myResponse === 'accepted' ? 'scheduled' : 'offered';
}

/**
 * A job's priority as shown, and whether it counts as high priority (the red
 * filter on Dispatch). Fred chooses both in Settings -> Lists & stages; as
 * standard, High, Critical and Emergency count (Emergency didn't, before).
 */
function priorityOf(v: string): { high: boolean; label: string } {
  if (!v.trim()) return { high: false, label: 'Normal' };
  return { high: isUrgent(v), label: labelOf('priorities', v) };
}

function base(r: Row, status: WfStatus, owner: boolean): WfJob {
  const pr = priorityOf(s(r, 'priority'));
  const price = owner ? Number(r.total_amount) : NaN;
  return {
    id: s(r, 'id'),
    number: s(r, 'wo_number'),
    title: s(r, 'title') || s(r, 'service_type') || 'Work order',
    client: s(r, 'customer_name') || s(r, 'buyer_company'),
    siteName: s(r, 'site_name'),
    street: s(r, 'site_address'),
    city: s(r, 'site_city'),
    state: s(r, 'site_state'),
    zip: s(r, 'site_zip'),
    siteLat: numOrNull(r.site_lat),
    siteLng: numOrNull(r.site_lng),
    date: dateOnly(s(r, 'scheduled_date')) ?? dateOnly(s(r, 'start_date')),
    startTime: s(r, 'start_time'),
    endTime: s(r, 'end_time'),
    status,
    officeStatus: s(r, 'wo_status') || 'Open',
    highPriority: pr.high,
    priorityLabel: pr.label,
    description: s(r, 'scope_of_work') || s(r, 'description'),
    serviceType: labelOf('serviceTypes', s(r, 'service_type')),
    techs: techList(r),
    pocName: s(r, 'poc_name'),
    pocPhone: s(r, 'poc_phone'),
    pocEmail: s(r, 'poc_email'),
    access: s(r, 'access_instructions'),
    parking: s(r, 'parking_instructions'),
    special: s(r, 'special_instructions'),
    deliverables: s(r, 'deliverables'),
    tools: s(r, 'tools_required'),
    skills: s(r, 'required_skills'),
    tasks: taskList(r),
    questions: questionList(r),
    photoRequired: r.photo_required === true,
    signatureRequired: r.signature_required === true,
    deliverableInstructions: s(r, 'deliverable_instructions'),
    checkedInAt: s(r, 'checked_in_at') || null,
    checkedOutAt: s(r, 'checked_out_at') || null,
    closeoutNotes: s(r, 'closeout_notes'),
    answers: {},
    closeout: parseCloseout(r.closeout),
    myTimeRequest: owner ? null : parseTimeRequest(r.my_time_request),
    timeRequests: owner ? parseTimeRequests(r.time_requests) : {},
    archived: !!s(r, 'archived_at'),
    clientPrice: owner && Number.isFinite(price) ? price : null,
  };
}

/** A row from `wf_tech_jobs()`: the signed-in tech's own job. Never any money. */
export function wfJobFromTech(r: Row): WfJob {
  return base(r, wfStatusFor(s(r, 'wo_status'), s(r, 'my_response'), true), false);
}

/** The owner's work order, with the client price. */
export function wfJobFromOwner(w: EnrichedWorkOrder | Row): WfJob {
  const r = w as Row;
  const techs = techList(r);
  const raw = (r.assignment_responses && typeof r.assignment_responses === 'object')
    ? (r.assignment_responses as Record<string, { status?: string } | null>) : {};
  const answers: Record<string, string> = {};
  for (const t of techs) {
    const a = raw[t]?.status;
    if (a) answers[t] = String(a);
  }
  const given = techs.map((t) => answers[t] ?? '');
  let summary = '';
  if (given.length > 0 && given.every((a) => a === 'declined')) summary = 'declined';
  else if (given.some((a) => a === 'accepted')) summary = 'accepted';
  const job = base(r, wfStatusFor(s(r, 'wo_status'), summary, techs.length > 0), true);
  // A job closed out in the office (archived) is closed, whatever its stage word.
  if (job.archived) job.status = 'closed';
  job.answers = answers;
  return job;
}

// ── Reading a job ───────────────────────────────────────────────────────────

/** "8:00 AM", "8am", "08:00", "13:30" → [hour, minute]; null when unreadable. */
export function parseClockTime(raw: string): [number, number] | null {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*([ap])?\.?\s*m?\.?\s*$/i.exec(raw ?? '');
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? '0');
  const ap = m[3]?.toLowerCase();
  if (min > 59) return null;
  if (ap === 'p' && h < 12) h += 12;
  if (ap === 'a' && h === 12) h = 0;
  if (h > 23) return null;
  return [h, min];
}

export const cityLine = (j: WfJob) =>
  [j.city, [j.state, j.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');

/** Full address for maps; falls back to the site name. */
export function fullAddress(j: WfJob): string {
  const full = [j.street, cityLine(j)].filter(Boolean).join(', ');
  return full || j.siteName;
}

/** "Easton, PA" style, for lists. */
export const place = (j: WfJob) => [j.city, j.state].filter(Boolean).join(', ');

export const tasksDone = (j: WfJob) => j.tasks.filter((t) => t.done).length;
export const isClockedIn = (j: WfJob) => !!j.checkedInAt && !j.checkedOutAt;
export const canWork = (j: WfJob) => j.status === 'scheduled' || j.status === 'inProgress';
export const isFinished = (j: WfJob) => j.status === 'workDone' || j.status === 'closed';

/** Milliseconds logged on the job so far (a running clock counts up to `now`). */
export function workedMs(j: WfJob, now: Date = new Date()): number {
  if (!j.checkedInAt) return 0;
  const start = Date.parse(j.checkedInAt);
  const end = j.checkedOutAt ? Date.parse(j.checkedOutAt) : now.getTime();
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0;
}

export type WfWorkType = 'networking' | 'cabling' | 'cameras' | 'general';

export function workTypeFor(serviceType: string, title: string): WfWorkType {
  const t = `${serviceType} ${title}`.toLowerCase();
  if (/camera|cctv|security|access control/.test(t)) return 'cameras';
  if (/cabl|cat6|drop|fiber|low.voltage/.test(t)) return 'cabling';
  if (/network|router|switch|wifi|starlink|rack/.test(t)) return 'networking';
  return 'general';
}

export const WF_WORK_TYPE_LABEL: Record<WfWorkType, string> = {
  networking: 'Networking',
  cabling: 'Low-voltage cabling',
  cameras: 'Cameras & security',
  general: 'General IT',
};

/** The photo on a job card. */
export function jobImage(j: WfJob): string {
  const t = workTypeFor(j.serviceType, j.title);
  if (t === 'cabling') return '/wf/job_cabling.jpg';
  if (t === 'networking') return '/wf/job_network.jpg';
  return '/wf/job_default.jpg';
}

function daysBetween(fromYmd: string, toYmd: string): number {
  return Math.round((Date.parse(`${toYmd}T12:00:00Z`) - Date.parse(`${fromYmd}T12:00:00Z`)) / 86_400_000);
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtClock12([h, m]: [number, number]): string {
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "Tomorrow · Tue Oct 6, 8:00 AM" — when the job is, said the way people say it. */
export function whenText(j: WfJob, today: string = todayISO()): string {
  if (!j.date) return 'Not scheduled yet';
  const d = new Date(`${j.date}T12:00:00Z`);
  const day = `${DOW[d.getUTCDay()]} ${MON[d.getUTCMonth()]} ${d.getUTCDate()}`;
  const n = daysBetween(today, j.date);
  const rel = n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : n === -1 ? 'Yesterday' : n > 0 ? `In ${n} days` : `${-n} days ago`;
  const t = parseClockTime(j.startTime);
  return t ? `${rel} · ${day}, ${fmtClock12(t)}` : `${rel} · ${day}`;
}

/** "Thu Oct 9, 6:00 PM" — the date and time a tech asked for. */
export function requestWhen(r: { date: string; time: string }): string {
  const d = new Date(`${r.date}T12:00:00Z`);
  const day = `${DOW[d.getUTCDay()]} ${MON[d.getUTCMonth()]} ${d.getUTCDate()}`;
  const t = parseClockTime(r.time);
  return t ? `${day}, ${fmtClock12(t)}` : day;
}

/** "2h 05m" style for summaries. */
export function formatDuration(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
}

/** "02:38:07" for the running clock. */
export function formatClock(ms: number): string {
  const secs = Math.floor(ms / 1000);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(Math.floor(secs / 3600))}:${two(Math.floor(secs / 60) % 60)}:${two(secs % 60)}`;
}

// ── Lists ───────────────────────────────────────────────────────────────────

/** The search box's rule: WO number, title, client, site, city, tech. */
export function matchesWf(j: WfJob, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [j.number, j.title, j.client, j.siteName, j.city, j.state, j.serviceType, ...j.techs]
    .some((v) => v.toLowerCase().includes(q));
}

/**
 * The order a list reads in: today and what is coming up first (soonest
 * first), then past jobs (most recent first), then jobs with no date.
 * Oldest-first put May's leftovers at the top of the office list.
 */
export function sortWf(jobs: WfJob[], today: string = todayISO()): WfJob[] {
  const rank = (j: WfJob) => (!j.date ? 2 : j.date >= today ? 0 : 1);
  return [...jobs].sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (a.date !== b.date && a.date && b.date) {
      return ra === 0 ? (a.date < b.date ? -1 : 1) : (a.date < b.date ? 1 : -1);
    }
    return a.number.localeCompare(b.number, undefined, { numeric: true });
  });
}

/** The stages that actually have jobs in them, for the filter chips. */
export function statusesPresent(jobs: WfJob[]): WfStatus[] {
  const have = new Set(jobs.map((j) => j.status));
  return WF_STATUS_ORDER.filter((st) => have.has(st));
}

/** The three numbers at the top of the office's Work Orders. */
export function ownerCounts(jobs: WfJob[], today: string = todayISO()) {
  const live = jobs.filter((j) => !j.archived);
  return {
    needTech: live.filter((j) => j.status === 'open').length,
    waiting: live.filter((j) => j.status === 'offered').length,
    today: live.filter((j) => j.date === today && j.status !== 'closed').length,
    workDone: live.filter((j) => j.status === 'workDone').length,
  };
}

/** The three numbers at the top of a tech's jobs. */
export function techCounts(jobs: WfJob[], today: string = todayISO(), now: Date = new Date()) {
  return {
    today: jobs.filter((j) => j.date === today && !isFinished(j) && j.status !== 'declined').length,
    inProgress: jobs.filter((j) => j.status === 'inProgress').length,
    offers: jobs.filter((j) => j.status === 'offered').length,
    workedTodayMs: jobs
      .filter((j) => j.checkedInAt && todayISO(new Date(j.checkedInAt)) === today)
      .reduce((sum, j) => sum + workedMs(j, now), 0),
  };
}

// ── What a tap changes, shown at once (even with no signal) ─────────────────

export function withTask(j: WfJob, taskId: string, done: boolean): WfJob {
  return { ...j, tasks: j.tasks.map((t) => (t.id === taskId ? { ...t, done } : t)) };
}

export function clockedIn(j: WfJob, at: Date): WfJob {
  return { ...j, checkedInAt: at.toISOString(), checkedOutAt: null, status: 'inProgress', officeStatus: 'In Progress' };
}

export function clockedOut(j: WfJob, at: Date): WfJob {
  return isClockedIn(j) ? { ...j, checkedOutAt: at.toISOString() } : j;
}

export function answered(j: WfJob, accept: boolean): WfJob {
  return { ...j, status: accept ? 'scheduled' : 'declined' };
}

/** A closeout change shows at once, signal or not. */
export function withCloseout(j: WfJob, op: CloseoutOp): WfJob {
  return { ...j, closeout: applyCloseoutOp(j.closeout, op) };
}

/** An ask for another time (null: taken back) shows at once. */
export function withTimeRequest(j: WfJob, req: TimeRequest | null): WfJob {
  return { ...j, myTimeRequest: req };
}

/** Notes and answers saved on the phone show at once, signal or not. */
export function withReport(j: WfJob, notes: string | null, answers: Record<string, string>): WfJob {
  return {
    ...j,
    closeoutNotes: notes ?? j.closeoutNotes,
    questions: j.questions.map((q) => (q.id in answers ? { ...q, answer: answers[q.id] ?? '' } : q)),
  };
}

/**
 * What still has to be filled in before a tech can say the work is done —
 * the same rules as the emailed job link: notes for the office, every
 * question answered, and a photo when the job needs photos. A signature, when
 * required, is taken in the Work done window itself.
 */
export function reportMissing(j: WfJob, notes: string, answers: Record<string, string>, photoCount: number): string[] {
  const missing: string[] = [];
  if (!notes.trim()) missing.push('Write what you did, in the notes for the office');
  for (const q of j.questions) {
    if (!(answers[q.id] ?? q.answer).trim()) missing.push(`Answer: ${q.label}`);
  }
  if (j.photoRequired && photoCount === 0) missing.push('Add at least one photo of the work');
  return missing;
}

export function markedWorkDone(j: WfJob, notes: string, at: Date): WfJob {
  const out = clockedOut(j, at);
  return { ...out, status: 'workDone', officeStatus: 'Work Done', closeoutNotes: notes || out.closeoutNotes };
}

/** Plain words for the reasons the server functions give back. */
export function wfReasonText(reason: string, name?: string): string {
  switch (reason) {
    case 'closed_or_not_yours': return 'That job is closed or no longer yours.';
    case 'not_your_job': return 'That job is no longer assigned to you.';
    case 'bad_closeout': return "That closeout entry wasn't complete. Check it and try again.";
    case 'bad_date': return 'Pick a date from today on.';
    case 'already_taken': return 'Someone else already took that job.';
    case 'no_such_task': return 'That checklist item was changed in the office. Pull down to refresh.';
    case 'not_owner': return 'Only the owner can do that.';
    case 'closed': return 'That job is closed. Reopen it first.';
    case 'unknown_tech': return `${name ?? 'That tech'} is not on your contractor list.`;
    case 'paid_tech': return `${name ?? 'A tech'} has already been paid on this job. Use Reassign, which splits the paid and unpaid money.`;
    case 'not_found': return 'That job was not found. It may have been deleted.';
    case 'not_a_tech': return 'This login is not set up as a tech.';
    default: return "That didn't go through. Try again.";
  }
}

// ── The four lists (Fred, 2026-10-02: "don't want to see all the jobs — I want
//    to see available, current, pending and closed") ─────────────────────────

export type WfBucket = 'available' | 'current' | 'pending' | 'closed';

export const WF_BUCKETS: { key: WfBucket; label: string; hint: { tech: string; office: string } }[] = [
  { key: 'available', label: 'Available', hint: { tech: 'Sent to you — waiting for your answer', office: 'Needs a tech, or waiting on a tech to answer' } },
  { key: 'current',   label: 'Current',   hint: { tech: 'Accepted — scheduled or in progress', office: 'Scheduled or in progress' } },
  { key: 'pending',   label: 'Pending',   hint: { tech: 'Work done — waiting on the office', office: 'Work done — close and bill' } },
  { key: 'closed',    label: 'Closed',    hint: { tech: 'Finished and closed', office: 'Approved, paid or archived' } },
];

/**
 * Which list a job sits in. A tech's declined offer leaves their lists; for
 * the office a job every tech declined needs a tech again, so it is available.
 */
export function bucketOf(s: WfStatus, ownerView = false): WfBucket | null {
  switch (s) {
    case 'open':
    case 'offered':
      return 'available';
    case 'declined':
      return ownerView ? 'available' : null;
    case 'scheduled':
    case 'inProgress':
      return 'current';
    case 'workDone':
      return 'pending';
    case 'closed':
      return 'closed';
  }
}

export function bucketCounts(jobs: WfJob[], ownerView = false): Record<WfBucket, number> {
  const c: Record<WfBucket, number> = { available: 0, current: 0, pending: 0, closed: 0 };
  for (const j of jobs) {
    const b = bucketOf(j.status, ownerView);
    if (b) c[b]++;
  }
  return c;
}

/**
 * Crew-project sites in the tech's four lists (Fred, 2026-10-02: "remove crew
 * project and add it to jobs as available"). An open site a lead can take is
 * Available; their own sites are Current until the work is done, Pending
 * while the office checks the paperwork, and Closed once audited.
 */
export function crewBucket(status: string, mine: boolean): WfBucket {
  if (!mine) return 'available';
  if (status === 'done' || status === 'deliverables_in') return 'pending';
  if (status === 'audited') return 'closed';
  return 'current';
}
