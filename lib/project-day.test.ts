import { describe, it, expect } from 'vitest';
import {
  parseDayEvents, dayState, onSiteMs, buildDayLogs, totalsOf, legLabel, sortEvents, lastPlace, tripLeg, type DayEvent,
} from './project-day';

const TZ = 'America/New_York';
// Tue 2026-10-13 in New York (EDT, UTC-4).
const at = (hhmm: string, day = '2026-10-13') => new Date(`${day}T${hhmm}:00-04:00`).toISOString();
const ev = (kind: DayEvent['kind'], hhmm: string, extra: Partial<DayEvent> = {}, day?: string): DayEvent => ({ kind, at: at(hhmm, day), ...extra });

describe('parseDayEvents', () => {
  it('keeps good taps, drops junk, sorts oldest first', () => {
    const got = parseDayEvents([
      { kind: 'in', at: at('08:10') },
      { kind: 'travel_start', at: at('07:05'), origin: 'home', dest: 'site' },
      { kind: 'nap', at: at('09:00') },
      { kind: 'out', at: 'yesterday' },
      'junk',
      { kind: 'travel_end', at: at('08:10'), miles: '42.4', contractor_name: 'Davis', id: 'e1' },
    ]);
    expect(got.map((e) => e.kind)).toEqual(['travel_start', 'travel_end', 'in']);
    expect(got[0]).toMatchObject({ origin: 'home', dest: 'site' });
    expect(got[1]).toMatchObject({ miles: 42.4, tech: 'Davis', id: 'e1' });
    expect(parseDayEvents(null)).toEqual([]);
  });

  it('puts arriving before starting the job when both happen in the same second', () => {
    const t = at('08:10');
    expect(sortEvents([{ kind: 'in', at: t }, { kind: 'travel_end', at: t }]).map((e) => e.kind)).toEqual(['travel_end', 'in']);
  });
});

describe('dayState — the one next step', () => {
  const now = new Date(at('12:00'));
  it('starts ready', () => {
    expect(dayState([], now, TZ)).toEqual({ stage: 'ready' });
  });
  it('walks through a whole day', () => {
    const day: DayEvent[] = [ev('travel_start', '07:05', { origin: 'hotel', dest: 'site' })];
    expect(dayState(day, now, TZ)).toMatchObject({ stage: 'travel', dest: 'site', origin: 'hotel' });
    day.push(ev('travel_end', '07:40'), ev('in', '07:40'));
    expect(dayState(day, now, TZ)).toMatchObject({ stage: 'onsite', since: at('07:40') });
    day.push(ev('lunch_start', '11:30'));
    expect(dayState(day, now, TZ)).toMatchObject({ stage: 'lunch', onSiteSince: at('07:40') });
    day.push(ev('lunch_end', '12:00'));
    const back = dayState(day, new Date(at('13:00')), TZ);
    expect(back).toMatchObject({ stage: 'onsite', lunchMs: 30 * 60_000 });
    // 07:40 → 13:00 is 5h20, less 30 min lunch.
    expect(onSiteMs(back, new Date(at('13:00')))).toBe((5 * 60 + 20 - 30) * 60_000);
    day.push(ev('out', '16:30'));
    expect(dayState(day, new Date(at('16:31')), TZ)).toMatchObject({ stage: 'offsite' });
    day.push(ev('travel_start', '16:35', { origin: 'site', dest: 'hotel' }));
    expect(dayState(day, new Date(at('16:40')), TZ)).toMatchObject({ stage: 'travel', dest: 'hotel' });
    day.push(ev('travel_end', '17:05', { miles: 18 }));
    expect(dayState(day, new Date(at('17:10')), TZ)).toEqual({ stage: 'ready' });
  });
  it('an evening off site with no drive starts fresh the next morning', () => {
    const day = [ev('in', '08:00'), ev('out', '16:00')];
    expect(dayState(day, new Date(at('18:00')), TZ).stage).toBe('offsite');
    expect(dayState(day, new Date(at('07:00', '2026-10-14')), TZ).stage).toBe('ready');
  });
  it('off site during lunch still leaves the site', () => {
    expect(dayState([ev('in', '08:00'), ev('lunch_start', '12:00'), ev('out', '12:10')], now, TZ).stage).toBe('offsite');
  });
});

describe('buildDayLogs — the office log and the client report', () => {
  const taps: DayEvent[] = [
    ev('travel_start', '07:05', { origin: 'home', dest: 'site', tech: 'Fred' }),
    ev('travel_end', '08:10', { miles: 42.4, tech: 'Fred', id: 'leg1' }),
    ev('in', '08:10', { tech: 'Fred' }),
    ev('lunch_start', '12:00', { tech: 'Fred' }),
    ev('lunch_end', '12:30', { tech: 'Fred' }),
    ev('out', '16:30', { tech: 'Fred' }),
    ev('travel_start', '16:35', { origin: 'site', dest: 'hotel', tech: 'Fred' }),
    ev('travel_end', '17:05', { miles: 18, tech: 'Fred', id: 'leg2' }),
    // Next day from the hotel, no GPS on arrival (no miles).
    ev('travel_start', '07:30', { origin: 'hotel', dest: 'site', tech: 'Fred' }, '2026-10-14'),
    ev('travel_end', '07:50', { tech: 'Fred' }, '2026-10-14'),
    ev('in', '07:50', { tech: 'Fred' }, '2026-10-14'),
  ];
  const logs = buildDayLogs(taps, new Date(at('09:50', '2026-10-14')), TZ);

  it('one log per tech per day, with legs and time on site', () => {
    expect(logs.map((d) => d.day)).toEqual(['2026-10-13', '2026-10-14']);
    const [tue, wed] = logs;
    expect(tue.legs.map(legLabel)).toEqual(['Home → Site', 'Site → Hotel']);
    expect(tue.legs.map((l) => l.miles)).toEqual([42.4, 18]);
    expect(tue.legs[0].endId).toBe('leg1');
    expect(tue.travelMs).toBe((65 + 30) * 60_000);
    expect(tue.lunchMs).toBe(30 * 60_000);
    // 08:10 → 16:30 is 8h20, less lunch.
    expect(tue.onSiteMs).toBe((8 * 60 + 20 - 30) * 60_000);
    expect(tue.miles).toBe(60.4);
    // Still on site Wednesday: counted up to now, still open.
    expect(wed.spans[0].out).toBeNull();
    expect(wed.onSiteMs).toBe(2 * 60 * 60_000);
    expect(wed.legs[0].miles).toBeNull();
  });

  it('adds up for the report', () => {
    const t = totalsOf(logs);
    expect(t.days).toBe(2);
    expect(t.miles).toBe(60.4);
    expect(t.travelMs).toBe((65 + 30 + 20) * 60_000);
  });

  it('keeps techs apart', () => {
    const two = buildDayLogs([
      ev('in', '08:00', { tech: 'Fred' }), ev('out', '10:00', { tech: 'Fred' }),
      ev('in', '09:00', { tech: 'Davis' }), ev('out', '10:00', { tech: 'Davis' }),
    ], new Date(at('12:00')), TZ);
    expect(two.map((d) => [d.tech, d.onSiteMs / 3_600_000])).toEqual([['Davis', 1], ['Fred', 2]]);
  });

  it('a travel leg that runs straight into Start job ends there, with no miles', () => {
    const [d] = buildDayLogs([ev('travel_start', '07:00', { dest: 'site' }), ev('in', '07:45')], new Date(at('08:00')), TZ);
    expect(d.legs).toHaveLength(1);
    expect(d.legs[0]).toMatchObject({ end: at('07:45'), miles: null, ms: 45 * 60_000 });
  });
});

describe('Start travel dropdown: Hotel / Home / Site / Between sites', () => {
  const now = new Date(at('18:00'));
  it('works out where the drive starts from', () => {
    expect(lastPlace([], now, TZ)).toBeNull();
    // Off site: leaving the site.
    expect(lastPlace([ev('in', '08:00'), ev('out', '16:00')], now, TZ)).toBe('site');
    // The next morning after driving to the hotel: leaving the hotel.
    const night = [ev('in', '08:00'), ev('out', '16:00'), ev('travel_start', '16:05', { origin: 'site', dest: 'hotel' }), ev('travel_end', '16:40')];
    expect(lastPlace(night, new Date(at('07:00', '2026-10-14')), TZ)).toBe('hotel');
    expect(tripLeg('site', night, new Date(at('07:00', '2026-10-14')), TZ)).toEqual({ origin: 'hotel', dest: 'site' });
  });
  it('between sites is site to the next site', () => {
    expect(tripLeg('between', [], now, TZ)).toEqual({ origin: 'site', dest: 'next_site' });
    expect(legLabel({ origin: 'site', dest: 'next_site' })).toBe('Between sites');
    expect(legLabel({ origin: 'hotel', dest: 'site' })).toBe('Hotel → Site');
    expect(legLabel({ origin: null, dest: 'site' })).toBe('Travel to site');
  });
  it('hotel and home after a day on site', () => {
    const day = [ev('in', '08:00'), ev('out', '16:00')];
    expect(tripLeg('hotel', day, now, TZ)).toEqual({ origin: 'site', dest: 'hotel' });
    expect(tripLeg('home', day, now, TZ)).toEqual({ origin: 'site', dest: 'home' });
  });
});

describe('Clock in first (migration 118)', () => {
  it('clock in, then travel; arriving at the site keeps the day going; the hotel ends it', () => {
    const day: DayEvent[] = [ev('day_start', '06:45')];
    expect(dayState(day, new Date(at('06:50')), TZ)).toEqual({ stage: 'clocked', since: at('06:45') });
    day.push(ev('travel_start', '07:00', { origin: 'hotel', dest: 'site' }), ev('travel_end', '07:40'));
    expect(dayState(day, new Date(at('07:41')), TZ)).toEqual({ stage: 'clocked', since: at('06:45') });
    day.push(ev('in', '07:40'), ev('out', '16:00'), ev('travel_start', '16:05', { origin: 'site', dest: 'hotel' }), ev('travel_end', '16:40'));
    expect(dayState(day, new Date(at('17:00')), TZ)).toEqual({ stage: 'ready' });
    const [d] = buildDayLogs(day, new Date(at('17:00')), TZ);
    expect(d.clockIn).toBe(at('06:45'));
    expect(d.signOut).toBe(at('16:40'));
    expect(lastPlace([ev('travel_start', '16:05', { dest: 'hotel' }), ev('travel_end', '16:40'), ev('day_start', '06:45', {}, '2026-10-14')],
      new Date(at('06:50', '2026-10-14')), TZ)).toBe('hotel');
  });
  it('a clock-in left open starts fresh the next day', () => {
    expect(dayState([ev('day_start', '06:45')], new Date(at('07:00', '2026-10-14')), TZ)).toEqual({ stage: 'ready' });
  });
  it('a clock-in while already on site changes nothing', () => {
    expect(dayState([ev('in', '08:00'), ev('day_start', '09:00')], new Date(at('09:30')), TZ).stage).toBe('onsite');
  });
});
