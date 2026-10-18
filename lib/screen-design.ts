// Screen designer (Settings -> Screen designer; Fred, 2026-10-06: "go ahead
// with the screen designer"). Arrange the Dashboard and the job page yourself:
// the order of the blocks, wide or half width, which column a job-page card
// sits in, and your own note and shortcut blocks on the Dashboard.
//
// Saved with the menu layout (user_settings.layout.design, lib/app-layout.ts).
// Hiding a standard block is still the `off` list (lib/screen-parts.ts), so
// "What each screen shows" and the designer always agree. normalizeDesign
// checks a saved value on every load: anything it doesn't understand is
// dropped, and a block added to the app later still shows up in its standard
// place.

export type BlockWidth = 'full' | 'half';
export const NOTE_COLORS = ['plain', 'gold', 'blue', 'green', 'red'] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];

export type DashBlock =
  /** One of the Dashboard's own blocks (dash.* in lib/screen-parts.ts). */
  | { kind: 'part'; key: string; width: BlockWidth }
  /** A note Fred writes: reminders, phone numbers, this week's goals. */
  | { kind: 'note'; key: string; width: BlockWidth; title: string; text: string; color: NoteColor }
  /** Buttons that open the screens he uses most. */
  | { kind: 'links'; key: string; width: BlockWidth; title: string; views: string[] };

export type ScreenDesign = {
  /** Dashboard blocks, top to bottom. Two half blocks in a row sit side by side. */
  dash: DashBlock[];
  /** Job page: the narrow column on the right, top to bottom. */
  jobSide: string[];
  /** Job page: the wide column, under the job's own details. */
  jobBelow: string[];
};

export const DASH_PART_KEYS = ['dash.attention', 'dash.field', 'dash.coming', 'dash.kpis', 'dash.status', 'dash.outstanding', 'dash.payments'];
// No "Quick changes" card: it repeated the date, time and price already at the top
// of the job (Fred, 2026-10-18: "Why do we need this"). Edit job changes them.
// No Money card either: Fred, the same day, "Still seeing money". Prices live under Pay in Edit job.
const STANDARD_SIDE = ['job.timeRequests', 'job.techs', 'job.fields'];
const STANDARD_BELOW = ['job.closeout', 'job.project', 'job.notes', 'job.report', 'job.expenses', 'job.photos', 'job.docs', 'job.sketches', 'job.timegps'];
export const JOB_PART_KEYS = [...STANDARD_SIDE, ...STANDARD_BELOW];

export const STANDARD_DESIGN: ScreenDesign = {
  dash: [
    { kind: 'part', key: 'dash.attention', width: 'full' },
    { kind: 'part', key: 'dash.field', width: 'full' },
    { kind: 'part', key: 'dash.coming', width: 'full' },
    { kind: 'part', key: 'dash.kpis', width: 'full' },
    { kind: 'part', key: 'dash.status', width: 'full' },
    { kind: 'part', key: 'dash.outstanding', width: 'half' },
    { kind: 'part', key: 'dash.payments', width: 'half' },
  ],
  jobSide: STANDARD_SIDE,
  jobBelow: STANDARD_BELOW,
};

export const TITLE_MAX = 40;
export const NOTE_MAX = 1000;
/** Notes and shortcut blocks together. */
export const CUSTOM_MAX = 12;
export const LINKS_MAX = 8;

const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
const oneLine = (v: unknown, max: number): string => text(v, max * 2).replace(/\s+/g, ' ').trim().slice(0, max);
const width = (v: unknown, fallback: BlockWidth): BlockWidth => (v === 'full' || v === 'half' ? v : fallback);
const customKey = (v: unknown, prefix: 'note' | 'links'): string | null =>
  typeof v === 'string' && new RegExp(`^${prefix}:[a-z0-9]{1,20}$`).test(v) ? v : null;

/**
 * A saved value (or anything else) made safe to show. `screenOk` says whether
 * a shortcut's screen still exists (lib/app-layout passes its own check, so
 * this file doesn't need the menu).
 */
export function normalizeDesign(raw: unknown, screenOk: (view: string) => boolean = () => true): ScreenDesign {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};

  // Dashboard
  const dash: DashBlock[] = [];
  const seen = new Set<string>();
  let custom = 0;
  for (const b of Array.isArray(src.dash) ? src.dash : STANDARD_DESIGN.dash) {
    if (!b || typeof b !== 'object') continue;
    const o = b as Record<string, unknown>;
    if (o.kind === 'part' && typeof o.key === 'string' && DASH_PART_KEYS.includes(o.key) && !seen.has(o.key)) {
      seen.add(o.key);
      const std = STANDARD_DESIGN.dash.find((x) => x.key === o.key)!;
      dash.push({ kind: 'part', key: o.key, width: width(o.width, std.width) });
    } else if (o.kind === 'note' && custom < CUSTOM_MAX) {
      const key = customKey(o.key, 'note');
      if (!key || seen.has(key)) continue;
      seen.add(key); custom += 1;
      dash.push({
        kind: 'note', key, width: width(o.width, 'half'),
        title: oneLine(o.title, TITLE_MAX), text: text(o.text, NOTE_MAX),
        color: NOTE_COLORS.includes(o.color as NoteColor) ? (o.color as NoteColor) : 'plain',
      });
    } else if (o.kind === 'links' && custom < CUSTOM_MAX) {
      const key = customKey(o.key, 'links');
      if (!key || seen.has(key)) continue;
      seen.add(key); custom += 1;
      const views = Array.isArray(o.views)
        ? [...new Set(o.views.filter((v): v is string => typeof v === 'string' && screenOk(v)))].slice(0, LINKS_MAX)
        : [];
      dash.push({ kind: 'links', key, width: width(o.width, 'half'), title: oneLine(o.title, TITLE_MAX), views });
    }
  }
  // A standard block missing from a saved design goes back to its standard spot.
  STANDARD_DESIGN.dash.forEach((std, i) => {
    if (seen.has(std.key)) return;
    seen.add(std.key);
    const before = STANDARD_DESIGN.dash.slice(0, i).reverse().find((x) => dash.some((d) => d.key === x.key));
    dash.splice(before ? dash.findIndex((d) => d.key === before.key) + 1 : 0, 0, { ...std });
  });

  // Job page: every card once, in one column or the other.
  const placed = new Set<string>();
  const take = (k: unknown): k is string => {
    if (typeof k !== 'string' || !JOB_PART_KEYS.includes(k) || placed.has(k)) return false;
    placed.add(k);
    return true;
  };
  const jobSide = (Array.isArray(src.jobSide) ? src.jobSide : STANDARD_SIDE).filter(take);
  const jobBelow = (Array.isArray(src.jobBelow) ? src.jobBelow : STANDARD_BELOW).filter(take);
  for (const k of STANDARD_SIDE) if (!placed.has(k)) { placed.add(k); jobSide.push(k); }
  for (const k of STANDARD_BELOW) if (!placed.has(k)) { placed.add(k); jobBelow.push(k); }

  return { dash, jobSide, jobBelow };
}

export function isStandardDesign(d: ScreenDesign): boolean {
  return JSON.stringify(normalizeDesign(d)) === JSON.stringify(normalizeDesign(STANDARD_DESIGN));
}

/**
 * Dashboard rows: two half blocks next to each other share a row; a half block
 * on its own (its partner hidden, say) stretches to the full width, so there's
 * never a gap.
 */
export function dashRows<T extends { width: BlockWidth }>(blocks: T[]): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.width === 'half' && blocks[i + 1]?.width === 'half') { rows.push([b, blocks[i + 1]]); i++; }
    else rows.push([b]);
  }
  return rows;
}

// ── Changes made in the designer. Each returns a new ScreenDesign. ────────────

const swap = <T,>(list: T[], i: number, dir: -1 | 1): T[] => {
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
};

/** Earlier (-1) or later (1) on the Dashboard. */
export function shiftDash(d: ScreenDesign, key: string, dir: -1 | 1): ScreenDesign {
  return { ...d, dash: swap(d.dash, d.dash.findIndex((b) => b.key === key), dir) };
}

/** Drag and drop: put a block just before another one (or last, with null). */
export function moveDashBefore(d: ScreenDesign, key: string, beforeKey: string | null): ScreenDesign {
  const block = d.dash.find((b) => b.key === key);
  if (!block || key === beforeKey) return d;
  const rest = d.dash.filter((b) => b.key !== key);
  const at = beforeKey === null ? rest.length : rest.findIndex((b) => b.key === beforeKey);
  if (at < 0) return d;
  return { ...d, dash: [...rest.slice(0, at), block, ...rest.slice(at)] };
}

export function setDashWidth(d: ScreenDesign, key: string, w: BlockWidth): ScreenDesign {
  return { ...d, dash: d.dash.map((b) => (b.key === key ? { ...b, width: w } : b)) };
}

const newKey = (prefix: 'note' | 'links') => `${prefix}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const customCount = (d: ScreenDesign) => d.dash.filter((b) => b.kind !== 'part').length;

/** A new note, at the top so it's seen. */
export function addNote(d: ScreenDesign, key = newKey('note')): ScreenDesign {
  if (customCount(d) >= CUSTOM_MAX) return d;
  return { ...d, dash: [{ kind: 'note', key, width: 'half', title: 'Note', text: '', color: 'gold' }, ...d.dash] };
}

export function addLinks(d: ScreenDesign, key = newKey('links')): ScreenDesign {
  if (customCount(d) >= CUSTOM_MAX) return d;
  return { ...d, dash: [{ kind: 'links', key, width: 'half', title: 'Shortcuts', views: [] }, ...d.dash] };
}

/** Change a note or shortcut block (title, text, colour, screens). */
export function editBlock(d: ScreenDesign, key: string, patch: Partial<{ title: string; text: string; color: NoteColor; views: string[] }>): ScreenDesign {
  return {
    ...d,
    dash: d.dash.map((b) => {
      if (b.key !== key || b.kind === 'part') return b;
      if (b.kind === 'note') {
        return { ...b, ...(patch.title !== undefined && { title: patch.title.slice(0, TITLE_MAX) }), ...(patch.text !== undefined && { text: patch.text.slice(0, NOTE_MAX) }), ...(patch.color && { color: patch.color }) };
      }
      return { ...b, ...(patch.title !== undefined && { title: patch.title.slice(0, TITLE_MAX) }), ...(patch.views && { views: patch.views.slice(0, LINKS_MAX) }) };
    }),
  };
}

/** Only notes and shortcut blocks can be removed; standard blocks are hidden instead. */
export function removeBlock(d: ScreenDesign, key: string): ScreenDesign {
  return { ...d, dash: d.dash.filter((b) => b.key !== key || b.kind === 'part') };
}

export type JobColumn = 'side' | 'below';
export const columnOf = (d: ScreenDesign, key: string): JobColumn => (d.jobSide.includes(key) ? 'side' : 'below');

/** Up (-1) or down (1) within its column. */
export function shiftJob(d: ScreenDesign, key: string, dir: -1 | 1): ScreenDesign {
  if (d.jobSide.includes(key)) return { ...d, jobSide: swap(d.jobSide, d.jobSide.indexOf(key), dir) };
  return { ...d, jobBelow: swap(d.jobBelow, d.jobBelow.indexOf(key), dir) };
}

/** Put a card in a column, just before another card (or at the bottom, with null). */
export function moveJob(d: ScreenDesign, key: string, to: JobColumn, beforeKey: string | null = null): ScreenDesign {
  if (!JOB_PART_KEYS.includes(key) || key === beforeKey) return d;
  const side = d.jobSide.filter((k) => k !== key);
  const below = d.jobBelow.filter((k) => k !== key);
  const list = to === 'side' ? side : below;
  const at = beforeKey === null ? -1 : list.indexOf(beforeKey);
  if (at < 0) list.push(key);
  else list.splice(at, 0, key);
  return { ...d, jobSide: side, jobBelow: below };
}

// The design in use right now — set by the owner app from Fred's layout
// (components/useAppLayout). The tech portal never sets it.
let now: ScreenDesign = normalizeDesign(STANDARD_DESIGN);
export function setDesignNow(d: ScreenDesign | undefined): void { now = d ?? normalizeDesign(STANDARD_DESIGN); }
export function designNow(): ScreenDesign { return now; }
