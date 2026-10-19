// The Work orders week calendar (Fred, 2026-10-18: "change the way I look at
// these work orders, the view sucks" ... "week calendar card like view").
// Sunday to Saturday (the US calendar), each job as a card on its day; a job that runs several
// days (start to its last day) shows on each one as "Day 2 of 6". Dates are
// plain YYYY-MM-DD strings, so no time zone can move a job to another day.
// Pure and unit-tested (lib/week-view.test.ts).

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const toUTC = (d: string) => Date.parse(`${d}T12:00:00Z`);
const fromUTC = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const addDays = (day: string, n: number): string => fromUTC(toUTC(day) + n * 86_400_000);

/** The Sunday a day's week starts on (a Sunday evening already shows the week ahead). */
export function weekStartOf(day: string): string {
  return addDays(day, -new Date(toUTC(day)).getUTCDay()); // 0 = Sunday
}

/** The seven days of a week, Sunday first. */
export const weekDays = (start: string): string[] => Array.from({ length: 7 }, (_, i) => addDays(start, i));

/** A job's days: its date to its last day. A last day before the start, or one far off, counts as the start alone. */
export function spanOf(j: { date: string | null; endDate?: string | null }): { start: string; end: string } | null {
  if (!j.date || !ISO.test(j.date)) return null;
  const end = j.endDate && ISO.test(j.endDate) && j.endDate >= j.date && toUTC(j.endDate) - toUTC(j.date) <= 62 * 86_400_000 ? j.endDate : j.date;
  return { start: j.date, end };
}

/** Where a day sits in a job: "Day 2 of 6", or null when the job isn't on that day. */
export function dayOfJob(j: { date: string | null; endDate?: string | null }, day: string): { n: number; of: number } | null {
  const s = spanOf(j);
  if (!s || day < s.start || day > s.end) return null;
  return { n: Math.round((toUTC(day) - toUTC(s.start)) / 86_400_000) + 1, of: Math.round((toUTC(s.end) - toUTC(s.start)) / 86_400_000) + 1 };
}

type Dated = { job: { date: string | null; endDate?: string | null; startTime: string; number: string } };

/** Each day of the week with its jobs, earliest start time first. */
export function weekJobs<T extends Dated>(rows: readonly T[], start: string): { day: string; rows: T[] }[] {
  const time = (t: string) => (/^\d{1,2}:\d{2}/.test(t) ? t.padStart(5, '0') : '99:99');
  return weekDays(start).map((day) => ({
    day,
    rows: rows.filter((r) => dayOfJob(r.job, day))
      .sort((a, b) => time(a.job.startTime).localeCompare(time(b.job.startTime)) || a.job.number.localeCompare(b.job.number)),
  }));
}

/** Jobs with no date yet: shown above the calendar so none gets lost. */
export const undated = <T extends Dated>(rows: readonly T[]): T[] => rows.filter((r) => !spanOf(r.job));

/** "Oct 18 – 24, 2026", or "Oct 25 – 31, 2026"; "Nov 29 – Dec 5, 2026" across months. */
export function weekLabel(start: string): string {
  const a = new Date(toUTC(start));
  const b = new Date(toUTC(addDays(start, 6)));
  const m = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  const right = a.getUTCMonth() === b.getUTCMonth() ? `${b.getUTCDate()}` : `${m(b)} ${b.getUTCDate()}`;
  return `${m(a)} ${a.getUTCDate()} – ${right}, ${b.getUTCFullYear()}`;
}
