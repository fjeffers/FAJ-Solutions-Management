import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

// POST /api/alerts/test { project_name } — Fred sends himself (and everyone on
// that project's list) a test alert, to check pop-ups and email work. Owner
// only; it goes through the same outbox and sender as a real alert.
export async function POST(req: Request) {
  const supabase = await createClient('admin');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { project_name?: string };
  const project = String(body.project_name ?? '').trim();
  if (!project) return NextResponse.json({ ok: false, error: 'Pick a project.' }, { status: 400 });
  // The owner's own project job (RLS on the owner's session keeps it to their jobs).
  const { data: wo } = await supabase.from('work_orders').select('id, wo_number, user_id')
    .eq('user_id', user.id).eq('is_project', true).eq('project_name', project).limit(1).maybeSingle();
  if (!wo) return NextResponse.json({ ok: false, error: 'No site on that project.' }, { status: 404 });
  const { error } = await createAdminClient().from('project_alerts').insert({
    user_id: wo.user_id, wo_id: wo.id, wo_number: wo.wo_number, project_name: project, kind: 'test', tech: 'Office',
  });
  if (error) return NextResponse.json({ ok: false, error: "Couldn't send the test." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
