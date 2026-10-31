import { describe, it, expect } from 'vitest';
import { arrivalAt, checkInDue, clearHome, drivingJob, isNear, loadHome, saveHome } from './arrival';
import { dayState, type DayEvent } from './project-day';
import type { WfJob } from './wf';

const SITE = { lat: 41.7658, lng: -72.6734 };
const HOME = { lat: 41.6, lng: -72.9 };
const NOW = new Date('2026-10-31T14:00:00Z');
const job = (o: Partial<WfJob>): WfJob => ({
  id: 'j1', number: '1', title: 'Job', siteName: 'Site', status: 'scheduled', date: '2026-10-31', endDate: null,
  dayFlow: true, myDay: [], siteLat: SITE.lat, siteLng: SITE.lng, startTime: '', endTime: '', ...o,
} as WfJob);
const drive = (dest: 'site' | 'home', origin: 'home' | 'site' = dest === 'site' ? 'home' : 'site'): DayEvent[] => [
  { kind: 'day_start', at: '2026-10-31T13:00:00Z' },
  { kind: 'travel_start', at: '2026-10-31T13:00:01Z', origin, dest },
];
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };

describe('isNear', () => {
  it('is near within about 250 m, not a mile off', () => {
    expect(isNear({ lat: 41.7665, lng: -72.6734 }, SITE)).toBe(true);
    expect(isNear({ lat: 41.78, lng: -72.6734 }, SITE)).toBe(false);
    expect(isNear({ lat: 41.7665, lng: -72.6734 }, null)).toBe(false);
  });
  it('gives a rough fix a little slack, at most 0.1 mi', () => {
    const edge = { lat: 41.7658 + 0.0028, lng: -72.6734 }; // about 0.19 mi
    expect(isNear(edge, SITE)).toBe(false);
    expect(isNear({ ...edge, accuracy: 100 }, SITE)).toBe(true);
    expect(isNear({ lat: 41.78, lng: -72.6734, accuracy: 5000 }, SITE)).toBe(false);
  });
});

describe('arrivalAt', () => {
  it('says site when driving to the site and there', () => {
    expect(arrivalAt(dayState(drive('site'), NOW), SITE, SITE, HOME)).toBe('site');
  });
  it('says home when driving home and there', () => {
    expect(arrivalAt(dayState(drive('home'), NOW), HOME, SITE, HOME)).toBe('home');
  });
  it('says nothing with no home saved, off target, or not driving', () => {
    expect(arrivalAt(dayState(drive('home'), NOW), HOME, SITE, null)).toBeNull();
    expect(arrivalAt(dayState(drive('site'), NOW), HOME, SITE, HOME)).toBeNull();
    expect(arrivalAt({ stage: 'ready' }, SITE, SITE, HOME)).toBeNull();
  });
});

describe('drivingJob', () => {
  it('finds the job whose drive is running', () => {
    const d = drivingJob([job({ id: 'a' }), job({ id: 'b', myDay: drive('site') })], NOW);
    expect(d?.job.id).toBe('b');
    expect(d?.st.dest).toBe('site');
  });
});

describe('checkInDue', () => {
  it("asks for check-in on today's job when nothing is under way", () => {
    expect(checkInDue([job({ id: 'tomorrow', date: '2026-11-01' }), job({ id: 'today' })], NOW)?.id).toBe('today');
  });
  it('counts a multi-day job running today', () => {
    expect(checkInDue([job({ date: '2026-10-30', endDate: '2026-11-02' })], NOW)?.id).toBe('j1');
  });
  it('stays quiet once a drive started, for an offer, or with no job today', () => {
    expect(checkInDue([job({ myDay: drive('site') })], NOW)).toBeNull();
    expect(checkInDue([job({ status: 'offered' })], NOW)).toBeNull();
    expect(checkInDue([job({ date: '2026-11-01' })], NOW)).toBeNull();
  });
});

describe('home spot', () => {
  it('is kept per login on the phone, and can be cleared', () => {
    const kv = mem();
    expect(loadHome(kv, 'u1')).toBeNull();
    saveHome(kv, 'u1', HOME);
    expect(loadHome(kv, 'u1')).toEqual(HOME);
    expect(loadHome(kv, 'u2')).toBeNull();
    clearHome(kv, 'u1');
    expect(loadHome(kv, 'u1')).toBeNull();
  });
});
