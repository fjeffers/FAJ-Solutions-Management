import { describe, it, expect } from 'vitest';
import { buildDayLogs, parseDayEvents, type DayEvent } from './project-day';
import { matchOdometer, type OdoRow } from './weekly-bill';
import {
  appDays, billRange, blocksBilling, byTech, byTechRows, clock, dayMiles, dayBill, fieldSheetInvoice, inDates, overlaps, dayCalc, fieldSheetRows, jobDays, nextEdits, parseEdits, parseSettings, rowsFor, sheetRows, sheetTotals,
  withAccountRate,
  type SavedDay, type SheetReceipt, type SheetSettings,
} from './field-sheet';

/** Billing settings: the defaults, with these changed. */
const bill = (o: Partial<SheetSettings>): SheetSettings => ({ ...parseSettings({}), ...o });

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

  it('adds the extra miles the office types on top of the day\'s own (Fred, 2026-10-27: "i cant add additional milage manually")', () => {
    const v = { ...rows.find((r) => r.key === '2026-10-21|Dwayne')!.values, odoStart: 227890, odoEnd: 227975 };
    expect(dayCalc(v, 0.6)).toMatchObject({ milesAuto: 85, miles: 85 });
    // The odometer's 85 stay as they are; a drive the app didn't log is added.
    expect(dayCalc({ ...v, extraMiles: 85 }, 0.6)).toMatchObject({ milesAuto: 85, miles: 170, mileage: 102 });
    // Miles typed by the office still win, and the extra goes on top of them.
    expect(dayCalc({ ...v, miles: 100, extraMiles: 40 }, 0.6)).toMatchObject({ miles: 140 });
    expect(parseEdits({ extraMiles: 85, junk: 1 })).toEqual({ extraMiles: 85 });
  });

  it('keeps only known fields of the right type from the database', () => {
    expect(parseEdits({ arrived: '7:45', back: 'soon', hours: '9', miles: 12, note: 3, ask: true, junk: 1 })).toEqual({ arrived: '7:45', miles: 12, ask: true });
    expect(parseSettings({ mileRate: 0.6, mealRate: -1, nights: 5, rooms: '2', labor: 'nonsense', items: [{ desc: 'Drop', qty: 3, price: 85 }, { qty: 'x' }] }))
      .toMatchObject({ mileRate: 0.6, mealRate: null, hotelRate: null, nights: 5, rooms: null, labor: 'hourly', items: [{ desc: 'Drop', qty: 3, price: 85 }], mealMode: 'receipts', receiptsAtCost: false });
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
    const t = sheetTotals(rows, receipts, bill({ mileRate: 0.6, mealRate: 50, hotelRate: 113, nights: 5, rooms: 2 }));
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
    const t = sheetTotals(rows, receipts, bill({}));
    expect(t.mileage).toBe(0);
    expect(t.bill).toBe(980);
  });

  it('writes the spreadsheet with a line per visible day and the totals', () => {
    const s = bill({ mileRate: 0.6 });
    const out = fieldSheetRows({ title: 'LDS Site 5006643', wo: '19101402', clientWo: 'LDS-1106', address: 'Goldsboro, NC' }, rows, sheetTotals(rows, receipts, s), s);
    expect(out[0][0]).toBe('FAJ Solutions Field Sheet');
    expect(out[2][0]).toBe('WO 19101402 · Client # LDS-1106 · Goldsboro, NC');
    const head = out.findIndex((r) => r[0] === 'Date'), end = out.findIndex((r) => r[0] === 'Week total');
    expect(end - head - 1).toBe(4);
    expect(out.at(-1)).toEqual(['', 'Total', '', '', sheetTotals(rows, receipts, s).bill]);
    expect(out.find((r) => r[0] === '2026-10-21' && r[1] === 'Dwayne')!.slice(2, 6)).toEqual(['7:38 AM', '7:44 AM', '5:18 PM', '5:27 PM']);
  });

  it('keeps the spreadsheet columns as Smartsheet imports them: extra miles are in Miles, and said in the notes', () => {
    const s = bill({ mileRate: 0.6 });
    const extra = rows.map((r) => (r.key === '2026-10-21|Dwayne' ? { ...r, values: { ...r.values, extraMiles: 40, note: 'Drive home' } } : r));
    const out = fieldSheetRows({ title: 'T', wo: '1', clientWo: null, address: '' }, extra, sheetTotals(extra, receipts, s), s);
    const head = out.find((r) => r[0] === 'Date')!;
    expect(head).toHaveLength(19);
    const line = out.find((r) => r[0] === '2026-10-21' && r[1] === 'Dwayne')!;
    expect(line[head.indexOf('Miles')]).toBe(44.4);
    expect(line[head.indexOf('Notes')]).toBe('Miles include 40 extra · Drive home');
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

describe('review fixes', () => {
  it('adds up a day with two visits from the visits and drives, not first arrival to last departure', () => {
    const two = buildDayLogs([
      ev('Ana', '20', 'travel_start', '07:30', { origin: 'hotel', dest: 'site' }), ev('Ana', '20', 'travel_end', '08:00', { miles: 10 }),
      ev('Ana', '20', 'in', '08:00'), ev('Ana', '20', 'out', '12:00'),
      ev('Ana', '20', 'travel_start', '12:00', { origin: 'site', dest: 'materials' }), ev('Ana', '20', 'travel_end', '12:30', { miles: 6 }),
      ev('Ana', '20', 'travel_start', '12:30', { origin: 'materials', dest: 'site' }), ev('Ana', '20', 'travel_end', '13:00', { miles: 6 }),
      ev('Ana', '20', 'in', '13:00'), ev('Ana', '20', 'out', '17:00'),
      ev('Ana', '20', 'travel_start', '17:00', { origin: 'site', dest: 'hotel' }), ev('Ana', '20', 'travel_end', '17:30', { miles: 10 }),
    ], new Date('2026-10-24T12:00:00Z'), TZ);
    const a = appDays(two, matchOdometer(two.flatMap((d) => d.legs), []), TZ)[0];
    expect(a).toMatchObject({ arrived: '08:00', leftSite: '17:00', hours: 8, travel: 2 });
    const [row] = sheetRows({ app: [a], saved: [], techs: [], days: [] });
    expect(dayCalc(row.values, 0.6)).toMatchObject({ hours: 8, travel: 2, miles: 32 });
    // Once the office retimes the day, the hours follow its times.
    const [retimed] = sheetRows({ app: [a], saved: [{ id: 's', day: a.day, tech: 'Ana', edits: { leftSite: '16:00' }, added: false, hidden: false }], techs: [], days: [] });
    expect(dayCalc(retimed.values, 0.6).hours).toBe(8);
    expect(retimed.source.hours).toBeUndefined();
    // A lunch the office enters comes off the visit totals; hours it types win.
    const saved = (edits: Record<string, unknown>) => sheetRows({ app: [a], saved: [{ id: 's', day: a.day, tech: 'Ana', edits, added: false, hidden: false }], techs: [], days: [] })[0];
    expect(dayCalc(saved({ lunch: 30 }).values, 0.6).hours).toBe(7.5);
    expect(dayCalc(saved({ lunch: 30, hours: 8.25 }).values, 0.6).hours).toBe(8.25);
  });

  it('counts the odometer only from the first drive’s start to the last drive’s end, else the GPS', () => {
    // Morning drive photographed both ends, the drive back not at all.
    const evs = [
      ev('Ana', '21', 'travel_start', '07:00', { origin: 'hotel', dest: 'site' }), ev('Ana', '21', 'travel_end', '07:30', { miles: 12 }),
      ev('Ana', '21', 'travel_start', '17:00', { origin: 'hotel', dest: 'hotel' }), ev('Ana', '21', 'travel_end', '17:30', { miles: 12 }),
    ];
    const l = buildDayLogs(evs, new Date('2026-10-24T12:00:00Z'), TZ);
    const shots = [odo('Ana', '21', '07:00', 1000, 'start'), odo('Ana', '21', '07:30', 1012, 'end')];
    const a = appDays(l, matchOdometer(l.flatMap((d) => d.legs), shots), TZ)[0];
    expect([a.odoStart, a.odoEnd, a.gps]).toEqual([1000, null, 24]);
    expect(dayCalc(sheetRows({ app: [a], saved: [], techs: [], days: [] })[0].values, 0.6).miles).toBe(24);
  });

  it('bills nothing for meals or hotel when the allowance is set to 0', () => {
    const rows = sheetRows({ app, saved: [], techs: [], days: [] });
    const t = sheetTotals(rows, [{ id: '1', category: 'meals', amount: 80, status: 'approved' }, { id: '2', category: 'hotel', amount: 300, status: 'approved' }],
      bill({ mileRate: 0, mealRate: 0, hotelRate: 113, nights: 0, rooms: 2 }));
    expect(t.meals.claim).toBe(0);
    expect(t.hotel.claim).toBe(0);
    expect(t.bill).toBe(0);
  });
});

describe('billing any client', () => {
  // Dwayne, Wed: 9.57 h on site, 0.25 h travel, 4.4 mi. Raja, Tue: 9.72 h on site, 0.52 h travel, 21 mi.
  const rows = sheetRows({ app, saved: [{ id: 'n', day: '2026-10-21', tech: 'Dwayne', edits: { note: 'Pulled AP runs' }, added: false, hidden: false }], techs: [], days: [] })
    .filter((r) => r.key === '2026-10-21|Dwayne' || r.key === '2026-10-20|Raja');
  const receipts: SheetReceipt[] = [
    { id: 'm', category: 'materials', amount: 47.48, status: 'approved', vendor: "Lowe's", date: '2026-10-20' },
    { id: 'f', category: 'fuel', amount: 64, status: 'approved', vendor: 'Sheetz', date: '2026-10-22' },
    { id: 'd', category: 'materials', amount: 99, status: 'declined', vendor: "Lowe's", date: '2026-10-21' },
  ];

  it('bills hourly by each tech’s day, travel at its own rate, with the day’s note', () => {
    const t = sheetTotals(rows, receipts, bill({ labor: 'hourly', rate: 85, travelRate: 45, mileRate: 0.7, byDay: true }));
    expect(t.lines.filter((l) => l.kind === 'labor').map((l) => [l.description, l.qty, l.amount])).toEqual([
      ['Tue, Oct 20 · Raja · on site 9.72 h', 9.72, 826.2],
      ['Wed, Oct 21 · Dwayne · on site 9.57 h — Pulled AP runs', 9.57, 813.45],
    ]);
    expect(t.lines.filter((l) => l.kind === 'travel').map((l) => l.amount)).toEqual([23.4, 11.25]);
    // Day by day: Tuesday's labor, travel and miles, then Wednesday's.
    expect(t.lines.map((l) => `${l.date} ${l.kind}`)).toEqual([
      '2026-10-20 labor', '2026-10-20 travel', '2026-10-20 mileage', '2026-10-21 labor', '2026-10-21 travel', '2026-10-21 mileage',
    ]);
    expect(t.labor).toBe(1674.3);
    expect(t.mileage).toBe(17.78);
    expect(t.bill).toBe(1692.08);
    expect(t.bill).toBe(Math.round(t.lines.reduce((s, l) => s + l.amount, 0) * 100) / 100);
  });

  it('bills a blended rate on every hour, on site and travel', () => {
    const t = sheetTotals(rows, [], bill({ labor: 'blended', rate: 75, byDay: true }));
    expect(t.lines.map((l) => [l.qty, l.amount])).toEqual([[10.24, 768], [9.82, 736.5]]);
  });

  // Fred, 2026-10-25: "i dont need the days i need the total hours then the total milage and the total meals 50 a day".
  it('bills the totals unless the sheet asks for each day: the hours, the mileage, then the meals', () => {
    const t = sheetTotals(rows, receipts, bill({ labor: 'hourly', rate: 100, travelRate: 45, mileRate: 0.6, mealMode: 'per_day', mealRate: 50 }));
    expect(t.lines).toEqual([
      { kind: 'labor', date: null, description: 'Hours on site: 19.29 h', qty: 19.29, rate: 100, amount: 1929 },
      { kind: 'travel', date: null, description: 'Travel: 0.77 h', qty: 0.77, rate: 45, amount: 34.65 },
      { kind: 'mileage', date: null, description: 'Mileage: 25.4 mi', qty: 25.4, rate: 0.6, amount: 15.24 },
      { kind: 'meals', date: null, description: 'Meals: 2 tech-days × $50', qty: 2, rate: 50, amount: 100 },
    ]);
    expect(t.bill).toBe(2078.89);
    expect(sheetTotals(rows, [], bill({ labor: 'blended', rate: 75 })).lines.map((l) => [l.description, l.amount])).toEqual([['Hours on site and travel: 20.06 h', 1504.5]]);
  });

  it('bills a fixed price or by the item, once for the week', () => {
    expect(sheetTotals(rows, [], bill({ labor: 'fixed', fixed: 2400, site: 'Wendy’s #1331, Hillside NJ' })).lines)
      .toEqual([{ kind: 'fixed', date: null, description: 'Fixed price — Wendy’s #1331, Hillside NJ', qty: 1, rate: 2400, amount: 2400 }]);
    const t = sheetTotals(rows, [], bill({ labor: 'items', items: [{ desc: 'Cat6A drop', qty: 12, price: 85 }, { desc: 'AP mount', qty: 4, price: 40 }] }));
    expect(t.labor).toBe(1180);
  });

  it('bills meals per tech-day and hotel per night when the client pays flat rates', () => {
    const t = sheetTotals(rows, [], bill({ mealMode: 'per_day', mealRate: 50, hotelMode: 'per_night', hotelRate: 113, nights: 5, rooms: 2 }));
    expect(t.lines.map((l) => [l.kind, l.qty, l.amount])).toEqual([['meals', 2, 100], ['hotel', 10, 1130]]);
  });

  it('bills other receipts at cost when asked, never fuel and never declined ones', () => {
    const t = sheetTotals(rows, receipts, bill({ receiptsAtCost: true }));
    expect(t.lines.map((l) => l.description)).toEqual(["Materials — Lowe's (Tue, Oct 20)"]);
    expect(t.atCost).toBe(47.48);
    expect(sheetTotals(rows, receipts, bill({})).atCost).toBe(0);
    // Fred's Rental and the office's own categories are billed at cost too; mileage receipts are in the mileage.
    const more: SheetReceipt[] = [
      { id: 'r', category: 'rental', amount: 150, status: 'approved', vendor: 'Sunbelt', date: '2026-10-21' },
      { id: 'c', category: 'c_lift_rental', amount: 90, status: 'approved', date: '2026-10-21' },
      { id: 'm', category: 'mileage', amount: 30, status: 'approved', date: '2026-10-21' },
    ];
    expect(sheetTotals(rows, more, bill({ receiptsAtCost: true })).lines.map((l) => [l.description, l.amount]))
      .toEqual([['Rental — Sunbelt (Wed, Oct 21)', 150], ['Lift rental (Wed, Oct 21)', 90]]);
  });

  it('gives each day what it bills', () => {
    const dwayne = rows.find((r) => r.tech === 'Dwayne')!;
    const s = bill({ labor: 'hourly', rate: 85, mileRate: 0.7, mealMode: 'per_day', mealRate: 50 });
    expect(dayBill(dayCalc(dwayne.values, 0.7), s)).toBe(r2(813.45 + 3.08 + 50));
  });
});

const r2 = (n: number) => Math.round(n * 100) / 100;

describe('what was spent each day', () => {
  const rows = sheetRows({
    app, techs: [], days: [],
    saved: [
      { id: 'a', day: '2026-10-21', tech: 'Dwayne', edits: { meals: 38.5, spend: 12, note: 'Zip ties' }, added: false, hidden: false },
      { id: 'b', day: '2026-10-20', tech: 'Raja', edits: { meals: 61 }, added: false, hidden: false },
    ],
  }).filter((r) => r.key === '2026-10-21|Dwayne' || r.key === '2026-10-20|Raja');

  it('adds the meals typed on each day to the meal receipts, capped by the daily allowance for the week', () => {
    const t = sheetTotals(rows, [{ id: 'm', category: 'meals', amount: 20, status: 'approved' }], bill({ mealRate: 50 }));
    expect(t.meals).toEqual({ allowed: 100, receipts: 119.5, claim: 100 });
  });

  it('bills the day’s other spending as it is, with the day’s note', () => {
    const t = sheetTotals(rows, [], bill({}));
    expect(t.lines.map((l) => [l.description, l.amount])).toEqual([['Wed, Oct 21 · Dwayne · spending — Zip ties', 12], ['Meals (receipts)', 99.5]]);
    const dwayne = rows.find((r) => r.tech === 'Dwayne')!;
    expect(dayBill(dayCalc(dwayne.values, 0), bill({}), dwayne.values)).toBe(50.5);
  });
});

describe('the QuickBooks invoice', () => {
  it('dates each line, prints the site and dates for the client, and keeps Amount = Qty × Rate', () => {
    const rows = sheetRows({ app, saved: [], techs: [], days: [] }).filter((r) => r.key === '2026-10-21|Dwayne');
    const t = sheetTotals(rows, [], bill({ labor: 'hourly', rate: 85, mileRate: 0.6, byDay: true }));
    const itemIds = { Cabling: 'i-cab', Traveling: 'i-trav', Meals: 'i-meal', Lodging: 'i-lodge', 'Field Services': 'i1' };
    const inv = fieldSheetInvoice(t.lines, { customerId: 'c1', itemIds, memo: 'LDS Site 5006643 · Oct 19 – Oct 23', note: 'WO 19101402', email: 'ap@netview.com', txnDate: '2026-10-24' });
    expect(inv.CustomerRef).toEqual({ value: 'c1' });
    expect(inv.BillEmail).toEqual({ Address: 'ap@netview.com' });
    expect(inv.CustomerMemo).toEqual({ value: 'LDS Site 5006643 · Oct 19 – Oct 23' });
    expect(inv.Line.map((l) => [l.SalesItemLineDetail.ServiceDate, l.SalesItemLineDetail.Qty, l.SalesItemLineDetail.UnitPrice, l.Amount]))
      .toEqual([['2026-10-21', 9.57, 85, 813.45], ['2026-10-21', 4.4, 0.6, 2.64]]);
    for (const l of inv.Line) expect(l.Amount).toBe(Math.round(l.SalesItemLineDetail.Qty * l.SalesItemLineDetail.UnitPrice * 100) / 100);
    // The totals go with no date, still Amount = Qty × Rate.
    const totals = fieldSheetInvoice(sheetTotals(rows, [{ id: 'h', category: 'hotel', amount: 701.48, status: 'approved' }], bill({ labor: 'hourly', rate: 85, mileRate: 0.6, mealMode: 'per_day', mealRate: 50 })).lines,
      { customerId: 'c1', itemIds, memo: '', note: '', email: null, txnDate: '2026-10-24' });
    expect(totals.Line.map((l) => [l.SalesItemLineDetail.ServiceDate, l.SalesItemLineDetail.ItemRef.value, l.SalesItemLineDetail.Qty, l.SalesItemLineDetail.UnitPrice, l.Amount]))
      .toEqual([[undefined, 'i-cab', 9.57, 85, 813.45], [undefined, 'i-trav', 4.4, 0.6, 2.64], [undefined, 'i-meal', 1, 50, 50], [undefined, 'i-lodge', 1, 701.48, 701.48]]);
  });

  it('knows when two weeks share a day, and which days are in the dates picked', () => {
    expect(overlaps({ from: '2026-10-18', to: '2026-10-24' }, { from: '2026-10-24', to: '2026-10-30' })).toBe(true);
    expect(overlaps({ from: '2026-10-18', to: '2026-10-24' }, { from: '2026-10-25', to: '2026-10-31' })).toBe(false);
    expect([inDates('2026-10-19', '2026-10-19', '2026-10-23'), inDates('2026-10-18', '2026-10-19', ''), inDates('2026-10-30', '', '')]).toEqual([true, false, true]);
  });

  it('records the dates billed from the days and the approved receipts, so a hotel the night before is inside them', () => {
    const rows = sheetRows({ app, saved: [], techs: [], days: [] }).filter((r) => r.key === '2026-10-21|Dwayne');
    const hotel: SheetReceipt = { id: 'h', category: 'hotel', amount: 120, status: 'approved', date: '2026-10-20' };
    const declined: SheetReceipt = { id: 'd', category: 'meals', amount: 20, status: 'declined', date: '2026-10-25' };
    expect(billRange(rows, [hotel, declined])).toEqual({ from: '2026-10-20', to: '2026-10-21' });
    expect(billRange(rows, [hotel], '2026-10-19', '2026-10-23')).toEqual({ from: '2026-10-19', to: '2026-10-23' });
    expect(billRange([], [])).toBeNull();
  });

  it('bills miles at the account rate when the sheet has none, the same as the screen shows', () => {
    expect(withAccountRate(bill({ mileRate: null }), 0.7).mileRate).toBe(0.7);
    expect(withAccountRate(bill({ mileRate: 0.6 }), 0.7).mileRate).toBe(0.6);
    expect(withAccountRate(bill({ mileRate: null }), null).mileRate).toBeNull();
  });

  it('lets dates be billed again once an invoice cut off over ten minutes ago, never one QuickBooks has', () => {
    const now = Date.parse('2026-10-24T12:00:00Z');
    expect(blocksBilling({ qbo_invoice_id: '42', created_at: '2026-10-01T12:00:00Z' }, now)).toBe(true);
    expect(blocksBilling({ qbo_invoice_id: null, created_at: '2026-10-24T11:55:00Z' }, now)).toBe(true);
    expect(blocksBilling({ qbo_invoice_id: null, created_at: '2026-10-24T11:45:00Z' }, now)).toBe(false);
  });
});

describe('miles added on a drive (Fred, 2026-10-27: "i add the milage 228010 then i add 40 it should be 228050")', () => {
  // WO 19101403, Mon Oct 19: four drives with odometer photos, but none at the end of the drive home.
  const fred = 'Frederick Jeffers';
  const day = [
    ev(fred, '19', 'day_start', '14:35'),
    ev(fred, '19', 'travel_start', '14:35', { origin: 'other', dest: 'site' }), ev(fred, '19', 'travel_end', '15:20'),
    ev(fred, '19', 'in', '15:20'), ev(fred, '19', 'out', '16:21'),
    ev(fred, '19', 'travel_start', '16:21', { origin: 'site', dest: 'home' }), ev(fred, '19', 'travel_end', '16:46'),
    ev(fred, '19', 'travel_start', '16:58', { origin: 'home', dest: 'site' }), ev(fred, '19', 'travel_end', '16:59'),
    ev(fred, '19', 'in', '16:59'), ev(fred, '19', 'out', '18:53'),
    ev(fred, '19', 'travel_start', '18:54', { origin: 'site', dest: 'home' }),
  ];
  const photos = [
    odo(fred, '19', '14:36', 227976, 'start'), odo(fred, '19', '15:20', 228004, 'end'),
    odo(fred, '19', '16:21', 228004, 'start'), odo(fred, '19', '16:46', 228010, 'end'),
    odo(fred, '19', '16:58', 228010, 'start'), odo(fred, '19', '16:59', 228010, 'end'),
    odo(fred, '19', '18:54', 228010, 'start'),
  ];
  const home = (extra: Partial<DayEvent>) => ev(fred, '19', 'travel_end', '21:06', extra);
  const theDay = (events: DayEvent[], saved: SavedDay[] = []) =>
    rowsFor({ events, readings: photos, saved, techs: [fred], start: '2026-10-19', end: '2026-10-19', timeZone: TZ })[0];

  it('40 mi added on the drive home that started at 228,010 ends it at 228,050: 74 mi for the day', () => {
    const r = theDay([...day, home({ miles: 40, milesTyped: true })]);
    expect(r.values).toMatchObject({ odoStart: 227976, odoEnd: 228050, driveMiles: 74, addedMiles: null });
    expect(dayCalc(r.values, 0).miles).toBe(74);
  });

  it('with no miles added, the day is the drives the photos read (34 mi), not nothing', () => {
    const r = theDay([...day, home({})]);
    expect(r.values).toMatchObject({ odoEnd: null, driveMiles: 34 });
    expect(dayCalc(r.values, 0).miles).toBe(34);
  });

  it('an end typed before the last drive (228,004) no longer holds the day at 28 mi', () => {
    const stale: SavedDay = { id: 's', day: '2026-10-19', tech: fred, edits: { odoEnd: 228004 }, added: false, hidden: false };
    expect(dayCalc(theDay([...day, home({ miles: 40, milesTyped: true })], [stale]).values, 0).miles).toBe(74);
    expect(dayCalc(theDay([...day, home({})], [stale]).values, 0).miles).toBe(34);
  });

  it('miles added on a drive that has both photos go on top of them', () => {
    const first = ev(fred, '19', 'travel_end', '15:20').at;
    const r = theDay([...day.map((e) => (e.kind === 'travel_end' && e.at === first ? { ...e, miles: 10, milesTyped: true } : e)), home({})]);
    expect(r.values).toMatchObject({ driveMiles: 34, addedMiles: 10 });
    expect(dayCalc(r.values, 0).miles).toBe(44);
    const out = fieldSheetRows({ title: 'T', wo: '19101403', clientWo: null, address: '' }, [r], sheetTotals([r], [], bill({})), bill({}));
    const head = out.find((x) => x[0] === 'Date')!;
    const line = out.find((x) => x[0] === '2026-10-19')!;
    expect(line[head.indexOf('Miles')]).toBe(44);
    expect(line[head.indexOf('Notes')]).toBe('Miles include 10 extra');
  });

  it("doesn't count a drive's GPS on top of its own odometer photos", () => {
    const first = ev(fred, '19', 'travel_end', '15:20').at;
    const r = theDay([...day.map((e) => (e.kind === 'travel_end' && e.at === first ? { ...e, miles: 31.5 } : e)), home({ miles: 12 })]);
    // 28 by the first drive's photos (not its 31.5 GPS), 6, 0, and the drive home's 12 GPS.
    expect(r.values).toMatchObject({ driveMiles: 46, addedMiles: null, odoEnd: null });
    expect(dayCalc(r.values, 0).miles).toBe(46);
  });

  it('the odometer from the first photo to the last wins when it is more than the drives (driving between taps)', () => {
    const v = { ...theDay([...day, home({})]).values, odoStart: 100, odoEnd: 200, driveMiles: 80 };
    expect(dayCalc(v, 0).miles).toBe(100);
    expect(dayCalc({ ...v, addedMiles: 5, extraMiles: 10 }, 0).miles).toBe(115);
  });

  it("readings that can't be right don't count drive by drive over the day's odometer (Greptile on PR #31)", () => {
    // A mistyped end (50,110 after half an hour) and a start that doesn't follow on from it.
    const r = rowsFor({
      events: [
        ev('Paul', '21', 'travel_start', '08:00', { origin: 'hotel', dest: 'site' }), ev('Paul', '21', 'travel_end', '08:30'),
        ev('Paul', '21', 'travel_start', '09:00', { origin: 'site', dest: 'hotel' }), ev('Paul', '21', 'travel_end', '09:30'),
      ],
      readings: [odo('Paul', '21', '08:00', 50000, 'start'), odo('Paul', '21', '08:30', 50110, 'end'), odo('Paul', '21', '09:00', 50010, 'start'), odo('Paul', '21', '09:30', 50020, 'end')],
      saved: [], techs: ['Paul'], start: '2026-10-21', end: '2026-10-21', timeZone: TZ,
    })[0];
    expect(r.values).toMatchObject({ odoStart: 50000, odoEnd: 50020, driveMiles: 0 });
    expect(dayCalc(r.values, 0).miles).toBe(20);
  });

  it('miles the office typed on a drive are marked, the GPS figure is not', () => {
    const [typed, gps, none] = parseDayEvents([
      { kind: 'travel_end', at: '2026-10-20T01:06:24Z', miles: '58.0', miles_from_gps: false },
      { kind: 'travel_end', at: '2026-10-20T02:06:24Z', miles: '12.0', miles_from_gps: true },
      { kind: 'travel_end', at: '2026-10-20T03:06:24Z', miles: null, miles_from_gps: false },
    ]);
    expect([typed.milesTyped, gps.milesTyped, none.milesTyped]).toEqual([true, undefined, undefined]);
  });
});

// Fred, 2026-10-29: "each tech get their own break down: tech one day clock in - out = total ... once finish
// with tech one hours then same for tech 2 ... odometers: tech one starting milage - end milage = total ...
// same with the hotels, materials and any things"; "make sure it all adds up correctly". Gaffney's week.
describe('by tech', () => {
  const day = (id: string, d: string, tech: string, edits: SavedDay['edits'], hidden = false): SavedDay => ({ id, day: d, tech, edits, added: true, hidden });
  const rows = sheetRows({ app: [], techs: [], days: [], saved: [
    day('a', '2026-10-18', 'Paul Gibbs', { odoStart: 141865, odoEnd: 142109 }),
    day('b', '2026-10-19', 'Paul Gibbs', { arrived: '07:37', leftSite: '17:37', miles: 8 }),
    day('c', '2026-10-19', 'Kendell Newbold', { arrived: '07:37', leftSite: '17:37' }),
    day('d', '2026-10-20', 'Kendell Newbold', { arrived: '07:50', leftSite: '18:09' }),
    day('e', '2026-10-21', 'Kendell Newbold', { arrived: '08:00', leftSite: '12:00' }, true),
    day('f', '2026-10-23', 'Kendell Newbold', { meals: 50 }),
  ] });
  const receipts: SheetReceipt[] = [
    { id: 'l1', category: 'materials', amount: 104.17, status: 'approved', vendor: "Lowe's", date: '2026-10-21', tech: 'Paul Gibbs' },
    { id: 'l2', category: 'materials', amount: 47.48, status: 'approved', vendor: "Lowe's", date: '2026-10-20', tech: 'Paul Gibbs' },
    { id: 'h', category: 'hotel', amount: 350.74, status: 'approved', vendor: 'Quality Inn', date: '2026-10-18', tech: 'Paul Gibbs' },
    { id: 'm', category: 'meals', amount: 18.5, status: 'approved', vendor: 'Waffle House', date: '2026-10-19', tech: 'Paul Gibbs' },
    { id: 'f', category: 'fuel', amount: 76.75, status: 'approved', date: '2026-10-21', tech: 'Paul Gibbs' },
    { id: 'x', category: 'materials', amount: 76.75, status: 'declined', date: '2026-10-21', tech: 'Paul Gibbs' },
    { id: 't', category: 'equipment', amount: 25, status: 'approved', vendor: 'Home Depot', date: '2026-10-19', tech: null },
  ];
  const s = bill({ labor: 'hourly', rate: 100, mileRate: 0.6, receiptsAtCost: true });
  const list = byTech(rows, receipts, s);
  const [kendell, paul, office] = list;

  it('gives each tech their own days, oldest first, the office’s own receipts last', () => {
    expect(list.map((t) => t.tech)).toEqual(['Kendell Newbold', 'Paul Gibbs', 'Office']);
    expect(kendell.lines.map((d) => [d.day, d.arrived, d.leftSite, d.hours, d.meals])).toEqual([
      ['2026-10-19', '07:37', '17:37', 10, 0], ['2026-10-20', '07:50', '18:09', 10.32, 0], ['2026-10-23', null, null, 0, 50],
    ]);
    expect(kendell).toMatchObject({ days: 2, hours: 20.32, labor: 2032, miles: 0, meals: 50 });
    expect(paul.lines.map((d) => [d.day, d.odoStart, d.odoEnd, d.miles])).toEqual([['2026-10-18', 141865, 142109, 244], ['2026-10-19', null, null, 8]]);
    expect(paul).toMatchObject({ days: 2, hours: 10, labor: 1000, miles: 252, mileage: 151.2, hotelTotal: 350.74, meals: 18.5, materialsTotal: 151.65 });
    expect(paul.materials.map((m) => m.id)).toEqual(['l2', 'l1']);
    expect(office).toMatchObject({ days: 0, labor: null, materials: [expect.objectContaining({ id: 't', amount: 25 })], materialsTotal: 25 });
  });

  it('adds up: each tech’s days to their total, every tech to the sheet and the bill', () => {
    const t = sheetTotals(rows, receipts, s);
    const of = (k: string) => t.lines.filter((l) => l.kind === k).reduce((x, l) => x + l.amount, 0);
    for (const b of list) {
      expect(b.lines.reduce((x, d) => x + d.hours, 0)).toBeCloseTo(b.hours, 6);
      expect(b.lines.reduce((x, d) => x + d.miles, 0)).toBeCloseTo(b.miles, 6);
    }
    expect(list.reduce((x, b) => x + b.hours, 0)).toBe(t.hours);
    expect(list.reduce((x, b) => x + b.miles, 0)).toBe(t.miles);
    expect(list.reduce((x, b) => x + (b.labor ?? 0), 0)).toBe(t.labor);
    expect(list.reduce((x, b) => x + b.mileage, 0)).toBe(of('mileage'));
    expect(list.reduce((x, b) => x + b.meals, 0)).toBe(t.meals.receipts);
    expect(list.reduce((x, b) => x + b.hotelTotal, 0)).toBe(t.hotel.receipts);
    expect(list.reduce((x, b) => x + b.materialsTotal, 0)).toBe(of('receipt'));
  });

  it('splits a day’s miles so the line adds up: the odometer’s end less start, plus the miles with no photos', () => {
    expect(dayMiles({ odoStart: 141865, odoEnd: 142109, miles: 244 })).toEqual({ odometer: 244, other: 0 });
    expect(dayMiles({ odoStart: 228889, odoEnd: 228978, miles: 112 })).toEqual({ odometer: 89, other: 23 });
    expect(dayMiles({ odoStart: null, odoEnd: null, miles: 8 })).toEqual({ odometer: null, other: 8 });
  });

  // Greptile on PR #33.
  const typed = (rowsIn: [string, number, number][]) => sheetRows({ app: [], techs: [], days: [],
    saved: rowsIn.map(([tech, hours, travel], i) => day(`t${i}`, '2026-10-19', tech, { hours, travel })) });
  it('charges each tech the way the bill does, each rate rounded on its own', () => {
    const one = typed([['Paul Gibbs', 0.33, 0.33]]);
    const r = bill({ labor: 'hourly', rate: 19.99, travelRate: 19.99, byDay: true });
    expect(sheetTotals(one, [], r).labor).toBe(13.2);
    expect(byTech(one, [], r)[0].labor).toBe(13.2);
  });

  it('puts the cent the bill’s rounding of the week leaves over on the tech with the most, so the parts add up', () => {
    const two = typed([['Kendell Newbold', 0.33, 0], ['Paul Gibbs', 0.33, 0]]);
    const r = bill({ labor: 'hourly', rate: 19.99 });
    expect(sheetTotals(two, [], r).labor).toBe(13.19);
    expect(byTech(two, [], r).map((b) => b.labor)).toEqual([6.59, 6.6]);
  });

  it('counts travel billed at its own rate when there is no on-site rate', () => {
    expect(byTech(typed([['Paul Gibbs', 2, 1]]), [], bill({ labor: 'hourly', travelRate: 45 }))[0].labor).toBe(45);
  });

  it('has no labor dollars when the job isn’t billed by the hour, and a flat meal a day when meals are billed that way', () => {
    expect(byTech(rows, [], bill({ labor: 'fixed', fixed: 2400 })).map((b) => b.labor)).toEqual([null, null]);
    const flat = byTech(rows, receipts, bill({ mealMode: 'per_day', mealRate: 50 }));
    expect(flat.map((b) => [b.tech, b.meals])).toEqual([['Kendell Newbold', 100], ['Paul Gibbs', 100], ['Office', 0]]);
    expect(flat.reduce((x, b) => x + b.meals, 0)).toBe(sheetTotals(rows, receipts, bill({ mealMode: 'per_day', mealRate: 50 })).meals.claim);
  });

  // Greptile on PR #33: what the bill charges when that isn't what was spent, and notes on days with no hours.
  it('says what the bill charges for meals and the hotel when that isn’t what was spent', () => {
    const one = sheetRows({ app: [], techs: [], days: [], saved: [day('a', '2026-10-19', 'Paul Gibbs', { arrived: '08:00', leftSite: '16:00', meals: 80 })] });
    const r = bill({ labor: 'hourly', rate: 100, mealRate: 50, hotelMode: 'per_night', hotelRate: 113, nights: 1, rooms: 1 });
    const t = sheetTotals(one, [], r);
    const out = byTechRows(byTech(one, [], r), r.mileRate, t.lines);
    expect(out).toContainEqual(['All techs', '', '', '', 80]);
    expect(out).toContainEqual(['On the bill: Meals (receipts, up to $50 a tech-day)', '', '', '', 50]);
    expect(out).toContainEqual(['On the bill: Hotel: 1 nights × 1 rooms × $113', '', '', '', 113]);
    // When the bill charges what was spent, there's nothing to explain.
    expect(byTechRows(list, s.mileRate, sheetTotals(rows, receipts, s).lines).some((x) => String(x[0]).startsWith('On the bill'))).toBe(false);
  });

  it('keeps the note on a day with no hours, so it still reaches the client', () => {
    const noted = sheetRows({ app: [], techs: [], days: [], saved: [
      day('a', '2026-10-18', 'Paul Gibbs', { odoStart: 141865, odoEnd: 142109, note: 'Drove down to Gaffney' }),
      day('b', '2026-10-24', 'Paul Gibbs', { note: 'Rained out' }),
    ] });
    const hours = byTechRows(byTech(noted, [], s), s.mileRate).filter((r) => r[0] === 'Paul Gibbs' && r.length === 9);
    expect(hours.map((r) => [r[1], r[8]])).toEqual([['Sun, 10/18', 'Drove down to Gaffney'], ['Sat, 10/24', 'Rained out']]);
  });

  it('says when the materials are not on the client’s bill', () => {
    const r = bill({ labor: 'hourly', rate: 100, mileRate: 0.6 });
    const notBilled = byTech(rows, receipts, r);
    expect(notBilled.every((b) => !b.materialsBilled)).toBe(true);
    expect(byTechRows(notBilled, r.mileRate)).toContainEqual(['Materials (not on the bill: the other receipts are not billed at cost on this job)']);
  });

  it('goes in the spreadsheet tech by tech under each heading, each tech’s days then their total', () => {
    const out = byTechRows(list, s.mileRate);
    const block = (title: string) => { const i = out.findIndex((r) => r.length === 1 && r[0] === title); const j = out.findIndex((r, k) => k > i && r.length === 0); return out.slice(i + 1, j < 0 ? undefined : j); };
    expect(out.filter((r) => r.length === 1).map((r) => r[0])).toEqual(['By tech', 'Hours', 'Mileage', 'Hotel', 'Meals', 'Materials']);
    expect(block('Hours')).toEqual([
      ['Technician', 'Day', 'Clock in', 'Clock out', 'Lunch (min)', 'Hours on site', 'Travel hours', 'Labor $', 'Note'],
      ['Kendell Newbold', 'Mon, 10/19', '7:37 AM', '5:37 PM', '', 10, 0, '', ''],
      ['Kendell Newbold', 'Tue, 10/20', '7:50 AM', '6:09 PM', '', 10.32, 0, '', ''],
      ['Kendell Newbold total', '2 days', '', '', '', 20.32, 0, 2032, ''],
      ['Paul Gibbs', 'Mon, 10/19', '7:37 AM', '5:37 PM', '', 10, 0, '', ''],
      ['Paul Gibbs total', '1 day', '', '', '', 10, 0, 1000, ''],
      ['All techs', '', '', '', '', 30.32, 0, 3032, ''],
    ]);
    expect(block('Mileage')).toEqual([
      ['Technician', 'Day', 'Odometer start', 'Odometer end', 'Odometer miles', 'Other miles', 'Miles', 'Mileage $ (0.6/mi)'],
      ['Paul Gibbs', 'Sun, 10/18', 141865, 142109, 244, '', 244, ''],
      ['Paul Gibbs', 'Mon, 10/19', '', '', '', 8, 8, ''],
      ['Paul Gibbs total', '', '', '', 244, 8, 252, 151.2],
      ['All techs', '', '', '', '', '', 252, 151.2],
    ]);
    expect(block('Hotel')).toEqual([
      ['Technician', 'Date', 'For', 'Store', 'Amount'], ['Paul Gibbs', 'Sun, 10/18', 'Lodging', 'Quality Inn', 350.74], ['Paul Gibbs total', '', '', '', 350.74], ['All techs', '', '', '', 350.74],
    ]);
    expect(block('Meals')).toEqual([
      ['Technician', 'Day', 'For', 'Store', 'Amount'],
      ['Kendell Newbold', 'Fri, 10/23', 'Meals', '', 50], ['Kendell Newbold total', '', '', '', 50],
      ['Paul Gibbs', 'Mon, 10/19', 'Meal receipt', 'Waffle House', 18.5], ['Paul Gibbs total', '', '', '', 18.5],
      ['All techs', '', '', '', 68.5],
    ]);
    expect(block('Materials')).toEqual([
      ['Technician', 'Date', 'For', 'Store', 'Amount'],
      ['Paul Gibbs', 'Tue, 10/20', 'Materials', "Lowe's", 47.48], ['Paul Gibbs', 'Wed, 10/21', 'Materials', "Lowe's", 104.17], ['Paul Gibbs total', '', '', '', 151.65],
      ['Office', 'Mon, 10/19', 'Tools & equipment', 'Home Depot', 25], ['Office total', '', '', '', 25],
      ['All techs', '', '', '', 176.65],
    ]);
  });
});
