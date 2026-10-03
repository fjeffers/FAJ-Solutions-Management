// A tech's week (Fred, 2026-10-02: "add my schedule to the tech portal").
// Pure helpers: which of the tech's jobs fall on which day, which crew-site
// weeks cover the week, and the same list as a calendar file (.ics) the phone
// can add to its own calendar. Nothing here carries money — a tech's WfJob has
// none (lib/wf.ts).
import { addDaysISO } from './utils';
import { fullAddress, parseClockTime, type WfJob } from './wf';

/** The Monday of the week a YYYY-MM-DD date falls in. */
export function mondayOf(date: string): string {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7; // Mon 0 … Sun 6
  return addDaysISO(date, -back);
}

/** Mon–Sun of the week starting on `monday`. */
export const weekDays = (monday: string): string[] => Array.from({ length: 7 }, (_, i) => addDaysISO(monday, i));

/** Jobs that belong on the tech's own schedule: theirs, not someone else's open job, not turned down. */
export const onMySchedule = (j: WfJob) => j.status !== 'open' && j.status !== 'declined';

/** Minutes after midnight for sorting; jobs with no time go first ("any time"). */
const startMinutes = (j: WfJob) => {
  const t = parseClockTime(j.startTime ?? '');
  return t ? t[0] * 60 + t[1] : -1;
};

export type ScheduleDay = { date: string; jobs: WfJob[] };

/** The week, day by day, with each day's jobs in time order. */
export function scheduleWeek(jobs: WfJob[], monday: string): ScheduleDay[] {
  const mine = jobs.filter(onMySchedule);
  return weekDays(monday).map((date) => ({
    date,
    jobs: mine.filter((j) => j.date === date).sort((a, b) => startMinutes(a) - startMinutes(b) || a.number.localeCompare(b.number)),
  }));
}

/** The tech's live jobs with no date yet — still theirs, just not on a day. */
export const undatedJobs = (jobs: WfJob[]) =>
  jobs.filter((j) => onMySchedule(j) && !j.date && j.status !== 'closed');

export type CrewWeek = { id: string; name: string; where: string; project: string; weekStart: string };

/** Crew sites booked for the week starting `monday` (a site's week starts on its Monday). */
export const crewThisWeek = (sites: CrewWeek[], monday: string) => sites.filter((s) => s.weekStart === monday);

// ── Calendar file ───────────────────────────────────────────────────────────

const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
const compactDate = (d: string) => d.replace(/-/g, '');
const clock = (t: [number, number]) => `${String(t[0]).padStart(2, '0')}${String(t[1]).padStart(2, '0')}00`;

/** Lines longer than 75 octets are folded, as the calendar format requires. */
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) { out.push(rest.slice(0, 74)); rest = ` ${rest.slice(74)}`; }
  out.push(rest);
  return out.join('\r\n');
}

/**
 * The tech's dated jobs (from `from` on) and crew weeks as one calendar file.
 * Times are the site's clock time ("floating"), so 8:00 AM stays 8:00 AM.
 * A job with no start time is an all-day event; a crew week runs Mon–Fri.
 */
export function scheduleIcs(jobs: WfJob[], crew: CrewWeek[], from: string, now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const events: string[] = [];
  for (const j of jobs) {
    if (!onMySchedule(j) || j.status === 'closed' || !j.date || j.date < from) continue;
    const start = parseClockTime(j.startTime ?? '');
    const end = parseClockTime(j.endTime ?? '');
    const lines = ['BEGIN:VEVENT', `UID:wo-${j.id}@app.fajsolutions.com`, `DTSTAMP:${stamp}`];
    if (start) {
      lines.push(`DTSTART:${compactDate(j.date)}T${clock(start)}`);
      const fin: [number, number] = end && end[0] * 60 + end[1] > start[0] * 60 + start[1]
        ? end : [Math.min(23, start[0] + 2), start[0] + 2 > 23 ? 59 : start[1]];
      lines.push(`DTEND:${compactDate(j.date)}T${clock(fin)}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${compactDate(j.date)}`, `DTEND;VALUE=DATE:${compactDate(addDaysISO(j.date, 1))}`);
    }
    lines.push(`SUMMARY:${icsText(`WO ${j.number} · ${j.title}`)}`);
    const where = fullAddress(j);
    if (where) lines.push(`LOCATION:${icsText(where)}`);
    const about = [j.client, j.siteName && j.siteName !== where ? j.siteName : '', j.status === 'offered' ? 'Offer — answer it in the tech portal' : '',
      'Details: https://app.fajsolutions.com/tech'].filter(Boolean).join('\n');
    lines.push(`DESCRIPTION:${icsText(about)}`, 'END:VEVENT');
    events.push(...lines);
  }
  for (const s of crew) {
    if (addDaysISO(s.weekStart, 4) < from) continue;
    events.push(
      'BEGIN:VEVENT', `UID:crew-${s.id}@app.fajsolutions.com`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compactDate(s.weekStart)}`, `DTEND;VALUE=DATE:${compactDate(addDaysISO(s.weekStart, 5))}`,
      `SUMMARY:${icsText(`Crew site · ${s.name}`)}`,
      ...(s.where ? [`LOCATION:${icsText(s.where)}`] : []),
      `DESCRIPTION:${icsText(`${s.project}\nDetails: https://app.fajsolutions.com/tech`)}`,
      'END:VEVENT',
    );
  }
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//FAJ Solutions//Tech schedule//EN', 'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:FAJ jobs', ...events, 'END:VCALENDAR'].map(fold).join('\r\n') + '\r\n';
}
