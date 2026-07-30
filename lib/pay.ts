// Turning GPS-stamped time into pay (migration 049).
//
// Techs already log travel → arrival → check in → check out from the portal, but
// contractor_pay was always a hand-typed number, so the logged hours were never
// worth collecting. This module turns them into a SUGGESTION.
//
// Deliberately a suggestion and not an automatic write: the owner decides what
// gets paid. A forgotten checkout or a tech sitting in the parking lot would
// otherwise silently inflate a payout. Two site imports once landed with 176h
// and 391h stamped on them, which is exactly this failure mode.
import type { ContractorTimeLog, Contractor, WorkOrder } from './types';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Hard ceiling on a single job's logged hours — see the 176h/391h incident. */
export const MAX_CREDIBLE_HOURS = 16;

export type PaySuggestion = {
  contractorName: string;
  hours: number | null;
  /** True when hours came from a manual correction rather than the clock. */
  adjusted: boolean;
  rate: number | null;
  amount: number | null;
  /** Why there's no amount, in words the owner can act on. */
  blockedReason: string | null;
  /** Clock hours before capping, when the cap actually bit. */
  rawHours: number | null;
};

/**
 * Hours on one time log. Prefers an explicit correction, then the clock.
 * Returns null when the tech hasn't checked out yet — an open shift has no
 * number, and guessing one would be worse than showing nothing.
 */
export function loggedHours(log: ContractorTimeLog): number | null {
  if (log.adjusted_hours != null) return round2(Number(log.adjusted_hours));
  if (!log.checked_in_at || !log.checked_out_at) return null;

  const ms = Date.parse(log.checked_out_at) - Date.parse(log.checked_in_at);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return round2(ms / 3_600_000);
}

/** The rate that applies: per-job override, then the tech's default. */
export function rateFor(
  log: Pick<ContractorTimeLog, 'hourly_rate'> | null,
  contractor: Pick<Contractor, 'default_hourly_rate'> | null | undefined,
): number | null {
  if (log?.hourly_rate != null) return Number(log.hourly_rate);
  if (contractor?.default_hourly_rate != null) return Number(contractor.default_hourly_rate);
  return null;
}

/**
 * What to suggest paying one tech for one job. Every "can't say yet" case names
 * itself, so the UI can tell the owner what to fix instead of showing a blank.
 */
export function suggestPay(
  log: ContractorTimeLog,
  contractor: Pick<Contractor, 'default_hourly_rate'> | null | undefined,
): PaySuggestion {
  const rawHours = loggedHours(log);
  const rate = rateFor(log, contractor);
  const adjusted = log.adjusted_hours != null;

  if (rawHours == null) {
    return {
      contractorName: log.contractor_name, hours: null, adjusted, rate,
      amount: null, rawHours: null,
      blockedReason: log.checked_in_at ? 'Still checked in — no checkout yet' : 'No time logged',
    };
  }

  // Cap rather than refuse: a capped number is still useful, and saying it was
  // capped is more honest than quietly paying 391 hours.
  const capped = Math.min(rawHours, MAX_CREDIBLE_HOURS);
  const wasCapped = capped < rawHours;

  if (rate == null) {
    return {
      contractorName: log.contractor_name, hours: capped, adjusted, rate: null,
      amount: null, rawHours,
      blockedReason: 'No hourly rate set for this tech',
    };
  }

  return {
    contractorName: log.contractor_name,
    hours: capped,
    adjusted,
    rate,
    amount: round2(capped * rate),
    rawHours,
    blockedReason: wasCapped
      ? `Clock says ${rawHours}h — capped at ${MAX_CREDIBLE_HOURS}h, check for a missed checkout`
      : null,
  };
}

/** Every tech's suggestion for one work order. */
export function suggestPayForWO(
  wo: Pick<WorkOrder, 'id'>,
  logs: ContractorTimeLog[],
  contractors: Pick<Contractor, 'name' | 'default_hourly_rate'>[],
): PaySuggestion[] {
  const byName = new Map(contractors.map((c) => [c.name, c]));
  return logs
    .filter((l) => l.wo_id === wo.id)
    .map((l) => suggestPay(l, byName.get(l.contractor_name)))
    .sort((a, b) => a.contractorName.localeCompare(b.contractorName));
}

/**
 * The suggestions shaped like work_orders.contractor_pay, so accepting them is
 * a straight write. Only techs with a real amount are included — a tech who
 * hasn't checked out must not land in the pay map as 0.
 */
export function suggestionsAsContractorPay(suggestions: PaySuggestion[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of suggestions) {
    if (s.amount != null) out[s.contractorName] = s.amount;
  }
  return out;
}

/**
 * Difference between what's currently recorded and what the hours suggest, so
 * the owner can see where the two disagree before accepting anything.
 */
export function payVariance(
  current: Record<string, number> | null | undefined,
  suggestions: PaySuggestion[],
): { contractorName: string; current: number | null; suggested: number | null; delta: number | null }[] {
  const cur = current ?? {};
  const names = new Set<string>([...Object.keys(cur), ...suggestions.map((s) => s.contractorName)]);
  return [...names].sort().map((name) => {
    const c = cur[name] != null ? round2(Number(cur[name])) : null;
    const s = suggestions.find((x) => x.contractorName === name)?.amount ?? null;
    return {
      contractorName: name,
      current: c,
      suggested: s,
      delta: c != null && s != null ? round2(s - c) : null,
    };
  });
}
