// What a job asks the tech for (Fred, 2026-10-18: "I need all work order is
// customizable. No one want to look at blank items if not needed. The work
// order needs to be flexible"). The office ticks the items on each job, or
// picks one of its saved templates; the tech sees only those, and the reports
// show only those. Every new job starts blank (Fred, 2026-10-18: "All work
// order need to start the same way blank, I'll add what's needed, remove the
// old style"). A job with no list at all (every job made before) still asks
// for everything, so jobs already out keep working.
//
// Pure and unit-tested (lib/capture.test.ts).

import { parseStartAsks, type StartAsk } from './checkin';

export type CaptureItem =
  | 'travel' | 'lunch' | 'odometer' | 'receipts' | 'photos'
  | 'checklist' | 'questions' | 'deliverables' | 'signature' | 'notes';

/** In the order the office sees them. Time on site is always kept. */
export const CAPTURE_ITEMS: { key: CaptureItem; label: string; hint: string }[] = [
  { key: 'travel', label: 'Travel', hint: 'Each drive: where from, where to, when, and the GPS miles' },
  { key: 'odometer', label: 'Odometer photos', hint: 'A photo of the odometer at the start and end of each drive; the AI reads it' },
  { key: 'lunch', label: 'Lunch', hint: 'Lunch breaks, taken off the time on site' },
  { key: 'receipts', label: 'Receipts', hint: 'Fuel, meals, hotel, parking and materials, with a photo; the AI reads it' },
  { key: 'photos', label: 'Job photos', hint: 'Photos of the work' },
  { key: 'checklist', label: 'Checklist', hint: "The job's own steps" },
  { key: 'questions', label: 'Questions', hint: "The job's questions for the tech" },
  { key: 'deliverables', label: 'Deliverables', hint: 'The closeout list for this kind of job' },
  { key: 'signature', label: 'Customer signature', hint: 'Sign-off on site, or the reason there is none' },
  { key: 'notes', label: "Tech's notes", hint: 'What got done' },
];
export const ALL_CAPTURE: CaptureItem[] = CAPTURE_ITEMS.map((c) => c.key);
const KNOWN = new Set<string>(ALL_CAPTURE);

/** Whether the job asks for this item. No list means everything. */
export const asks = (capture: readonly CaptureItem[] | null | undefined, item: CaptureItem): boolean =>
  !capture || capture.includes(item);

/** A stored list (or anything else) → the known items in the standard order, or null for "everything". */
export function parseCapture(raw: unknown): CaptureItem[] | null {
  if (!Array.isArray(raw)) return null;
  const set = new Set(raw.map(String));
  return ALL_CAPTURE.filter((k) => set.has(k) && KNOWN.has(k));
}

export type JobTemplate = {
  id: string; name: string; items: CaptureItem[];
  /** What else to ask at check-in (lib/checkin.ts). */
  startAsks?: StartAsk[];
};

/** None: Fred builds his own from blank ("remove the old style"). */
export const STARTER_TEMPLATES: JobTemplate[] = [];

export const TEMPLATE_MAX = 20;

/** user_settings.job_templates (or anything else) → safe templates. A template may be blank (no items yet). */
export function parseTemplates(raw: unknown): JobTemplate[] {
  if (!Array.isArray(raw) || raw.length === 0) return STARTER_TEMPLATES;
  const out: JobTemplate[] = [];
  const ids = new Set<string>();
  for (const t of raw) {
    if (!t || typeof t !== 'object') continue;
    const o = t as Record<string, unknown>;
    const id = typeof o.id === 'string' && /^[a-z0-9-]{1,40}$/.test(o.id) ? o.id : '';
    const name = typeof o.name === 'string' ? o.name.replace(/\s+/g, ' ').trim().slice(0, 60) : '';
    const items = parseCapture(o.items) ?? [];
    if (!id || !name || ids.has(id)) continue;
    ids.add(id);
    const startAsks = parseStartAsks(o.startAsks);
    out.push(startAsks.length ? { id, name, items, startAsks } : { id, name, items });
    if (out.length >= TEMPLATE_MAX) break;
  }
  return out.length ? out : STARTER_TEMPLATES;
}

/**
 * The template these exact items match, if any (to show which one a job uses).
 * Given the job's check-in items too, they must match as well, so two templates
 * with the same ticks are told apart.
 */
export function templateOf(items: readonly CaptureItem[] | null, templates: JobTemplate[], startAsks?: readonly StartAsk[]): JobTemplate | null {
  if (!items) return null;
  const key = [...items].sort().join();
  const asksKey = (l: readonly StartAsk[]) => l.map((a) => `${a.kind}:${a.label}`).join('|');
  return templates.find((t) => [...t.items].sort().join() === key && (!startAsks || asksKey(t.startAsks ?? []) === asksKey(startAsks))) ?? null;
}

// ── Editing templates (Settings -> Job templates) ───────────────────────────

/** Tick or untick one item, keeping the standard order. */
export function toggleItem(items: readonly CaptureItem[], key: CaptureItem): CaptureItem[] {
  const set = new Set(items);
  if (set.has(key)) set.delete(key); else set.add(key);
  return ALL_CAPTURE.filter((k) => set.has(k));
}

const cleanName = (name: string) => name.replace(/\s+/g, ' ').trim().slice(0, 60);
const sameName = (a: string, b: string) => cleanName(a).toLowerCase() === cleanName(b).toLowerCase();

/** A new template, or null when the name is empty, taken, or there are too many. */
export function addTemplate(list: JobTemplate[], name: string, items: CaptureItem[], idSeed: string): JobTemplate[] | null {
  const n = cleanName(name);
  if (!n || list.length >= TEMPLATE_MAX || list.some((t) => sameName(t.name, n))) return null;
  const base = n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'template';
  const id = `${base}-${idSeed.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || '1'}`;
  if (list.some((t) => t.id === id)) return null;
  return [...list, { id, name: n, items: ALL_CAPTURE.filter((k) => items.includes(k)) }];
}

/** Rename one; null when the new name is empty or another template has it. */
export function renameTemplate(list: JobTemplate[], id: string, name: string): JobTemplate[] | null {
  const n = cleanName(name);
  if (!n || list.some((t) => t.id !== id && sameName(t.name, n))) return null;
  return list.map((t) => (t.id === id ? { ...t, name: n } : t));
}

/** Change one's items (none is fine: a blank template). */
export function setTemplateItems(list: JobTemplate[], id: string, items: CaptureItem[]): JobTemplate[] {
  return list.map((t) => (t.id === id ? { ...t, items: ALL_CAPTURE.filter((k) => items.includes(k)) } : t));
}

export const removeTemplate = (list: JobTemplate[], id: string): JobTemplate[] => list.filter((t) => t.id !== id);

/** Change one's check-in items. */
export const setTemplateStartAsks = (list: JobTemplate[], id: string, startAsks: StartAsk[]): JobTemplate[] =>
  list.map((t) => (t.id === id ? (startAsks.length ? { ...t, startAsks } : { id: t.id, name: t.name, items: t.items }) : t));
