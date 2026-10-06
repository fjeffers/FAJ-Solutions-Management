import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const woId = searchParams.get('wo_id');

  if (!woId) {
    return NextResponse.json({ error: 'wo_id is required' }, { status: 400 });
  }

  const supabase = await createClient('admin');

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Verify the WO belongs to this user before returning time logs
  const { data: wo } = await supabase
    .from('work_orders')
    .select('id')
    .eq('id', woId)
    .eq('user_id', user.id)
    .single();

  if (!wo) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const { data, error } = await supabase
    .from('contractor_time_logs')
    .select('*')
    .eq('wo_id', woId)
    .order('created_at', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}
