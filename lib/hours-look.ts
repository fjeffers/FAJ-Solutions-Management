// How the Hours cards show (Fred, 2026-10-24: "i want to be change they way i
// view the cards manually"; "add that to settings"; "weeek view month view etc").
//
// Saved with Fred's menu layout (Settings -> Hours screen, user_settings.layout),
// so the Hours screen and a work order's Time Logs tab open the way he set it, on
// every device. The bar above the cards changes the same setting.

export type HoursLook = {
  /** Newest day first, or oldest. */
  order: 'new' | 'old';
  /** One run of days, or grouped by week (Monday to Sunday) or by month, each with its totals. */
  group: 'day' | 'week' | 'month';
  /** Every box open on every card, or one line per day that opens when tapped. */
  cards: 'full' | 'short';
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
    cards: v.cards === 'short' ? 'short' : 'full',
  };
}

let now: HoursLook = STANDARD_HOURS_LOOK;
/** Kept on Fred's choice by useAppLayout, like the screen parts. */
export function setHoursLookNow(l: HoursLook | undefined): void { now = normalizeHoursLook(l); }
export function hoursLookNow(): HoursLook { return now; }

/**
 * The group a day ('2026-10-23') falls in: the Monday that starts its week, or
 * its month ('2026-10'). Days are calendar dates, so this is done in UTC and
 * never shifts with the clock.
 */
export function groupOf(day: string, group: HoursLook['group']): string {
  if (group === 'day') return day;
  if (group === 'month') return day.slice(0, 7);
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** 'Week of Mon, Oct 20 – Sun, Oct 26' or 'October 2026'. */
export function groupLabel(key: string, group: HoursLook['group']): string {
  const fmt = (iso: string, o: Intl.DateTimeFormatOptions) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { ...o, timeZone: 'UTC' });
  if (group === 'month') return fmt(`${key}-01`, { month: 'long', year: 'numeric' });
  if (group === 'day') return fmt(key, { weekday: 'long', month: 'short', day: 'numeric' });
  const end = new Date(`${key}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 6);
  const o: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' };
  return `Week of ${fmt(key, o)} – ${fmt(end.toISOString().slice(0, 10), o)}`;
}
