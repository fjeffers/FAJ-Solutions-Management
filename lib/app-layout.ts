// Fred's own menu (Settings -> Menu & screens). Fred, 2026-10-05: "I want
// setting to be able to create or change layouts of the app, add, remove
// anything — full admin privilege in settings."
//
// The standard menu is lib/office-menu.ts. What Fred changes is saved as a
// Layout on his user_settings row (migration 107): which screens sit in the
// left menu, the Office sections and their order, new names, and what's
// hidden. normalizeLayout checks a saved value on every load, so a bad or old
// value can never break the menu — anything it doesn't understand falls back
// to the standard place, and a screen added to the app later still shows up.
//
// Two rules keep Fred from locking himself out: Office always stays in the
// left menu (it's how you reach everything else), and Settings can never be
// hidden (it's how you undo all this).

import { OFFICE_GROUPS, SIDEBAR_VIEWS, type OfficeGroup } from './office-menu';

export type Layout = {
  /** Screens in the left menu, top to bottom. Always includes 'office'. */
  main: string[];
  /** Office sections, top to bottom, each with its screens in order. */
  sections: { id: string; title: string; items: string[] }[];
  /** New names, by screen. Only names that differ from the standard. */
  labels: Record<string, string>;
  /** Screens taken off the menu. Nothing is deleted; the screen still works. */
  hidden: string[];
};

export type Screen = {
  /** The view name, or 'netview' for NetView's form (another site). */
  key: string;
  /** The owner app view it opens; null for the NetView link. */
  view: string | null;
  label: string;
  standardLabel: string;
  hint: string;
  hidden: boolean;
};
export type ResolvedSection = { id: string; title: string; items: Screen[] };
export type ResolvedLayout = { main: Screen[]; sections: ResolvedSection[] };

/** Can't be hidden, and can't leave the left menu. */
export const OFFICE_KEY = 'office';
/** Can't be hidden. */
export const SETTINGS_KEY = 'settings';
export const LABEL_MAX = 40;

const MAIN_SCREENS: Record<string, { label: string; hint: string }> = {
  dashboard: { label: 'Dashboard', hint: 'Money, jobs and what needs you today' },
  workorders: { label: 'Dispatch', hint: 'The job board: every job by stage' },
  scheduling: { label: 'Schedule', hint: 'Jobs on the calendar' },
  office: { label: 'Office', hint: 'Every other screen, in sections' },
};

type Base = { view: string | null; label: string; hint: string; section: string | null };

/** Every screen the menu can show, with its standard name and place. */
export const SCREENS: Record<string, Base> = (() => {
  const all: Record<string, Base> = {};
  for (const k of SIDEBAR_VIEWS) all[k] = { view: k, ...MAIN_SCREENS[k], section: null };
  for (const g of OFFICE_GROUPS) {
    for (const i of g.items) {
      const key = i.view ?? i.href ?? i.label;
      all[key] = { view: i.view, label: i.label, hint: i.hint, section: g.id };
    }
  }
  return all;
})();

export const STANDARD_LAYOUT: Layout = {
  main: [...SIDEBAR_VIEWS],
  sections: OFFICE_GROUPS.map((g: OfficeGroup) => ({ id: g.id, title: g.title, items: g.items.map((i) => i.view ?? i.href ?? i.label) })),
  labels: {},
  hidden: [],
};

const known = (k: unknown): k is string => typeof k === 'string' && Object.prototype.hasOwnProperty.call(SCREENS, k);
const cleanText = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, LABEL_MAX) : '');

/** A saved value (or anything else) made safe to show. */
export function normalizeLayout(raw: unknown): Layout {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const placed = new Set<string>();
  const take = (k: unknown): k is string => {
    if (!known(k) || placed.has(k)) return false;
    placed.add(k);
    return true;
  };

  const savedMain = Array.isArray(src.main) ? src.main : null;
  const main = (savedMain ?? STANDARD_LAYOUT.main).filter(take);
  if (!placed.has(OFFICE_KEY)) { placed.add(OFFICE_KEY); main.push(OFFICE_KEY); }

  const ids = new Set<string>();
  const savedSections = Array.isArray(src.sections) ? src.sections : null;
  const sections: Layout['sections'] = [];
  for (const s of savedSections ?? STANDARD_LAYOUT.sections) {
    if (!s || typeof s !== 'object') continue;
    const rec = s as Record<string, unknown>;
    const id = typeof rec.id === 'string' && rec.id.trim() ? rec.id.trim().slice(0, 40) : '';
    if (!id || ids.has(id)) continue;
    ids.add(id);
    const items = Array.isArray(rec.items) ? rec.items.filter(take) : [];
    sections.push({ id, title: cleanText(rec.title) || 'Untitled section', items });
  }

  // Anything not placed (a screen new to the app, or a damaged value) goes
  // back to its standard section — or the last section, or the left menu.
  for (const key of Object.keys(SCREENS)) {
    if (placed.has(key)) continue;
    placed.add(key);
    const home = sections.find((s) => s.id === SCREENS[key].section) ?? sections[sections.length - 1];
    if (SCREENS[key].section === null || !home) main.push(key);
    else home.items.push(key);
  }

  const labels: Record<string, string> = {};
  if (src.labels && typeof src.labels === 'object') {
    for (const [k, v] of Object.entries(src.labels as Record<string, unknown>)) {
      const name = cleanText(v);
      if (known(k) && name && name !== SCREENS[k].label) labels[k] = name;
    }
  }

  const hidden = Array.isArray(src.hidden)
    ? [...new Set(src.hidden.filter((k): k is string => known(k) && k !== OFFICE_KEY && k !== SETTINGS_KEY))]
    : [];

  return { main, sections, labels, hidden };
}

function screen(l: Layout, key: string): Screen {
  const b = SCREENS[key];
  return { key, view: b.view, label: cleanText(l.labels[key]) || b.label, standardLabel: b.label, hint: b.hint, hidden: l.hidden.includes(key) };
}

/** Every screen with its name and hidden flag — hidden ones included (the editor shows them). */
export function resolveLayout(l: Layout): ResolvedLayout {
  return {
    main: l.main.map((k) => screen(l, k)),
    sections: l.sections.map((s) => ({ id: s.id, title: cleanText(s.title) || 'Untitled section', items: s.items.map((k) => screen(l, k)) })),
  };
}

/** What the menu shows: hidden screens out, and sections left empty out. */
export function visibleLayout(r: ResolvedLayout): ResolvedLayout {
  return {
    main: r.main.filter((s) => !s.hidden),
    sections: r.sections.map((s) => ({ ...s, items: s.items.filter((i) => !i.hidden) })).filter((s) => s.items.length > 0),
  };
}

/** The id of the Office section showing a screen, or null (left menu, or hidden). */
export function sectionOfView(r: ResolvedLayout, view: string): string | null {
  return r.sections.find((s) => s.items.some((i) => i.view === view && !i.hidden))?.id ?? null;
}

/** Every word typed must appear in the name, the hint or the section. */
export function searchSections(sections: ResolvedSection[], query: string): ResolvedSection[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return sections;
  return sections
    .map((s) => ({
      ...s,
      items: s.items.filter((i) => {
        const text = `${i.label} ${i.standardLabel} ${i.hint} ${s.title}`.toLowerCase();
        return words.every((w) => text.includes(w));
      }),
    }))
    .filter((s) => s.items.length > 0);
}

/** True when nothing differs from the standard menu. */
export function isStandard(l: Layout): boolean {
  return JSON.stringify(normalizeLayout(l)) === JSON.stringify(normalizeLayout(STANDARD_LAYOUT));
}

// ── Changes Fred makes in Settings. Each returns a new Layout. ───────────────

/** 'main', or the id of the section it's in. */
export function placeOf(l: Layout, key: string): string | null {
  if (l.main.includes(key)) return 'main';
  return l.sections.find((s) => s.items.includes(key))?.id ?? null;
}

/** Kept exactly as typed while Fred types (spaces and all); tidied on save. */
export function renameScreen(l: Layout, key: string, name: string): Layout {
  return { ...l, labels: { ...l.labels, [key]: name.slice(0, LABEL_MAX) } };
}

export function setHidden(l: Layout, key: string, hide: boolean): Layout {
  if (key === OFFICE_KEY || key === SETTINGS_KEY) return l;
  const rest = l.hidden.filter((k) => k !== key);
  return { ...l, hidden: hide ? [...rest, key] : rest };
}

/** Move a screen to the left menu or another section (at the bottom). */
export function moveScreen(l: Layout, key: string, to: string): Layout {
  if (key === OFFICE_KEY || placeOf(l, key) === to) return l;
  if (to !== 'main' && !l.sections.some((s) => s.id === to)) return l;
  const main = l.main.filter((k) => k !== key);
  const sections = l.sections.map((s) => ({ ...s, items: s.items.filter((k) => k !== key) }));
  if (to === 'main') main.push(key);
  else sections.find((s) => s.id === to)!.items.push(key);
  return { ...l, main, sections };
}

const swap = <T,>(list: T[], i: number, dir: -1 | 1): T[] => {
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
};

/** Up (-1) or down (1) within its own list. */
export function shiftScreen(l: Layout, key: string, dir: -1 | 1): Layout {
  if (l.main.includes(key)) return { ...l, main: swap(l.main, l.main.indexOf(key), dir) };
  return { ...l, sections: l.sections.map((s) => (s.items.includes(key) ? { ...s, items: swap(s.items, s.items.indexOf(key), dir) } : s)) };
}

export function addSection(l: Layout, title: string, id = `s${Date.now().toString(36)}`): Layout {
  return { ...l, sections: [...l.sections, { id, title: cleanText(title) || 'New section', items: [] }] };
}

export function renameSection(l: Layout, id: string, title: string): Layout {
  return { ...l, sections: l.sections.map((s) => (s.id === id ? { ...s, title: title.slice(0, LABEL_MAX) } : s)) };
}

export function shiftSection(l: Layout, id: string, dir: -1 | 1): Layout {
  return { ...l, sections: swap(l.sections, l.sections.findIndex((s) => s.id === id), dir) };
}

/** Only an empty section can go — its screens have to be moved out first. */
export function removeSection(l: Layout, id: string): Layout {
  const s = l.sections.find((x) => x.id === id);
  if (!s || s.items.length > 0) return l;
  return { ...l, sections: l.sections.filter((x) => x.id !== id) };
}
