// The job log as a sheet the office can edit (Fred, 2026-10-30: "Used this layout with what we have and I
// need to edit all of it hours time milages materials etc all of it", with his workbook job-log-timesheet.xlsx).
// Five sections, as on the workbook: Time on site (clock in, clock out, break), Mileage (odometer start and
// end, miles), Meals, Materials and Other receipts. It starts from what the app has (the clock-ins, the
// Field Sheet's miles, the approved receipts); once the office saves an edit, the job keeps its own sheet
// (work_orders.job_log_sheet, migration 146) and the log shows that. Pure and unit-tested.
//
// Fred, 2026-10-30: "I want to make sure I can edit the time sheet and it shows on the job logs". A day whose
// time on site the office set on the Hours screen (lib/field-sheet.ts: arrived, left site, lunch or hours
// changed, or the day added) is on the log as the Hours screen has it, in place of that day's clock-ins; a
// day hidden there is off the log.
import { expenseCategoryLabel } from './expenses';
import { dayCalc, type SheetRow } from './field-sheet';
import { byTechGroups, dayOf, type Visit } from './job-log';

/** A stretch on site: clock in and out as "HH:MM" (24-hour, the job's time zone), the break in hours. */
export type TimeRow = {
  tech: string; day: string; in: string; out: string; brk: number;
  /** Still on site (live data only): the hours so far come from `ms`. */
  open?: boolean; ms?: number;
  /**
   * The day's hours as the Hours screen has them, when they aren't clock out less clock in less the break
   * (hours typed there, or a day with two visits): these count. Changing the times drops them.
   */
  hours?: number;
};
/** A day's drive: the odometer at each end when there is one; `miles` is what counts (a GPS-only day has no odometer). */
export type MileRow = { tech: string; day: string; start: number | null; end: number | null; miles: number };
/** A receipt: the store, the amount, and (other receipts) what it was for. */
export type MoneyRow = { tech: string; day: string; store: string; amount: number; for?: string };
export type JobSheet = { time: TimeRow[]; miles: MileRow[]; meals: MoneyRow[]; materials: MoneyRow[]; other: MoneyRow[] };

/** The receipt fields the sheet reads (job_expenses). */
export type SheetReceipt = {
  contractor_name: string | null; category: string; vendor: string | null; amount: number | string;
  expense_date: string; note?: string | null; status: string;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const r1 = (n: number) => Math.round(n * 10) / 10;

/** "07:37" → 457; anything else → null. */
export function minutesOf(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/** An instant as "HH:MM" in the time zone. */
export function clockOf(iso: string, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('hour')}:${get('minute')}`;
}

/**
 * A row's hours: clock out less clock in (past midnight too, as the workbook's MOD does), less the break,
 * to 0.01 h. Null without both times, unless it's a live stretch still on site.
 */
export function rowHours(r: TimeRow): number | null {
  if (r.hours != null) return r2(r.hours);
  const a = minutesOf(r.in), b = minutesOf(r.out);
  if (a == null || b == null) return r.open && r.ms != null ? r2(r.ms / 3_600_000) : null;
  return r2(Math.max(0, ((b - a + 1440) % 1440) / 60 - (r.brk || 0)));
}

/** A section's total, adding each row as it shows (so the column adds up for the client). */
export const hoursTotal = (rows: TimeRow[]) => r2(rows.reduce((t, r) => t + (rowHours(r) ?? 0), 0));
export const milesTotal = (rows: MileRow[]) => r1(rows.reduce((t, r) => t + (r.miles || 0), 0));
export const moneyTotal = (rows: MoneyRow[]) => r2(rows.reduce((t, r) => t + (r.amount || 0), 0));

/** The miles of a row whose odometer was just typed: end less start when both are there, else as they were. */
export function milesFromOdometer(r: MileRow): number {
  return r.start != null && r.end != null && r.end >= r.start ? r1(r.end - r.start) : r.miles;
}

/** A tech's day as the office set it on the Hours screen: its time on site, or (hidden) none on the log. */
export type HoursScreenDay = TimeRow & { hidden?: boolean };

/** The fields that set a day's time on site on the Hours screen. */
const ON_SITE = ['arrived', 'leftSite', 'lunch', 'hours'] as const;

/**
 * The days the office set on the Hours screen (its Field Sheet rows): arrived, left site, lunch or hours
 * changed, or a day added, with a time on site there; or a day hidden. Arrived and left site are the clock in
 * and out, the lunch (minutes) the break, and the day's hours are the Hours screen's whenever the times alone
 * don't give them. A day the Hours screen has no time on site for (only a time leaving the site, say) leaves
 * the clock-ins as they are: they're the better record of it.
 */
export function hoursScreenDays(rows: SheetRow[]): HoursScreenDay[] {
  return rows.flatMap((r): HoursScreenDay[] => {
    if (r.hidden) return [{ tech: r.tech, day: r.day, in: '', out: '', brk: 0, hidden: true }];
    const set = ON_SITE.some((f) => f in r.edits);
    if (!set && !r.added) return [];
    const v = r.values;
    const row: TimeRow = { tech: r.tech, day: r.day, in: v.arrived ?? '', out: v.leftSite ?? '', brk: r2((v.lunch ?? 0) / 60) };
    const h = dayCalc(v, 0).hours;
    if (!h && rowHours(row) == null) return [];
    return [rowHours(row) === h ? row : { ...row, hours: h }];
  });
}

/** The sheet from what the app has: clock-ins, the Field Sheet's days with miles, the approved receipts. */
export function sheetFromApp(input: {
  visits: Visit[];
  mileage: { tech: string; day: string; start: number | null; end: number | null; miles: number }[];
  receipts: SheetReceipt[];
  /** Days the office set on the Hours screen: they take the place of that day's clock-ins. */
  hoursScreen?: HoursScreenDay[];
  timeZone?: string;
}): JobSheet {
  const approved = input.receipts.filter((e) => e.status === 'approved');
  const money = (e: SheetReceipt, withFor: boolean): MoneyRow => ({
    tech: e.contractor_name || 'Office', day: e.expense_date, store: e.vendor ?? '', amount: Number(e.amount) || 0,
    ...(withFor ? { for: [expenseCategoryLabel(e.category), (e.note ?? '').trim()].filter(Boolean).join(' · ') } : {}),
  });
  const office = input.hoursScreen ?? [];
  const setDays = new Set(office.map((d) => `${d.day}|${d.tech}`));
  return {
    time: [
      ...input.visits.filter((v) => !setDays.has(`${v.day}|${v.tech}`)).map((v) => ({
        tech: v.tech, day: v.day, in: clockOf(v.inAt, input.timeZone),
        out: v.outAt ? clockOf(v.outAt, input.timeZone) : '', brk: 0,
        ...(v.open ? { open: true, ms: v.ms } : {}),
      })),
      ...office.filter((d) => !d.hidden).map((d): TimeRow => ({ tech: d.tech, day: d.day, in: d.in, out: d.out, brk: d.brk, ...(d.hours != null ? { hours: d.hours } : {}) })),
    ],
    miles: input.mileage.map((m) => ({ ...m })),
    meals: approved.filter((e) => e.category === 'meals').map((e) => money(e, false)),
    materials: approved.filter((e) => e.category === 'materials').map((e) => money(e, false)),
    other: approved.filter((e) => e.category !== 'meals' && e.category !== 'materials').map((e) => money(e, true)),
  };
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : null);
const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const rowsOf = (v: unknown) => (Array.isArray(v) ? v.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object') : []);

/** The job's saved sheet (work_orders.job_log_sheet), or null when there is none; rows without a tech and a day are dropped. */
export function parseSheet(raw: unknown): JobSheet | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const keep = <T extends { tech: string; day: string }>(r: T) => !!r.tech.trim() && isDay(r.day);
  const money = (r: Record<string, unknown>, withFor: boolean): MoneyRow => ({
    tech: str(r.tech), day: str(r.day), store: str(r.store), amount: num(r.amount) ?? 0, ...(withFor ? { for: str(r.for) } : {}),
  });
  return {
    time: rowsOf(o.time).map((r) => {
      const hours = num(r.hours);
      return { tech: str(r.tech), day: str(r.day), in: str(r.in), out: str(r.out), brk: num(r.brk) ?? 0, ...(hours != null ? { hours } : {}) };
    }).filter(keep),
    miles: rowsOf(o.miles).map((r) => ({ tech: str(r.tech), day: str(r.day), start: num(r.start), end: num(r.end), miles: num(r.miles) ?? 0 })).filter(keep),
    meals: rowsOf(o.meals).map((r) => money(r, false)).filter(keep),
    materials: rowsOf(o.materials).map((r) => money(r, false)).filter(keep),
    other: rowsOf(o.other).map((r) => money(r, true)).filter(keep),
  };
}

const byDay = <T extends { day: string }>(rows: T[], then?: (a: T, b: T) => number) =>
  [...rows].sort((a, b) => a.day.localeCompare(b.day) || (then ? then(a, b) : 0));

/** Every section in day order, and clock-in order within a day. */
export function sheetSorted(s: JobSheet): JobSheet {
  return {
    time: byDay(s.time, (a, b) => (minutesOf(a.in) ?? 0) - (minutesOf(b.in) ?? 0)),
    miles: byDay(s.miles), meals: byDay(s.meals), materials: byDay(s.materials), other: byDay(s.other),
  };
}

/** Each tech's rows together, the lead tech first as the log lists them, in day order within: the order to edit in. */
export function sheetByTech(s: JobSheet, crew: string[]): JobSheet {
  const o = sheetSorted(s);
  const group = <T extends { tech: string }>(rows: T[]) => byTechGroups(rows, (r) => r.tech, crew).flatMap((g) => g.items);
  return { time: group(o.time), miles: group(o.miles), meals: group(o.meals), materials: group(o.materials), other: group(o.other) };
}

/** The sheet as it's saved: in order, the words trimmed (so "Paul Gibbs " is Paul), without what only the live log has. */
export function sheetToSave(s: JobSheet): JobSheet {
  const o = sheetSorted(s);
  const t = (v: string) => v.trim();
  return {
    // A stretch still on site keeps its hours so far, so saving never drops them (Greptile, CodeRabbit on PR #39).
    time: o.time.map((r) => {
      const hours = r.hours ?? (r.open && !r.out ? rowHours(r) : null);
      return { tech: t(r.tech), day: r.day, in: r.in, out: r.out, brk: r.brk || 0, ...(hours != null ? { hours } : {}) };
    }),
    miles: o.miles.map(({ tech, day, start, end, miles }) => ({ tech: t(tech), day, start, end, miles })),
    meals: o.meals.map(({ tech, day, store, amount }) => ({ tech: t(tech), day, store: t(store), amount })),
    materials: o.materials.map(({ tech, day, store, amount }) => ({ tech: t(tech), day, store: t(store), amount })),
    other: o.other.map(({ tech, day, store, amount, for: f }) => ({ tech: t(tech), day, store: t(store), amount, for: t(f ?? '') })),
  };
}

/** The rows that can't be saved: no name, or no date. "Time on site row 2", … */
export function sheetProblems(s: JobSheet): string[] {
  const names = { time: 'Time on site', miles: 'Mileage', meals: 'Meals', materials: 'Materials', other: 'Other receipts' } as const;
  return (Object.keys(names) as (keyof JobSheet)[]).flatMap((k) => (s[k] as { tech: string; day: string }[])
    .map((r, i) => (!r.tech.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(r.day) ? `${names[k]} row ${i + 1}` : null))
    .filter((x): x is string => !!x));
}

/** Only the rows in the dates picked (either end may be open). */
export function sheetInDates(s: JobSheet, from: string, to: string): JobSheet {
  const ok = (r: { day: string }) => (!from || r.day >= from) && (!to || r.day <= to);
  return { time: s.time.filter(ok), miles: s.miles.filter(ok), meals: s.meals.filter(ok), materials: s.materials.filter(ok), other: s.other.filter(ok) };
}

/** Today in the time zone, for a row added by hand. */
export const todayIn = (timeZone?: string) => dayOf(new Date().toISOString(), timeZone);
