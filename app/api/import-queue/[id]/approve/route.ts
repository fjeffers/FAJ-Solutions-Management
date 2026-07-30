import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { deriveSiteName } from '@/lib/visits';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: item } = await supabase
    .from('import_queue')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (item.status !== 'pending') return NextResponse.json({ error: 'Already reviewed' }, { status: 400 });

  const f = item.parsed_fields;
  const { data: wos } = await supabase.from('work_orders').select('wo_number').order('wo_number');
  const nums = (wos ?? []).map((w) => parseInt(w.wo_number, 10)).filter((n) => !isNaN(n));
  const nextWoNumber = nums.length > 0 ? String(Math.max(...nums) + 1) : '1001';

  const SOURCE_PLATFORM_MAP: Record<string, string> = {
    netview_smartsheet: 'NetView',
    field_nation: 'FieldNation',
    google_sheets: 'Internal',
    google_docs: 'Internal',
  };

  // Fold the incoming customer name onto the canonical customer record, so a job
  // for 'Wendys' lands on the same customer as "Wendy's" (migration 046/049).
  // Non-fatal: an unmatched name must never block the import.
  let customerId: string | null = null;
  if (f.customer_name?.trim()) {
    const { data: cid, error: custErr } = await supabase.rpc('customer_resolve_or_create', {
      p_user_id: user.id,
      p_name: f.customer_name,
    });
    if (custErr) console.error('customer_resolve_or_create failed:', custErr);
    else customerId = (cid as string | null) ?? null;
  }

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
    total_amount: typeof f.total_amount === 'number' && !isNaN(f.total_amount) ? f.total_amount : 0,
    pay_type: 'Fixed',
    wo_status: 'Open',
    assignment_type: 'Internal',
    priority: 'Normal',
    schedule_type: 'Exact Time',
  }).select('id').single();

  if (insertError || !newWO) {
    return NextResponse.json({ error: insertError?.message ?? 'Failed to create work order' }, { status: 500 });
  }

  // Open a site visit alongside the work order, so the location Fred is driving
  // to is tracked from the moment of import rather than remembered later. It
  // starts un-invoiced with no hours; the Site Log's Check In fills those in.
  // Non-fatal for the same reason as above — the work order is what matters.
  const siteLabel = deriveSiteName(f.title, f.customer_name);
  const { error: visitError } = await supabase.from('site_visits').insert({
    user_id: user.id,
    customer_id: customerId,
    program: f.customer_name?.trim() || null,
    site_code: f.client_reference?.trim() || null,
    site_name: siteLabel,
    visit_date: f.start_date ?? null,
    visit_type: 'Project',
    invoice_status: 'not_invoiced',
    payment_status: 'unpaid',
    work_order_id: newWO.id,
    notes: f.title ?? null,
  });
  if (visitError) console.error('site_visits insert failed:', visitError);

  await supabase.from('import_queue').update({
    status: 'approved',
    reviewed_at: new Date().toISOString(),
    created_work_order_id: newWO.id,
  }).eq('id', id);

  return NextResponse.json({
    ok: true,
    work_order_id: newWO.id,
    wo_number: nextWoNumber,
    customer_id: customerId,
    site_visit_created: !visitError,
  });
}
