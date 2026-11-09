import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { deriveSiteName } from '@/lib/visits';
import { nextFreeWorkOrderNumber } from '@/lib/wo-number';
import { ownerOnly } from '@/lib/security';

type SourceDocument = { name?: unknown; url?: unknown; category?: unknown };

const safeDocName = (value: unknown, url: string) => {
  const fromUrl = decodeURIComponent(new URL(url).pathname.split('/').pop() || 'SimplySub document.pdf');
  const supplied = typeof value === 'string' ? value.trim() : '';
  const name = supplied && !/^\*+\s*workorder\s*\*+$/i.test(supplied) ? supplied : fromUrl;
  return name.replace(/[^\w .()&,'-]/g, '').slice(0, 116).replace(/\.pdf$/i, '') + '.pdf';
};

async function copySimplySubPdfs(
  supabase: Awaited<ReturnType<typeof createClient>>,
  docs: SourceDocument[],
  userId: string,
  woId: string,
) {
  let copied = 0;
  for (const [index, doc] of docs.slice(0, 20).entries()) {
    const rawUrl = typeof doc.url === 'string' ? doc.url : '';
    let url: URL;
    try { url = new URL(rawUrl); } catch { continue; }
    if (url.protocol !== 'https:' || url.hostname !== 'cdn.simplysub.com') continue;
    try {
      const res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
      const length = Number(res.headers.get('content-length') || 0);
      const isPdf = res.headers.get('content-type')?.toLowerCase().includes('application/pdf') || /\.pdf$/i.test(url.pathname);
      if (!res.ok || !isPdf || length > 15_000_000) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length === 0 || bytes.length > 15_000_000 || String.fromCharCode(...bytes.slice(0, 4)) !== '%PDF') continue;
      const name = safeDocName(doc.name, rawUrl);
      const path = `${userId}/${woId}/simplysub-${Date.now()}-${index}.pdf`;
      const { error: uploadError } = await supabase.storage.from('job-docs').upload(path, bytes, {
        contentType: 'application/pdf',
        upsert: false,
      });
      if (uploadError) continue;
      const kind = typeof doc.category === 'string' ? doc.category.slice(0, 40) : 'SimplySub';
      const { error: rowError } = await supabase.from('job_docs').insert({
        user_id: userId, wo_id: woId, path, name, kind, bytes: bytes.length, sent_by: 'SimplySub import',
      });
      if (rowError) {
        await supabase.storage.from('job-docs').remove([path]);
        continue;
      }
      copied += 1;
    } catch {
      // Source files are best-effort. The original URL remains on the work order.
    }
  }
  return copied;
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient('admin');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const denied = await ownerOnly(supabase);
  if (denied) return denied;

  const { data: item } = await supabase
    .from('import_queue')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (item.status !== 'pending') return NextResponse.json({ error: 'Already reviewed' }, { status: 400 });

  const f = item.parsed_fields;

  // The next WO number and the customer lookup don't depend on each other, and
  // Fred is watching a button spin — run them together.
  const [{ data: wos }, custRes] = await Promise.all([
    supabase.from('work_orders').select('wo_number').order('wo_number'),
    f.customer_name?.trim()
      ? supabase.rpc('customer_resolve_or_create', { p_user_id: user.id, p_name: f.customer_name })
      : Promise.resolve({ data: null, error: null }),
  ]);

  // The same rule every other creation path uses, so an approved import gets a
  // number that fits FAJ's sequence and can't collide with an existing job.
  const nextWoNumber = nextFreeWorkOrderNumber((wos ?? []).map((w) => w.wo_number));

  // Folding 'Wendys' onto the canonical "Wendy's" is best-effort: an unmatched
  // name must never block the work order.
  if (custRes.error) console.error('customer_resolve_or_create failed:', custRes.error);
  const customerId = (custRes.data as string | null) ?? null;

  const SOURCE_PLATFORM_MAP: Record<string, string> = {
    netview_smartsheet: 'NetView',
    field_nation: 'FieldNation',
    google_sheets: 'Internal',
    google_docs: 'Internal',
    simplysub: 'NetView',
  };

  const { data: newWO, error: insertError } = await supabase.from('work_orders').insert({
    user_id: user.id,
    wo_number: nextWoNumber,
    contractor_name: '',
    title: f.title ?? null,
    description: f.description ?? null,
    customer_name: f.customer_name ?? null,
    customer_id: customerId,
    client_reference: f.client_reference ?? null,
    external_wo_id: f.external_wo_id ?? null,
    source_platform: SOURCE_PLATFORM_MAP[item.source] ?? 'Internal',
    start_date: f.start_date ?? null,
    // Location, when the email stated it (a go-back list gives one per site).
    site_name: f.site_name ?? null,
    site_address: f.site_address ?? null,
    site_city: f.city || null,
    site_state: f.state || null,
    site_zip: f.zip || null,
    total_amount: typeof f.total_amount === 'number' && !isNaN(f.total_amount) ? f.total_amount : 0,
    pay_type: 'Fixed',
    wo_status: 'Open',
    assignment_type: 'Internal',
    priority: 'Normal',
    schedule_type: 'Exact Time',
    ...(Array.isArray(f.wo_tasks) ? { wo_tasks: f.wo_tasks } : {}),
    ...(Array.isArray(f.custom_qa) ? { custom_qa: f.custom_qa } : {}),
    ...(Array.isArray(f.client_links) ? { client_links: f.client_links } : {}),
    ...(f.deliverable_link ? { deliverable_link: f.deliverable_link } : {}),
    ...(f.deliverables ? { deliverables: f.deliverables } : {}),
    ...(Array.isArray(f.source_documents)
      ? { doc_urls: f.source_documents.map((d: { url?: unknown }) => d.url).filter((u: unknown): u is string => typeof u === 'string') }
      : {}),
  }).select('id').single();

  if (insertError || !newWO) {
    return NextResponse.json({ error: insertError?.message ?? 'Failed to create work order' }, { status: 500 });
  }

  const copiedDocuments = item.source === 'simplysub' && Array.isArray(f.source_documents)
    ? await copySimplySubPdfs(supabase, f.source_documents, user.id, newWO.id)
    : 0;

  // Open a site visit alongside the work order, so the location Fred is driving
  // to is tracked from the moment of import rather than remembered later. It
  // starts un-invoiced with no hours; the Site Log's Check In fills those in.
  // Non-fatal for the same reason as above — the work order is what matters.
  // Prefer the site name the email actually gave; fall back to parsing the title.
  const siteLabel = f.site_name || deriveSiteName(f.title, f.customer_name);
  const [{ error: visitError }] = await Promise.all([
    supabase.from('site_visits').insert({
      user_id: user.id,
      customer_id: customerId,
      program: f.customer_name?.trim() || null,
      site_code: f.client_reference?.trim() || null,
      site_name: siteLabel,
      address: f.site_address ?? null,
      visit_date: f.start_date ?? null,
      visit_type: 'Project',
      invoice_status: 'not_invoiced',
      payment_status: 'unpaid',
      work_order_id: newWO.id,
      notes: f.title ?? null,
    }),
    supabase.from('import_queue').update({
      status: 'approved',
      reviewed_at: new Date().toISOString(),
      created_work_order_id: newWO.id,
    }).eq('id', id),
  ]);
  if (visitError) console.error('site_visits insert failed:', visitError);

  return NextResponse.json({
    ok: true,
    work_order_id: newWO.id,
    wo_number: nextWoNumber,
    customer_id: customerId,
    site_visit_created: !visitError,
    copied_documents: copiedDocuments,
  });
}
