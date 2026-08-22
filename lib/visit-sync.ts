// Keeping the times and the hours on a site visit in step.
//
// They are the same fact written twice, and a visit is edited from three
// places — the card, the spreadsheet grid and the check-in timer. This is the
// one rule they all use, so they cannot drift apart.
//
// Two directions:
//   times edited  -> total them into Hours
//   Hours edited  -> move the finish time of the last day to match
//
// And one thing that must never happen: on a multi-day job, Time In and Time
// Out are only mirrors of first-in and last-out, so the gap between them
// counts every night nobody was on site. One visit read 94.79 hours for 6.73
// hours of work that way.
import type { SiteVisit, VisitSession } from './types';
import { actualHours, billableHours, applyHoursToSessions } from './visits';

/**
 * What else has to change, given what was just edited.
 *
 * `next` is the visit as it will be after the edit; `patch` says which fields
 * the user actually touched, because a figure typed over a calculated one has
 * to stay typed.
 */
export function deriveTimesAndHours(
  next: Pick<SiteVisit, 'time_in' | 'time_out' | 'hours' | 'sessions'>,
  patch: Partial<SiteVisit>,
): Partial<SiteVisit> {
  const derived: Partial<SiteVisit> = {};
  const timesEdited = 'time_in' in patch || 'time_out' in patch;
  const hoursEdited = 'hours' in patch;

  if (timesEdited && next.time_in && next.time_out) {
    const stints = (next.sessions ?? []).filter((s) => s.in && s.out);

    if (stints.length > 1) {
      // Multi-day: the stints are the truth, never the gap between mirrors.
      const fromStints = actualHours(next.sessions ?? null);
      if (fromStints != null && fromStints > 0) derived.hours = billableHours(fromStints);
    } else {
      // One day: these times ARE the visit, so they set the hours, and the
      // single stint follows them so the two never disagree.
      const gap = (new Date(next.time_out).getTime() - new Date(next.time_in).getTime()) / 3600000;
      if (gap > 0) {
        derived.sessions = [{ in: next.time_in, out: next.time_out }];
        derived.hours = billableHours(Math.round(gap * 100) / 100);
      }
    }
    return derived;
  }

  if (hoursEdited) {
    const reshaped = applyHoursToSessions(next.sessions ?? null, next.hours);
    if (reshaped) {
      const outs = reshaped.filter((s) => s.out).map((s) => s.out!).sort();
      derived.sessions = reshaped as VisitSession[];
      derived.time_in = reshaped[0]?.in ?? next.time_in;
      derived.time_out = outs[outs.length - 1] ?? next.time_out;
    }
  }

  return derived;
}
