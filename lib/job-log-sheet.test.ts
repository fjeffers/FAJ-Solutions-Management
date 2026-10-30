// The job log as a sheet the office can edit (Fred, 2026-10-30: "I need to edit all of it hours time milages
// materials etc all of it"), with the Gaffney job's own numbers (WO 19101401).
import { describe, it, expect } from 'vitest';
import {
  clockOf, hoursTotal, milesFromOdometer, milesTotal, minutesOf, moneyTotal, parseSheet, rowHours,
  sheetByTech, sheetFromApp, sheetInDates, sheetProblems, sheetToSave, type JobSheet, type TimeRow,
} from './job-log-sheet';
import type { Visit } from './job-log';

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
  it('has none without both times; a live stretch still on site counts its time so far', () => {
    expect(rowHours(t('Paul Gibbs', '2026-10-19', '07:37', ''))).toBeNull();
    expect(rowHours({ ...t('Paul Gibbs', '2026-10-19', '07:37', ''), open: true, ms: 2.5 * 3_600_000 })).toBe(2.5);
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
    time: [t('Paul Gibbs', '2026-10-20', '07:50', '18:09', 0.5), { ...t('Paul Gibbs', '2026-10-19', '07:37', ''), open: true, ms: 5 }],
    miles: [{ tech: 'Paul Gibbs', day: '2026-10-19', start: 142109, end: 142117, miles: 8 }],
    meals: [], materials: [{ tech: 'Paul Gibbs', day: '2026-10-20', store: "Lowe's", amount: 47.48 }],
    other: [{ tech: 'Paul Gibbs', day: '2026-10-18', store: 'Quality Inn', amount: 350.74, for: 'Lodging' }],
  };
  it('saves in day order, without what only the live log has', () => {
    const saved = sheetToSave(sheet);
    expect(saved.time).toEqual([t('Paul Gibbs', '2026-10-19', '07:37', ''), t('Paul Gibbs', '2026-10-20', '07:50', '18:09', 0.5)]);
    expect(parseSheet(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
  });
  it('is none when the job has not got one, and drops a row without a tech or a day', () => {
    expect(parseSheet(null)).toBeNull();
    expect(parseSheet([])).toBeNull();
    const p = parseSheet({ time: [{ tech: '', day: '2026-10-19', in: '07:00', out: '15:00' }, { tech: 'Paul Gibbs', day: '10/19', in: '07:00' }, { tech: 'Paul Gibbs', day: '2026-10-19', in: '07:00', out: '15:00', brk: '0.5' }], miles: 'x' });
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
});
