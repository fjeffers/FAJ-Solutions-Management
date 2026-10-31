// Client templates (Fred, 2026-10-31: "i want a general work order but then templates for each like
// wendys dunkin LDS etc"). A job template (lib/capture.ts) can also carry what that client's work
// orders always say: the client, the type of work, the scope, deliverables, tools, links, the
// checklist and the questions. Picking it on a work order fills in only what is still empty, so
// nothing typed for this site is overwritten. General is no template: the blank work order.
//
// Pure; unit-tested in lib/template-fill.test.ts.
import { LDS_SCOPE_TEXT, LDS_TOOLS_TEXT, TOOLS_HUB } from './lds-sow';

export type FillTaskCategory = 'Pre Visit' | 'On Site' | 'Post Site';
export const FILL_TASK_CATEGORIES: FillTaskCategory[] = ['Pre Visit', 'On Site', 'Post Site'];

export type TemplateFill = {
  customer_name?: string;
  service_type?: string;
  description?: string;
  deliverables?: string;
  deliverable_instructions?: string;
  tools_required?: string;
  required_skills?: string;
  client_links?: string[];
  checkin_link?: string;
  checkout_link?: string;
  survey_link?: string;
  deliverable_link?: string;
  tasks?: { category: FillTaskCategory; label: string }[];
  questions?: string[];
};

export const FILL_TEXT_FIELDS = [
  'customer_name', 'service_type', 'description', 'deliverables', 'deliverable_instructions', 'tools_required',
  'required_skills', 'checkin_link', 'checkout_link', 'survey_link', 'deliverable_link',
] as const;
export type FillTextField = (typeof FILL_TEXT_FIELDS)[number];

const MAX_TEXT = 8000;
const MAX_LIST = 60;
const text = (v: unknown, max = MAX_TEXT) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const lines = (v: unknown, max = MAX_LIST) => (Array.isArray(v) ? v.map((x) => text(x, 300)).filter(Boolean).slice(0, max) : []);

/** Saved settings (or anything else) → a safe fill, or undefined when it says nothing. */
export function parseFill(raw: unknown): TemplateFill | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const out: TemplateFill = {};
  for (const k of FILL_TEXT_FIELDS) { const v = text(o[k]); if (v) out[k] = v; }
  const links = lines(o.client_links);
  if (links.length) out.client_links = links;
  const tasks = Array.isArray(o.tasks) ? o.tasks.flatMap((t) => {
    const r = (t ?? {}) as Record<string, unknown>;
    const label = text(r.label, 300);
    const category = FILL_TASK_CATEGORIES.includes(r.category as FillTaskCategory) ? (r.category as FillTaskCategory) : 'On Site';
    return label ? [{ category, label }] : [];
  }).slice(0, MAX_LIST) : [];
  if (tasks.length) out.tasks = tasks;
  const questions = lines(o.questions);
  if (questions.length) out.questions = questions;
  return Object.keys(out).length ? out : undefined;
}

/** How many things a fill sets, for "fills in 6 things". */
export const fillCount = (f: TemplateFill | undefined): number =>
  !f ? 0 : FILL_TEXT_FIELDS.filter((k) => f[k]).length + (f.client_links?.length ? 1 : 0) + (f.tasks?.length ? 1 : 0) + (f.questions?.length ? 1 : 0);

export type JobNow = Partial<Record<FillTextField, string | null>> & {
  client_links: string[]; tasks: number; questions: number;
};
export type FillPlan = {
  fields: Partial<Record<FillTextField, string>>;
  /** Links to add (the job's own stay). */
  links: string[];
  /** Only when the job has none yet. */
  tasks: { category: FillTaskCategory; label: string }[];
  questions: string[];
};

/** What picking the template changes on this job: only what is still empty. */
export function planFill(f: TemplateFill | undefined, job: JobNow): FillPlan {
  const plan: FillPlan = { fields: {}, links: [], tasks: [], questions: [] };
  if (!f) return plan;
  for (const k of FILL_TEXT_FIELDS) if (f[k] && !(job[k] ?? '').trim()) plan.fields[k] = f[k];
  plan.links = (f.client_links ?? []).filter((l) => !job.client_links.includes(l));
  if (!job.tasks) plan.tasks = f.tasks ?? [];
  if (!job.questions) plan.questions = f.questions ?? [];
  return plan;
}
export const planSize = (p: FillPlan): number =>
  Object.keys(p.fields).length + (p.links.length ? 1 : 0) + (p.tasks.length ? 1 : 0) + (p.questions.length ? 1 : 0);

/** This work order's details as a template fill (the "Save into template" button). Site-only details stay out. */
export function fillFromJob(job: Partial<Record<FillTextField, string | null>> & {
  client_links?: string[]; tasks?: { category: string; label: string }[]; questions?: string[];
}): TemplateFill | undefined {
  return parseFill({
    ...Object.fromEntries(FILL_TEXT_FIELDS.map((k) => [k, job[k] ?? ''])),
    client_links: job.client_links ?? [],
    tasks: (job.tasks ?? []).map((t) => ({ label: t.label, category: t.category === 'Prep' ? 'Pre Visit' : t.category === 'Post' ? 'Post Site' : t.category })),
    questions: job.questions ?? [],
  });
}

// ── Starter client templates ────────────────────────────────────────────────

export type StarterClient = { name: string; items: string[]; fill: TemplateFill };
const FIELD_ITEMS = ['travel', 'odometer', 'receipts', 'photos', 'checklist', 'questions', 'notes'];

/**
 * LDS from NetView's Installer SOW (lib/lds-sow.ts); its five-day closeout list stays off until it's redone
 * (Fred, 2026-10-31: "LDS checklist we can redo or remove until we can do better"). Wendy's and Dunkin start
 * with the client only: build one work order the way you want it, then Save into template.
 */
export const STARTER_CLIENTS: StarterClient[] = [
  {
    name: 'LDS', items: FIELD_ITEMS, fill: {
      customer_name: 'NetView', service_type: 'Network install', description: LDS_SCOPE_TEXT, tools_required: LDS_TOOLS_TEXT,
      client_links: [TOOLS_HUB],
    },
  },
  { name: "Wendy's", items: FIELD_ITEMS, fill: { customer_name: "Wendy's" } },
  { name: 'Dunkin', items: FIELD_ITEMS, fill: { customer_name: 'Dunkin' } },
];
