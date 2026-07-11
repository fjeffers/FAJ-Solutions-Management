import type { MileageLog, WorkOrder } from './types';

// UI default only — the rate is editable on every row, so a changed IRS
// standard rate never requires a code change.
export const DEFAULT_MILEAGE_RATE = 0.7;

export function mileageReimbursement(logs: MileageLog[] | null | undefined): number {
  return (logs ?? []).reduce((s, l) => s + (Number(l.miles) || 0) * (Number(l.rate) || 0), 0);
}

export function totalMiles(logs: MileageLog[] | null | undefined): number {
  return (logs ?? []).reduce((s, l) => s + (Number(l.miles) || 0), 0);
}

// One tech's mileage reimbursement on a job
export function mileageForTech(logs: MileageLog[] | null | undefined, name: string): number {
  return (logs ?? [])
    .filter((l) => l.contractor_name === name)
    .reduce((s, l) => s + (Number(l.miles) || 0) * (Number(l.rate) || 0), 0);
}

// Fleet-wide totals across work orders (e.g. for the Financials view)
export function mileageAcrossWOs(wos: Pick<WorkOrder, 'mileage_logs'>[]): { miles: number; amount: number } {
  return wos.reduce(
    (acc, w) => ({
      miles: acc.miles + totalMiles(w.mileage_logs),
      amount: acc.amount + mileageReimbursement(w.mileage_logs),
    }),
    { miles: 0, amount: 0 },
  );
}
