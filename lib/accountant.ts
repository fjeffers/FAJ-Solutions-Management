// The accountant section's data layer (migration-095): audit, taxes, 1099s, W-9s.
//
// Same wall as the assistant and tech portals: every read is an acct_* RPC that
// resolves the caller and checks the accountant role in the database. Job money
// is computed with the app's own functions in lib/utils — never a second copy.
import { createClient } from '@/lib/supabase/client';
import { woPayoutTotal, woProfitOrNull } from '@/lib/utils';
import { needs1099 } from '@/lib/tax1099';
import type { WorkOrder } from '@/lib/types';

export interface AccountantMe { staff_id: string; name: string; email: string; owner_id: string; role: 'accountant' }

export interface Row1099 {
  name: string;
  contractor_id: string | null;
  business_name: string | null;
  entity_type: string | null;
  tax_id_type: string | null;
  tax_id_last4: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  email: string | null;
  w9_received: boolean;
  w9_file: boolean;
  w9_submitted_at: string | null;
  paid: number;
  payments: number;
}

export interface TechPayout {
  id: string;
  payment_date: string;
  contractor_name: string;
  wo_number: string | null;
  amount: number;
  method: string | null;
  notes: string | null;
  in_quickbooks: boolean;
}

export interface AcctInvoice {
  id: string;
  invoice_number: string | null;
  client_name: string | null;
  title: string | null;
  issued: string | null;
  due_date: string | null;
  subtotal: number | null;
  tax_amount: number | null;
  total: number | null;
  status: string | null;
  paid: number;
  paid_at: string | null;
}

export interface AcctReceived {
  id: string;
  payment_date: string;
  amount: number;
  method: string | null;
  reference: string | null;
  invoice_number: string | null;
  client_name: string | null;
}

async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}

const num = (v: unknown) => Number(v ?? 0);

export const fetchAccountantMe = () => rpc<AccountantMe | null>('acct_me');
export const fetch1099 = async (year: number) =>
  ((await rpc<Row1099[] | null>('acct_1099', { p_year: year })) ?? []).map((r) => ({ ...r, paid: num(r.paid), payments: num(r.payments) }));
export const fetchPayouts = async (year: number) =>
  ((await rpc<TechPayout[] | null>('acct_payments', { p_year: year })) ?? []).map((p) => ({ ...p, amount: num(p.amount) }));
export const fetchInvoices = async (year: number) =>
  ((await rpc<AcctInvoice[] | null>('acct_invoices', { p_year: year })) ?? []).map((i) => ({ ...i, total: num(i.total), paid: num(i.paid) }));
export const fetchReceived = async (year: number) =>
  ((await rpc<AcctReceived[] | null>('acct_received', { p_year: year })) ?? []).map((r) => ({ ...r, amount: num(r.amount) }));
export const fetchJobs = async (year: number) => (await rpc<WorkOrder[] | null>('acct_jobs', { p_year: year })) ?? [];

/** The full tax ID for one tech. Each call is written to Fred's activity log. */
export const revealTaxId = (contractorId: string) =>
  rpc<{ ok: boolean; reason: string; tax_id?: string; tax_id_type?: string }>('acct_reveal_tin', { p_contractor: contractorId });

// ─── Pure helpers (unit-tested) ─────────────────────────────────────────────

export const round2 = (n: number) => Math.round(n * 100) / 100;
export const sum = (xs: number[]) => round2(xs.reduce((a, b) => a + b, 0));

export interface Summary1099 { total: number; needing: number; missingW9: number; missingTin: number }

/** The year's 1099 picture: who needs a form, and whose paperwork is missing. */
export function summarize1099(rows: Row1099[], year: number): Summary1099 {
  const needing = rows.filter((r) => needs1099(r.paid, year));
  return {
    total: sum(rows.map((r) => r.paid)),
    needing: needing.length,
    missingW9: needing.filter((r) => !r.w9_received).length,
    missingTin: needing.filter((r) => !r.tax_id_last4).length,
  };
}

export interface JobMoney { revenue: number; payout: number; profit: number | null }

/** Revenue, payout and profit for one job — straight from lib/utils. */
export function jobMoney(wo: WorkOrder): JobMoney {
  return { revenue: round2(num(wo.total_amount)), payout: woPayoutTotal(wo), profit: woProfitOrNull(wo) };
}

/** Year totals for the Jobs tab. Jobs with no pay split are counted, not guessed. */
export function jobsTotals(jobs: WorkOrder[]) {
  const m = jobs.map(jobMoney);
  return {
    revenue: sum(m.map((x) => x.revenue)),
    payout: sum(m.map((x) => x.payout)),
    profit: sum(m.map((x) => x.profit ?? 0)),
    noSplit: m.filter((x) => x.profit === null).length,
  };
}

/**
 * Spreadsheet-safe CSV. Quotes every cell, doubles inner quotes, and prefixes
 * cells that start with = + - @ so a spreadsheet never runs them as formulas.
 * (A negative number is still a number: only text gets the prefix.)
 */
export function toCsv(headers: string[], rows: (string | number | boolean | null | undefined)[][]): string {
  const cell = (v: string | number | boolean | null | undefined) => {
    if (v === null || v === undefined) return '""';
    if (typeof v === 'number') return `"${v}"`;
    let s = String(v);
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  return [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
