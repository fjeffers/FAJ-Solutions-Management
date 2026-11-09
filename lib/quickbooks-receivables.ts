import { createAdminClient } from '@/lib/supabase/admin';
import { getValidQboSession } from '@/lib/quickbooks-session';
import { getInvoiceStatus, invoicePaymentDates } from '@/lib/quickbooks';
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

function qboMeta(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const invoice = raw as Record<string, unknown>;
  const qbo = invoice.qbo;
  return qbo && typeof qbo === 'object' && !Array.isArray(qbo) ? qbo as Record<string, unknown> : null;
}

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
  const workOrderIds = [...new Set(sources.map((s) => s.workOrderId))];
  const { data: workOrders, error: workOrderError } = workOrderIds.length
    ? await admin.from('work_orders').select('id, customer_name').in('id', workOrderIds)
    : { data: [], error: null };
  if (workOrderError) throw workOrderError;
  const customers = new Map((workOrders ?? []).map((w) => [w.id as string, w.customer_name as string | null]));

  const { environment, realm_id: realm, access_token: token } = session;
  const statuses = await Promise.all(sources.map((source) =>
    getInvoiceStatus(environment, realm, token, source.qboId).then((qbo) => ({ source, qbo }))
  ));
  const payments = await invoicePaymentDates(environment, realm, token, sources.map((s) => s.qboId));
  const now = new Date().toISOString();
  return statuses.map(({ source, qbo }) => {
    const total = qbo.total || source.total;
    const balance = Math.max(0, qbo.balance);
    const status = total <= 0 ? 'void' : balance <= 0.005 ? 'paid' : balance < total - 0.005 ? 'partial' : 'sent';
    const payment = payments.get(source.qboId);
    return {
      work_order_id: source.workOrderId,
      source_type: source.sourceType,
      qbo_invoice_id: source.qboId,
      qbo_invoice_number: qbo.docNumber || source.number || null,
      customer_name: source.customer || customers.get(source.workOrderId) || null,
      total,
      balance,
      status,
      sent_at: source.sentAt,
      paid_at: status === 'paid' && payment?.latestDate ? `${payment.latestDate}T12:00:00.000Z` : null,
      last_payment_at: payment?.latestDate ?? null,
      email_status: qbo.emailStatus,
      synced_at: now,
    } satisfies QuickBooksReceivable;
  });
}
