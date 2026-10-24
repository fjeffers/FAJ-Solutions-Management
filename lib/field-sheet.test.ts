import { describe, it, expect } from 'vitest';
import { buildDayLogs, type DayEvent } from './project-day';
import { matchOdometer, type OdoRow } from './weekly-bill';
import {
  appDays, clock, dayCalc, fieldSheetRows, jobDays, nextEdits, parseEdits, parseSettings, sheetRows, sheetTotals,
  type SavedDay, type SheetReceipt,
} from './field-sheet';

const TZ = 'America/New_York';
// Week 1 on the LDS Goldsboro site (2026-10-19), the taps exactly as the techs made them.
const ev = (tech: string, day: string, kind: DayEvent['kind'], hhmm: string, extra: Partial<DayEvent> = {}): DayEvent =>
  ({ kind, at: new Date(`2026-10-${day}T${hhmm}:00-04:00`).toISOString(), tech, ...extra });
const odo = (tech: string, day: string, hhmm: string, reading: number, moment: 'start' | 'end'): OdoRow =>
  ({ wo_id: 'wo', contractor_name: tech, at: new Date(`2026-10-${day}T${hhmm}:00-04:00`).toISOString(), moment, reading, ai_reading: reading, photo_path: null });

const events: DayEvent[] = [
  // Raja, Tuesday: the app worked as meant — Hotel → Site, Start job, Off site, Site → Hotel.
  ev('Raja', '20', 'travel_start', '07:43', { origin: 'hotel', dest: 'site' }), ev('Raja', '20', 'travel_end', '07:44', { miles: 0 }),
  ev('Raja', '20', 'in', '07:44'), ev('Raja', '20', 'out', '17:27'),
  ev('Raja', '20', 'travel_start', '17:27', { origin: 'site', dest: 'hotel' }), ev('Raja', '20', 'travel_end', '17:57', { miles: 2.1 }),
  // Dwayne, Wednesday: "Traveling to: Hotel" both ways, no Start job.
  ev('Dwayne', '21', 'travel_start', '07:38', { origin: 'hotel', dest: 'hotel' }), ev('Dwayne', '21', 'travel_end', '07:44', { miles: 2.2 }),
  ev('Dwayne', '21', 'travel_start', '17:18', { origin: 'hotel', dest: 'hotel' }), ev('Dwayne', '21', 'travel_end', '17:27', { miles: 2.2 }),
  // Dwayne, Tuesday: a fuel stop, then a "drive" from 8:18 to 1:33 that never moved.
  ev('Dwayne', '20', 'travel_start', '08:15', { origin: 'other', dest: 'fuel' }), ev('Dwayne', '20', 'travel_end', '08:15', { miles: 0 }),
  ev('Dwayne', '20', 'travel_start', '08:18', { origin: 'fuel', dest: 'hotel' }), ev('Dwayne', '20', 'travel_end', '13:33', { miles: 0 }),
  ev('Dwayne', '20', 'travel_start', '18:09', { origin: 'hotel', dest: 'hotel' }), ev('Dwayne', '20', 'travel_end', '18:18', { miles: 2.2 }),
  // Raja, Thursday: only the drive back at 6:05 PM.
  ev('Raja', '22', 'travel_start', '18:05', { origin: 'hotel', dest: 'hotel' }), ev('Raja', '22', 'travel_end', '18:39', { miles: 2.2 }),
  // Raja, Friday: the drive home.
  ev('Raja', '23', 'travel_start', '07:09', { origin: 'hotel', dest: 'home' }), ev('Raja', '23', 'travel_end', '15:19', { miles: 485.9 }),
];
const readings = [
  odo('Raja', '20', '07:44', 55330, 'start'), odo('Raja', '20', '07:44', 55334, 'end'),
  odo('Raja', '20', '17:28', 55334, 'start'), odo('Raja', '20', '17:57', 55351, 'end'),
  odo('Raja', '23', '07:10', 55418, 'start'), odo('Raja', '23', '15:19', 55871, 'end'),
];
const logs = buildDayLogs(events, new Date('2026-10-24T12:00:00Z'), TZ);
const legs = matchOdometer(logs.flatMap((d) => d.legs), readings);
const app = appDays(logs, legs, TZ);
const day = (tech: string, d: string) => app.find((a) => a.tech === tech && a.day === `2026-10-${d}`)!;

describe('the field sheet, from the app', () => {
  it('uses Start job and Off site when the tech tapped them, with the drives either side', () => {
    expect(day('Raja', '20')).toMatchObject({ left: '07:43', arrived: '07:44', leftSite: '17:27', back: '17:57', odoStart: 55330, odoEnd: 55351, gps: 2.1, guessed: [] });
  });

  it('takes the time on site from the gap between two drives when nobody tapped Start job', () => {
    expect(day('Dwayne', '21')).toMatchObject({ left: '07:38', arrived: '07:44', leftSite: '17:18', back: '17:27', gps: 4.4, guessed: ['arrived', 'leftSite'] });
    expect(day('Dwayne', '21').drives).toBe('7:38 AM–7:44 AM Hotel → Hotel, 2.2 mi; 5:18 PM–5:27 PM Hotel → Hotel, 2.2 mi');
  });

  it('reads a long drive with no miles as standing still, not driving', () => {
    expect(day('Dwayne', '20')).toMatchObject({ left: '08:15', arrived: '08:18', leftSite: '18:09', back: '18:18' });
  });

  it('reads a lone afternoon drive back to the hotel as leaving the site', () => {
    expect(day('Raja', '22')).toMatchObject({ left: null, arrived: null, leftSite: '18:05', back: '18:39', guessed: ['leftSite'] });
  });

  it('keeps a travel day as one drive, left to back', () => {
    expect(day('Raja', '23')).toMatchObject({ left: '07:09', arrived: null, leftSite: null, back: '15:19', odoStart: 55418, odoEnd: 55871 });
    expect(dayCalc(sheetRows({ app: [day('Raja', '23')], saved: [], techs: [], days: [] })[0].values, 0.6))
      .toMatchObject({ hours: 0, travel: 8.17, miles: 453, mileage: 271.8 });
  });
});

describe('the lines and the office’s edits', () => {
  const saved: SavedDay[] = [
    { id: 's1', day: '2026-10-21', tech: 'Raja', edits: { arrived: '07:52', note: 'Fuel stop first' }, added: false, hidden: false },
    { id: 's2', day: '2026-10-19', tech: 'Kendell', edits: { arrived: '08:00', leftSite: '16:30' }, added: true, hidden: false },
  ];
  const rows = sheetRows({ app, saved, techs: ['Dwayne', 'Raja'], days: jobDays('2026-10-19', '2026-10-20') });

  it('shows every app day, every added line, and the assigned techs with nothing on a job day', () => {
    expect(rows.map((r) => `${r.day.slice(8)} ${r.tech}${r.missing ? ' (missing)' : ''}`)).toEqual([
      '19 Dwayne (missing)', '19 Kendell', '19 Raja (missing)', '20 Dwayne', '20 Raja', '21 Dwayne', '21 Raja', '22 Raja', '23 Raja',
    ]);
  });

  it('puts the office’s figures over the app’s and says where each came from', () => {
    const raja21 = rows.find((r) => r.key === '2026-10-21|Raja')!;
    expect(raja21.values).toMatchObject({ arrived: '07:52', note: 'Fuel stop first' });
    expect(raja21.source.arrived).toBe('office');
    const dwayne21 = rows.find((r) => r.key === '2026-10-21|Dwayne')!;
    expect(dwayne21.source).toMatchObject({ left: 'app', arrived: 'guess', leftSite: 'guess', back: 'app' });
    expect(dayCalc(dwayne21.values, 0.6)).toMatchObject({ hours: 9.57, travel: 0.25, miles: 4.4, mileage: 2.64 });
  });

  it('drops an edit set back to the app’s figure, and keeps an emptied app figure as empty', () => {
    const dwayne21 = rows.find((r) => r.key === '2026-10-21|Dwayne')!;
    expect(nextEdits(dwayne21, 'back', '17:40')).toEqual({ back: '17:40' });
    expect(nextEdits({ ...dwayne21, edits: { back: '17:40' } }, 'back', '17:27')).toEqual({});
    expect(nextEdits({ ...dwayne21, edits: { back: '17:40' } }, 'back', '')).toEqual({});
    expect(nextEdits(dwayne21, 'back', '')).toEqual({ back: null });
    expect(nextEdits(dwayne21, 'hours', 9)).toEqual({ hours: 9 });
    expect(nextEdits({ ...dwayne21, edits: { hours: 9 } }, 'hours', null)).toEqual({});
    const emptied = sheetRows({ app, saved: [{ id: 'x', day: '2026-10-21', tech: 'Dwayne', edits: { back: null }, added: false, hidden: false }], techs: [], days: [] })
      .find((r) => r.key === '2026-10-21|Dwayne')!;
    expect(emptied.values.back).toBeNull();
  });

  it('lets a typed figure win over the worked-out one, and lunch come off the hours', () => {
    const v = { ...rows.find((r) => r.key === '2026-10-21|Dwayne')!.values, lunch: 30 };
    expect(dayCalc(v, 0.6).hours).toBe(9.07);
    expect(dayCalc({ ...v, hours: 8, miles: 10 }, 0.6)).toMatchObject({ hours: 8, miles: 10, mileage: 6, total: 8.25 });
  });

  it('keeps only known fields of the right type from the database', () => {
    expect(parseEdits({ arrived: '7:45', back: 'soon', hours: '9', miles: 12, note: 3, ask: true, junk: 1 })).toEqual({ arrived: '7:45', miles: 12, ask: true });
    expect(parseSettings({ mileRate: 0.6, mealRate: -1, nights: 5, rooms: '2' })).toEqual({ mileRate: 0.6, mealRate: null, hotelRate: null, nights: 5, rooms: null });
  });
});

describe('the totals', () => {
  const rows = sheetRows({ app, saved: [{ id: 'h', day: '2026-10-22', tech: 'Raja', edits: {}, added: false, hidden: true }], techs: [], days: [] });
  const receipts: SheetReceipt[] = [
    { id: '1', category: 'fuel', amount: 64, status: 'approved' },
    { id: '2', category: 'meals', amount: 80, status: 'approved' },
    { id: '3', category: 'hotel', amount: 900, status: 'approved' },
    { id: '4', category: 'fuel', amount: 76.75, status: 'declined' },
    { id: '5', category: 'meals', amount: 12, status: 'submitted' },
  ];

  it('bills miles, and meals and hotel from approved receipts up to the allowance; leaves out hidden lines and declined receipts', () => {
    const t = sheetTotals(rows, receipts, { mileRate: 0.6, mealRate: 50, hotelRate: 113, nights: 5, rooms: 2 });
    expect(t.techDays).toBe(4);
    expect(t.meals).toEqual({ allowed: 200, receipts: 80, claim: 80 });
    expect(t.hotel).toEqual({ allowed: 1130, receipts: 900, claim: 900 });
    expect(t.miles).toBe(480.6);
    expect(t.bill).toBe(Math.round((t.mileage + 80 + 900) * 100) / 100);
    expect(t.byCategory).toEqual({ fuel: 64, meals: 80, hotel: 900 });
    expect(t.declined).toBe(76.75);
    expect(t.waiting).toBe(1);
  });

  it('bills the receipts as they are when the client sets no allowance', () => {
    const t = sheetTotals(rows, receipts, { mileRate: null, mealRate: null, hotelRate: null, nights: null, rooms: null });
    expect(t.mileage).toBe(0);
    expect(t.bill).toBe(980);
  });

  it('writes the spreadsheet with a line per visible day and the totals', () => {
    const s = { mileRate: 0.6, mealRate: null, hotelRate: null, nights: null, rooms: null };
    const out = fieldSheetRows({ title: 'LDS Site 5006643', wo: '19101402', clientWo: 'LDS-1106', address: 'Goldsboro, NC' }, rows, sheetTotals(rows, receipts, s), s);
    expect(out[1][0]).toBe('WO 19101402 · Client # LDS-1106 · Goldsboro, NC');
    expect(out.filter((r) => /^2026-10-/.test(String(r[0])))).toHaveLength(4);
    expect(out.find((r) => r[0] === '2026-10-21' && r[1] === 'Dwayne')!.slice(2, 6)).toEqual(['7:38 AM', '7:44 AM', '5:18 PM', '5:27 PM']);
  });
});

describe('helpers', () => {
  it('lists the job days and writes clock times', () => {
    expect(jobDays('2026-10-18', '2026-10-23')).toHaveLength(6);
    expect(jobDays('2026-10-23', '2026-10-18')).toEqual(['2026-10-23']);
    expect(jobDays(null, '2026-10-23')).toEqual([]);
    expect([clock('00:05'), clock('12:00'), clock('19:59'), clock('bad')]).toEqual(['12:05 AM', '12:00 PM', '7:59 PM', '']);
  });
});
