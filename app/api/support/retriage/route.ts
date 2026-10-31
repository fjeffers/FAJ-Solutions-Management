import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sortSafely, triageColumns } from '@/lib/support-intake';
import { ownerOnly } from '@/lib/security';

// POST /api/support/retriage { id } — "Sort again" on a ticket the bot
// couldn't sort (or sorted badly). Only a ticket still waiting for approval:
// once Fred has decided, his decision is the record.
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const supabase = await createClient('admin');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const denied = await ownerOnly(supabase);
  if (denied) return denied;

  const id = String((await req.json().catch(() => ({})))?.id ?? '');
  const { data: t } = await supabase.from('support_tickets')
    .select('id, status, from_name, from_email, subject, body').eq('id', id).maybeSingle();
  if (!t) return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
  if (t.status !== 'new') return NextResponse.json({ error: 'This ticket is already decided.' }, { status: 409 });

  const from = t.from_name ? `${t.from_name} <${t.from_email ?? ''}>` : (t.from_email ?? '');
  const outcome = await sortSafely({ from, subject: t.subject ?? '', body: t.body });
  const { error } = await supabase.from('support_tickets').update(triageColumns(outcome)).eq('id', id);
  if (error) return NextResponse.json({ error: "Couldn't save the new sorting." }, { status: 500 });
  return NextResponse.json({ ok: true, queue: outcome.result.queue, error: outcome.error });
}
