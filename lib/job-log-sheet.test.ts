// The job log as a sheet the office can edit (Fred, 2026-10-30: "I need to edit all of it hours time milages
// materials etc all of it"), with the Gaffney job's own numbers (WO 19101401).
import { describe, it, expect } from 'vitest';
import {
  clockOf, hoursScreenDays, hoursTotal, isHotel, milesFromOdometer, milesTotal, minutesOf, moneyTotal, parseSheet, rowHours,
  sheetByTech, sheetFromApp, sheetInDates, sheetProblems, sheetToSave, type JobSheet, type TimeRow,
} from './job-log-sheet';
import type { Visit } from './job-log';
import { sheetRows } from './field-sheet';

const TZ = 'America/New_York';
const t = (tech: string, day: string, i: string, out: string, brk = 0): TimeRow => ({ tech, day, in: i, out, brk });

describe('a row of hours', () => {
  it('is clock out less clock in, less the break, to 0.01 h', () => {
    expect(rowHours(t('Paul Gibbs', '2026-10-19', '07:37', '17:37'))).toBe(10);
    expect(rowHours(t('Kendell Newbold', '2026-10-20', '07:50', '18:09'))).toBe(10.32);
    expect(rowHours(t('Paul Gibbs', '2026-10-19', '08:00', '17:00', 0.5))).toBe(8.5);
  });
  it('goes past midnight, as the workbook does', () => {
    expect(rowHours(t('Paul Gibbs', '2026-10-22', '22:00', '02:30'))).toBe(4.5);
  });
  it('has none without both times; a live stretch still on site counts its time so far, less its break', () => {
    expect(rowHours(t('Paul Gibbs', '2026-10-19', '07:37', ''))).toBeNull();
    expect(rowHours({ ...t('Paul Gibbs', '2026-10-19', '07:37', ''), open: true, ms: 2.5 * 3_600_000 })).toBe(2.5);
    expect(rowHours({ ...t('Paul Gibbs', '2026-10-19', '07:37', '', 0.5), open: true, ms: 4 * 3_600_000 })).toBe(3.5);
    // 1 h 18 s is 1.005 h: 1.01, as Excel's ROUND makes it (CodeRabbit on PR #39).
    expect(rowHours({ ...t('Paul Gibbs', '2026-10-19', '07:37', ''), open: true, ms: 3_600_000 + 18_000 })).toBe(1.01);
  });
  it('reads "HH:MM" only', () => {
    expect(minutesOf('7:05')).toBe(425);
    expect(minutesOf('24:00')).toBeNull();
    expect(minutesOf('7am')).toBeNull();
  });
});

describe('the totals', () => {
  it('add each row as it shows', () => {
    expect(hoursTotal([t('a', '2026-10-19', '07:37', '17:37'), t('a', '2026-10-20', '07:50', '18:09'), t('a', '2026-10-21', '07:38', '')])).toBe(20.32);
    expect(milesTotal([{ tech: 'a', day: '2026-10-18', start: 141865, end: 142109, miles: 244 }, { tech: 'a', day: '2026-10-22', start: null, end: null, miles: 196.1 }])).toBe(440.1);
    expect(moneyTotal([{ tech: 'a', day: '2026-10-20', store: "Lowe's", amount: 47.48 }, { tech: 'a', day: '2026-10-21', store: "Lowe's", amount: 104.17 }])).toBe(151.65);
  });
  it('take the miles from the odometer when both ends are typed', () => {
    expect(milesFromOdometer({ tech: 'a', day: 'd', start: 142117, end: 142127, miles: 5 })).toBe(10);
    expect(milesFromOdometer({ tech: 'a', day: 'd', start: 142117, end: null, miles: 5 })).toBe(5);
    expect(milesFromOdometer({ tech: 'a', day: 'd', start: 142127, end: 142117, miles: 5 })).toBe(5);
  });
});

describe('the sheet from the app', () => {
  const visit = (tech: string, inAt: string, outAt: string | null, ms: number): Visit =>
    ({ tech, day: inAt.slice(0, 10), inAt, outAt, inGps: null, outGps: null, open: !outAt, ms });
  it('has the clock-ins in the job\'s time, the miles, and the approved receipts by what they were for', () => {
    const s = sheetFromApp({
      visits: [visit('Paul Gibbs', '2026-10-19T11:37:00Z', '2026-10-19T21:37:00Z', 36e6), visit('Kendell Newbold', '2026-10-22T11:44:00Z', null, 3_600_000)],
      mileage: [{ tech: 'Paul Gibbs', day: '2026-10-18', start: 141865, end: 142109, miles: 244 }],
      receipts: [
        { contractor_name: 'Paul Gibbs', category: 'materials', vendor: "Lowe's", amount: '47.48', expense_date: '2026-10-20', status: 'approved' },
        { contractor_name: 'Paul Gibbs', category: 'meals', vendor: 'Bojangles', amount: 12.25, expense_date: '2026-10-19', status: 'approved' },
        { contractor_name: 'Paul Gibbs', category: 'fuel', vendor: null, amount: 76.75, expense_date: '2026-10-21', note: 'Van', status: 'approved' },
        { contractor_name: 'Paul Gibbs', category: 'fuel', vendor: 'Circle K', amount: 76.75, expense_date: '2026-10-21', status: 'declined' },
        { contractor_name: null, category: 'hotel', vendor: 'Quality Inn', amount: 350.74, expense_date: '2026-10-18', status: 'approved' },
      ],
      timeZone: TZ,
    });
    expect(s.time).toEqual([
      { tech: 'Paul Gibbs', day: '2026-10-19', in: '07:37', out: '17:37', brk: 0 },
      { tech: 'Kendell Newbold', day: '2026-10-22', in: '07:44', out: '', brk: 0, open: true, ms: 3_600_000 },
    ]);
    expect(s.miles).toEqual([{ tech: 'Paul Gibbs', day: '2026-10-18', start: 141865, end: 142109, miles: 244 }]);
    expect(s.meals).toEqual([{ tech: 'Paul Gibbs', day: '2026-10-19', store: 'Bojangles', amount: 12.25 }]);
    expect(s.materials).toEqual([{ tech: 'Paul Gibbs', day: '2026-10-20', store: "Lowe's", amount: 47.48 }]);
    expect(s.other).toEqual([
      { tech: 'Paul Gibbs', day: '2026-10-21', store: '', amount: 76.75, for: 'Fuel · Van' },
      { tech: 'Office', day: '2026-10-18', store: 'Quality Inn', amount: 350.74, for: 'Lodging' },
    ]);
  });
  it('reads a time in the job\'s zone', () => {
    expect(clockOf('2026-10-19T21:37:00Z', TZ)).toBe('17:37');
    expect(clockOf('2026-10-20T04:05:00Z', TZ)).toBe('00:05');
  });
});

describe('the saved sheet', () => {
  const sheet: JobSheet = {
    time: [t('Paul Gibbs', '2026-10-20', '07:50', '18:09', 0.5), { ...t('Paul Gibbs', '2026-10-19', '07:37', ''), open: true, ms: 3 * 3_600_000 }],
    miles: [{ tech: 'Paul Gibbs', day: '2026-10-19', start: 142109, end: 142117, miles: 8 }],
    meals: [], materials: [{ tech: 'Paul Gibbs', day: '2026-10-20', store: "Lowe's", amount: 47.48 }],
    other: [{ tech: 'Paul Gibbs', day: '2026-10-18', store: 'Quality Inn', amount: 350.74, for: 'Lodging' }],
  };
  it('saves in day order, a stretch still on site with its hours so far and without what only the live log has', () => {
    const saved = sheetToSave(sheet);
    expect(saved.time).toEqual([{ ...t('Paul Gibbs', '2026-10-19', '07:37', ''), hours: 3 }, t('Paul Gibbs', '2026-10-20', '07:50', '18:09', 0.5)]);
    expect(parseSheet(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
  });
  it('is none when the job has not got one, and drops a row without a tech or a day', () => {
    expect(parseSheet(null)).toBeNull();
    expect(parseSheet([])).toBeNull();
    // Not a sheet the app saved: the log keeps the app's (CodeRabbit on PR #39).
    expect(parseSheet({})).toBeNull();
    expect(parseSheet({ time: [], miles: [] })).toBeNull();
    expect(parseSheet({ time: [], miles: [], meals: [], materials: [], other: [] })).toEqual({ time: [], miles: [], meals: [], materials: [], other: [] });
    const p = parseSheet({ time: [{ tech: '', day: '2026-10-19', in: '07:00', out: '15:00' }, { tech: 'Paul Gibbs', day: '10/19', in: '07:00' }, { tech: 'Paul Gibbs', day: '2026-10-19', in: '07:00', out: '15:00', brk: '0.5' }], miles: ['x'], meals: [], materials: [], other: [] });
    expect(p?.time).toEqual([t('Paul Gibbs', '2026-10-19', '07:00', '15:00', 0.5)]);
    expect(p?.miles).toEqual([]);
  });
  it('shows only the dates picked', () => {
    expect(sheetInDates(sheet, '2026-10-20', '').time.map((r) => r.day)).toEqual(['2026-10-20']);
    expect(sheetInDates(sheet, '', '2026-10-19').other).toEqual(sheet.other);
  });

  it('saves a name and a store trimmed, and names the rows that have no name or date', () => {
    const typed: JobSheet = {
      time: [{ tech: 'Paul Gibbs ', day: '2026-10-19', in: '08:00', out: '17:00', brk: 0 }, { tech: ' ', day: '2026-10-20', in: '', out: '', brk: 0 }],
      miles: [{ tech: 'Paul Gibbs', day: '', start: null, end: null, miles: 8 }],
      meals: [{ tech: ' Kendell Newbold', day: '2026-10-19', store: ' Bojangles ', amount: 12.25 }], materials: [], other: [],
    };
    expect(sheetProblems(typed)).toEqual(['Time on site row 2', 'Mileage row 1']);
    expect(sheetToSave(typed).time[0].tech).toBe('Paul Gibbs');
    expect(sheetToSave(typed).meals[0]).toEqual({ tech: 'Kendell Newbold', day: '2026-10-19', store: 'Bojangles', amount: 12.25 });
  });

  it('lists each tech\'s rows together to edit, the lead tech first, by day', () => {
    const mixed: JobSheet = { ...sheet, time: [
      { tech: 'Kendell Newbold', day: '2026-10-20', in: '07:50', out: '18:09', brk: 0 },
      { tech: 'Paul Gibbs', day: '2026-10-20', in: '07:50', out: '12:20', brk: 0 },
      { tech: 'Kendell Newbold', day: '2026-10-19', in: '07:37', out: '17:37', brk: 0 },
      { tech: 'Paul Gibbs', day: '2026-10-19', in: '07:37', out: '17:37', brk: 0 },
    ] };
    expect(sheetByTech(mixed, ['Paul Gibbs', 'Kendell Newbold']).time.map((r) => `${r.tech} ${r.day}`)).toEqual([
      'Paul Gibbs 2026-10-19', 'Paul Gibbs 2026-10-20', 'Kendell Newbold 2026-10-19', 'Kendell Newbold 2026-10-20',
    ]);
  });

  it('keeps the hours so far of a stretch still on site when saved (Greptile, CodeRabbit on PR #39)', () => {
    const live: TimeRow = { ...t('Paul Gibbs', '2026-10-30', '07:30', ''), open: true, ms: 2.5 * 3_600_000 };
    expect(sheetToSave({ ...sheet, time: [live] }).time[0]).toEqual({ tech: 'Paul Gibbs', day: '2026-10-30', in: '07:30', out: '', brk: 0, hours: 2.5 });
    // Saved, they come to just what they did live: 4 h 18.36 s less a 0.124 h break is 3.88 either way, not 3.89.
    const odd: TimeRow = { ...t('Paul Gibbs', '2026-10-30', '07:30', '', 0.124), open: true, ms: 4 * 3_600_000 + 18_360 };
    expect(rowHours(odd)).toBe(3.88);
    expect(rowHours(sheetToSave({ ...sheet, time: [odd] }).time[0])).toBe(3.88);
  });

  it('has a row\'s own hours (from the Hours screen) count less its break, and a break put back restores them', () => {
    expect(rowHours({ ...t('Paul Gibbs', '2026-10-20', '', ''), hours: 6 })).toBe(6);
    // A break typed too big, then cleared: the six hours are back (Greptile on PR #39).
    expect(rowHours({ ...t('Paul Gibbs', '2026-10-20', '', '', 7), hours: 6 })).toBe(0);
    expect(rowHours({ ...t('Paul Gibbs', '2026-10-20', '', '', 0), hours: 6 })).toBe(6);
    const saved = sheetToSave({ ...sheet, time: [{ ...t('Paul Gibbs', '2026-10-20', '', ''), hours: 6 }] });
    expect(saved.time[0]).toEqual({ tech: 'Paul Gibbs', day: '2026-10-20', in: '', out: '', brk: 0, hours: 6 });
    expect(parseSheet(saved)!.time[0].hours).toBe(6);
  });
});

describe('the Hours screen on the job log', () => {
  // Fred, 2026-10-30: "I want to make sure I can edit the time sheet and it shows on the job logs".
  const day = (id: string, d: string, tech: string, edits: Record<string, unknown>, more: { added?: boolean; hidden?: boolean } = {}) =>
    ({ id, day: d, tech, edits, added: more.added ?? false, hidden: more.hidden ?? false });
  const rows = sheetRows({
    app: [], techs: [], days: [],
    saved: [
      // Retimed: on site 8:00 to 4:30 with half an hour for lunch.
      day('s1', '2026-10-19', 'Paul Gibbs', { arrived: '08:00', leftSite: '16:30', lunch: 30 }),
      // Hours typed, no times.
      day('s2', '2026-10-20', 'Paul Gibbs', { hours: 6 }),
      // Hidden: not part of this job.
      day('s3', '2026-10-21', 'Kendell Newbold', {}, { hidden: true }),
      // Added for its miles only: no time on site.
      day('s4', '2026-10-18', 'Paul Gibbs', { miles: 244 }, { added: true }),
      // Only a time leaving the site (WO 19101402, Dwayne on 10/19): no time on site there, so his clock-ins stay.
      day('s5', '2026-10-19', 'Dwayne Cudjoe', { leftSite: '15:07' }, { added: true }),
      // Hours typed as 0, no times: no hours that day, whatever the clock-ins say (Greptile on PR #39).
      day('s6', '2026-10-22', 'Paul Gibbs', { hours: 0 }),
      // Only a lunch typed, no times: the break on that day's clock-ins (CodeRabbit on PR #39).
      day('s7', '2026-10-23', 'Kendell Newbold', { lunch: 30 }),
      // The same, and the day's first clock-in is shorter than the lunch.
      day('s8', '2026-10-24', 'Kendell Newbold', { lunch: 30 }),
      // Hours typed with a lunch: the row keeps them before the lunch, and the break takes it off.
      day('s9', '2026-10-24', 'Paul Gibbs', { hours: 6, lunch: 30 }),
    ],
  });

  it('takes the days the office set: times, lunch as the break, hours typed; a hidden day or 0 hours is off', () => {
    expect(hoursScreenDays(rows)).toEqual([
      { tech: 'Paul Gibbs', day: '2026-10-19', in: '08:00', out: '16:30', brk: 0.5 },
      { tech: 'Paul Gibbs', day: '2026-10-20', in: '', out: '', brk: 0, hours: 6 },
      { tech: 'Kendell Newbold', day: '2026-10-21', in: '', out: '', brk: 0, hidden: true },
      { tech: 'Paul Gibbs', day: '2026-10-22', in: '', out: '', brk: 0, hidden: true },
      { tech: 'Kendell Newbold', day: '2026-10-23', in: '', out: '', brk: 0.5, breakOnly: true },
      { tech: 'Kendell Newbold', day: '2026-10-24', in: '', out: '', brk: 0.5, breakOnly: true },
      { tech: 'Paul Gibbs', day: '2026-10-24', in: '', out: '', brk: 0.5, hours: 6.5 },
    ]);
  });

  it('puts them on the log in place of those days\' clock-ins, and keeps every other clock-in', () => {
    const visit = (tech: string, inAt: string, outAt: string): Visit =>
      ({ tech, day: inAt.slice(0, 10), inAt, outAt, inGps: null, outGps: null, open: false, ms: Date.parse(outAt) - Date.parse(inAt) });
    const s = sheetFromApp({
      visits: [
        visit('Paul Gibbs', '2026-10-19T11:37:00Z', '2026-10-19T21:37:00Z'),
        visit('Paul Gibbs', '2026-10-20T11:50:00Z', '2026-10-20T22:09:00Z'),
        visit('Kendell Newbold', '2026-10-21T11:38:00Z', '2026-10-21T21:50:00Z'),
        visit('Kendell Newbold', '2026-10-22T11:44:00Z', '2026-10-22T23:15:00Z'),
        visit('Dwayne Cudjoe', '2026-10-19T12:36:00Z', '2026-10-19T19:14:00Z'),
        visit('Paul Gibbs', '2026-10-22T11:36:00Z', '2026-10-22T21:00:00Z'),
        visit('Kendell Newbold', '2026-10-23T12:00:00Z', '2026-10-23T16:00:00Z'),
        visit('Kendell Newbold', '2026-10-23T17:00:00Z', '2026-10-23T21:00:00Z'),
        visit('Kendell Newbold', '2026-10-24T12:00:00Z', '2026-10-24T12:15:00Z'),
        visit('Kendell Newbold', '2026-10-24T13:00:00Z', '2026-10-24T17:00:00Z'),
      ],
      mileage: [], receipts: [], hoursScreen: hoursScreenDays(rows), timeZone: TZ,
    });
    expect(s.time.map((r) => [r.tech, r.day, r.in, r.out, rowHours(r)])).toEqual([
      ['Kendell Newbold', '2026-10-22', '07:44', '19:15', 11.52],
      ['Dwayne Cudjoe', '2026-10-19', '08:36', '15:14', 6.63],
      // The lunch once, on the day's first clock-in.
      ['Kendell Newbold', '2026-10-23', '08:00', '12:00', 3.5],
      ['Kendell Newbold', '2026-10-23', '13:00', '17:00', 4],
      // A 15-minute first clock-in takes what it can of the lunch; the rest comes off the next: 3.75 in all.
      ['Kendell Newbold', '2026-10-24', '08:00', '08:15', 0],
      ['Kendell Newbold', '2026-10-24', '09:00', '13:00', 3.75],
      ['Paul Gibbs', '2026-10-19', '08:00', '16:30', 8],
      ['Paul Gibbs', '2026-10-20', '', '', 6],
      ['Paul Gibbs', '2026-10-24', '', '', 6],
    ]);
  });
});

describe('a hotel among the other receipts', () => {
  it('is one whose For says Lodging, hotel or motel (Fred: "see it hotels also")', () => {
    const r = (f: string) => ({ tech: 'Paul Gibbs', day: '2026-10-18', store: 'Quality Inn', amount: 350.74, for: f });
    expect(isHotel(r('Lodging'))).toBe(true);
    expect(isHotel(r('Lodging · 2 nights'))).toBe(true);
    expect(isHotel(r('Hotel'))).toBe(true);
    expect(isHotel(r('motel for the crew'))).toBe(true);
    expect(isHotel(r('Fuel'))).toBe(false);
    expect(isHotel(r('Tolls & parking'))).toBe(false);
    // The tech's note doesn't make it a hotel: only the category does.
    expect(isHotel(r('Tolls & parking · parking at the hotel'))).toBe(false);
    expect(isHotel(r('Fuel · motel gas station'))).toBe(false);
    expect(isHotel({ tech: 'Paul Gibbs', day: '2026-10-18', store: 'Holiday Inn', amount: 10 })).toBe(false);
  });
});
