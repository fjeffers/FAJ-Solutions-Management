import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

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

  const { data: newWO, error: insertError } = await supabase.from('work_orders').insert({
    user_id: user.id,
    wo_number: nextWoNumber,
    contractor_name: '',
    title: f.title ?? null,
    description: f.description ?? null,
    customer_name: f.customer_name ?? null,
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

  await supabase.from('import_queue').update({
    status: 'approved',
    reviewed_at: new Date().toISOString(),
    created_work_order_id: newWO.id,
  }).eq('id', id);

  return NextResponse.json({ ok: true, work_order_id: newWO.id, wo_number: nextWoNumber });
}
