// "Generate with AI" for a new work order (Fred, 2026-10-02: "fix the AI
// generate — it needs to look and fill in everything necessary").
//
// The model reads whatever Fred pastes (a Field Nation or NetView email, a
// client's message, his own notes) and fills every work order field it can
// find, plus a checklist for the tech. Everything it returns passes through
// sanitizeWoAi() before it reaches the form: unknown keys are dropped, choices
// must be one of the app's own options, dates/times/states must look right,
// and nothing about techs or tech pay is ever taken from it (that stays
// Fred's call). Pure and unit-tested (lib/wo-ai.test.ts).
import type { WoTask, WorkOrder } from './types';
import { PAY_TYPES, SERVICE_TYPES, WORK_ORDER_PRIORITIES, WORK_ORDER_SOURCES, SCHEDULE_TYPES } from './types';

export const WO_AI_MODEL = 'claude-sonnet-5-5';

const TEXT_FIELDS = [
  'title', 'description', 'customer_name', 'project_name', 'buyer_company', 'external_wo_id', 'client_reference',
  'site_name', 'site_address', 'site_city', 'site_zip',
  'poc_name', 'poc_phone', 'poc_email', 'support_contact',
  'access_instructions', 'parking_instructions',
  'tools_required', 'parts_materials', 'required_skills',
  'deliverables', 'deliverable_instructions',
] as const;
const NUMBER_FIELDS = ['total_amount', 'hourly_rate', 'per_device_rate', 'device_count'] as const;
const CHOICE_FIELDS: Record<string, readonly string[]> = {
  service_type: SERVICE_TYPES, priority: WORK_ORDER_PRIORITIES, source_platform: WORK_ORDER_SOURCES,
  pay_type: PAY_TYPES, schedule_type: SCHEDULE_TYPES,
};
const TASK_CATEGORIES: WoTask['category'][] = ['Pre Visit', 'On Site', 'Post Site'];
const US_ZONES = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu'];

export function buildWoPrompt(text: string, today: string): string {
  return `You fill in work orders for FAJ Solutions, an IT and low-voltage field services company in Easton, PA (network installs, cabling, cameras, POS, Starlink, site surveys). Work comes from clients (Wendy's, State Farm, Trulieve, …) and from work marketplaces (Field Nation, NetView, WorkMarket, Insight, …).

Read the job below and return ONLY one JSON object (no markdown) with these keys. Use null for anything the text does not say. NEVER invent names, phone numbers, addresses, prices or dates. Today is ${today}; resolve words like "next Tuesday".

{
  "title": short summary, max 70 chars, lead with the brand/site, e.g. "Wendy's #5798 — POS network refresh",
  "description": the full scope of work, cleaned up — keep every technical detail, counts, models, rooms,
  "service_type": one of ${JSON.stringify(SERVICE_TYPES)},
  "priority": one of ${JSON.stringify(WORK_ORDER_PRIORITIES)},
  "source_platform": where the work came from, one of ${JSON.stringify(WORK_ORDER_SOURCES)} ("FieldNation" for Field Nation, "NetView", "WorkMarket", "Direct" for a client emailing FAJ directly),
  "external_wo_id": the sender's own work order / ticket / assignment number,
  "buyer_company": the company that sent the work (the marketplace buyer, MSP or dispatcher),
  "client_reference": PO, store number, billing or project code,
  "customer_name": the end client / brand (e.g. "Wendy's"),
  "project_name": project or program name,
  "site_name": the location's name, e.g. "Wendy's #5798",
  "site_address": street address only,
  "site_city": city,
  "site_state": 2-letter state,
  "site_zip": ZIP,
  "time_zone": IANA zone for the site, e.g. "America/New_York" (you may infer it from the state),
  "start_date": "YYYY-MM-DD",
  "start_time": "HH:MM" 24-hour,
  "end_date": "YYYY-MM-DD",
  "end_time": "HH:MM" 24-hour,
  "schedule_type": one of ${JSON.stringify(SCHEDULE_TYPES)},
  "poc_name": the on-site contact,
  "poc_phone": their phone,
  "poc_email": their email,
  "support_contact": the help desk / dispatch line to call during the job,
  "access_instructions": how to get in, who to ask for, check-in rules,
  "parking_instructions": where to park,
  "tools_required": tools the tech must bring,
  "parts_materials": parts and materials needed or shipped,
  "required_skills": skills or certifications needed,
  "deliverables": what must be handed over, ONE ITEM PER LINE,
  "deliverable_instructions": photos, sign-off, closeout and reporting requirements,
  "photo_required": true | false | null,
  "signature_required": true | false | null,
  "total_amount": what the client or marketplace pays FAJ for the job, in dollars,
  "pay_type": one of ${JSON.stringify(PAY_TYPES)},
  "hourly_rate": dollars per hour if paid hourly,
  "per_device_rate": dollars per device if paid per device,
  "device_count": number of devices,
  "wo_tasks": the tech's checklist, 3-15 short steps in order, each {"category": "Pre Visit" | "On Site" | "Post Site", "label": "..."} — taken from the scope, the deliverables and the closeout rules (e.g. call the contact before arrival, check in with the manager, the work itself, test, photos, check out)
}

Job:
"""
${text}
"""

Return only the JSON object.`;
}

/** The JSON object in a model's answer, even with fences or words around it. */
export function parseModelJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

const clean = (v: unknown, max = 4000): string | null => {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const s = String(v).replace(/\r\n/g, '\n').trim();
  return s ? s.slice(0, max) : null;
};

function newId(): string {
  try { return crypto.randomUUID(); } catch { return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }
}

/** Only what the form understands, in the shapes it expects. */
export function sanitizeWoAi(raw: unknown): Partial<WorkOrder> {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const k of TEXT_FIELDS) {
    const v = clean(r[k], k === 'description' || k === 'deliverables' ? 8000 : k === 'title' ? 90 : 2000);
    if (v) out[k] = v;
  }
  for (const k of NUMBER_FIELDS) {
    if (r[k] === null || r[k] === undefined || r[k] === '') continue;
    const n = Number(String(r[k]).replace(/[$,\s]/g, ''));
    if (Number.isFinite(n) && n >= 0) out[k] = k === 'device_count' ? Math.round(n) : Math.round(n * 100) / 100;
  }
  for (const [k, options] of Object.entries(CHOICE_FIELDS)) {
    const v = clean(r[k], 60);
    if (!v) continue;
    const hit = options.find((o) => o.toLowerCase().replace(/[\s/_-]/g, '') === v.toLowerCase().replace(/[\s/_-]/g, ''));
    if (hit) out[k] = hit;
  }
  const state = clean(r.site_state, 20)?.toUpperCase();
  if (state && /^[A-Z]{2}$/.test(state)) out.site_state = state;
  const tz = clean(r.time_zone, 60);
  if (tz && US_ZONES.includes(tz)) out.time_zone = tz;
  for (const k of ['start_date', 'end_date'] as const) {
    const v = clean(r[k], 20);
    if (v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`))) out[k] = v;
  }
  for (const k of ['start_time', 'end_time'] as const) {
    const m = /^(\d{1,2}):(\d{2})/.exec(clean(r[k], 10) ?? '');
    if (m && Number(m[1]) < 24 && Number(m[2]) < 60) out[k] = `${m[1].padStart(2, '0')}:${m[2]}`;
  }
  // The calendar shows a job on its scheduled date; a new job is scheduled for its start.
  if (out.start_date) out.scheduled_date = out.start_date;
  for (const k of ['photo_required', 'signature_required'] as const) {
    if (typeof r[k] === 'boolean') out[k] = r[k];
  }
  if (out.poc_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(out.poc_email))) delete out.poc_email;

  if (Array.isArray(r.wo_tasks)) {
    const tasks: WoTask[] = [];
    for (const t of r.wo_tasks.slice(0, 25)) {
      const label = clean(typeof t === 'string' ? t : (t as Record<string, unknown> | null)?.label, 140);
      if (!label) continue;
      const catRaw = typeof t === 'object' && t ? String((t as Record<string, unknown>).category ?? '') : '';
      const category = TASK_CATEGORIES.find((c) => c.toLowerCase() === catRaw.toLowerCase()) ?? 'On Site';
      tasks.push({ id: newId(), category, label, completed: false, completed_at: null });
    }
    if (tasks.length) out.wo_tasks = tasks;
  }
  return out as Partial<WorkOrder>;
}

/** How many fields were filled, for the "filled 18 fields" message. */
export function filledCount(f: Partial<WorkOrder>): number {
  return Object.keys(f).filter((k) => k !== 'scheduled_date' && k !== 'wo_tasks').length;
}

/**
 * Why the AI part didn't run, as a reason code the route returns
 * (Fred, 2026-10-17: "Generate with AI needs fixing" — every failure used to
 * show the same "The AI didn't answer"). Reads the status and the start of
 * Anthropic's error text; never sees or returns the key.
 */
export function aiFailureReason(status: number, errorText: string): string {
  const t = errorText.toLowerCase();
  if (status === 400 && /credit balance|billing|purchase credits/.test(t)) return 'ai_credit';
  if (status === 400 && /workspace/.test(t)) return 'ai_workspace';
  if (status === 401) return 'ai_401';
  if (status === 403) return 'ai_403';
  if (status === 404) return 'ai_404';
  if (status === 429) return 'ai_429';
  if (status === 529 || status >= 500) return 'ai_busy';
  return `ai_${status}`;
}

/** What Fred reads when only the basics were filled, by reason code. */
export function aiFailureText(why: string | undefined): string {
  const tail = ' Only the basics were filled (address, price, dates, contact). Check them, then Save.';
  switch (why) {
    case 'no_key': return "The AI isn't connected on the live site (no AI key is set)." + tail;
    case 'ai_401': return 'The AI key was refused: it is wrong or was turned off. A new key is needed.' + tail;
    case 'ai_403': return "The AI key isn't allowed to do this. A new key is needed." + tail;
    case 'ai_credit': return 'The AI account is out of credit. Add credit at console.anthropic.com.' + tail;
    case 'ai_workspace': return 'The AI key isn’t in a workspace. Make the key inside the Default workspace at console.anthropic.com.' + tail;
    case 'ai_404': return "The AI model the app asks for isn't available." + tail;
    case 'ai_429': return 'The AI is getting too many requests right now. Try again in a minute.' + tail;
    case 'ai_busy': return 'The AI service is overloaded right now. Try again in a minute.' + tail;
    case 'ai_unreadable': return "The AI answered, but its reply couldn't be read. Try again." + tail;
    default: return "The AI didn't answer." + tail;
  }
}
