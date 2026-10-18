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
