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
