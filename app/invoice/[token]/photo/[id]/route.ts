import { createAdminClient } from '@/lib/supabase/admin';
import { clientReceiptPhotoFilename } from '@/lib/client-invoice-pdf';
import type { Invoice, WorkOrder } from '@/lib/types';
import { jobLogPhotoLabel } from '@/lib/job-log-photo-label';

export const dynamic = 'force-dynamic';

type Photo = { id: string; wo_id: string; url: string; taken_at: string };
type ReceiptWorkOrder = Pick<WorkOrder,
  'id' | 'site_name' | 'site_city' | 'site_state' | 'title' | 'client_reference' | 'wo_number' | 'job_log_receipt_photos' | 'job_log_left_out'
>;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string; id: string }> },
) {
  const { token, id } = await params;
  if (!token || token.length < 16 || !id) return new Response('Receipt not found.', { status: 404 });

  const db = createAdminClient();
  const [{ data: invoice }, { data: photo }] = await Promise.all([
    db.from('invoices').select('*').eq('share_token', token).maybeSingle<Invoice>(),
    db.from('wo_photos').select('id, wo_id, url, taken_at').eq('id', id).maybeSingle<Photo>(),
  ]);
  if (!invoice || !photo || !invoice.work_order_ids.includes(photo.wo_id)) {
    return new Response('Receipt not found.', { status: 404 });
  }

  const { data: site } = await db.from('work_orders')
    .select('id, site_name, site_city, site_state, title, client_reference, wo_number, job_log_receipt_photos, job_log_left_out')
    .eq('id', photo.wo_id).maybeSingle<ReceiptWorkOrder>();
  const meta = jobLogPhotoLabel(site?.job_log_receipt_photos ?? [], photo.id);
  if (!site || meta.kind === 'photo' || meta.kind === 'odometer' || new Set(site.job_log_left_out ?? []).has(`photo:${photo.id}`)) {
    return new Response('Receipt not found.', { status: 404 });
  }

  let source: URL;
  try { source = new URL(photo.url); } catch { return new Response('Receipt not found.', { status: 404 }); }
  if (source.protocol !== 'https:' || !source.hostname.endsWith('.supabase.co')) {
    return new Response('Receipt not found.', { status: 404 });
  }
  const file = await fetch(source, { cache: 'no-store' });
  if (!file.ok) return new Response('Receipt not found.', { status: 404 });

  const filename = clientReceiptPhotoFilename(invoice, { taken_at: photo.taken_at, url: photo.url, kind: meta.kind, vendor: meta.vendor }, site);
  const asciiFilename = filename.replace(/[^\x20-\x7E]/g, ' ').replace(/"/g, '').replace(/\s+/g, ' ').trim() || 'Receipt photo.jpg';
  return new Response(await file.arrayBuffer(), {
    headers: {
      'content-type': file.headers.get('content-type') || 'application/octet-stream',
      'content-disposition': `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'cache-control': 'private, no-store',
    },
  });
}
