import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { splitPastedEmail } from '@/lib/email-parsers/pasted';
import { fileSupportTicket } from '@/lib/support-intake';

// POST /api/support/from-email — paste an email (or drop a .eml) into the
// Support inbox. The bot sorts it and files it as a new ticket for Fred to
// approve, exactly like one read from support@ (migration-104). Owner only:
// the insert runs under Fred's own session, so the row is his by RLS.
export const dynamic = 'force-dynamic';
const MAX_BYTES = 2 * 1024 * 1024;

export async function POST(req: Request) {
  const supabase = await createClient('admin');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let raw = '';
  if ((req.headers.get('content-type') ?? '').includes('application/json')) {
    raw = String((await req.json().catch(() => ({})))?.raw ?? '');
  } else {
    const file = (await req.formData()).get('file');
    if (file instanceof File) {
      if (file.size > MAX_BYTES) return NextResponse.json({ error: 'That file is larger than 2MB.' }, { status: 400 });
      raw = await file.text();
    }
  }
  if (!raw.trim()) return NextResponse.json({ error: 'Paste the email first.' }, { status: 400 });

  const e = splitPastedEmail(raw.slice(0, 200_000));
  if (!e.body.trim() && !e.subject.trim()) return NextResponse.json({ error: "Couldn't find any text in that email." }, { status: 400 });
  try {
    const ticket = await fileSupportTicket(supabase, user.id, { from: e.sender, subject: e.subject, body: e.body || e.subject }, 'pasted');
    return NextResponse.json({ ok: true, ticket });
  } catch (err) {
    console.error('Support paste failed:', err);
    return NextResponse.json({ error: "Couldn't make the ticket. Try again." }, { status: 500 });
  }
}
