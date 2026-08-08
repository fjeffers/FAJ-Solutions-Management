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
  timeOnSite: string;
  hours: number | null;
  rate: string;
  miles: number | null;
  travel: number | null;
  amount: number;
};

// Mirrors the columns of the Projects spreadsheet this replaces: the client
// recognises their own site id, and a billed hour is easier to accept next to
// the times it was worked.
export const STATEMENT_HEADERS = [
  'Date', 'Site #', 'Site', 'Address', 'Work Performed',
  'Time On Site', 'Hours', 'Rate', 'Miles', 'Travel Charge', 'Amount',
];

/** "8:15 AM – 12:30 PM", across however many stints the visit had. */
function timeOnSite(v: SiteVisit): string {
  const stints = (v.sessions && v.sessions.length > 0)
    ? v.sessions
    : (v.time_in ? [{ in: v.time_in, out: v.time_out }] : []);
  const t = (iso: string | null) => iso
    ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : '';
  return stints
    .filter((s) => s.in)
    .map((s) => `${t(s.in)}${s.out ? ` – ${t(s.out)}` : ''}`)
    .join(', ');
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
        timeOnSite: timeOnSite(v),
        hours: v.hours,
        rate: basis,
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
    r.timeOnSite, r.hours ?? '', r.rate, r.miles ?? '', r.travel ?? '', r.amount,
  ]);
  const totalMiles = rows.reduce((s, r) => s + Number(r.miles ?? 0), 0);
  const totalHours = rows.reduce((s, r) => s + Number(r.hours ?? 0), 0);
  return [
    STATEMENT_HEADERS,
    ...body,
    ['', '', '', '', '', 'TOTAL',
      totalHours || '', '', totalMiles || '', '', statementTotal(rows)],
  ];
}
