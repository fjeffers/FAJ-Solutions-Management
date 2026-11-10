import { createAdminClient } from '@/lib/supabase/admin';
import { clientInvoiceFilename, clientInvoicePdf } from '@/lib/client-invoice-pdf';
import type { Invoice, InvoicePayment, WorkOrder } from '@/lib/types';

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
      ? db.from('work_orders').select('site_name, title, client_reference, wo_number').in('id', invoice.work_order_ids).limit(1)
      : Promise.resolve({ data: [] }),
    invoice.work_order_ids.length
      ? db.from('job_expenses').select('id, vendor, category, amount, expense_date').in('wo_id', invoice.work_order_ids)
        .eq('status', 'approved').not('receipt_path', 'is', null).order('expense_date')
      : Promise.resolve({ data: [] }),
  ]);
  const site = (sites?.[0] ?? null) as Pick<WorkOrder, 'site_name' | 'title' | 'client_reference' | 'wo_number'> | null;
  const origin = new URL(request.url).origin;
  const expenseLinks = ((expenses ?? []) as { id: string; vendor: string | null; category: string; amount: number; expense_date: string }[])
    .map((expense) => ({
      label: `${expense.expense_date} - ${expense.vendor || expense.category.replace(/[_-]+/g, ' ')} - ${Number(expense.amount).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}`,
      url: `${origin}/invoice/${encodeURIComponent(token)}/expense/${encodeURIComponent(expense.id)}`,
    }));
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
