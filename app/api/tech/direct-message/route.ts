import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { ownerOnly } from '@/lib/security';
import { directThreadId } from '@/lib/messages-inbox';
import { directMessagePush, pushToUser } from '@/lib/tech-push';

// A private office-to-technician message that is not tied to a work order.
export async function POST(req: Request) {
  const supabase = await createClient('admin');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  const denied = await ownerOnly(supabase);
  if (denied) return denied;

  const body = (await req.json().catch(() => ({}))) as { contractor_id?: unknown; content?: unknown };
  const contractorId = String(body.contractor_id ?? '');
  const content = String(body.content ?? '').trim().slice(0, 4000);
  if (!contractorId || !content) return NextResponse.json({ ok: false }, { status: 400 });

  const admin = createAdminClient();
  const { data: contractor } = await admin.from('contractors').select('id, name, auth_user_id')
    .eq('id', contractorId).eq('user_id', user.id).maybeSingle();
  const tech = contractor as { id: string; name: string; auth_user_id: string | null } | null;
  if (!tech) return NextResponse.json({ ok: false }, { status: 404 });

  const { data: message, error } = await admin.from('work_order_messages').insert({
    user_id: user.id,
    work_order_id: directThreadId(tech.id),
    sender_email: user.email ?? null,
    sender_name: 'FAJ Solutions',
    sender_role: 'admin',
    content,
  }).select('id, work_order_id, sender_name, sender_role, content, read_at, created_at').single();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  let pushed = 0;
  if (tech.auth_user_id) {
    try { pushed = await pushToUser(admin, tech.auth_user_id, directMessagePush(content)); } catch { /* the message still stays in the inbox */ }
  }
  return NextResponse.json({ ok: true, message, pushed, connected: !!tech.auth_user_id });
}
