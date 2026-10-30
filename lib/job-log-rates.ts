// Each tech's rates for the client's copy of the job log (Fred, 2026-10-30: "i need a copy i can entered how much
// per an hour the milage for each tech ... the client just asked for this then i need a copy with out it for the
// tech"). He picked "Rates and the dollars": each tech's hours × $ per hour and miles × $ per mile, and a total,
// on the client's PDF and Excel; the tech's copy has none of it. Kept in public.job_log_rates (migration 147),
// owner only. Only what's shown is charged: the dates picked, the hours and miles as the time sheet has them.
import { byTechGroups } from './job-log';
import { hoursTotal, milesTotal, type JobSheet } from './job-log-sheet';

/** A tech's $ per hour and $ per mile; null when not set. */
export type TechRate = { hour: number | null; mile: number | null };
/** Each tech's rates, by the name on the time sheet. */
export type JobRates = Record<string, TechRate>;

/** A tech's line on the client's copy: hours and miles, the rates, and the dollars (null where no rate's set). */
export type TechCharge = {
  tech: string;
  hours: number; hourRate: number | null; labor: number | null;
  miles: number; mileRate: number | null; mileage: number | null;
};

// To the cent the way Excel's ROUND does it, so the workbook and the PDF agree.
const r2 = (n: number) => Math.round(n * 100 + 1e-9) / 100;
const rate = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

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

/** Each tech with hours or miles on the sheet, the lead first: their hours and miles, × their rates. */
export function chargesByTech(sheet: JobSheet, rates: JobRates, crew: string[]): TechCharge[] {
  const techs = byTechGroups([...sheet.time.map((r) => r.tech), ...sheet.miles.map((r) => r.tech)], (t) => t, crew).map((g) => g.tech);
  return techs.map((tech) => {
    const hours = hoursTotal(sheet.time.filter((r) => r.tech === tech));
    const miles = milesTotal(sheet.miles.filter((r) => r.tech === tech));
    const { hour, mile } = rates[tech] ?? { hour: null, mile: null };
    return {
      tech,
      hours, hourRate: hour, labor: hour == null ? null : r2(hours * hour),
      miles, mileRate: mile, mileage: mile == null ? null : r2(miles * mile),
    };
  });
}

/** The client's total: every tech's hours and miles dollars. */
export const chargesTotal = (charges: TechCharge[]) =>
  r2(charges.reduce((t, c) => t + (c.labor ?? 0) + (c.mileage ?? 0), 0));

/** The techs with hours or miles but no rate for them, to say so before the copy goes to the client. */
export const missingRates = (charges: TechCharge[]) =>
  charges.filter((c) => (c.hours > 0 && c.hourRate == null) || (c.miles > 0 && c.mileRate == null)).map((c) => c.tech);
