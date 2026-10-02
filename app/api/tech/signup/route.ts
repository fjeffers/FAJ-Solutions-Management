import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { looksLikeEmail, normalizeUsername, usernameProblem } from '@/lib/usernames';

// POST /api/tech/signup — a tech makes their login: name and email, then a
// username and password (Fred, 2026-10-02).
//
// The email must be the one Fred has on their contractor record; the portal
// links the login to that record at first sign-in (tech_claim_account), the
// same as before. The username is saved here with the service key
// (migration-099), only once Supabase has actually made a new login.
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 }); }
  const name = String(body.name ?? '').trim();
  const email = String(body.email ?? '').trim();
  const username = normalizeUsername(String(body.username ?? ''));
  const password = String(body.password ?? '');

  if (name.length < 2) return NextResponse.json({ ok: false, error: 'Enter your name.' }, { status: 400 });
  if (!looksLikeEmail(email)) return NextResponse.json({ ok: false, error: 'Enter your email address — the one Fred has on file for you.' }, { status: 400 });
  const problem = usernameProblem(username);
  if (problem) return NextResponse.json({ ok: false, error: problem }, { status: 400 });
  if (password.length < 8) return NextResponse.json({ ok: false, error: 'Use a password of at least 8 characters.' }, { status: 400 });

  const admin = createAdminClient();
  const { data: taken } = await admin.from('login_usernames').select('user_id').eq('username', username).maybeSingle();
  if (taken) return NextResponse.json({ ok: false, error: `The username "${username}" is taken. Try another, like ${username}2.` }, { status: 409 });

  const origin = new URL(req.url).origin;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email, password,
    options: { emailRedirectTo: `${origin}/tech`, data: { full_name: name, username } },
  });
  if (error) {
    const m = error.message.toLowerCase();
    const msg = m.includes('rate limit') ? 'Too many tries. Wait a few minutes and try again.'
      : m.includes('password') ? 'Use a stronger password: at least 8 characters, not something common.'
      : m.includes('already registered') ? 'There is already a login for this email. Sign in instead, or use "Forgot password?".'
      : "Couldn't make your login. Check your details and try again.";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }

  // Supabase answers "fine" for an email that already has a login, but sends
  // nothing and makes nothing — it hands back a user with no identities.
  if (!data.user || (Array.isArray(data.user.identities) && data.user.identities.length === 0)) {
    return NextResponse.json({
      ok: false, reason: 'email_taken',
      error: 'There is already a login for this email, so no email was sent. Sign in with your username or email and password, or tap "Forgot password?".',
    }, { status: 409 });
  }

  const { error: nameError } = await admin.from('login_usernames').insert({ user_id: data.user.id, username });
  return NextResponse.json({
    ok: true,
    confirmEmail: !data.session,
    // Someone took the username in the same moment: the login still works by email.
    usernameSaved: !nameError,
  });
}
