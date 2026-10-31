// Arrival by GPS (Fred, 2026-10-31: "gps from marking home and the site so the
// app know when they arrived to the site"). The site's spot is the work order's
// address (siteLat / siteLng); home is a spot the tech saves from Profile, kept
// on their phone only. While a drive is running and the app is open, being
// within ARRIVE_MILES of where they're headed brings up "You're here".
//
// Pure and unit-tested (lib/arrival.test.ts).
import { milesBetween } from './geo';
import { fsStage } from './fs-stage';
import { dayState, type DayState } from './project-day';
import { todayISO } from './utils';
import { canWork, sortTechJobs, type WfJob } from './wf';
import type { KeyValue } from './wf-outbox';

/** About 250 m: a parking lot away, not the next block. */
export const ARRIVE_MILES = 0.15;
const METERS_PER_MILE = 1609.344;

export type Spot = { lat: number; lng: number };
export type Fix = Spot & { accuracy?: number | null };

const HOME = (uid: string) => `faj-tech-home:${uid}`;

export function loadHome(kv: KeyValue | null, uid: string): Spot | null {
  if (!kv || !uid) return null;
  try {
    const v = JSON.parse(kv.getItem(HOME(uid)) ?? 'null') as Spot | null;
    return v && Number.isFinite(v.lat) && Number.isFinite(v.lng) ? { lat: v.lat, lng: v.lng } : null;
  } catch { return null; }
}

export function saveHome(kv: KeyValue | null, uid: string, spot: Spot): void {
  if (!kv || !uid) return;
  try { kv.setItem(HOME(uid), JSON.stringify({ lat: spot.lat, lng: spot.lng })); } catch { /* storage blocked */ }
}

export function clearHome(kv: KeyValue | null, uid: string): void {
  if (!kv || !uid) return;
  try { kv.removeItem(HOME(uid)); } catch { /* storage blocked */ }
}

export function siteSpot(job: WfJob): Spot | null {
  return job.siteLat != null && job.siteLng != null ? { lat: job.siteLat, lng: job.siteLng } : null;
}

/** Within ARRIVE_MILES, plus up to 0.1 mi for a rough GPS fix. */
export function isNear(here: Fix, spot: Spot | null): boolean {
  if (!spot) return false;
  const slack = Math.min((here.accuracy ?? 0) / METERS_PER_MILE, 0.1);
  return milesBetween(here.lat, here.lng, spot.lat, spot.lng) <= ARRIVE_MILES + slack;
}

export type Arrival = 'site' | 'home';

/** On a drive and now where it was headed: the site, or home. */
export function arrivalAt(st: DayState, here: Fix, site: Spot | null, home: Spot | null): Arrival | null {
  if (st.stage !== 'travel') return null;
  if (st.dest === 'site') return isNear(here, site) ? 'site' : null;
  if (st.dest === 'home') return isNear(here, home) ? 'home' : null;
  return null;
}

/** The job whose drive is running now (the latest, if more than one). */
export function drivingJob(jobs: WfJob[], now: Date = new Date()): { job: WfJob; st: Extract<DayState, { stage: 'travel' }> } | null {
  let best: { job: WfJob; st: Extract<DayState, { stage: 'travel' }> } | null = null;
  for (const job of jobs) {
    if (!job.dayFlow || !(canWork(job) || job.status === 'workDone')) continue;
    const st = dayState(job.myDay ?? [], now);
    if (st.stage === 'travel' && (!best || st.since > best.st.since)) best = { job, st };
  }
  return best;
}

/**
 * The job to check in for, when the tech hasn't started their day: a job of
 * theirs on today's date, and nothing under way on any job. Null otherwise.
 */
export function checkInDue(jobs: WfJob[], now: Date = new Date()): WfJob | null {
  const today = todayISO(now);
  const underWay = jobs.some((j) => j.dayFlow && (canWork(j) || j.status === 'workDone')
    && !['ready', 'done'].includes(fsStage(j.myDay ?? [], {}, now, 'America/New_York')));
  if (underWay) return null;
  const todays = jobs.filter((j) => j.dayFlow && canWork(j) && j.status !== 'offered'
    && j.date != null && j.date <= today && (j.endDate ?? j.date) >= today
    && fsStage(j.myDay ?? [], {}, now, 'America/New_York') === 'ready');
  return sortTechJobs(todays, today)[0] ?? null;
}
