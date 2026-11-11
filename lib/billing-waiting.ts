// Invoices made on the job log but not yet in QuickBooks or on NetView's form (Fred, 2026-11-08: "I need a
// platform where I can see everything"). Home lists them so a finished invoice can't sit forgotten.
//
// Only invoices saved from BILLING_SINCE on count: older jobs were billed outside the app before these marks
// existed, and a list that is always full gets ignored. Pure; components/BillingToSend.tsx loads the rows.
import { inQuickBooks, parseInvoiceMeta } from './job-log-invoice';
import { parseRate, parseRates } from './job-log-rates';
import { isNetviewJob, type NetviewJob } from './netview-form';

export const BILLING_SINCE = '2026-11-08';

/** A row of job_log_rates. */
export type BillingRow = { wo_id: string; rates: unknown; all_hours_rate: unknown; invoice: unknown; updated_at: string };
export type BillingJob = NetviewJob & { id: string; wo_number: string; site_name?: string | null; customer_name?: string | null; archived_at?: string | null };
export type BillingItem = { woId: string; title: string; quickbooks: boolean; netview: boolean };
export type AccountingJob = BillingJob & {
  wo_status?: string;
  scheduled_date?: string | null;
  start_date?: string | null;
  paid?: number;
  remaining?: number;
  pay_set?: boolean;
};
export type AccountingItem = {
  woId: string;
  title: string;
  invoice: 'not_prepared' | 'not_sent' | 'sent';
  invoiceNumber?: string;
  techPaid: number;
  techDue: number;
  paySet: boolean;
  date: string;
};

export function billingWaiting(rows: BillingRow[], jobs: BillingJob[], since = BILLING_SINCE): BillingItem[] {
  const byId = new Map(jobs.map((j) => [j.id, j]));
  const out: BillingItem[] = [];
  for (const r of rows) {
    if (r.updated_at.slice(0, 10) < since) continue;
    const job = byId.get(r.wo_id);
    if (!job) continue;
    // No rate yet: the invoice isn't made, so there's nothing to send.
    if (Object.keys(parseRates(r.rates)).length === 0 && parseRate(r.all_hours_rate) == null) continue;
    const meta = parseInvoiceMeta(r.invoice, since);
    const quickbooks = !inQuickBooks(meta);
    const netview = isNetviewJob(job, job.customer_name) && !meta.netview;
    if (!quickbooks && !netview) continue;
    out.push({ woId: job.id, title: `WO ${job.wo_number}${job.site_name ? ` · ${job.site_name}` : ''}`, quickbooks, netview });
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

/** "Not in QuickBooks · NetView not sent". */
export const billingDetail = (i: BillingItem) =>
  [i.quickbooks && 'Not in QuickBooks', i.netview && 'NetView not sent'].filter(Boolean).join(' · ');

/** Finished jobs in one ledger: client invoice status beside technician pay. */
export function accountingTracking(rows: BillingRow[], jobs: AccountingJob[]): AccountingItem[] {
  const rowByJob = new Map<string, BillingRow>();
  for (const row of rows) {
    const current = rowByJob.get(row.wo_id);
    if (!current || row.updated_at > current.updated_at) rowByJob.set(row.wo_id, row);
  }
  return jobs
    .filter((job) => !!job.archived_at || ['Work Done', 'Approved', 'Paid'].includes(job.wo_status ?? ''))
    .map((job) => {
      const row = rowByJob.get(job.id);
      const prepared = !!row && (Object.keys(parseRates(row.rates)).length > 0 || parseRate(row.all_hours_rate) != null);
      const meta = parseInvoiceMeta(row?.invoice, BILLING_SINCE);
      const sent = inQuickBooks(meta);
      return {
        woId: job.id,
        title: `WO ${job.wo_number}${job.site_name ? ` · ${job.site_name}` : ''}`,
        invoice: sent ? 'sent' as const : prepared ? 'not_sent' as const : 'not_prepared' as const,
        ...(meta.qbo?.number ? { invoiceNumber: meta.qbo.number } : {}),
        techPaid: Number(job.paid || 0),
        techDue: Math.max(0, Number(job.remaining || 0)),
        paySet: job.pay_set === true,
        date: job.scheduled_date || job.start_date || '',
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date) || b.title.localeCompare(a.title));
}
