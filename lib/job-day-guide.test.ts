import { describe, expect, it } from 'vitest';
import { jobDayGuide } from './job-day-guide';

const now = (g: ReturnType<typeof jobDayGuide>) => g.find((s) => s.state === 'now')?.key ?? null;
const all = { photos: true, report: true, closeout: true };

describe('jobDayGuide', () => {
  it('starts with Check in, then getting to the site', () => {
    expect(now(jobDayGuide({ ...all, stage: 'ready', workDone: false, missing: [] }))).toBe('checkin');
    expect(now(jobDayGuide({ ...all, stage: 'outbound', workDone: false, missing: [] }))).toBe('arrive');
  });

  it('on site, lights the first thing the check-out list still needs', () => {
    const g = jobDayGuide({ ...all, stage: 'onsite', workDone: false,
      missing: ['Answer: Rack mounted?', 'Get the customer to sign off under Closeout'] });
    expect(g.map((s) => [s.key, s.state])).toEqual([
      ['checkin', 'done'], ['arrive', 'done'], ['photos', 'done'], ['report', 'now'], ['closeout', 'later'], ['checkout', 'later'],
    ]);
    expect(g.find((s) => s.key === 'report')!.target).toBe('report');
  });

  it('with everything in, the next step is Check out; work done finishes the list', () => {
    expect(now(jobDayGuide({ ...all, stage: 'onsite', workDone: false, missing: [] }))).toBe('checkout');
    expect(now(jobDayGuide({ ...all, stage: 'onsite', workDone: true, missing: ['Add at least one photo of the work'] }))).toBeNull();
  });

  it('leaves out what the job does not ask for', () => {
    const g = jobDayGuide({ photos: false, report: false, closeout: false, stage: 'ready', workDone: false, missing: [] });
    expect(g.map((s) => s.key)).toEqual(['checkin', 'arrive', 'checkout']);
  });
});
