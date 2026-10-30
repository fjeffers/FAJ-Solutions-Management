// Each tech's rates on the client's copy of the job log (Fred, 2026-10-30: "i need a copy i can entered how much
// per an hour the milage for each tech"; "Rates and the dollars").
import { describe, it, expect } from 'vitest';
import { chargesByTech, chargesTotal, missingRates, parseRates, ratesToSave } from './job-log-rates';
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

  it("leaves a rate that isn't set without dollars, out of the total, and names the tech", () => {
    const c = chargesByTech(sheet, { 'Paul Gibbs': { hour: 65, mile: null } }, crew);
    expect(c[0]).toMatchObject({ labor: 1202.5, mileRate: null, mileage: null });
    expect(c[1]).toMatchObject({ hourRate: null, labor: null, mileage: null });
    expect(chargesTotal(c)).toBe(1202.5);
    expect(missingRates(c)).toEqual(['Paul Gibbs', 'Kendell Newbold']);
    expect(missingRates(chargesByTech(sheet, { 'Paul Gibbs': { hour: 65, mile: 0.7 }, 'Kendell Newbold': { hour: 55, mile: 0.7 } }, crew))).toEqual([]);
  });

  it('rounds each line to the cent as Excel does', () => {
    const c = chargesByTech({ ...sheet, time: [{ tech: 'Paul Gibbs', day: '2026-10-19', in: '', out: '', brk: 0, hours: 1.01 }], miles: [] },
      { 'Paul Gibbs': { hour: 0.5, mile: null } }, crew);
    // 1.01 × 0.5 = 0.505 → 0.51, as ROUND(0.505, 2).
    expect(c[0].labor).toBe(0.51);
  });

  it('keeps only rates that are numbers, from the database', () => {
    expect(parseRates(null)).toEqual({});
    expect(parseRates([])).toEqual({});
    expect(parseRates({ ' Paul Gibbs ': { hour: 65, mile: '0.7' }, Kendell: { hour: -1 }, '': { hour: 5 }, Raja: 'x' }))
      .toEqual({ 'Paul Gibbs': { hour: 65, mile: null } });
    expect(ratesToSave({ 'Paul Gibbs': { hour: 65, mile: 0.7 }, Kendell: { hour: null, mile: null } }))
      .toEqual({ 'Paul Gibbs': { hour: 65, mile: 0.7 } });
  });
});
