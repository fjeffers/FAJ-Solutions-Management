// The spreadsheet Fred sends a client to get paid: every completed visit for
// that client, what was done, and what it costs.
//
// This is the money-carrying counterpart to lib/site-report.ts, which is the
// deliberately money-free activity report. Same visits, different audience
// question — "what did you do" vs "what do I owe".
//
// Two formats from one shape: .xlsx for a client who wants a real spreadsheet,
// .csv for Excel or a Google Sheets import. The rows are built once so the two
// can never disagree about a total.
import type { SiteVisit } from './types';
import { visitAmount, visitLineItem } from './visits';
import { clientVisibleNote } from './site-report';

export type StatementRow = {
  date: string;
  siteCode: string;
  site: string;
  address: string;
  work: string;
  timeIn: string;
  timeOut: string;
  hours: number | null;
  rate: string;
  /** hours × rate — shown so the client can check the arithmetic themselves. */
  labor: number;
  miles: number | null;
  travel: number | null;
  amount: number;
};

// Deliberately the column names from Fred's own Projects sheet — Time In,
// Time Out, Total Time, Rate, Total Pay, Round Trip Miles, Travel Charge — so
// the client receives the document they already recognise. 'Total' is the one
// addition: his sheet made the reader add labour and travel themselves.
export const STATEMENT_HEADERS = [
  'Date', 'Site #', 'Site Name', 'Address', 'Work Performed',
  'Time In', 'Time Out', 'Total Time', 'Rate', 'Total Pay',
  'Round Trip Miles', 'Travel Charge', 'Total',
];

const clock = (iso: string | null | undefined) => iso
  ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  : '';

/** First arrival and last departure. A multi-day visit shows the span it covered. */
function stints(v: SiteVisit) {
  const list = (v.sessions && v.sessions.length > 0)
    ? v.sessions
    : (v.time_in ? [{ in: v.time_in, out: v.time_out }] : []);
  const withIn = list.filter((s) => s.in);
  if (withIn.length === 0) return { timeIn: '', timeOut: '' };
  const outs = withIn.filter((s) => s.out);
  return {
    timeIn: clock(withIn[0].in),
    timeOut: outs.length > 0 ? clock(outs[outs.length - 1].out) : '',
  };
}

/** Newest last, so the statement reads like a running account. */
export function buildStatementRows(visits: SiteVisit[]): StatementRow[] {
  return [...visits]
    .sort((a, b) => (a.visit_date ?? '').localeCompare(b.visit_date ?? ''))
    .map((v) => {
      const li = visitLineItem(v);
      const basis = v.total_project_price != null
        ? 'Project price'
        : li.rate > 0 && (v.rate ?? '').match(/\/\s*h/i)
          ? `${li.quantity}h @ $${li.rate}/hr`
          : li.rate > 0 ? 'Flat rate' : 'To be priced';
      return {
        date: v.visit_date ?? '',
        siteCode: v.site_code ?? '',
        site: v.site_name ?? '',
        address: v.address ?? '',
        // Same gate the shared report uses, so a pasted assignment email never
        // reaches a client here either.
        work: clientVisibleNote(v),
        ...stints(v),
        hours: v.hours,
        rate: basis,
        // Straight from the same line item the amount comes from, so Labor and
        // Amount can never disagree about what the hours were worth.
        labor: Math.round(li.quantity * li.rate * 100) / 100,
        miles: v.miles,
        travel: v.travel_charge,
        amount: visitAmount(v),
      };
    });
}

export function statementTotal(rows: StatementRow[]): number {
  return Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100;
}

export function statementMatrix(rows: StatementRow[]): (string | number)[][] {
  const body = rows.map((r) => [
    r.date, r.siteCode, r.site, r.address, r.work,
    r.timeIn, r.timeOut, r.hours ?? '', r.rate, r.labor,
    r.miles ?? '', r.travel ?? '', r.amount,
  ]);
  const sum = (pick: (r: StatementRow) => number | null) =>
    Math.round(rows.reduce((s, r) => s + Number(pick(r) ?? 0), 0) * 100) / 100;

  // Every column a client would add up themselves is totalled, so they can
  // check the bottom line without retyping the sheet.
  return [
    STATEMENT_HEADERS,
    ...body,
    ['', '', '', '', '', '', 'TOTAL',
      sum((r) => r.hours) || '', '', sum((r) => r.labor),
      sum((r) => r.miles) || '', sum((r) => r.travel), statementTotal(rows)],
  ];
}
