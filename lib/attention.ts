// What needs Fred today, computed — not guessed.
//
// This is the "monitor" half of an assistant, and it deliberately contains no
// AI at all. Every number here is money, and money math is arithmetic: it must
// be exact, instant and free. An LLM asked to add up unbilled work would be
// slower, cost a fraction of a cent per glance, and could be wrong — and being
// wrong about revenue is the one failure that actually costs Fred money.
//
// The assistant reads THIS. It explains and drafts; it never does the sums.
//
// Everything is derived from state the app has already loaded, so the panel
// costs one pass over arrays rather than a round trip.
import type {
  Contract, EnrichedWorkOrder, Invoice, InvoicePayment, Quote, SiteVisit, Survey,
} from './types';
import { surveyTotals, unpricedDevices, readyToQuote } from './surveys';
import { visitAmount, rateIsAmbiguous, hoursLookWrong, suspectSessions } from './visits';
import { todayISO } from './utils';

export type AttentionKind =
  | 'survey_unquoted' | 'survey_unpriced'
  | 'quote_stale' | 'quote_unbuilt'
  | 'contract_unsigned'
  | 'work_awaiting_review' | 'invoice_overdue'
  | 'tech_owed' | 'assignment_unanswered'
  | 'visit_unbilled' | 'visit_rate_unclear' | 'visit_hours_wrong'
  | 'assignment_declined' | 'support_waiting' | 'import_waiting' | 'messages_unread'
  | 'receipts_waiting';

export type AttentionItem = {
  kind: AttentionKind;
  /** money = cash is sitting still. action = someone is waiting on you. */
  severity: 'money' | 'action';
  title: string;
  detail: string;
  count: number;
  /** Dollars, when the item is about money. */
  amount?: number;
  /** Which tab answers it. */
  view: string;
};

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

/** Days between an ISO date and today. Negative means the date is in the past. */
export function daysUntil(iso: string | null, today = todayISO()): number | null {
  if (!iso) return null;
  const a = Date.parse(`${iso.slice(0, 10)}T12:00:00`);
  const b = Date.parse(`${today.slice(0, 10)}T12:00:00`);
  if (isNaN(a) || isNaN(b)) return null;
  return Math.round((a - b) / 86_400_000);
}

export type AttentionInput = {
  surveys: Survey[];
  quotes: Quote[];
  contracts: Contract[];
  workOrders: EnrichedWorkOrder[];
  invoices: Invoice[];
  invoicePayments: InvoicePayment[];
  /** Site log visits. Optional so an older caller keeps working. */
  siteVisits?: SiteVisit[];
  /** Counts the office already keeps: support tickets, imports waiting, unread tech messages. */
  waiting?: { support?: number; imports?: number; messages?: number; receipts?: number };
  today?: string;
};

/**
 * Everything worth a nudge, most valuable first. Money items outrank actions
 * because cash sitting still is the thing that compounds.
 */
export function attentionItems(input: AttentionInput): AttentionItem[] {
  const today = input.today ?? todayISO();
  const items: AttentionItem[] = [];

  // ── Surveys walked but never quoted — money on the shelf ──────────────────
  const unquoted = input.surveys.filter(
    (s) => !s.quote_id && s.status !== 'lost' && !s.archived_at,
  );
  if (unquoted.length > 0) {
    const value = unquoted.reduce((sum, s) => sum + surveyTotals(s).total, 0);
    items.push({
      kind: 'survey_unquoted',
      severity: 'money',
      title: `${unquoted.length} ${plural(unquoted.length, 'survey')} never quoted`,
      detail: value > 0 ? `${money(value)} walked but never sent` : 'Walked but never sent',
      count: unquoted.length,
      amount: value,
      view: 'surveys',
    });
  }

  // ── Surveys that cannot be quoted yet, because nothing is priced ──────────
  const unpriced = input.surveys.filter(
    (s) => !s.quote_id && s.status !== 'lost' && !s.archived_at
      && !readyToQuote(s) && unpricedDevices(s) > 0,
  );
  if (unpriced.length > 0) {
    const devices = unpriced.reduce((n, s) => n + unpricedDevices(s), 0);
    items.push({
      kind: 'survey_unpriced',
      severity: 'action',
      title: `${devices} ${plural(devices, 'position')} with no price`,
      detail: `Across ${unpriced.length} ${plural(unpriced.length, 'survey')} — blocks the quote`,
      count: devices,
      view: 'surveys',
    });
  }

  // ── Quotes sent and gone quiet ───────────────────────────────────────────
  const stale = input.quotes.filter((q) => {
    if (q.status !== 'sent') return false;
    const age = daysUntil(q.created_at.slice(0, 10), today);
    return age != null && age <= -14;
  });
  if (stale.length > 0) {
    const value = stale.reduce((sum, q) => sum + Number(q.total || 0), 0);
    items.push({
      kind: 'quote_stale',
      severity: 'money',
      title: `${stale.length} ${plural(stale.length, 'quote')} with no answer`,
      detail: `${money(value)} out for more than two weeks`,
      count: stale.length,
      amount: value,
      view: 'quotes',
    });
  }

  // ── Accepted, but nobody has been sent to do it ──────────────────────────
  const unbuilt = input.quotes.filter((q) => q.status === 'accepted' && !q.work_order_id);
  if (unbuilt.length > 0) {
    items.push({
      kind: 'quote_unbuilt',
      severity: 'action',
      title: `${unbuilt.length} accepted ${plural(unbuilt.length, 'quote')} with no job`,
      detail: 'Client said yes — the work order was never created',
      count: unbuilt.length,
      view: 'quotes',
    });
  }

  // ── Contracts out for signature ─────────────────────────────────────────
  const unsigned = input.contracts.filter(
    (c) => c.status === 'sent' && !c.signed_at && !c.archived_at,
  );
  if (unsigned.length > 0) {
    const value = unsigned.reduce((sum, c) => sum + Number(c.total || 0), 0);
    items.push({
      kind: 'contract_unsigned',
      severity: 'money',
      title: `${unsigned.length} ${plural(unsigned.length, 'contract')} unsigned`,
      detail: `${money(value)} waiting on a signature`,
      count: unsigned.length,
      amount: value,
      view: 'contracts',
    });
  }

  // ── A tech says it's finished and it is sitting on you ───────────────────
  // This is the handoff back from the field. Without it, "Work Done" is a
  // status nobody is watching and the job quietly stops moving.
  const awaiting = input.workOrders.filter(
    (w) => !w.archived_at && w.wo_status === 'Work Done',
  );
  if (awaiting.length > 0) {
    const value = awaiting.reduce((sum, w) => sum + Number(w.total_amount || 0), 0);
    items.push({
      kind: 'work_awaiting_review',
      severity: 'action',
      title: `${awaiting.length} ${plural(awaiting.length, 'job')} finished, waiting on you`,
      detail: value > 0
        ? `${money(value)} — review and close them to bill`
        : 'A tech marked the work done; close it to bill',
      count: awaiting.length,
      amount: value,
      view: 'workorders',
    });
  }

  // ── Client billing does not happen here ──────────────────────────────────
  // Fred bills clients through QuickBooks and the NetView portal, never from
  // this app: three invoices exist and all three are still drafts, against
  // $54k of work. A "finished but not invoiced" warning read off this app's
  // invoice table was therefore permanently true and permanently useless, and
  // it was reporting a backlog at him that did not exist.
  //
  // The site log's own invoice_status is different and is kept — Fred sets
  // that flag himself, so it says what HE knows about what has been billed.

  // ── Invoices past due ────────────────────────────────────────────────────
  const paidByInvoice = new Map<string, number>();
  for (const p of input.invoicePayments) {
    paidByInvoice.set(p.invoice_id, (paidByInvoice.get(p.invoice_id) ?? 0) + Number(p.amount || 0));
  }
  const overdue = input.invoices.filter((inv) => {
    if (inv.status !== 'sent') return false;
    const days = daysUntil(inv.due_date, today);
    if (days == null || days >= 0) return false;
    return (paidByInvoice.get(inv.id) ?? 0) < Number(inv.total || 0);
  });
  if (overdue.length > 0) {
    const value = overdue.reduce(
      (sum, inv) => sum + Math.max(0, Number(inv.total || 0) - (paidByInvoice.get(inv.id) ?? 0)), 0,
    );
    items.push({
      kind: 'invoice_overdue',
      severity: 'money',
      title: `${overdue.length} ${plural(overdue.length, 'invoice')} past due`,
      detail: `${money(value)} owed to you`,
      count: overdue.length,
      amount: value,
      view: 'invoices',
    });
  }

  // ── Techs owed ───────────────────────────────────────────────────────────
  // enrichWorkOrders already did this sum with the tested payout helpers.
  const owedWOs = input.workOrders.filter((w) => !w.archived_at && w.remaining > 0.005);
  if (owedWOs.length > 0) {
    const value = owedWOs.reduce((sum, w) => sum + w.remaining, 0);
    items.push({
      kind: 'tech_owed',
      severity: 'money',
      title: `${money(value)} owed to techs`,
      detail: `Across ${owedWOs.length} ${plural(owedWOs.length, 'job')}`,
      count: owedWOs.length,
      amount: value,
      view: 'payables',
    });
  }

  // ── Site visits walked but never billed ──────────────────────────────────
  // These never reached the dashboard before, because it only loaded visits
  // that already had a work order. A visit billed straight to the client
  // without one was invisible, and invisible money does not get chased.
  const visits = (input.siteVisits ?? []).filter((v) => !v.archived_at);
  const unbilledVisits = visits.filter((v) => v.invoice_status !== 'invoiced');
  if (unbilledVisits.length > 0) {
    const value = unbilledVisits.reduce((sum, v) => sum + visitAmount(v), 0);
    const oldest = unbilledVisits
      .map((v) => daysUntil(v.visit_date, today))
      .filter((d): d is number => d != null)
      .sort((a, b) => a - b)[0];
    items.push({
      kind: 'visit_unbilled',
      severity: 'money',
      title: `${unbilledVisits.length} site ${plural(unbilledVisits.length, 'visit')} not invoiced`,
      detail: oldest != null && oldest <= -30
        ? `${money(value)} — the oldest has been sitting ${Math.abs(oldest)} days`
        : `${money(value)} walked but never billed`,
      count: unbilledVisits.length,
      amount: value,
      view: 'sitelog',
    });
  }

  // ── Visits whose rate could be read two ways ─────────────────────────────
  // A bare "55" bills once for the whole visit, not per hour. The app will not
  // guess which was meant, so it says so instead of quietly under-billing.
  const unclear = visits.filter(rateIsAmbiguous);
  if (unclear.length > 0) {
    items.push({
      kind: 'visit_rate_unclear',
      severity: 'action',
      title: `${unclear.length} ${plural(unclear.length, 'visit')} with an unclear rate`,
      detail: 'A rate with no "/hr" bills once for the whole visit — check these are right',
      count: unclear.length,
      view: 'sitelog',
    });
  }

  // ── A clock nobody stopped ───────────────────────────────────────────────
  // The most expensive thing that can sit quietly in the site log. A stint
  // running from 31 July to 1 September put 787.5 hours on a $55 call — over
  // $43,000 if it had been invoiced — and nothing anywhere said a word.
  const badHours = visits.filter(hoursLookWrong);
  if (badHours.length > 0) {
    const worst = badHours
      .flatMap(suspectSessions)
      .reduce((max, s) => Math.max(max, s.hours ?? 0), 0);
    const atRisk = badHours.reduce((sum, v) => sum + visitAmount(v), 0);
    items.push({
      kind: 'visit_hours_wrong',
      severity: 'money',
      title: `${badHours.length} ${plural(badHours.length, 'visit')} with impossible hours`,
      detail: worst > 0
        ? `One stint runs ${Math.round(worst)} hours — would bill ${money(atRisk)}`
        : `A clock was never stopped — would bill ${money(atRisk)}`,
      count: badHours.length,
      amount: atRisk,
      view: 'sitelog',
    });
  }

  // ── Assignments sent but unanswered ──────────────────────────────────────
  const waiting = input.workOrders.filter((w) => {
    if (w.archived_at) return false;
    if (w.wo_status === 'Approved' || w.wo_status === 'Paid') return false;
    const name = (w.contractor_name ?? '').trim();
    if (!name) return false;
    return !(w.assignment_responses ?? {})[name];
  });
  if (waiting.length > 0) {
    items.push({
      kind: 'assignment_unanswered',
      severity: 'action',
      title: `${waiting.length} ${plural(waiting.length, 'job')} unanswered`,
      detail: 'Sent to a tech who has not accepted or declined',
      count: waiting.length,
      view: 'workorders',
    });
  }

  // ── Jobs a tech turned down ──────────────────────────────────────────────
  const declined = input.workOrders.filter((w) => {
    if (w.archived_at) return false;
    if (w.wo_status === 'Approved' || w.wo_status === 'Paid') return false;
    const r = w.assignment_responses ?? {};
    const names = [...(w.contractor_names ?? []), w.contractor_name ?? ''].map((n) => n.trim()).filter(Boolean);
    return names.some((n) => r[n]?.status === 'declined');
  });
  if (declined.length > 0) {
    items.push({
      kind: 'assignment_declined',
      severity: 'action',
      title: `${declined.length} ${plural(declined.length, 'job')} turned down`,
      detail: 'A tech said no; pick another tech',
      count: declined.length,
      view: 'workorders',
    });
  }

  // ── What the office keeps its own count of ───────────────────────────────
  const kept = input.waiting ?? {};
  const counted: [AttentionKind, number | undefined, string, string, string][] = [
    ['messages_unread', kept.messages, 'unread tech message', 'Answer your techs', 'messages'],
    ['support_waiting', kept.support, 'support ticket', 'Support emails waiting for you to approve', 'support'],
    ['import_waiting', kept.imports, 'work order to bring in', 'From email and spreadsheets, waiting on you', 'import-queue'],
    ['receipts_waiting', kept.receipts, 'receipt', 'From techs, waiting for you to approve or decline on Dispatch', 'workorders'],
  ];
  for (const [kind, n, one, detail, view] of counted) {
    if (n && n > 0) items.push({ kind, severity: 'action', title: `${n} ${plural(n, one)}`, detail, count: n, view });
  }

  // Money first, then by size. An action with no dollar figure sorts under the
  // money items rather than above them.
  return items.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'money' ? -1 : 1;
    return (b.amount ?? 0) - (a.amount ?? 0);
  });
}

/** One line for the top of the dashboard, or null when nothing needs anyone. */
export function attentionSummary(items: AttentionItem[]): string | null {
  if (items.length === 0) return null;
  const cash = items
    .filter((i) => i.severity === 'money')
    .reduce((sum, i) => sum + (i.amount ?? 0), 0);
  if (cash > 0) return `${money(cash)} is sitting still across ${items.length} ${plural(items.length, 'thing')}`;
  return `${items.length} ${plural(items.length, 'thing')} need you`;
}
