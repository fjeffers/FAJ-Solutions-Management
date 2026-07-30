// Per-customer profit and loss — the payoff of the customer master (migration 046).
//
// Before customer_id existed this was impossible: 'Wendy's', "Wendy's " and
// 'Wendys' were three different strings across three tables, so revenue, visits
// and invoices could not be joined to one client.
//
// The money model is NOT re-derived here. Revenue and profit come from the
// tested helpers in lib/utils.ts (woProfit / woPayoutTotal) and visit billing
// from lib/visits.ts (visitAmount). Getting revenue confused with profit is the
// worst bug this app could have, so there is exactly one implementation of it.
import type {
  Customer, WorkOrder, Invoice, InvoicePayment, SiteVisit, Quote,
} from './types';
import { woPayoutTotal, woProfit } from './utils';
import { visitAmount } from './visits';

export type CustomerBook = {
  customer: Customer;

  // ── Work orders ──
  woCount: number;
  /** What the client agreed to pay FAJ across all their work orders. */
  woRevenue: number;
  /** What the techs get, including mileage. */
  techCost: number;
  /** Revenue minus tech cost. What FAJ actually keeps. */
  profit: number;
  /** profit / woRevenue, 0–1. Null when there's no revenue to divide by. */
  margin: number | null;

  // ── Field work ──
  visitCount: number;
  hours: number;
  miles: number;
  /** Billable value of visits that have not been invoiced yet. */
  unbilled: number;
  unbilledVisits: number;

  // ── Accounts receivable ──
  invoiceCount: number;
  invoiced: number;
  received: number;
  /** Invoiced minus received, on sent invoices only. */
  outstanding: number;
  /** Sitting in draft — built but never sent. */
  neverSent: number;

  // ── CRM ──
  openQuotes: number;
  openQuoteValue: number;
  /** Most recent dated activity of any kind, for a "last touched" column. */
  lastActivity: string | null;
};

type Inputs = {
  workOrders: WorkOrder[];
  invoices: Invoice[];
  invoicePayments: InvoicePayment[];
  visits: SiteVisit[];
  quotes?: Quote[];
};

const sum = (ns: number[]) => ns.reduce((s, n) => s + n, 0);
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Roll up one customer's whole book of business. */
export function customerBook(customer: Customer, input: Inputs): CustomerBook {
  const id = customer.id;
  const wos = input.workOrders.filter((w) => w.customer_id === id);
  const visits = input.visits.filter((v) => v.customer_id === id);
  const invoices = input.invoices.filter((i) => i.customer_id === id);
  const quotes = (input.quotes ?? []).filter((q) => q.customer_id === id);

  const woRevenue = sum(wos.map((w) => Number(w.total_amount ?? 0)));
  const techCost = sum(wos.map(woPayoutTotal));
  const profit = sum(wos.map(woProfit));

  const unbilledList = visits.filter((v) => v.invoice_status === 'not_invoiced');

  // Drafts are money never asked for; they don't belong in outstanding AR.
  const sent = invoices.filter((i) => i.status !== 'draft' && i.status !== 'void');
  const paidFor = (invoiceId: string) =>
    sum(
      input.invoicePayments
        .filter((p) => p.invoice_id === invoiceId)
        .map((p) => Number(p.amount ?? 0)),
    );
  const received = sum(sent.map((i) => paidFor(i.id)));
  const outstanding = sum(
    sent.map((i) => Math.max(0, Number(i.total ?? 0) - paidFor(i.id))),
  );
  const neverSent = sum(
    invoices.filter((i) => i.status === 'draft').map((i) => Number(i.total ?? 0)),
  );

  const openQuotes = quotes.filter(
    (q) => q.status !== 'accepted' && q.status !== 'rejected' && q.status !== 'expired',
  );

  const dates = [
    ...visits.map((v) => v.visit_date),
    ...invoices.map((i) => i.created_at?.slice(0, 10) ?? null),
    ...wos.map((w) => w.scheduled_date ?? w.created_at?.slice(0, 10) ?? null),
  ].filter((d): d is string => Boolean(d));

  return {
    customer,
    woCount: wos.length,
    woRevenue: round2(woRevenue),
    techCost: round2(techCost),
    profit: round2(profit),
    margin: woRevenue > 0 ? round2(profit / woRevenue) : null,
    visitCount: visits.length,
    hours: round2(sum(visits.map((v) => Number(v.hours ?? 0)))),
    miles: round2(sum(visits.map((v) => Number(v.miles ?? 0)))),
    unbilled: round2(sum(unbilledList.map(visitAmount))),
    unbilledVisits: unbilledList.length,
    invoiceCount: invoices.length,
    invoiced: round2(sum(invoices.map((i) => Number(i.total ?? 0)))),
    received: round2(received),
    outstanding: round2(outstanding),
    neverSent: round2(neverSent),
    openQuotes: openQuotes.length,
    openQuoteValue: round2(sum(openQuotes.map((q) => Number(q.total ?? 0)))),
    lastActivity: dates.length ? dates.sort().at(-1)! : null,
  };
}

/** Every customer's book, best clients first. */
export function customerBooks(customers: Customer[], input: Inputs): CustomerBook[] {
  return customers
    .map((c) => customerBook(c, input))
    .sort((a, b) => b.woRevenue + b.invoiced - (a.woRevenue + a.invoiced));
}

/**
 * Work orders, visits or invoices that carry a customer NAME but no customer_id.
 * These are the rows that silently fall out of every per-customer total, so the
 * UI surfaces the count and offers to link them.
 */
export function unlinkedCount(input: Inputs): number {
  const named = (s: string | null | undefined) => Boolean(s && s.trim());
  return (
    input.workOrders.filter(
      (w) => !w.customer_id && (named(w.customer_name) || named(w.buyer_company)),
    ).length +
    input.invoices.filter((i) => !i.customer_id && named(i.client_name)).length +
    input.visits.filter((v) => !v.customer_id && named(v.program)).length
  );
}

/** Normalized matching key — 'Wendy's ' and 'wendys' both become 'wendys'. */
export function aliasKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}
