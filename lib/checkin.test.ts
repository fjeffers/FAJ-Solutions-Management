import { describe, it, expect } from 'vitest';
import { DRIVES, drivesFor, driveOf, tripOf, parseStartAsks, addStartAsk, checkInNotes, checkInMissing, START_ASK_MAX } from './checkin';

describe('check in: the drive', () => {
  it('names every drive in one list, the likely ones first, nothing picked', () => {
    expect(DRIVES.map((d) => d.label)).toEqual(['Home → Hotel', 'Hotel → Site', 'Site → Hotel', 'Home → Site', 'Site → Home', 'Hotel → Home', 'Site → Next site']);
    expect(drivesFor('hotel').slice(0, 2).map((d) => d.label)).toEqual(['Hotel → Site', 'Hotel → Home']);
    expect(drivesFor(null)).toEqual(DRIVES);
    // After Work done only the drive back is left.
    expect(drivesFor('site', true).map((d) => d.label)).toEqual(['Site → Hotel', 'Site → Home', 'Home → Hotel', 'Hotel → Home']);
  });

  it('records the drive as FAJ Start travel takes it', () => {
    expect(tripOf(driveOf('home-hotel')!)).toEqual({ trip: 'hotel', from: 'home' });
    expect(tripOf(driveOf('hotel-site')!)).toEqual({ trip: 'site', from: 'hotel' });
    expect(tripOf(driveOf('site-next')!)).toEqual({ trip: 'between', from: 'site' });
    expect(driveOf('nope')).toBeNull();
  });
});

describe('check in: what the office asks for', () => {
  it('keeps a stored list safe', () => {
    expect(parseStartAsks([
      { id: 'ask-1', label: '  Photo of   the truck ', kind: 'photo' },
      { id: 'ask-2', label: 'Fuel level', kind: 'answer' },
      { id: 'ask-2', label: 'Duplicate', kind: 'answer' },
      { id: 'BAD', label: 'x' }, { id: 'ask-3', label: '' }, 'junk',
    ])).toEqual([{ id: 'ask-1', label: 'Photo of the truck', kind: 'photo' }, { id: 'ask-2', label: 'Fuel level', kind: 'answer' }]);
    expect(parseStartAsks(null)).toEqual([]);
  });

  it('adds items up to ten', () => {
    const one = addStartAsk([], ' Photo of the truck ', 'photo', 'Ab1');
    expect(one).toEqual([{ id: 'ask-ab1', label: 'Photo of the truck', kind: 'photo' }]);
    expect(addStartAsk(one!, '  ', 'photo', 'x')).toBeNull();
    let list = one!;
    for (let i = 0; i < START_ASK_MAX - 1; i++) list = addStartAsk(list, `Item ${i}`, 'answer', `s${i}`)!;
    expect(list).toHaveLength(START_ASK_MAX);
    expect(addStartAsk(list, 'One more', 'photo', 'zz')).toBeNull();
  });

  it('puts the answers in messages for the office, none cut off', () => {
    const asks = [{ id: 'a', label: 'Truck', kind: 'answer' as const }, { id: 'b', label: 'Truck photo', kind: 'photo' as const }, { id: 'c', label: 'Fuel', kind: 'answer' as const }];
    expect(checkInNotes(driveOf('home-site'), asks, { a: ' F-150 ', c: 'Full' })).toEqual(['Check-in, Home → Site · Truck: F-150 · Fuel: Full']);
    expect(checkInNotes(null, asks, {})).toEqual([]);
    // Ten long answers: every one arrives, each message under the 2,000 the office keeps.
    const ten = Array.from({ length: 10 }, (_, i) => ({ id: `q${i}`, label: `Question ${i + 1}`, kind: 'answer' as const }));
    const notes = checkInNotes(driveOf('home-site'), ten, Object.fromEntries(ten.map((q) => [q.id, 'x'.repeat(300)])));
    expect(notes.length).toBeGreaterThan(1);
    expect(notes.every((n) => n.length <= 2000)).toBe(true);
    expect(ten.every((q) => notes.some((n) => n.includes(`${q.label}: ${'x'.repeat(300)}`)))).toBe(true);
    expect(notes[1].startsWith('Check-in, Home → Site (continued) · ')).toBe(true);
  });

  it('says what is still needed before Done', () => {
    const asks = [{ id: 'a', label: 'Truck', kind: 'answer' as const }, { id: 'b', label: 'Truck photo', kind: 'photo' as const }];
    const base = { needsDrive: true, drive: null, needsMileage: true, mileage: '', hasMileagePhoto: false, asks, answers: {}, photos: {} };
    expect(checkInMissing(base)).toEqual(['Pick where you are driving', 'Take the photo of the starting mileage', 'Enter the starting mileage', 'Answer: Truck', 'Photo: Truck photo']);
    expect(checkInMissing({ ...base, drive: driveOf('home-site'), mileage: '48,200', hasMileagePhoto: true, answers: { a: 'F-150' }, photos: { b: true } })).toEqual([]);
    expect(checkInMissing({ ...base, needsDrive: false, needsMileage: false, asks: [] })).toEqual([]);
  });
});

describe('the four activities at check-in (Fred, 2026-10-18)', async () => {
  const { activityOf, checkInChoices, ON_SITE_KEY, DRIVES, ACTIVITY_LABEL } = await import('./checkin');
  const { buildDayLogs } = await import('./project-day');

  it('names every drive by its activity', () => {
    expect(Object.fromEntries(DRIVES.map((d) => [d.label, ACTIVITY_LABEL[activityOf(d.origin, d.dest)]]))).toEqual({
      'Home → Hotel': 'Travel to site', 'Hotel → Site': 'Travel to site', 'Home → Site': 'Travel to site',
      'Site → Next site': 'Site-to-site travel',
      'Site → Hotel': 'Travel from site', 'Site → Home': 'Travel from site', 'Hotel → Home': 'Travel from site',
    });
  });

  it('lists Traveling to (hotel, site, home, fuel) and On site at the bottom', async () => {
    const { checkInDrive } = await import('./checkin');
    const groups = checkInChoices('hotel');
    expect(groups.map((g) => g.label)).toEqual(['Traveling to', 'On site']);
    expect(groups[0].options.map((o) => o.label)).toEqual(['Hotel', 'Site', 'Home', 'Fuel']);
    expect(groups[1].options).toEqual([{ key: ON_SITE_KEY, label: 'Log in on site: start work' }]);
    // The next site only when leaving a site; after Work done only the drive back.
    expect(checkInChoices('site')[0].options.map((o) => o.label)).toContain('Next site');
    expect(checkInChoices('site', true).map((g) => g.options.map((o) => o.label))).toEqual([['Hotel', 'Home', 'Fuel']]);
    // Leaving from where the tech is now.
    expect(checkInDrive('to-site', 'hotel')).toMatchObject({ origin: 'hotel', dest: 'site', label: 'Hotel → Site' });
    expect(checkInDrive('to-fuel', 'site')).toMatchObject({ origin: 'site', dest: 'fuel', label: 'Site → Fuel' });
    expect(checkInDrive('to-next_site', 'site')).toMatchObject({ origin: 'site', dest: 'next_site' });
    expect(checkInDrive('to-site', null)).toMatchObject({ origin: 'other', label: 'Here → Site' });
    expect(checkInDrive(ON_SITE_KEY, 'site')).toBeNull();
  });

  it('saves all four: each drive with where it went, and work on site as the clock', () => {
    const ev = (kind: string, hhmm: string, extra: Record<string, unknown> = {}) =>
      ({ kind, at: new Date(`2026-10-19T${hhmm}:00-04:00`).toISOString(), tech: 'Dana', ...extra }) as never;
    // What Check in records for each choice: travel_start with origin and destination, or the clock-in.
    const day = buildDayLogs([
      ev('day_start', '06:59'),
      ev('travel_start', '07:00', { origin: 'hotel', dest: 'site' }), ev('travel_end', '07:30', { miles: 12 }),
      ev('in', '07:31'), ev('out', '11:00'),
      ev('travel_start', '11:01', { origin: 'site', dest: 'next_site' }), ev('travel_end', '11:40', { miles: 20 }),
      ev('in', '11:41'), ev('out', '16:00'),
      ev('travel_start', '16:01', { origin: 'site', dest: 'hotel' }), ev('travel_end', '16:45', { miles: 30 }),
    ], new Date('2026-10-20T12:00:00Z'), 'America/New_York');
    expect(day).toHaveLength(1);
    expect(day[0].legs.map((l) => activityOf(l.origin, l.dest))).toEqual(['to_site', 'between_sites', 'from_site']);
    expect(day[0].spans).toHaveLength(2); // work on site, twice
    expect(day[0].legs.map((l) => l.miles)).toEqual([12, 20, 30]);
  });
});

describe('a fuel stop (migration 131)', async () => {
  const { buildDayLogs, dayState, lastPlace, legLabel } = await import('./project-day');
  const { activityOf } = await import('./checkin');
  const ev = (kind: string, hhmm: string, extra: Record<string, unknown> = {}) =>
    ({ kind, at: new Date(`2026-10-19T${hhmm}:00-04:00`).toISOString(), tech: 'Dana', ...extra }) as never;
  const taps = [
    ev('day_start', '06:59'),
    ev('travel_start', '07:00', { origin: 'hotel', dest: 'fuel' }), ev('travel_end', '07:10', { miles: 3 }),
    ev('travel_start', '07:20', { origin: 'fuel', dest: 'site' }), ev('travel_end', '07:50', { miles: 18 }),
  ];
  it('keeps the day going and the next drive leaves from it', () => {
    const now = new Date('2026-10-19T12:15:00Z');
    expect(dayState(taps.slice(0, 3), now, 'America/New_York').stage).toBe('clocked');
    expect(lastPlace(taps.slice(0, 3), now, 'America/New_York')).toBe('fuel');
    const legs = buildDayLogs(taps, new Date('2026-10-20T12:00:00Z'), 'America/New_York')[0].legs;
    expect(legs.map((l) => legLabel(l))).toEqual(['Hotel → Fuel stop', 'Fuel stop → Site']);
    expect(legs.map((l) => activityOf(l.origin, l.dest))).toEqual(['to_site', 'to_site']);
    expect(legs.map((l) => l.miles)).toEqual([3, 18]);
  });
});

