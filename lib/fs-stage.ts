// Field Service LIVE's stages on a FAJ job (Fred, 2026-10-18: FAJ techs get
// the Field Service tech screens on FAJ's own data). FAJ keeps its tap log and
// works out where the tech is on the phone (dayState), so taps made with no
// signal replay in order; this names that place the way Field Service does and
// says the one next step. FAJ's own review (Work Done → approved) stays as is.
//
// Pure and unit-tested (lib/fs-stage.test.ts).

import { dayOf, dayState, type DayEvent } from './project-day';
import type { WfStatus } from './wf';

export type FsStage = 'ready' | 'clocked' | 'outbound' | 'onsite' | 'lunch' | 'stopped' | 'offsite' | 'returning' | 'done';

/** The chip on a work order card. */
export const FS_STAGE_NAME: Record<FsStage, string> = {
  ready: 'Not started',
  clocked: 'Clocked in',
  outbound: 'Traveling',
  onsite: 'On site',
  lunch: 'At lunch',
  stopped: 'Work stopped',
  offsite: 'Off site',
  returning: 'Returning',
  done: 'Done',
};

/**
 * Where the tech is today. A problem reported on site and not yet resolved is
 * "Work stopped"; a day that ended at the hotel or home is "Done" until the
 * next morning.
 */
export function fsStage(events: DayEvent[], opts: { openIssue?: boolean } = {}, now: Date = new Date(), timeZone?: string): FsStage {
  const st = dayState(events, now, timeZone);
  switch (st.stage) {
    case 'clocked': return 'clocked';
    case 'travel': return st.dest === 'hotel' || st.dest === 'home' ? 'returning' : 'outbound';
    case 'onsite': return opts.openIssue ? 'stopped' : 'onsite';
    case 'lunch': return 'lunch';
    case 'offsite': return 'offsite';
  }
  const today = dayOf(now.toISOString(), timeZone);
  return events.some((e) => dayOf(e.at, timeZone) === today) ? 'done' : 'ready';
}

/** "Your next step" on the work order, in Field Service's words. */
export function fsNextStep(stage: FsStage, status: WfStatus): string {
  if (status === 'closed') return 'Work accepted';
  if (status === 'workDone') return 'Waiting for the office to approve';
  switch (stage) {
    case 'ready': return 'Clock in';
    case 'clocked': return 'Start travel to site';
    case 'outbound': return 'Confirm arrival';
    case 'onsite': return 'Record work or finish on site';
    case 'lunch': return 'Return from lunch';
    case 'stopped': return 'Resolve the reported issue';
    case 'offsite': return 'Start travel to the hotel, home or next site';
    case 'returning': return 'Finish travel and sign out';
    case 'done': return 'Done for today';
  }
}
