import { createAdminClient } from '@/lib/supabase/admin';
import { clientInvoiceFilename, clientInvoicePdf } from '@/lib/client-invoice-pdf';
import type { Invoice, InvoicePayment, WorkOrder } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 16) return new Response('Invoice not found.', { status: 404 });

  const db = createAdminClient();
  const { data: invoice } = await db.from('invoices').select('*').eq('share_token', token).maybeSingle<Invoice>();
  if (!invoice) return new Response('Invoice not found.', { status: 404 });

  const [{ data: payments }, { data: sites }] = await Promise.all([
    db.from('invoice_payments').select('*').eq('invoice_id', invoice.id).order('payment_date'),
    invoice.work_order_ids.length
      ? db.from('work_orders').select('site_name, title, client_reference, wo_number').in('id', invoice.work_order_ids).limit(1)
      : Promise.resolve({ data: [] }),
  ]);
  const site = (sites?.[0] ?? null) as Pick<WorkOrder, 'site_name' | 'title' | 'client_reference' | 'wo_number'> | null;
  const pdf = await clientInvoicePdf(invoice, (payments ?? []) as InvoicePayment[], site);
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
