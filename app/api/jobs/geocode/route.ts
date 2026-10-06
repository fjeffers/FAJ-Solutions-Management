import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { geocodeSite, siteLine } from '@/lib/geocode-server';

// POST /api/jobs/geocode — find the map position of live jobs that have a
// street address but no position yet, so techs see how far away a job is
// (Fred, 2026-10-04). The owner app calls it in the background once a session.
// Owner rows only (RLS); a dozen per call so it never runs long.
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST() {
  const supabase = await createClient('admin');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: rows, error } = await supabase.from('work_orders')
    .select('id, site_address, site_city, site_state, site_zip, wo_status')
    .eq('user_id', user.id)
    .is('archived_at', null)
    .is('site_lat', null)
    .not('site_address', 'is', null)
    .or('wo_status.is.null,wo_status.not.in.(Approved,Paid,Cancelled)')
    .order('updated_at', { ascending: false })
    .limit(12);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let found = 0;
  for (const w of rows ?? []) {
    const line = siteLine(w);
    if (!line) continue;
    const hit = await geocodeSite(line);
    if (!hit) continue;
    const { error: upErr } = await supabase.from('work_orders')
      .update({ site_lat: hit.lat, site_lng: hit.lng }).eq('id', w.id).is('site_lat', null);
    if (!upErr) found++;
  }
  return NextResponse.json({ ok: true, checked: rows?.length ?? 0, found });
}
