import type { EnrichedWorkOrder, Payment, Contractor } from '@/lib/types';
import { fmtMoney } from '@/lib/utils';

function downloadCSV(filename: string, rows: string[][]) {
  const csv = rows.map((r) => r.map((c) => `"${(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
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
