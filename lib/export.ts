import type { EnrichedWorkOrder, Payment, Contractor } from '@/lib/types';
import { fmtMoney } from '@/lib/utils';
import { toCSV, UTF8_BOM } from '@/lib/csv';

/**
 * Put text on the clipboard, with a fallback for the cases where the browser
 * refuses: Safari outside a user gesture, an insecure origin, or a denied
 * permission. The prompt is ugly but it always lets the user get their data —
 * silently failing a copy is the one outcome worth avoiding.
 *
 * Returns true when the clipboard API took it, false when the user was shown
 * the fallback, so the caller can word its toast honestly.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    window.prompt('Copy with Ctrl+C, then paste into Excel:', text);
    return false;
  }
}

/**
 * Save a ready-built CSV string. The only place in the app that touches the
 * download plumbing — exported so callers holding their own CSV (the site
 * activity report) don't reimplement it.
 */
export function downloadCSVText(filename: string, csv: string) {
  // BOM so Excel reads it as UTF-8 instead of mangling accented names.
  const blob = new Blob([UTF8_BOM + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Save a sheet as a real .xlsx. Loaded on demand so the SheetJS bundle only
 * reaches users who actually export — it is far larger than the rest of this
 * module. Column widths are set because the default is unreadable for an
 * address column, and this file goes to a client.
 */
export async function downloadXLSX(
  filename: string,
  sheetName: string,
  rows: (string | number)[][],
  colWidths?: number[],
) {
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.aoa_to_sheet(rows);
  if (colWidths) ws['!cols'] = colWidths.map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}

/**
 * Escaping goes through lib/csv, which guards against Excel formula injection.
 * The previous inline escaper here only handled quotes, so a contractor name or
 * note beginning with '=' or '-' was written as a live formula into files that
 * go to clients and to the accountant.
 */
function downloadCSV(filename: string, rows: string[][]) {
  downloadCSVText(filename, toCSV(rows));
}

export function exportWorkOrdersCSV(wos: EnrichedWorkOrder[]) {
  const header = ['WO#', 'Contractor', 'Title', 'Status', 'Pay Status', 'Total', 'Paid', 'Remaining', 'Start Date', 'Service Type', 'City', 'State'];
  const rows = wos.map((w) => [
    w.wo_number, w.contractor_name, w.title ?? '', w.wo_status, w.payment_status,
    fmtMoney(Number(w.total_amount)), fmtMoney(w.paid), fmtMoney(w.remaining),
    w.start_date ?? '', w.service_type ?? '', w.site_city ?? '', w.site_state ?? '',
  ]);
  downloadCSV(`work-orders-${new Date().toISOString().split('T')[0]}.csv`, [header, ...rows]);
}

export function exportPaymentsCSV(payments: Payment[]) {
  const header = ['Date', 'WO#', 'Contractor', 'Amount', 'Method', 'Notes'];
  const rows = payments.map((p) => [
    p.payment_date, p.wo_number, p.contractor_name,
    fmtMoney(Number(p.amount)), p.method ?? '', p.notes ?? '',
  ]);
  downloadCSV(`payments-${new Date().toISOString().split('T')[0]}.csv`, [header, ...rows]);
}

export function exportContractorsCSV(contractors: Contractor[]) {
  const header = ['Name', 'Phone', 'Email', 'Business Name', 'Entity Type', 'W9 Received', 'City', 'State'];
  const rows = contractors.map((c) => [
    c.name, c.phone ?? '', c.email ?? '', c.business_name ?? '',
    c.entity_type ?? '', c.w9_received ? 'Yes' : 'No', c.city ?? '', c.state ?? '',
  ]);
  downloadCSV(`contractors-${new Date().toISOString().split('T')[0]}.csv`, [header, ...rows]);
}

export function exportFinancialSummaryCSV(
  monthly: { month: string; committed: number; paid: number; outstanding: number; jobCount: number }[],
  byContractor: { name: string; committed: number; paid: number; outstanding: number; jobCount: number }[],
) {
  const monthlyHeader = ['Month', 'Jobs', 'Committed', 'Paid', 'Outstanding'];
  const monthlyRows = monthly.map((m) => [
    m.month, String(m.jobCount), fmtMoney(m.committed), fmtMoney(m.paid), fmtMoney(m.outstanding),
  ]);
  const contractorHeader = ['Contractor', 'Jobs', 'Committed', 'Paid', 'Outstanding'];
  const contractorRows = byContractor.map((c) => [
    c.name, String(c.jobCount), fmtMoney(c.committed), fmtMoney(c.paid), fmtMoney(c.outstanding),
  ]);
  downloadCSV(`financial-summary-${new Date().toISOString().split('T')[0]}.csv`, [
    ['Monthly Summary'], monthlyHeader, ...monthlyRows,
    [], ['By Contractor'], contractorHeader, ...contractorRows,
  ]);
}

export function export1099CSV(contractors: Contractor[], payments: Payment[], year: number) {
  const yearPayments = payments.filter((p) => p.payment_date?.startsWith(String(year)));
  const totals = new Map<string, number>();
  for (const p of yearPayments) {
    totals.set(p.contractor_name, (totals.get(p.contractor_name) ?? 0) + Number(p.amount));
  }
  const header = ['Contractor', 'Business Name', 'Tax ID Type', 'Tax ID', 'Address', 'City', 'State', 'ZIP', `${year} Total Paid`, '1099 Required'];
  const rows = contractors
    .filter((c) => (totals.get(c.name) ?? 0) > 0)
    .map((c) => {
      const total = totals.get(c.name) ?? 0;
      return [
        c.name, c.business_name ?? '', c.tax_id_type ?? '', c.tax_id ?? '',
        c.address ?? '', c.city ?? '', c.state ?? '', c.zip ?? '',
        fmtMoney(total), total >= 600 ? 'Yes' : 'No',
      ];
    });
  downloadCSV(`1099-report-${year}.csv`, [header, ...rows]);
}
