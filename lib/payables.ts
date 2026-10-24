// What each tech is owed (Pay Techs) and the money totals across the top of the
// Financials dashboard. The rules for what is owed live here once, so the
// dashboard's "Techs are owed" is the same figure Pay Techs shows.
import { contractorOwedOnWO } from './utils';
import type { Invoice, InvoicePayment, Payment, WorkOrder } from './types';

/** One tech's slice of a work order: their share of the pay, what they've been paid on it, and what's still owed. */
export type PayableSlice<W extends WorkOrder = WorkOrder> = W & { share: number; sharePaid: number; shareRemaining: number };

/**
 * Each tech's slices: what they're still owed job by job, and the jobs they were
 * paid MORE than their share on (kept apart, never netted off quietly: whether an
 * overpayment on one job was meant to cover another is Fred's call).
 *
 * A job with no contractor_pay has no agreed tech rate, and the legacy fallback
 * values the share at the FULL client price. Shown as a balance that reads as a
 * debt and invites payment against a guess — on 7 Aug 2026 it produced $9,125 of
 * recorded payments that never happened. Those wait in Pay Techs' needs-setup
 * banner until a real split is entered.
 */
export function payableSlices<W extends WorkOrder>(workOrders: W[], payments: Payment[]): {
  owed: Map<string, PayableSlice<W>[]>; over: Map<string, PayableSlice<W>[]>;
} {
  const owed = new Map<string, PayableSlice<W>[]>();
  const over = new Map<string, PayableSlice<W>[]>();
  for (const w of workOrders) {
    const names = (w.contractor_names && w.contractor_names.length > 0)
      ? w.contractor_names
      : (w.contractor_name ? [w.contractor_name] : []);
    const hasSplit = Boolean(w.contractor_pay && Object.keys(w.contractor_pay).length > 0);
    for (const name of names) {
      const share = contractorOwedOnWO(w, name);
      const sharePaid = payments
        .filter((p) => p.wo_number === w.wo_number && p.contractor_name === name)
        .reduce((s, p) => s + Number(p.amount), 0);
      if (!hasSplit && sharePaid <= share) continue;
      if (sharePaid - share > 0.009) {
        over.set(name, [...(over.get(name) ?? []), { ...w, share, sharePaid, shareRemaining: 0 }]);
        continue;
      }
      if (share <= 0) continue;
      const shareRemaining = Math.max(0, share - sharePaid);
      if (shareRemaining <= 0) continue;
      owed.set(name, [...(owed.get(name) ?? []), { ...w, share, sharePaid, shareRemaining }]);
    }
  }
  return { owed, over };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export type MoneyTotals = {
  /** Paid by clients this year (invoice payments). */
  receivedYtd: number;
  /** Still owed by clients on sent invoices. */
  clientsOwe: number;
  /** Paid to techs this year. */
  paidOutYtd: number;
  /** Still owed to techs (Pay Techs). */
  techsOwed: number;
};

/** The figures across the top of the Financials dashboard, for the year `year` (e.g. "2026"). */
export function moneyTotals(input: {
  invoices: Invoice[]; invoicePayments: InvoicePayment[]; payments: Payment[]; workOrders: WorkOrder[]; year: string;
}): MoneyTotals {
  const paidOn = new Map<string, number>();
  for (const p of input.invoicePayments) paidOn.set(p.invoice_id, (paidOn.get(p.invoice_id) ?? 0) + Number(p.amount));
  let clientsOwe = 0;
  for (const inv of input.invoices) {
    if (inv.status !== 'sent') continue;
    const bal = Number(inv.total) - (paidOn.get(inv.id) ?? 0);
    if (bal > 0) clientsOwe += bal;
  }
  const receivedYtd = input.invoicePayments.filter((p) => p.payment_date?.startsWith(input.year)).reduce((s, p) => s + Number(p.amount), 0);
  const paidOutYtd = input.payments.filter((p) => p.payment_date?.startsWith(input.year)).reduce((s, p) => s + Number(p.amount), 0);
  const { owed } = payableSlices(input.workOrders, input.payments);
  const techsOwed = [...owed.values()].flat().reduce((s, x) => s + x.shareRemaining, 0);
  return { receivedYtd: r2(receivedYtd), clientsOwe: r2(clientsOwe), paidOutYtd: r2(paidOutYtd), techsOwed: r2(techsOwed) };
}
