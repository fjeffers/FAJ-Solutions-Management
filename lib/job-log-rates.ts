// Each tech's rates for the client's copy of the job log (Fred, 2026-10-30: "i need a copy i can entered how much
// per an hour the milage for each tech ... the client just asked for this then i need a copy with out it for the
// tech"). He picked "Rates and the dollars": each tech's hours × $ per hour and miles × $ per mile, and a total,
// on the client's PDF and Excel; the tech's copy has none of it. Kept in public.job_log_rates (migration 147),
// owner only. Only what's shown is charged: the dates picked, the hours and miles as the time sheet has them.
// The rates are a table the office adds a tech to or takes one off ("on the job log give me a table to add or
// remove rates": "tech rates, milage rate, per hour rate and i set the rates for each one"): only a rate that's
// set is charged. Each row of the hours and of the miles gets its rate and its dollars ("in the hours should get
// the rate and the same for the milage gets the milages rate"); a tech's dollars are their rows' added up.
import { byTechGroups } from './job-log';
import { hoursTotal, milesTotal, rowHours, type JobSheet } from './job-log-sheet';

/** A tech's $ per hour and $ per mile; null when not set. */
export type TechRate = { hour: number | null; mile: number | null };
/** Each tech's rates, by the name on the time sheet. */
export type JobRates = Record<string, TechRate>;

/** A row of the rates table. */
export type RateRow = { tech: string; hour: number | null; mile: number | null };

/** A tech's line on the client's copy: hours and miles, the rates, and the dollars (null where no rate's set). */
export type TechCharge = {
  tech: string;
  hours: number; hourRate: number | null; labor: number | null;
  miles: number; mileRate: number | null; mileage: number | null;
};

// To the cent the way Excel's ROUND does it, so the workbook and the PDF agree.
const r2 = (n: number) => Math.round(n * 100 + 1e-9) / 100;
const rate = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

/** A row's dollars: its hours or miles × the rate, to the cent; none without a rate. */
export const lineAmount = (qty: number | null, rate: number | null | undefined) => (rate == null ? null : r2((qty ?? 0) * rate));

/** job_log_rates.rates from the database: only names with a rate that's a number. */
export function parseRates(raw: unknown): JobRates {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: JobRates = {};
  for (const [tech, v] of Object.entries(raw as Record<string, unknown>)) {
    const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
    const r = { hour: rate(o.hour), mile: rate(o.mile) };
    if (tech.trim() && (r.hour != null || r.mile != null)) out[tech.trim()] = r;
  }
  return out;
}

/** The rates to save: names trimmed, a tech with no rate left out. */
export const ratesToSave = (rates: JobRates): JobRates => parseRates(rates);

/** The same rates, whatever order their names are in (the database keeps its own). */
export const sameRates = (a: JobRates, b: JobRates) => {
  const key = (r: JobRates) => JSON.stringify(Object.entries(r).sort(([x], [y]) => x.localeCompare(y)));
  return key(a) === key(b);
};

/** The table's rows from the saved rates, the lead first. */
export const rateRows = (rates: JobRates, crew: string[]): RateRow[] =>
  byTechGroups(Object.keys(rates), (t) => t, crew).map(({ tech }) => ({ tech, ...rates[tech] }));

/** The rates in the table: a row with no name or no rate isn't one; a name twice, the last row's. */
export const ratesFromRows = (rows: RateRow[]): JobRates =>
  parseRates(Object.fromEntries(rows.map((r) => [r.tech, { hour: r.hour, mile: r.mile }])));

/** The techs on the sheet (hours or miles), the lead first. */
export const sheetTechs = (sheet: JobSheet, crew: string[]) =>
  byTechGroups([...sheet.time.map((r) => r.tech), ...sheet.miles.map((r) => r.tech)], (t) => t, crew).map((g) => g.tech);

/** Each tech in the rates table, the lead first: their hours and miles on the sheet, × their rates. */
export function chargesByTech(sheet: JobSheet, rates: JobRates, crew: string[]): TechCharge[] {
  return rateRows(rates, crew).map(({ tech }) => {
    const time = sheet.time.filter((r) => r.tech === tech), drives = sheet.miles.filter((r) => r.tech === tech);
    const { hour, mile } = rates[tech] ?? { hour: null, mile: null };
    const sum = (amounts: (number | null)[]) => r2(amounts.reduce<number>((t, a) => t + (a ?? 0), 0));
    return {
      tech,
      hours: hoursTotal(time), hourRate: hour, labor: hour == null ? null : sum(time.map((r) => lineAmount(rowHours(r), hour))),
      miles: milesTotal(drives), mileRate: mile, mileage: mile == null ? null : sum(drives.map((r) => lineAmount(r.miles, mile))),
    };
  });
}

/** The client's total: every tech's hours and miles dollars. */
export const chargesTotal = (charges: TechCharge[]) =>
  r2(charges.reduce((t, c) => t + (c.labor ?? 0) + (c.mileage ?? 0), 0));

/** The techs with hours or miles on the sheet and no rate in the table: not on the client's charges. */
export const notCharged = (sheet: JobSheet, rates: JobRates, crew: string[]) => sheetTechs(sheet, crew).filter((t) => !rates[t]);
