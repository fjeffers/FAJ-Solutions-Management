// The tech's job day as one list of steps, the next one lit (Fred, 2026-10-31:
// "a guided job day"). The job screen still shows every card; this says which
// one is next and takes the tech there.
import type { FsStage } from './fs-stage';
import { missingGoesTo } from './wf';

export type GuideTarget = 'day' | 'photos' | 'report' | 'closeout';
export type GuideStep = { key: string; label: string; state: 'done' | 'now' | 'later'; target: GuideTarget };

const ARRIVED: FsStage[] = ['onsite', 'lunch', 'stopped', 'offsite', 'returning', 'done'];
const LEFT: FsStage[] = ['offsite', 'returning', 'done'];

/**
 * Check in, get to the site, then what the job asks for (photos, the report and
 * questions, the closeout), then check out. `missing` is the check-out list
 * (reportMissing + closeoutMissing), so the guide and check-out always agree.
 */
export function jobDayGuide(f: {
  stage: FsStage; workDone: boolean; photos: boolean; report: boolean; closeout: boolean; missing: string[];
}): GuideStep[] {
  const left = (t: GuideTarget) => f.missing.some((m) => missingGoesTo(m) === t);
  const steps: Omit<GuideStep, 'state'>[] = [
    { key: 'checkin', label: 'Check in', target: 'day' },
    { key: 'arrive', label: 'Get to the site', target: 'day' },
    ...(f.photos ? [{ key: 'photos', label: 'Photos', target: 'photos' as const }] : []),
    ...(f.report ? [{ key: 'report', label: 'Notes & questions', target: 'report' as const }] : []),
    ...(f.closeout ? [{ key: 'closeout', label: 'Closeout', target: 'closeout' as const }] : []),
    { key: 'checkout', label: 'Check out', target: 'day' },
  ];
  const done = (k: string, t: GuideTarget): boolean => {
    if (f.workDone) return true;
    if (k === 'checkin') return f.stage !== 'ready';
    if (k === 'arrive') return ARRIVED.includes(f.stage);
    if (k === 'checkout') return LEFT.includes(f.stage);
    return !left(t);
  };
  let lit = false;
  return steps.map((s) => {
    if (done(s.key, s.target)) return { ...s, state: 'done' };
    if (lit) return { ...s, state: 'later' };
    lit = true;
    return { ...s, state: 'now' };
  });
}
