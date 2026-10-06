import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { looksLikeEmail, normalizeUsername } from '@/lib/usernames';

// POST /api/tech/login — sign in to the tech portal with a username (or email)
// and password (Fred, 2026-10-02: "user name and password").
//
// Supabase signs in by email, so a username is looked up here, on the server,
// with the service key (migration-099). The browser never learns which email a
// username belongs to, and every failure reads the same, so this cannot be used
// to find out who has a login. The session cookies are set on this response,
// exactly as a sign-in from the browser would set them.
const NO_MATCH = "That username and password don't match. Try again, or use \"Forgot password?\".";

export async function POST(req: Request) {
  let body: { login?: unknown; password?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 }); }
  const login = String(body.login ?? '').trim();
  const password = String(body.password ?? '');
  if (!login || !password) return NextResponse.json({ ok: false, error: 'Enter your username and password.' }, { status: 400 });

  let email = login;
  if (!looksLikeEmail(login)) {
    const admin = createAdminClient();
    const { data: row } = await admin.from('login_usernames').select('user_id').eq('username', normalizeUsername(login)).maybeSingle();
    if (!row?.user_id) return NextResponse.json({ ok: false, error: NO_MATCH }, { status: 401 });
    const { data: found } = await admin.auth.admin.getUserById(row.user_id);
    if (!found?.user?.email) return NextResponse.json({ ok: false, error: NO_MATCH }, { status: 401 });
    email = found.user.email;
  }

  const supabase = await createClient('field');
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    const m = error.message.toLowerCase();
    const msg = m.includes('email not confirmed')
      ? "Confirm your email first: open the link we emailed you when you made your login, then sign in."
      : m.includes('rate limit') || m.includes('too many')
        ? 'Too many tries. Wait a minute and try again.'
        : NO_MATCH;
    return NextResponse.json({ ok: false, error: msg }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}
