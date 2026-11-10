import { createAdminClient } from '@/lib/supabase/admin';
import { getValidQboSession } from '@/lib/quickbooks-session';
import { getInvoiceStatus, invoicePaymentDates, listOpenInvoices, type QuickBooksInvoiceStatus } from '@/lib/quickbooks';
import type { QuickBooksReceivable } from '@/lib/types';

type SourceInvoice = {
  workOrderId: string;
  sourceType: 'job_log' | 'field_sheet';
  qboId: string;
  number: string;
  customer: string | null;
  total: number;
  sentAt: string | null;
};

type InvoiceRow = {
  source: SourceInvoice | null;
  qbo: QuickBooksInvoiceStatus;
  customerName: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
};

function qboMeta(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const invoice = raw as Record<string, unknown>;
  const qbo = invoice.qbo;
  return qbo && typeof qbo === 'object' && !Array.isArray(qbo) ? qbo as Record<string, unknown> : null;
}

const numberKey = (value: string) => value.trim().toLowerCase();

export async function loadQuickBooksReceivables(userId: string): Promise<QuickBooksReceivable[]> {
  const admin = createAdminClient();
  const session = await getValidQboSession(userId);
  if (!session) throw new Error('QuickBooks is not connected, or its sign-in expired.');

  const [fieldResult, jobResult] = await Promise.all([
    admin.from('field_sheet_invoices')
      .select('wo_id, customer_name, qbo_invoice_id, qbo_invoice_number, total, sent_at')
      .eq('user_id', userId)
      .not('qbo_invoice_id', 'is', null),
    admin.from('job_log_rates')
      .select('wo_id, invoice')
      .eq('user_id', userId),
  ]);
  if (fieldResult.error) throw fieldResult.error;
  if (jobResult.error) throw jobResult.error;

  const jobRows = (jobResult.data ?? []).flatMap((row) => {
    const qbo = qboMeta(row.invoice);
    const id = typeof qbo?.id === 'string' ? qbo.id : '';
    if (!id) return [];
    return [{
      workOrderId: row.wo_id as string,
      sourceType: 'job_log' as const,
      qboId: id,
      number: typeof qbo?.number === 'string' ? qbo.number : '',
      customer: null,
      total: Number(qbo?.total ?? 0),
      sentAt: typeof qbo?.at === 'string' ? qbo.at : null,
    }];
  });
  const fieldRows: SourceInvoice[] = (fieldResult.data ?? []).map((row) => ({
    workOrderId: row.wo_id as string,
    sourceType: 'field_sheet',
    qboId: row.qbo_invoice_id as string,
    number: String(row.qbo_invoice_number ?? ''),
    customer: row.customer_name as string | null,
    total: Number(row.total ?? 0),
    sentAt: row.sent_at as string | null,
  }));
  const sources = [...jobRows, ...fieldRows];
  const workOrderIds = [...new Set(sources.map((source) => source.workOrderId))];
  const { data: workOrders, error: workOrderError } = workOrderIds.length
    ? await admin.from('work_orders').select('id, customer_name').in('id', workOrderIds)
    : { data: [], error: null };
  if (workOrderError) throw workOrderError;
  const customers = new Map((workOrders ?? []).map((workOrder) => [workOrder.id as string, workOrder.customer_name as string | null]));

  const { environment, realm_id: realm, access_token: token } = session;
  const openInvoices = await listOpenInvoices(environment, realm, token);
  const sourcesById = new Map(sources.map((source) => [source.qboId, source]));
  const sourcesByNumber = new Map(sources.filter((source) => source.number).map((source) => [numberKey(source.number), source]));
  const usedSources = new Set<SourceInvoice>();
  const rows: InvoiceRow[] = openInvoices.map((qbo) => {
    const source = sourcesById.get(qbo.id) ?? sourcesByNumber.get(numberKey(qbo.docNumber)) ?? null;
    if (source) usedSources.add(source);
    return {
      source,
      qbo,
      customerName: qbo.customerName,
      invoiceDate: qbo.invoiceDate,
      dueDate: qbo.dueDate,
    };
  });

  const remainingSources = sources.filter((source) => !usedSources.has(source));
  const remaining = await Promise.all(remainingSources.map(async (source): Promise<InvoiceRow> => ({
    source,
    qbo: await getInvoiceStatus(environment, realm, token, source.qboId),
    customerName: source.customer || customers.get(source.workOrderId) || null,
    invoiceDate: source.sentAt?.slice(0, 10) ?? null,
    dueDate: null,
  })));
  rows.push(...remaining);

  const payments = await invoicePaymentDates(environment, realm, token, rows.map((row) => row.qbo.id));
  const now = new Date().toISOString();
  return rows.map(({ source, qbo, customerName, invoiceDate, dueDate }) => {
    const total = qbo.total || source?.total || 0;
    const balance = Math.max(0, qbo.balance);
    const status = total <= 0 ? 'void' : balance <= 0.005 ? 'paid' : balance < total - 0.005 ? 'partial' : 'sent';
    const payment = payments.get(qbo.id);
    return {
      work_order_id: source?.workOrderId ?? null,
      source_type: source?.sourceType ?? 'quickbooks',
      qbo_invoice_id: qbo.id,
      qbo_invoice_number: qbo.docNumber || source?.number || null,
      customer_name: source?.customer || customerName || (source ? customers.get(source.workOrderId) : null) || null,
      total,
      balance,
      status,
      sent_at: source?.sentAt ?? (invoiceDate ? `${invoiceDate}T12:00:00.000Z` : qbo.updatedAt),
      due_date: dueDate,
      paid_at: status === 'paid' && payment?.latestDate ? `${payment.latestDate}T12:00:00.000Z` : null,
      last_payment_at: payment?.latestDate ?? null,
      email_status: qbo.emailStatus,
      synced_at: now,
    } satisfies QuickBooksReceivable;
  });
}
