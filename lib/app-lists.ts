// Fred's own lists (Settings -> Lists & stages). Fred, 2026-10-05: "I want
// setting to be able to create or change layouts of the app, add, remove
// anything — full admin privilege in settings."
//
// Saved as one JSON value on his user_settings row (migration 109) and checked
// by normalizeLists on every load, so a bad value can't break a screen.
//
// The rules that keep old jobs safe:
// - A list item has a KEY (what's stored on the job) and a LABEL (what's
//   shown). Renaming changes the label only; jobs keep their stored value and
//   simply show the new name.
// - Nothing is deleted. Hiding an item stops it being offered for new jobs;
//   jobs that already use it still show it.
// - Job stages can be renamed for the office, never added or removed — the
//   stages are how the board works.
// - Expense categories are not here: each one decides how a tech is paid back.

// Type-only: lib/wf.ts reads these lists, so a value import here would be circular.
import type { WfStatus } from './wf';
import { ASSIGNMENT_TYPES, SERVICE_TYPES, WORK_ORDER_PRIORITIES, WORK_ORDER_SOURCES } from './types';

export type ListItem = { key: string; label: string; hidden: boolean; urgent?: boolean };
export type ListName = 'priorities' | 'serviceTypes' | 'sources' | 'assignmentTypes' | 'boardColumns';

export type AppLists = {
  /** Office names for the job stages, only where they differ from the standard. */
  stages: Partial<Record<WfStatus, string>>;
  priorities: ListItem[];
  serviceTypes: ListItem[];
  sources: ListItem[];
  assignmentTypes: ListItem[];
  /** Fred's own Dispatch board columns, for jobs waiting on something (lib/dispatch-columns.ts). */
  boardColumns: ListItem[];
};

export const NAME_MAX = 40;
const STAGE_KEYS: WfStatus[] = ['open', 'offered', 'scheduled', 'inProgress', 'workDone', 'closed', 'declined'];
export const LIST_NAMES: ListName[] = ['priorities', 'serviceTypes', 'sources', 'assignmentTypes', 'boardColumns'];

/** As standard, the holding columns Fred used on SimplySub's job board (2026-10-06). */
export const STANDARD_BOARD_COLUMNS = ['Revisit needed', 'Waiting on material', 'Waiting on deliverables', 'Ready to invoice', 'On hold'];

/** The office's standard stage names (the tech portal keeps its own wording). */
export const STANDARD_STAGE_NAMES: Record<WfStatus, string> = {
  open: 'Needs a tech',
  offered: 'Awaiting response',
  scheduled: 'Scheduled',
  inProgress: 'In progress',
  workDone: 'Work done',
  closed: 'Closed',
  declined: 'Declined',
};

/** High, Critical and Emergency count as high priority as standard. */
const STANDARD_URGENT = new Set(['high', 'critical', 'emergency', 'urgent']);

const item = (key: string): ListItem => ({ key, label: key, hidden: false });

export const STANDARD_LISTS: AppLists = {
  stages: {},
  priorities: WORK_ORDER_PRIORITIES.map((k) => ({ ...item(k), urgent: STANDARD_URGENT.has(k.toLowerCase()) })),
  serviceTypes: SERVICE_TYPES.map(item),
  sources: WORK_ORDER_SOURCES.map(item),
  assignmentTypes: ASSIGNMENT_TYPES.map(item),
  boardColumns: STANDARD_BOARD_COLUMNS.map(item),
};

const clean = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) : '');

function normalizeList(raw: unknown, standard: ListItem[], withUrgent: boolean): ListItem[] {
  const out: ListItem[] = [];
  const seen = new Set<string>();
  for (const r of Array.isArray(raw) ? raw : standard) {
    if (!r || typeof r !== 'object') continue;
    const rec = r as Record<string, unknown>;
    const key = clean(rec.key);
    if (!key || seen.has(key.toLowerCase())) continue;
    seen.add(key.toLowerCase());
    const std = standard.find((s) => s.key === key);
    const it: ListItem = { key, label: clean(rec.label) || key, hidden: rec.hidden === true };
    if (withUrgent) it.urgent = typeof rec.urgent === 'boolean' ? rec.urgent : (std?.urgent ?? false);
    out.push(it);
  }
  // A standard item can be hidden, never lost: put back any that are missing.
  for (const s of standard) if (!seen.has(s.key.toLowerCase())) out.push({ ...s });
  return out;
}

/** A saved value (or anything else) made safe to use. */
export function normalizeLists(raw: unknown): AppLists {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const stages: AppLists['stages'] = {};
  if (src.stages && typeof src.stages === 'object') {
    for (const [k, v] of Object.entries(src.stages as Record<string, unknown>)) {
      const name = clean(v);
      if ((STAGE_KEYS as string[]).includes(k) && name && name !== STANDARD_STAGE_NAMES[k as WfStatus]) stages[k as WfStatus] = name;
    }
  }
  return {
    stages,
    priorities: normalizeList(src.priorities, STANDARD_LISTS.priorities, true),
    serviceTypes: normalizeList(src.serviceTypes, STANDARD_LISTS.serviceTypes, false),
    sources: normalizeList(src.sources, STANDARD_LISTS.sources, false),
    assignmentTypes: normalizeList(src.assignmentTypes, STANDARD_LISTS.assignmentTypes, false),
    boardColumns: normalizeList(src.boardColumns, STANDARD_LISTS.boardColumns, false),
  };
}

export function isStandardLists(l: AppLists): boolean {
  return JSON.stringify(normalizeLists(l)) === JSON.stringify(normalizeLists(STANDARD_LISTS));
}

// ── The lists in use right now ───────────────────────────────────────────────
// Set by the owner app as soon as Fred's lists load (components/useAppLists);
// the tech portal never sets it, so techs see the standard names.
let current: AppLists = normalizeLists(STANDARD_LISTS);
export function setListsNow(l: AppLists): void { current = l; }
export function listsNow(): AppLists { return current; }

/** The office's name for a stage. */
export function stageName(s: WfStatus, l: AppLists = current): string {
  return l.stages[s] || STANDARD_STAGE_NAMES[s];
}

/** The name to show for a stored value; unknown values show as they are. */
export function labelOf(list: ListName, key: string | null | undefined, l: AppLists = current): string {
  if (!key) return '';
  const k = key.trim().toLowerCase();
  return l[list].find((i) => i.key.toLowerCase() === k)?.label || key;
}

/** Whether a stored priority counts as high priority (the red filter on Dispatch). */
export function isUrgent(priority: string | null | undefined, l: AppLists = current): boolean {
  if (!priority) return false;
  const k = priority.trim().toLowerCase();
  const found = l.priorities.find((i) => i.key.toLowerCase() === k);
  return found ? !!found.urgent : STANDARD_URGENT.has(k);
}

/**
 * The choices for a dropdown on a job: the items not hidden, in Fred's order,
 * plus the job's own value if it's hidden or no longer in the list — so
 * opening an old job never changes what it says.
 */
export function choicesFor(list: ListName, current_value: string | null | undefined, l: AppLists = current): { value: string; label: string }[] {
  const v = (current_value ?? '').trim();
  const same = (k: string) => !!v && k.toLowerCase() === v.toLowerCase();
  // The job's own value is always a choice, spelled exactly as stored (so the
  // dropdown shows it selected), even if hidden or no longer in the list.
  const out = l[list].filter((i) => !i.hidden || same(i.key)).map((i) => ({ value: same(i.key) ? v : i.key, label: i.label || i.key }));
  if (v && !out.some((o) => o.value === v)) out.push({ value: v, label: labelOf(list, v, l) });
  return out;
}

// ── Changes Fred makes in Settings. Each returns new lists. ──────────────────

export function renameStage(l: AppLists, s: WfStatus, name: string): AppLists {
  return { ...l, stages: { ...l.stages, [s]: name.slice(0, NAME_MAX) } };
}

function mapList(l: AppLists, list: ListName, f: (items: ListItem[]) => ListItem[]): AppLists {
  return { ...l, [list]: f(l[list]) };
}

/** Kept as typed while Fred types; tidied on save. Blank shows the stored value. */
export function renameItem(l: AppLists, list: ListName, key: string, label: string): AppLists {
  return mapList(l, list, (items) => items.map((i) => (i.key === key ? { ...i, label: label.slice(0, NAME_MAX) } : i)));
}

export function setItemHidden(l: AppLists, list: ListName, key: string, hidden: boolean): AppLists {
  return mapList(l, list, (items) => items.map((i) => (i.key === key ? { ...i, hidden } : i)));
}

export function setUrgent(l: AppLists, key: string, urgent: boolean): AppLists {
  return mapList(l, 'priorities', (items) => items.map((i) => (i.key === key ? { ...i, urgent } : i)));
}

export function shiftItem(l: AppLists, list: ListName, key: string, dir: -1 | 1): AppLists {
  return mapList(l, list, (items) => {
    const i = items.findIndex((x) => x.key === key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= items.length) return items;
    const out = [...items];
    [out[i], out[j]] = [out[j], out[i]];
    return out;
  });
}

/** Add a new choice at the bottom. Null when the name is blank or already there. */
export function addItem(l: AppLists, list: ListName, name: string): AppLists | null {
  const key = clean(name);
  if (!key || l[list].some((i) => i.key.toLowerCase() === key.toLowerCase() || i.label.toLowerCase() === key.toLowerCase())) return null;
  const it: ListItem = list === 'priorities' ? { ...item(key), urgent: false } : item(key);
  return mapList(l, list, (items) => [...items, it]);
}
