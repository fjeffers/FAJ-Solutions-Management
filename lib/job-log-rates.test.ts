// Each tech's rates on the client's copy of the job log (Fred, 2026-10-30: "i need a copy i can entered how much
// per an hour the milage for each tech"; "Rates and the dollars").
import { describe, it, expect } from 'vitest';
import { chargesByTech, chargesTotal, mileRateShown, mileRateTyped, notCharged, parseRate, parseRates, rateRows, ratesFromRows, ratesToSave, sameRates, withAllHoursRate } from './job-log-rates';
import type { JobSheet } from './job-log-sheet';

const sheet: JobSheet = {
  time: [
    { tech: 'Kendell Newbold', day: '2026-10-19', in: '07:50', out: '18:09', brk: 0 },
    { tech: 'Paul Gibbs', day: '2026-10-19', in: '07:37', out: '17:37', brk: 0 },
    { tech: 'Paul Gibbs', day: '2026-10-20', in: '08:00', out: '17:00', brk: 0.5 },
  ],
  miles: [
    { tech: 'Paul Gibbs', day: '2026-10-19', start: 41200, end: 41418, miles: 218 },
    { tech: 'Kendell Newbold', day: '2026-10-19', start: null, end: null, miles: 240 },
  ],
  meals: [{ tech: 'Paul Gibbs', day: '2026-10-19', store: 'Waffle House', amount: 18.5 }],
  materials: [],
  other: [{ tech: 'Paul Gibbs', day: '2026-10-18', store: 'Quality Inn', amount: 350.74, for: 'Lodging' }],
};
const crew = ['Paul Gibbs', 'Kendell Newbold'];

describe('the client copy charges', () => {
  it("multiplies each tech's hours and miles by their own rates, the lead first, and totals them", () => {
    const c = chargesByTech(sheet, { 'Paul Gibbs': { hour: 65, mile: 0.7 }, 'Kendell Newbold': { hour: 55, mile: 0.7 } }, crew);
    expect(c).toEqual([
      { tech: 'Paul Gibbs', hours: 18.5, hourRate: 65, labor: 1202.5, miles: 218, mileRate: 0.7, mileage: 152.6 },
      { tech: 'Kendell Newbold', hours: 10.32, hourRate: 55, labor: 567.6, miles: 240, mileRate: 0.7, mileage: 168 },
    ]);
    // Hours and miles only: the meals and the hotel aren't in it (Fred picked the rates and their dollars).
    expect(chargesTotal(c)).toBe(2090.7);
  });

  it("charges only the techs in the rates table and the rates set, and names a tech who isn't charged", () => {
    const rates = { 'Paul Gibbs': { hour: 65, mile: null } };
    const c = chargesByTech(sheet, rates, crew);
    expect(c).toEqual([{ tech: 'Paul Gibbs', hours: 18.5, hourRate: 65, labor: 1202.5, miles: 218, mileRate: null, mileage: null }]);
    expect(chargesTotal(c)).toBe(1202.5);
    expect(notCharged(sheet, rates, crew)).toEqual(['Kendell Newbold']);
    expect(notCharged(sheet, { 'Paul Gibbs': { hour: 65, mile: 0.7 }, 'Kendell Newbold': { hour: 55, mile: null } }, crew)).toEqual([]);
  });

  it('turns the table into rates and back: a row with no name or no rate is no rate', () => {
    const rows = [
      { tech: 'Kendell Newbold', hour: 55, mile: null }, { tech: '', hour: 40, mile: null },
      { tech: 'Raja', hour: null, mile: null }, { tech: 'Paul Gibbs', hour: 65, mile: 0.7 },
    ];
    const rates = ratesFromRows(rows);
    expect(rates).toEqual({ 'Kendell Newbold': { hour: 55, mile: null }, 'Paul Gibbs': { hour: 65, mile: 0.7 } });
    // The lead first, as the log has them.
    expect(rateRows(rates, crew).map((r) => r.tech)).toEqual(['Paul Gibbs', 'Kendell Newbold']);
    // Saved, the database may give the names back in another order: still the same rates.
    expect(sameRates(rates, { 'Paul Gibbs': { hour: 65, mile: 0.7 }, 'Kendell Newbold': { hour: 55, mile: null } })).toBe(true);
    expect(sameRates(rates, { 'Paul Gibbs': { hour: 65, mile: 0.7 } })).toBe(false);
  });

  it('rounds each line to the cent as Excel does', () => {
    const c = chargesByTech({ ...sheet, time: [{ tech: 'Paul Gibbs', day: '2026-10-19', in: '', out: '', brk: 0, hours: 1.01 }], miles: [] },
      { 'Paul Gibbs': { hour: 0.5, mile: null } }, crew);
    // 1.01 × 0.5 = 0.505 → 0.51, as ROUND(0.505, 2).
    expect(c[0].labor).toBe(0.51);
  });

  it('puts all the techs\' hours at one rate when they\'re together (Fred: "the rate is changing 100, 90, 60")', () => {
    // Kendell has no rate of his own: with the hours together he's charged too; Paul's $ per mile stays.
    const rates = withAllHoursRate(sheet, { 'Paul Gibbs': { hour: 65, mile: 0.7 } }, 100);
    expect(rates).toEqual({ 'Paul Gibbs': { hour: 100, mile: 0.7 }, 'Kendell Newbold': { hour: 100, mile: null } });
    const c = chargesByTech(sheet, rates, crew);
    // 18.5 + 10.32 hours × $100, and Paul's 218 miles × $0.70.
    expect(c.map((t) => [t.tech, t.hours, t.labor, t.mileage])).toEqual([['Paul Gibbs', 18.5, 1850, 152.6], ['Kendell Newbold', 10.32, 1032, null]]);
    expect(chargesTotal(c)).toBe(3034.6);
    expect(notCharged(sheet, rates, crew)).toEqual([]);
    // Separate: each tech's own, as they are.
    const own = { 'Paul Gibbs': { hour: 65, mile: 0.7 } };
    expect(withAllHoursRate(sheet, own, null)).toBe(own);
  });

  it('keeps only rates that are numbers, from the database', () => {
    expect(parseRates(null)).toEqual({});
    expect(parseRates([])).toEqual({});
    expect(parseRates({ ' Paul Gibbs ': { hour: 65, mile: '0.7' }, Kendell: { hour: -1 }, '': { hour: 5 }, Raja: 'x' }))
      .toEqual({ 'Paul Gibbs': { hour: 65, mile: null } });
    // The one rate for all hours: numeric comes back as a number or a string.
    expect([parseRate(90), parseRate('62.5'), parseRate(null), parseRate(''), parseRate(-1), parseRate('x')]).toEqual([90, 62.5, null, null, null, null]);
    expect(ratesToSave({ 'Paul Gibbs': { hour: 65, mile: 0.7 }, Kendell: { hour: null, mile: null } }))
      .toEqual({ 'Paul Gibbs': { hour: 65, mile: 0.7 } });
  });

  it('takes a mileage rate as Fred writes it, .50 or .652, or in cents, 50 or 65.2 (Fred: "Cent per mile", ".652 per mile")', () => {
    expect([0.5, 0.652, 50, 65.2, 72.5, 57, 0.1234567, 0].map(mileRateTyped)).toEqual([0.5, 0.652, 0.5, 0.652, 0.725, 0.57, 0.1234567, 0]);
    // Shown as typed, in full, so opening it again and saving never changes it (CodeRabbit on PR #48).
    expect([0.5, 0.652, 0.6, 0.1234567, 0, 1.25].map(mileRateShown)).toEqual(['.50', '.652', '.60', '.1234567', '0', '1.25']);
  });
});
