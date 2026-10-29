// How the Hours cards show (Fred, 2026-10-24: "i want to be change they way i
// view the cards manually"; "add that to settings"; "weeek view month view etc").
//
// Saved with Fred's menu layout (Settings -> Hours screen, user_settings.layout),
// so the Hours screen and a work order's Time Logs tab open the way he set it, on
// every device. The bar above the cards changes the same setting.
import { weekStartOf } from './week-view';

export type HoursLook = {
  /** Newest day first, or oldest. */
  order: 'new' | 'old';
  /** One run of days, or grouped by week (Sunday to Saturday) or by month, each with its totals. */
  group: 'day' | 'week' | 'month';
  /**
   * Every box open on every card, one line per day that opens when tapped, or
   * a board like monday.com: colored groups, a status label, every cell typed
   * into and saved on the spot (Fred, 2026-10-24: "give me a monday.com feature view").
   */
  cards: 'full' | 'short' | 'board';
};

export const STANDARD_HOURS_LOOK: HoursLook = { order: 'new', group: 'day', cards: 'full' };

export const HOURS_GROUPS: { value: HoursLook['group']; label: string }[] = [
  { value: 'day', label: 'Day by day' },
  { value: 'week', label: 'By week' },
  { value: 'month', label: 'By month' },
];

/** A saved value (or anything else) made safe to use. */
export function normalizeHoursLook(raw: unknown): HoursLook {
  const v = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    order: v.order === 'old' ? 'old' : 'new',
    group: v.group === 'week' || v.group === 'month' ? v.group : 'day',
    cards: v.cards === 'short' || v.cards === 'board' ? v.cards : 'full',
  };
}

export const HOURS_CARDS: { value: HoursLook['cards']; label: string; hint: string }[] = [
  { value: 'full', label: 'Full cards', hint: 'Every box open, ready to type in' },
  { value: 'short', label: 'Short list', hint: 'One line a day; tap a line to open it' },
  { value: 'board', label: 'Board', hint: 'Like monday.com: colored groups, a status on each day, type in any cell' },
];

// ── The board's status label (monday.com's colored status column) ──────────

export type DayStatus = 'app' | 'changed' | 'check' | 'travel' | 'typed';
export const DAY_STATUS: Record<DayStatus, { label: string; color: string }> = {
  app: { label: 'From the app', color: '#00C875' },
  changed: { label: 'Changed', color: '#FDAB3D' },
  check: { label: 'Check times', color: '#E2445C' },
  travel: { label: 'Travel day', color: '#A25DDC' },
  typed: { label: 'Typed in', color: '#579BFC' },
};
/** The colors monday.com gives its groups, in turn. */
export const GROUP_COLORS = ['#579BFC', '#00C875', '#A25DDC', '#FDAB3D', '#E2445C', '#037F4C', '#FF158A', '#784BD1'];

/**
 * A day's status: a travel-only day; else changed by the office; else times
 * worked out from the drives (to check); else typed in by the office with no
 * taps; else straight from the app.
 */
export function dayStatus(r: {
  app: unknown; edits: Record<string, unknown>; source: Partial<Record<string, string>>;
  values: { hours: number | null; arrived: string | null; leftSite: string | null };
}): DayStatus {
  if (r.values.hours === 0 && !r.values.arrived && !r.values.leftSite) return 'travel';
  if (Object.keys(r.edits).length) return 'changed';
  if (r.source.arrived === 'guess' || r.source.leftSite === 'guess') return 'check';
  return r.app ? 'app' : 'typed';
}

/** The office saved a day on Hours or the work order (field_sheet_days): the work order's totals reload. */
export const HOURS_CHANGED = 'faj:hours-changed';
/** Save every day card with changes: the work order's Save Changes sends it (Fred, 2026-10-24: "save all is not working (save Changes)"). */
export const HOURS_SAVE_ALL = 'faj:hours-save-all';

let now: HoursLook = STANDARD_HOURS_LOOK;
/** Kept on Fred's choice by useAppLayout, like the screen parts. */
export function setHoursLookNow(l: HoursLook | undefined): void { now = normalizeHoursLook(l); }
export function hoursLookNow(): HoursLook { return now; }

/**
 * The group a day ('2026-10-23') falls in: the Sunday that starts its week, or
 * its month ('2026-10'). Weeks run Sunday to Saturday, like the bill (Fred,
 * 2026-10-29: "Need to add Sunday to Saturday"). Days are calendar dates, so
 * this is done in UTC and never shifts with the clock.
 */
export function groupOf(day: string, group: HoursLook['group']): string {
  if (group === 'day') return day;
  if (group === 'month') return day.slice(0, 7);
  return weekStartOf(day);
}

/** 'Week of Sun, Oct 25 – Sat, Oct 31' or 'October 2026'. */
export function groupLabel(key: string, group: HoursLook['group']): string {
  const fmt = (iso: string, o: Intl.DateTimeFormatOptions) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { ...o, timeZone: 'UTC' });
  if (group === 'month') return fmt(`${key}-01`, { month: 'long', year: 'numeric' });
  if (group === 'day') return fmt(key, { weekday: 'long', month: 'short', day: 'numeric' });
  const end = new Date(`${key}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 6);
  const o: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' };
  return `Week of ${fmt(key, o)} – ${fmt(end.toISOString().slice(0, 10), o)}`;
}
