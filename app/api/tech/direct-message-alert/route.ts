import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { directThreadId } from '@/lib/messages-inbox';
import { ownerDirectMessagePush, pushToUser } from '@/lib/tech-push';

// A signed-in technician just replied in the private FAJ thread. The message is
// already in Supabase; this route verifies that row, then rings the owner's app.
export async function POST(req: Request) {
  const supabase = await createClient('field');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { content?: unknown };
  const content = String(body.content ?? '').trim().slice(0, 4000);
  if (!content) return NextResponse.json({ ok: false }, { status: 400 });

  const admin = createAdminClient();
  const { data: contractor } = await admin.from('contractors').select('id, name, user_id')
    .eq('auth_user_id', user.id).maybeSingle();
  const tech = contractor as { id: string; name: string; user_id: string } | null;
  if (!tech) return NextResponse.json({ ok: false }, { status: 403 });

  const since = new Date(Date.now() - 2 * 60_000).toISOString();
  const { data: saved } = await admin.from('work_order_messages').select('id')
    .eq('user_id', tech.user_id)
    .eq('work_order_id', directThreadId(tech.id))
    .eq('sender_role', 'contractor')
    .eq('content', content)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!saved) return NextResponse.json({ ok: false }, { status: 409 });

  let pushed = 0;
  try { pushed = await pushToUser(admin, tech.user_id, ownerDirectMessagePush(tech.name, content)); } catch { /* reply is still saved */ }
  return NextResponse.json({ ok: true, pushed });
}
