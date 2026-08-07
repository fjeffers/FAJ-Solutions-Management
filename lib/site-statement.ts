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
  site: string;
  address: string;
  work: string;
  hours: number | null;
  basis: string;
  amount: number;
};

export const STATEMENT_HEADERS = [
  'Date', 'Site', 'Address', 'Work Performed', 'Hours', 'Basis', 'Amount',
];

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
        site: [v.site_name, v.site_code ? `#${v.site_code}` : null].filter(Boolean).join(' '),
        address: v.address ?? '',
        // Same gate the shared report uses, so a pasted assignment email never
        // reaches a client here either.
        work: clientVisibleNote(v),
        hours: v.hours,
        basis,
        amount: visitAmount(v),
      };
    });
}

export function statementTotal(rows: StatementRow[]): number {
  return Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100;
}

export function statementMatrix(rows: StatementRow[]): (string | number)[][] {
  const body = rows.map((r) => [
    r.date, r.site, r.address, r.work, r.hours ?? '', r.basis, r.amount,
  ]);
  return [STATEMENT_HEADERS, ...body, ['', '', '', '', '', 'TOTAL', statementTotal(rows)]];
}
