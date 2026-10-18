import { describe, it, expect } from 'vitest';
import { fsStage, fsNextStep, FS_STAGE_NAME, type FsStage } from './fs-stage';
import type { DayEvent } from './project-day';

const TZ = 'America/New_York';
// Tue 2026-10-13 in New York (EDT, UTC-4).
const at = (hhmm: string, day = '2026-10-13') => new Date(`${day}T${hhmm}:00-04:00`).toISOString();
const ev = (kind: DayEvent['kind'], hhmm: string, extra: Partial<DayEvent> = {}, day?: string): DayEvent => ({ kind, at: at(hhmm, day), ...extra });
const stage = (events: DayEvent[], hhmm = '23:00', openIssue = false) => fsStage(events, { openIssue }, new Date(at(hhmm)), TZ);

describe('fsStage — Field Service names for the FAJ day', () => {
  it('walks a whole day in Field Service stages', () => {
    const taps: DayEvent[] = [];
    const seen: FsStage[] = [stage(taps)];
    for (const tap of [
      ev('day_start', '07:00'),
      ev('travel_start', '07:05', { origin: 'hotel', dest: 'site' }),
      ev('travel_end', '07:40'),
      ev('in', '07:40'),
      ev('lunch_start', '12:00'),
      ev('lunch_end', '12:30'),
      ev('out', '16:00'),
      ev('travel_start', '16:05', { origin: 'site', dest: 'hotel' }),
      ev('travel_end', '16:40'),
    ]) {
      taps.push(tap);
      seen.push(stage(taps));
    }
    expect(seen).toEqual(['ready', 'clocked', 'outbound', 'clocked', 'onsite', 'lunch', 'onsite', 'offsite', 'returning', 'done']);
  });

  it('shows Work stopped while a problem reported on site is open', () => {
    const onSite = [ev('day_start', '07:00'), ev('in', '07:30')];
    expect(stage(onSite, '09:00', true)).toBe('stopped');
    expect(stage(onSite, '09:00', false)).toBe('onsite');
    // Lunch and off site are not hidden by an open problem.
    expect(stage([...onSite, ev('lunch_start', '12:00')], '12:10', true)).toBe('lunch');
  });

  it('counts travel to the next site as outbound and home as returning', () => {
    const base = [ev('day_start', '07:00'), ev('in', '07:30'), ev('out', '11:00')];
    expect(stage([...base, ev('travel_start', '11:05', { dest: 'next_site' })], '11:10')).toBe('outbound');
    expect(stage([...base, ev('travel_start', '11:05', { dest: 'home' })], '11:10')).toBe('returning');
  });

  it("starts fresh the next morning after yesterday's day ended", () => {
    const yesterday = [ev('day_start', '07:00', {}, '2026-10-12'), ev('in', '07:30', {}, '2026-10-12'), ev('out', '16:00', {}, '2026-10-12'),
      ev('travel_start', '16:05', { dest: 'home' }, '2026-10-12'), ev('travel_end', '16:40', {}, '2026-10-12')];
    expect(stage(yesterday, '06:30')).toBe('ready');
  });
});

describe('fsNextStep', () => {
  it('says the next step for every stage', () => {
    for (const s of Object.keys(FS_STAGE_NAME) as FsStage[]) expect(fsNextStep(s, 'inProgress')).toBeTruthy();
    expect(fsNextStep('ready', 'scheduled')).toBe('Clock in');
    expect(fsNextStep('outbound', 'inProgress')).toBe('Confirm arrival');
    expect(fsNextStep('stopped', 'inProgress')).toBe('Resolve the reported issue');
  });

  it('asks for an answer on a job offered to the tech', () => {
    expect(fsNextStep('ready', 'offered')).toBe('Accept or decline this job');
    expect(fsNextStep('ready', 'declined')).toBe('You declined this job');
  });

  it("follows FAJ's own review once the work is done", () => {
    expect(fsNextStep('done', 'workDone')).toBe('Waiting for the office to approve');
    expect(fsNextStep('ready', 'closed')).toBe('Work accepted');
    expect(fsNextStep('done', 'inProgress')).toBe('Done for today');
  });
});
