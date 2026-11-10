import { createAdminClient } from '@/lib/supabase/admin';
import { clientInvoiceFilename, clientInvoicePdf } from '@/lib/client-invoice-pdf';
import type { Invoice, InvoicePayment, WorkOrder } from '@/lib/types';
import { jobLogPhotoLabel } from '@/lib/job-log-photo-label';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 16) return new Response('Invoice not found.', { status: 404 });

  const db = createAdminClient();
  const { data: invoice } = await db.from('invoices').select('*').eq('share_token', token).maybeSingle<Invoice>();
  if (!invoice) return new Response('Invoice not found.', { status: 404 });

  const [{ data: payments }, { data: sites }, { data: expenses }] = await Promise.all([
    db.from('invoice_payments').select('*').eq('invoice_id', invoice.id).order('payment_date'),
    invoice.work_order_ids.length
      ? db.from('work_orders').select('id, site_name, site_city, site_state, title, client_reference, wo_number, job_log_receipt_photos, job_log_left_out').in('id', invoice.work_order_ids)
      : Promise.resolve({ data: [] }),
    invoice.work_order_ids.length
      ? db.from('job_expenses').select('id, vendor, category, amount, expense_date').in('wo_id', invoice.work_order_ids)
        .eq('status', 'approved').not('receipt_path', 'is', null).order('expense_date')
      : Promise.resolve({ data: [] }),
  ]);
  type ReceiptSite = Pick<WorkOrder, 'id' | 'site_name' | 'site_city' | 'site_state' | 'title' | 'client_reference' | 'wo_number' | 'job_log_receipt_photos' | 'job_log_left_out'>;
  const receiptSites = (sites ?? []) as ReceiptSite[];
  const site = receiptSites[0] ?? null;
  const origin = new URL(request.url).origin;
  const expenseLinks: { label: string; url: string }[] = ((expenses ?? []) as { id: string; vendor: string | null; category: string; amount: number; expense_date: string }[])
    .map((expense) => ({
      label: `${expense.expense_date} - ${expense.vendor || expense.category.replace(/[_-]+/g, ' ')} - ${Number(expense.amount).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}`,
      url: `${origin}/invoice/${encodeURIComponent(token)}/expense/${encodeURIComponent(expense.id)}`,
    }));
  const photoIds = new Map<string, { kind: 'receipt' | 'hotel' | 'rental'; vendor: string | null }>();
  for (const wo of receiptSites) {
    const left = new Set(wo.job_log_left_out ?? []);
    const ids = (wo.job_log_receipt_photos ?? []).map((label) => label.split(':').at(-1)!).filter(Boolean);
    for (const id of ids) {
      const meta = jobLogPhotoLabel(wo.job_log_receipt_photos ?? [], id);
      if (meta.kind !== 'photo' && meta.kind !== 'odometer' && !left.has(`photo:${id}`)) {
        photoIds.set(id, { kind: meta.kind, vendor: meta.vendor });
      }
    }
  }
  if (photoIds.size) {
    const { data: photos } = await db.from('wo_photos').select('id, taken_at').in('id', [...photoIds.keys()]).in('wo_id', invoice.work_order_ids).order('taken_at');
    for (const photo of (photos ?? []) as { id: string; taken_at: string }[]) {
      const meta = photoIds.get(photo.id)!;
      const type = meta.kind === 'hotel' ? 'Hotel receipt' : meta.kind === 'rental' ? 'Vehicle rental receipt' : 'Receipt photo';
      expenseLinks.push({
        label: `${photo.taken_at.split('T')[0]} - ${type}${meta.vendor ? ` - ${meta.vendor}` : ''}`,
        url: `${origin}/invoice/${encodeURIComponent(token)}/photo/${encodeURIComponent(photo.id)}`,
      });
    }
  }
  const pdf = await clientInvoicePdf(invoice, (payments ?? []) as InvoicePayment[], site, expenseLinks);
  const filename = clientInvoiceFilename(invoice, site);
  const asciiFilename = filename.replace(/[^\x20-\x7E]/g, ' ').replace(/"/g, '').replace(/\s+/g, ' ').trim() || `Invoice ${invoice.invoice_number}.pdf`;

  return new Response(pdf as BodyInit, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'cache-control': 'private, no-store',
    },
  });
}
