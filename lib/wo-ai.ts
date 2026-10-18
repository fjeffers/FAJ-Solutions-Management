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
//
// Fred, 2026-10-18: "fix the Generate with AI ... fill in every field on the
// work order". It now also fills check-in / check-out, assignment type, the
// expense budget, travel and bonus amounts, every site contact, the questions
// the tech answers, and Fred's own custom fields; the model's answer is held
// to woAiSchema() (structured outputs), so a stray word can't lose the lot.
import type { CustomQAItem, QuestionFieldType, SiteContact, WoTask, WorkOrder } from './types';
import { ASSIGNMENT_TYPES, PAY_TYPES, SERVICE_TYPES, WORK_ORDER_PRIORITIES, WORK_ORDER_SOURCES, SCHEDULE_TYPES } from './types';
import type { CustomValues, FieldDef } from './custom-fields';

export const WO_AI_MODEL = 'claude-opus-5-5';

const TEXT_FIELDS = [
  'title', 'description', 'customer_name', 'project_name', 'buyer_company', 'external_wo_id', 'client_reference',
  'site_name', 'site_address', 'site_city', 'site_zip',
  'poc_name', 'poc_phone', 'poc_email', 'support_contact',
  'access_instructions', 'parking_instructions',
  'tools_required', 'parts_materials', 'required_skills',
  'deliverables', 'deliverable_instructions',
] as const;
const NUMBER_FIELDS = ['total_amount', 'hourly_rate', 'per_device_rate', 'device_count', 'expense_budget', 'travel_amount', 'bonus_amount'] as const;
const CHOICE_FIELDS: Record<string, readonly string[]> = {
  service_type: SERVICE_TYPES, priority: WORK_ORDER_PRIORITIES, source_platform: WORK_ORDER_SOURCES,
  pay_type: PAY_TYPES, schedule_type: SCHEDULE_TYPES, assignment_type: ASSIGNMENT_TYPES,
};
const BOOL_FIELDS = ['photo_required', 'signature_required', 'check_in_required', 'check_out_required'] as const;
const TASK_CATEGORIES: WoTask['category'][] = ['Pre Visit', 'On Site', 'Post Site'];
const QUESTION_TYPES: QuestionFieldType[] = ['text', 'number', 'yes_no', 'textarea', 'photo', 'document', 'signature'];
const US_ZONES = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu'];

/** Fred's own job fields (Settings -> Custom fields) the AI may fill, as the prompt describes them. */
export type AiCustomField = Pick<FieldDef, 'id' | 'label' | 'kind' | 'options'>;

function customLines(defs: AiCustomField[]): string {
  return defs.map((d) => {
    const what = d.kind === 'number' ? 'a number' : d.kind === 'date' ? '"YYYY-MM-DD"' : d.kind === 'yesno' ? 'true | false'
      : d.kind === 'choice' ? `one of ${JSON.stringify(d.options)}` : d.kind === 'longtext' ? 'text (can be long)' : 'short text';
    return `    "${d.id}": ${d.label} — ${what}`;
  }).join(',\n');
}

export function buildWoPrompt(text: string, today: string, custom: AiCustomField[] = []): string {
  return `You fill in work orders for FAJ Solutions, an IT and low-voltage field services company in Easton, PA (network installs, cabling, cameras, POS, Starlink, site surveys). Work comes from clients (Wendy's, State Farm, Trulieve, …) and from work marketplaces (Field Nation, NetView, WorkMarket, Insight, …).

Read the job below and fill in EVERY field of the work order the text supports — read it all, including signatures, footers and fine print. Return one JSON object with these keys. Use null (or an empty list) for anything the text does not say. NEVER invent names, phone numbers, addresses, prices or dates. Today is ${today}; resolve words like "next Tuesday".

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
  "check_in_required": true if the tech must check in on arrival (with the site, a help desk or the app), false if the text says not to, else null,
  "check_out_required": the same for checking out,
  "assignment_type": one of ${JSON.stringify(ASSIGNMENT_TYPES)} ("Subcontract" when the work comes from another company or a marketplace, "Direct" when the end client hired FAJ),
  "total_amount": what the client or marketplace pays FAJ for the job, in dollars,
  "pay_type": one of ${JSON.stringify(PAY_TYPES)},
  "hourly_rate": dollars per hour if paid hourly,
  "per_device_rate": dollars per device if paid per device,
  "device_count": number of devices,
  "expense_budget": dollars allowed for expenses or materials, if stated,
  "travel_amount": dollars paid for travel or mileage, if stated,
  "bonus_amount": dollars of bonus or incentive pay, if stated,
  "contacts": EVERY person or line named for the job — site contact, manager, help desk, NOC, project manager, security — each {"label": their role, "name": "...", "phone": "...", "email": "..."} (empty string for what's not given),
  "custom_qa": questions the tech must answer on site or at closeout — serial or MAC numbers to record, readings, counts, yes/no confirmations, photos or documents to attach, a sign-off — each {"label": the question, "type": one of ${JSON.stringify(QUESTION_TYPES)}},
  "wo_tasks": the tech's checklist, 3-15 short steps in order, each {"category": "Pre Visit" | "On Site" | "Post Site", "label": "..."} — taken from the scope, the deliverables and the closeout rules (e.g. call the contact before arrival, check in with the manager, the work itself, test, photos, check out)${custom.length ? `,
  "custom": FAJ's own fields, keyed by id; null when the text doesn't say: {
${customLines(custom)}
  }` : ''}
}

Job:
"""
${text}
"""

Return only the JSON object.`;
}

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] });
const strict = (properties: Record<string, unknown>) => ({
  type: 'object', properties, required: Object.keys(properties), additionalProperties: false,
});

/** The shape the model must answer in (structured outputs). Every key is present; null when unknown. */
export function woAiSchema(custom: AiCustomField[] = []): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  for (const k of TEXT_FIELDS) p[k] = nullable({ type: 'string' });
  for (const k of ['site_state', 'time_zone', 'start_date', 'start_time', 'end_date', 'end_time']) p[k] = nullable({ type: 'string' });
  for (const k of NUMBER_FIELDS) p[k] = nullable({ type: 'number' });
  for (const [k, options] of Object.entries(CHOICE_FIELDS)) p[k] = nullable({ type: 'string', enum: [...options] });
  for (const k of BOOL_FIELDS) p[k] = nullable({ type: 'boolean' });
  p.contacts = { type: 'array', items: strict({ label: { type: 'string' }, name: { type: 'string' }, phone: { type: 'string' }, email: { type: 'string' } }) };
  p.custom_qa = { type: 'array', items: strict({ label: { type: 'string' }, type: { type: 'string', enum: QUESTION_TYPES } }) };
  p.wo_tasks = { type: 'array', items: strict({ category: { type: 'string', enum: TASK_CATEGORIES }, label: { type: 'string' } }) };
  if (custom.length) {
    const c: Record<string, unknown> = {};
    for (const d of custom) {
      c[d.id] = nullable(d.kind === 'number' ? { type: 'number' } : d.kind === 'yesno' ? { type: 'boolean' }
        : d.kind === 'choice' && d.options.length ? { type: 'string', enum: d.options } : { type: 'string' });
    }
    p.custom = strict(c);
  }
  return strict(p);
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
export function sanitizeWoAi(raw: unknown, custom: AiCustomField[] = []): Partial<WorkOrder> {
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
  for (const k of BOOL_FIELDS) {
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

  if (Array.isArray(r.contacts)) {
    const contacts: SiteContact[] = [];
    for (const c of r.contacts.slice(0, 15)) {
      if (!c || typeof c !== 'object') continue;
      const x = c as Record<string, unknown>;
      const name = clean(x.name, 120) ?? '';
      const phone = clean(x.phone, 40) ?? '';
      const emailRaw = clean(x.email, 160) ?? '';
      const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw) ? emailRaw : '';
      if (!name && !phone && !email) continue;
      contacts.push({ id: newId(), label: clean(x.label, 60) ?? '', name, phone, email });
    }
    if (contacts.length) out.contacts = contacts;
  }

  if (Array.isArray(r.custom_qa)) {
    const qa: CustomQAItem[] = [];
    for (const q of r.custom_qa.slice(0, 20)) {
      const label = clean(typeof q === 'string' ? q : (q as Record<string, unknown> | null)?.label, 200);
      if (!label) continue;
      const t = typeof q === 'object' && q ? String((q as Record<string, unknown>).type ?? '') : '';
      qa.push({ id: newId(), label, type: QUESTION_TYPES.includes(t as QuestionFieldType) ? (t as QuestionFieldType) : 'text', answer: null });
    }
    if (qa.length) out.custom_qa = qa;
  }

  // Fred's own fields: only ones that exist, each in its own kind.
  const rc = r.custom && typeof r.custom === 'object' && !Array.isArray(r.custom) ? (r.custom as Record<string, unknown>) : {};
  const values: CustomValues = {};
  for (const d of custom) {
    const v = rc[d.id];
    if (v === null || v === undefined || v === '') continue;
    if (d.kind === 'yesno') { if (typeof v === 'boolean') values[d.id] = v; continue; }
    if (d.kind === 'number') {
      const n = Number(String(v).replace(/[$,\s]/g, ''));
      if (Number.isFinite(n)) values[d.id] = n;
      continue;
    }
    const text = clean(v, d.kind === 'longtext' ? 4000 : 500);
    if (!text) continue;
    if (d.kind === 'date') { if (/^\d{4}-\d{2}-\d{2}$/.test(text)) values[d.id] = text; continue; }
    if (d.kind === 'choice') { const hit = d.options.find((o) => o.toLowerCase() === text.toLowerCase()); if (hit) values[d.id] = hit; continue; }
    values[d.id] = text;
  }
  if (Object.keys(values).length) out.custom = values;
  return out as Partial<WorkOrder>;
}

/** How many fields were filled, for the "filled 18 fields" message. Each of Fred's own fields counts once. */
export function filledCount(f: Partial<WorkOrder>): number {
  const own = f.custom && typeof f.custom === 'object' ? Object.keys(f.custom).length : 0;
  return Object.keys(f).filter((k) => !['scheduled_date', 'wo_tasks', 'custom'].includes(k)).length + own;
}
