import type { WorkOrder } from './types';

export const QBO_IMPORT_BATCH_SIZE = 100;

export type QboWorkOrderInput = Pick<WorkOrder,
  | 'id'
  | 'wo_number'
  | 'wo_status'
  | 'customer_name'
  | 'buyer_company'
  | 'title'
  | 'site_name'
  | 'total_amount'
  | 'start_date'
  | 'end_date'
  | 'scheduled_date'
  | 'submitted_at'
  | 'approved_at'
  | 'created_at'
>;

export type QboImportJob = {
  id: string;
  invoiceNumber: string;
  customerName: string;
  invoiceDate: string;
  dueDate: string;
  serviceDate: string;
  description: string;
  amount: number;
};

export type QboSkippedJob = {
  id: string;
  workOrderNumber: string;
  reason: string;
};

const COMPLETED_STATUSES = new Set(['Work Done', 'Approved', 'Paid']);

function isoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const datePrefix = value.trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePrefix)
    && !Number.isNaN(Date.parse(`${datePrefix}T00:00:00Z`))) return datePrefix;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function usDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${Number(month)}/${Number(day)}/${year}`;
}

export function prepareQboCompletedJobs(workOrders: QboWorkOrderInput[]) {
  const completed = workOrders
    .filter((job) => COMPLETED_STATUSES.has(job.wo_status))
    .sort((a, b) => a.wo_number.localeCompare(b.wo_number, undefined, { numeric: true }));
  const jobs: QboImportJob[] = [];
  const skipped: QboSkippedJob[] = [];

  for (const job of completed) {
    const customerName = (job.customer_name || job.buyer_company || '').trim();
    const amount = Math.round(Number(job.total_amount) * 100) / 100;
    if (!customerName) {
      skipped.push({ id: job.id, workOrderNumber: job.wo_number, reason: 'Add a customer name or buyer company.' });
      continue;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      skipped.push({ id: job.id, workOrderNumber: job.wo_number, reason: 'Add a positive client amount.' });
      continue;
    }

    const serviceDate = isoDate(job.end_date) ?? isoDate(job.start_date) ?? isoDate(job.scheduled_date);
    const invoiceDate = isoDate(job.approved_at)
      ?? isoDate(job.submitted_at)
      ?? serviceDate
      ?? isoDate(job.created_at);
    if (!invoiceDate) {
      skipped.push({ id: job.id, workOrderNumber: job.wo_number, reason: 'Add a valid job date.' });
      continue;
    }

    const subject = job.title?.trim() || job.site_name?.trim() || 'Field service';
    jobs.push({
      id: job.id,
      invoiceNumber: `WO-${job.wo_number}`,
      customerName,
      invoiceDate,
      dueDate: addDays(invoiceDate, 30),
      serviceDate: serviceDate ?? invoiceDate,
      description: `${subject} — WO #${job.wo_number}`,
      amount,
    });
  }

  return { completedCount: completed.length, jobs, skipped };
}

export function qboInvoiceImportRows(jobs: QboImportJob[]): string[][] {
  return [
    ['InvoiceNo', 'Customer', 'InvoiceDate', 'DueDate', 'Terms', 'Memo', 'Item(Product/Service)', 'ItemDescription', 'ItemQuantity', 'ItemRate', 'ItemAmount', 'Service Date'],
    ...jobs.map((job) => [
      job.invoiceNumber,
      job.customerName,
      usDate(job.invoiceDate),
      usDate(job.dueDate),
      'Net 30',
      `Completed job WO #${job.invoiceNumber.replace(/^WO-/, '')}`,
      'Field Services',
      job.description,
      '1',
      job.amount.toFixed(2),
      job.amount.toFixed(2),
      usDate(job.serviceDate),
    ]),
  ];
}
