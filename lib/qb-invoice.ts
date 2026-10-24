import { visitInvoiceLines } from './visits';
import type { SiteVisit } from './types';

// Site visits → a QuickBooks Online invoice.
//
// QuickBooks is the ledger. The app's job is to describe the work and hand it
// over; the invoice NUMBER, the balance and the payment all belong to
// QuickBooks and are never minted here. That is the whole point of this file:
// the app used to keep its own INV-2026-00N sequence, which reconciled with
// nothing and produced three drafts billing a client who had already paid.
//
// Money comes from visitInvoiceLines(), the same function the statement and
// the site sheet use, so an invoice can never quietly disagree with the rest
// of the app about what a visit is worth.

/** A QuickBooks SalesItemLine. Amount is authoritative; Qty × UnitPrice must agree. */
export type QbLine = {
  DetailType: 'SalesItemLineDetail';
  Amount: number;
  Description: string;
  SalesItemLineDetail: {
    ItemRef: { value: string };
    Qty: number;
    UnitPrice: number;
    /** The day the work was done (Field Sheet lines). */
    ServiceDate?: string;
  };
};

export type QbInvoicePayload = {
  CustomerRef: { value: string };
  Line: QbLine[];
  TxnDate?: string;
  DueDate?: string;
  PrivateNote?: string;
  /** Printed on the invoice the client sees (Field Sheet: the site and the dates). */
  CustomerMemo?: { value: string };
  BillEmail?: { Address: string };
};

export type BuildOptions = {
  /** QuickBooks Customer Id — resolved by name before we get here. */
  customerId: string;
  /** QuickBooks Item Id every line is booked against (a Service item). */
  itemId: string;
  txnDate?: string;
  dueDate?: string;
  memo?: string;
};

/** Round to whole cents. Floating point drift on a client invoice is not acceptable. */
function cents(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export type Rejection = { id: string; label: string; reason: string };

function labelOf(v: Partial<SiteVisit>): string {
  const site = [v.site_name, v.site_code ? `#${v.site_code}` : null].filter(Boolean).join(' ');
  return [v.visit_date, site].filter(Boolean).join(' — ') || 'Untitled visit';
}

/**
 * Sort visits into what can be billed and what cannot, in ONE pass.
 *
 * One pass on purpose: two separate filters can disagree, and a disagreement
 * here either bills a client twice or silently drops work off the invoice.
 */
function partition(visits: SiteVisit[] | null | undefined): { billable: SiteVisit[]; rejected: Rejection[] } {
  const billable: SiteVisit[] = [];
  const rejected: Rejection[] = [];
  const kept = new Set<string>();

  for (const v of visits ?? []) {
    const label = labelOf(v);

    if (v.invoice_status === 'invoiced') {
      rejected.push({ id: v.id, label, reason: 'already invoiced' });
      continue;
    }
    if (v.archived_at) {
      rejected.push({ id: v.id, label, reason: 'archived' });
      continue;
    }
    // Only a LATER copy is the duplicate. Rejecting by id would throw away the
    // good first occurrence along with it, and silently under-bill the job.
    if (kept.has(v.id)) {
      rejected.push({ id: v.id, label, reason: 'listed twice' });
      continue;
    }
    const total = visitInvoiceLines(v).reduce((sum, l) => sum + l.quantity * l.rate, 0);
    if (cents(total) <= 0) {
      rejected.push({ id: v.id, label, reason: 'nothing to bill — priced at $0' });
      continue;
    }

    kept.add(v.id);
    billable.push(v);
  }
  return { billable, rejected };
}

/**
 * Which visits must NOT go on an invoice, and why.
 *
 * The first rule is the one that matters. A visit already marked invoiced has
 * been billed once; putting it on a second invoice bills a client twice for
 * the same work, and finding that out afterwards costs a customer. It is
 * cheaper to refuse here than to apologise later, so this is a hard block
 * rather than a warning.
 */
export function rejectedVisits(visits: SiteVisit[] | null | undefined): Rejection[] {
  return partition(visits).rejected;
}

/** The visits that are safe to bill. */
export function billableVisits(visits: SiteVisit[] | null | undefined): SiteVisit[] {
  return partition(visits).billable;
}

/**
 * Build the payload QuickBooks will accept.
 *
 * Throws when there is nothing billable: sending an invoice with no lines
 * creates a $0 document in the ledger that someone then has to void.
 */
export function buildQbInvoice(
  visits: SiteVisit[] | null | undefined,
  opts: BuildOptions,
): QbInvoicePayload {
  const usable = billableVisits(visits);
  if (usable.length === 0) {
    throw new Error('Nothing to invoice — every visit was already billed, archived or priced at $0.');
  }

  const Line: QbLine[] = [];
  for (const v of usable) {
    for (const l of visitInvoiceLines(v)) {
      const qty = Number(l.quantity) || 0;
      const rate = cents(l.rate);
      const amount = cents(qty * rate);
      if (amount === 0) continue;   // a $0 row invites a question with no useful answer
      Line.push({
        DetailType: 'SalesItemLineDetail',
        Amount: amount,
        Description: l.description,
        SalesItemLineDetail: {
          ItemRef: { value: opts.itemId },
          Qty: qty,
          UnitPrice: rate,
        },
      });
    }
  }

  if (Line.length === 0) {
    throw new Error('Nothing to invoice — the selected visits came to $0.');
  }

  const payload: QbInvoicePayload = {
    CustomerRef: { value: opts.customerId },
    Line,
  };
  if (opts.txnDate) payload.TxnDate = opts.txnDate;
  if (opts.dueDate) payload.DueDate = opts.dueDate;
  if (opts.memo)    payload.PrivateNote = opts.memo;
  return payload;
}

/** What the payload comes to — for showing Fred the figure before it is sent. */
export function qbInvoiceTotal(payload: QbInvoicePayload | null | undefined): number {
  return cents((payload?.Line ?? []).reduce((s, l) => s + (Number(l.Amount) || 0), 0));
}

/** The visit ids an invoice covers, to write back once QuickBooks accepts it. */
export function coveredVisitIds(visits: SiteVisit[] | null | undefined): string[] {
  return billableVisits(visits).map((v) => v.id);
}
