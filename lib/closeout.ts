// Job closeout and "suggest another time" (Fred, 2026-10-04: "can workflow
// update to what you see" — the Primio WorkFlow app — "everything", "No pay
// for techs"). Migration 105.
//
// Closeout: what a tech hands over at the end of a job — the deliverables for
// the job type ticked off, any delays logged, and the customer's sign-off. Work
// done waits until every deliverable is ticked, and the sign-off is in when the
// office asked for a signature.
//
// Time requests: a tech offered a job can ask for another date and time with a
// note. Never pay — techs do not see or propose money. Fred answers in
// WorkFlow: use the new time, or keep the original.
//
// Pure and unit-tested (lib/closeout.test.ts).

// ── Deliverables by job type (the lists from Primio's closeout.dart) ───────

export const KIOSK_DELIVERABLES = [
  'Boxes and equipment as delivered',
  'Cable tester showing "Pass"',
  'Bridge PC installed',
  'Ceiling pole and trim close-up',
  'Ceiling pole attachment point',
  'Tidy cable management',
  'Kiosk foot bolted down',
  'Pin pad side view',
  'Completed kiosk',
  'Kiosk in room: logo screen, pink LED, pin pad on',
  'Gift card and credit card test receipts',
];

export const SURVEY_DELIVERABLES = [
  'Completed site survey form',
  'Floorplan with drop locations noted',
  'Hours needed per technician',
  'Materials list',
  'Photo: building exterior and entrance',
  'Photo: ISP demarc',
  'Photo: MDF / IDF rooms',
  'Photo: existing racks and patch panels',
  'Photo: ceiling and cable pathways',
  'Photo: each proposed drop location',
  'Photo: power and grounding',
  'Video walkthrough of the site',
  'Photos clear, well lit and labeled',
];

export const STANDARD_DELIVERABLES = [
  'Before photos of the work area',
  'Cable test results',
  'Cables and patch panel labeled',
  'After photos of the finished work',
  'Work area cleaned up',
];

/** Kiosk jobs, surveys, and everything else — read from the job's own words. */
export function deliverablesFor(title: string, description: string): string[] {
  const text = `${title} ${description}`.toLowerCase();
  if (text.includes('kiosk')) return KIOSK_DELIVERABLES;
  if (text.includes('survey')) return SURVEY_DELIVERABLES;
  return STANDARD_DELIVERABLES;
}

// ── The closeout record ─────────────────────────────────────────────────────

export type DelayEntry = { id: string; reason: string; start: string; end: string };
export type SignOff = { name: string; signedAt: string };
export type SignSkip = { reason: string; at: string };
export type Closeout = {
  done: string[]; delays: DelayEntry[]; signoff: SignOff | null;
  /**
   * Deliverables the tech couldn't do, with why (Fred, 2026-10-13: "if they
   * can't get a certain picture ... they need to give a reason"). Migration 117.
   */
  skipped?: Record<string, string>;
  /** No customer signature, and why ("contact not on site"). */
  signSkip?: SignSkip | null;
};

export const EMPTY_CLOSEOUT: Closeout = { done: [], delays: [], signoff: null };

type Raw = Record<string, unknown>;
const str = (v: unknown): string => (v == null ? '' : String(v).trim());
const isObj = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v);

/** work_orders.closeout as stored (or anything else) → a safe Closeout. */
export function parseCloseout(raw: unknown): Closeout {
  if (!isObj(raw)) return EMPTY_CLOSEOUT;
  const done = Array.isArray(raw.done) ? [...new Set(raw.done.map(str).filter(Boolean))] : [];
  const delays = Array.isArray(raw.delays)
    ? raw.delays.filter(isObj)
      .map((d) => ({ id: str(d.id), reason: str(d.reason), start: str(d.start), end: str(d.end) }))
      .filter((d) => d.id && Number.isFinite(Date.parse(d.start)) && Number.isFinite(Date.parse(d.end)))
    : [];
  const s = raw.signoff;
  const signoff = isObj(s) && str(s.name) ? { name: str(s.name), signedAt: str(s.signed_at ?? s.signedAt) } : null;
  const out: Closeout = { done, delays, signoff };
  if (isObj(raw.skipped)) {
    const skipped: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw.skipped)) if (str(k) && str(v) && !done.includes(str(k))) skipped[str(k)] = str(v);
    if (Object.keys(skipped).length > 0) out.skipped = skipped;
  }
  const k = raw.sign_skip ?? raw.signSkip;
  if (isObj(k) && str(k.reason) && !signoff) out.signSkip = { reason: str(k.reason), at: str(k.at) };
  return out;
}

/** Why a deliverable wasn't done, if the tech said. */
export const skipReason = (c: Closeout, item: string): string => (c.done.includes(item) ? '' : c.skipped?.[item] ?? '');

export const delayMs = (d: DelayEntry): number => Math.max(0, Date.parse(d.end) - Date.parse(d.start));
export const totalDelayMs = (c: Closeout): number => c.delays.reduce((sum, d) => sum + delayMs(d), 0);

/** Ticked items that are on this job's list (an old tick for another list doesn't count). */
export const doneCount = (c: Closeout, items: string[]): number => items.filter((i) => c.done.includes(i)).length;

/**
 * What still stands between the tech and Work done, in plain words. Every
 * deliverable ticked (Primio's rule); the sign-off when the office switched on
 * "customer signature required" for the job.
 */
export function closeoutMissing(c: Closeout, items: string[], signatureRequired: boolean): string[] {
  const out: string[] = [];
  // A deliverable the tech couldn't do counts once they've said why.
  const left = items.filter((i) => !c.done.includes(i) && !skipReason(c, i)).length;
  if (left > 0) out.push(`Tick off ${left} more deliverable${left === 1 ? '' : 's'} under Closeout`);
  if (signatureRequired && !c.signoff && !c.signSkip) out.push('Get the customer to sign off under Closeout');
  return out;
}

/** One closeout change — the same steps the server applies (wf_tech_closeout). */
export type CloseoutOp =
  | { op: 'tick'; item: string; done: boolean }
  | { op: 'add_delay'; delay: DelayEntry }
  | { op: 'remove_delay'; id: string }
  | { op: 'sign'; name: string; at: string }
  | { op: 'clear_sign' }
  /** Couldn't do it: the reason (an empty reason takes it back). */
  | { op: 'skip'; item: string; reason: string }
  | { op: 'skip_sign'; reason: string; at: string };

/** Shows a change at once on the phone, signal or not. */
export function applyCloseoutOp(c: Closeout, o: CloseoutOp): Closeout {
  switch (o.op) {
    case 'tick': {
      const rest = c.done.filter((d) => d !== o.item);
      if (!o.done) return { ...c, done: rest };
      if (!c.skipped || !(o.item in c.skipped)) return { ...c, done: [...rest, o.item] };
      // Done after all: the reason no longer applies.
      const { [o.item]: _gone, ...skipped } = c.skipped; // eslint-disable-line @typescript-eslint/no-unused-vars
      return { ...c, done: [...rest, o.item], skipped };
    }
    case 'skip': {
      const { [o.item]: _old, ...skipped } = c.skipped ?? {}; // eslint-disable-line @typescript-eslint/no-unused-vars
      const reason = o.reason.trim();
      return reason
        ? { ...c, done: c.done.filter((d) => d !== o.item), skipped: { ...skipped, [o.item]: reason } }
        : { ...c, skipped };
    }
    case 'skip_sign':
      return { ...c, signSkip: o.reason.trim() ? { reason: o.reason.trim(), at: o.at } : null };
    case 'add_delay':
      return c.delays.some((d) => d.id === o.delay.id) ? c : { ...c, delays: [...c.delays, o.delay] };
    case 'remove_delay':
      return { ...c, delays: c.delays.filter((d) => d.id !== o.id) };
    case 'sign':
      return c.signSkip
        ? { ...c, signoff: { name: o.name.trim(), signedAt: o.at }, signSkip: null }
        : { ...c, signoff: { name: o.name.trim(), signedAt: o.at } };
    case 'clear_sign':
      return { ...c, signoff: null };
  }
}

/** The outbox carries plain args; these turn an op into them and back. */
export function closeoutArgs(o: CloseoutOp): Record<string, unknown> {
  switch (o.op) {
    case 'tick': return { item: o.item, done: o.done };
    case 'add_delay': return { id: o.delay.id, reason: o.delay.reason, start: o.delay.start, end: o.delay.end };
    case 'remove_delay': return { id: o.id };
    case 'sign': return { name: o.name };
    case 'clear_sign': return {};
    case 'skip': return { item: o.item, reason: o.reason };
    case 'skip_sign': return { reason: o.reason };
  }
}

export function closeoutOpFrom(op: string, args: Raw, at: string): CloseoutOp | null {
  switch (op) {
    case 'tick': return str(args.item) ? { op, item: str(args.item), done: args.done === true } : null;
    case 'add_delay': return str(args.id)
      ? { op, delay: { id: str(args.id), reason: str(args.reason), start: str(args.start), end: str(args.end) } } : null;
    case 'remove_delay': return { op, id: str(args.id) };
    case 'sign': return str(args.name) ? { op, name: str(args.name), at } : null;
    case 'clear_sign': return { op };
    case 'skip': return str(args.item) ? { op, item: str(args.item), reason: str(args.reason) } : null;
    case 'skip_sign': return { op, reason: str(args.reason), at };
    default: return null;
  }
}

/**
 * "14:05" on the day of `day` (a Date) → ISO. A delay that ends before it
 * starts is taken to run past midnight.
 */
export function delayFromTimes(id: string, reason: string, day: Date, start: string, end: string): DelayEntry | null {
  const at = (hhmm: string) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
    if (!m) return null;
    const d = new Date(day);
    d.setHours(Number(m[1]), Number(m[2]), 0, 0);
    return d;
  };
  const s = at(start), e = at(end);
  if (!s || !e) return null;
  if (e < s) e.setDate(e.getDate() + 1);
  return { id, reason: reason.trim(), start: s.toISOString(), end: e.toISOString() };
}

// ── Asking for another time ─────────────────────────────────────────────────

export type TimeRequestState = 'waiting' | 'accepted' | 'kept';
export type TimeRequest = { date: string; time: string; note: string; at: string; state: TimeRequestState };

function parseOne(raw: unknown): TimeRequest | null {
  if (!isObj(raw)) return null;
  const date = str(raw.date).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const st = str(raw.state);
  return {
    date, time: str(raw.time), note: str(raw.note), at: str(raw.at),
    state: st === 'accepted' || st === 'kept' ? st : 'waiting',
  };
}

/** A tech's own request (wf_tech_jobs → my_time_request). */
export const parseTimeRequest = (raw: unknown): TimeRequest | null => parseOne(raw);

/** work_orders.time_requests → { tech name: request }. */
export function parseTimeRequests(raw: unknown): Record<string, TimeRequest> {
  const out: Record<string, TimeRequest> = {};
  if (!isObj(raw)) return out;
  for (const [name, v] of Object.entries(raw)) {
    const r = parseOne(v);
    if (r && name.trim()) out[name] = r;
  }
  return out;
}

/** Requests Fred still has to answer, from techs who are still on the job. */
export function waitingRequests(requests: Record<string, TimeRequest>, techs: string[]): [string, TimeRequest][] {
  return Object.entries(requests).filter(([name, r]) => r.state === 'waiting' && techs.includes(name));
}

type WoForTime = {
  time_requests?: unknown;
  assignment_responses?: Record<string, unknown> | null;
};

/**
 * Fred takes the tech's time: the job moves to it, the tech counts as having
 * accepted, and the request is marked answered. One update for the office's
 * own row (owner RLS); logged by the caller.
 */
export function acceptTimePatch(wo: WoForTime, name: string, now: Date = new Date()): Record<string, unknown> | null {
  const reqs = isObj(wo.time_requests) ? (wo.time_requests as Raw) : {};
  const r = parseOne(reqs[name]);
  if (!r) return null;
  const at = now.toISOString();
  const patch: Record<string, unknown> = {
    start_date: r.date,
    scheduled_date: r.date,
    time_requests: { ...reqs, [name]: { ...(reqs[name] as Raw), state: 'accepted', answered_at: at } },
    assignment_responses: { ...(wo.assignment_responses ?? {}), [name]: { status: 'accepted', at } },
    updated_at: at,
  };
  if (r.time) patch.start_time = r.time;
  return patch;
}

/** Fred keeps the original time. The offer still stands for the tech to answer. */
export function keepTimePatch(wo: WoForTime, name: string, now: Date = new Date()): Record<string, unknown> | null {
  const reqs = isObj(wo.time_requests) ? (wo.time_requests as Raw) : {};
  if (!parseOne(reqs[name])) return null;
  const at = now.toISOString();
  return {
    time_requests: { ...reqs, [name]: { ...(reqs[name] as Raw), state: 'kept', answered_at: at } },
    updated_at: at,
  };
}

// ── Checklists Fred edits in admin (migration-106) ─────────────────────────

export type CloseoutList = { id: string; name: string; keywords: string[]; items: string[]; sort: number };

/** closeout_lists rows (or wf_tech_closeout_lists()) → clean lists, in order. */
export function parseCloseoutLists(raw: unknown): CloseoutList[] {
  if (!Array.isArray(raw)) return [];
  const words = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
  return raw
    .filter(isObj)
    .map((r) => ({
      id: str(r.id), name: str(r.name) || 'Checklist',
      keywords: words(r.keywords).map((k) => k.toLowerCase()), items: words(r.items),
      sort: Number.isFinite(Number(r.sort)) ? Number(r.sort) : 0,
    }))
    .filter((l) => l.items.length > 0)
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
}

/**
 * The checklist for a job: the first list with a keyword in the job's title or
 * description, else the list with no keywords. With no lists (offline, or none
 * saved yet) Primio's built-in lists apply.
 */
export function listFor(lists: CloseoutList[], title: string, description: string): { name: string; items: string[] } {
  const text = `${title} ${description}`.toLowerCase();
  const hit = lists.find((l) => l.keywords.some((k) => text.includes(k)))
    ?? lists.find((l) => l.keywords.length === 0);
  if (hit) return { name: hit.name, items: hit.items };
  const items = deliverablesFor(title, description);
  return { name: items === KIOSK_DELIVERABLES ? 'Kiosk install' : items === SURVEY_DELIVERABLES ? 'Site survey' : 'Standard job', items };
}
