// The office corrects a tech's tap time (Fred, 2026-10-24: "pull the info from
// their work order and get it in accurate times"). Migration 138 keeps the time
// the phone recorded; these are the words and the clock arithmetic for the
// screen (components/wf/ProjectOffice.tsx). Pure and unit-tested
// (lib/time-fix.test.ts).
import type { DayEvent } from './project-day';

/** What a tap was, in the words the tech saw. */
export function tapLabel(e: Pick<DayEvent, 'kind' | 'origin' | 'dest'>): string {
  switch (e.kind) {
    case 'day_start': return 'Clocked in';
    case 'travel_start': return e.dest === 'hotel' ? 'Left for the hotel' : e.dest === 'home' ? 'Left for home'
      : e.dest === 'fuel' ? 'Left for fuel' : e.dest === 'materials' ? 'Left for materials' : 'Started travel';
    case 'travel_end': return e.dest === 'hotel' ? 'Arrived at the hotel' : e.dest === 'home' ? 'Arrived home'
      : e.dest === 'fuel' ? 'Arrived for fuel' : e.dest === 'materials' ? 'Arrived for materials' : 'Arrived at the site';
    case 'in': return 'Started the job';
    case 'out': return 'Off site';
    case 'lunch_start': return 'Lunch';
    case 'lunch_end': return 'Back from lunch';
  }
}

/** Wall-clock parts of an instant in a time zone. */
function parts(ms: number, timeZone: string) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second };
}

/** An instant as "YYYY-MM-DDTHH:MM" on the wall clock of `timeZone` (for a datetime-local box). */
export function toLocalInput(iso: string, timeZone: string): string {
  const p = parts(Date.parse(iso), timeZone);
  const z = (n: number) => String(n).padStart(2, '0');
  return `${p.y}-${z(p.mo)}-${z(p.d)}T${z(p.h)}:${z(p.mi)}`;
}

/** "YYYY-MM-DDTHH:MM" read on the wall clock of `timeZone` → the instant (ISO). Null when it isn't a time. */
export function fromLocalInput(value: string, timeZone: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  // The zone's offset at that moment, found by reading the guess back; twice covers a clock change.
  let t = asUtc;
  for (let i = 0; i < 2; i++) {
    const p = parts(t, timeZone);
    t = asUtc - (Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - t);
  }
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** Why a corrected time can't be saved, or null when it can (the database checks the same). */
export function fixProblem(phoneAt: string, next: string, now: Date = new Date()): string | null {
  const n = Date.parse(next);
  if (!Number.isFinite(n)) return 'Pick a date and time.';
  if (n > now.getTime() + 5 * 60_000) return 'That time hasn’t happened yet.';
  if (Math.abs(n - Date.parse(phoneAt)) > 2 * 86_400_000) return 'A time can only move up to 2 days from what the phone recorded.';
  return null;
}

/** The database's reasons, in words. */
export function fixFailure(reason: string | undefined): string {
  switch (reason) {
    case 'not_owner': return 'Only the business owner can change a tech’s times.';
    case 'future': return 'That time hasn’t happened yet.';
    case 'too_far': return 'A time can only move up to 2 days from what the phone recorded.';
    case 'not_found': return 'That tap is gone. Reload and try again.';
    default: return 'The time wasn’t saved. Try again.';
  }
}
