import { NextResponse } from 'next/server';
import { emailClient } from '@/lib/email-client';
import { createAdminClient } from '@/lib/supabase/admin';
import { looksLikeEmail, normalizeUsername, usernameProblem } from '@/lib/usernames';
import { confirmLoginEmail } from '@/lib/tech-app-email';

// POST /api/tech/signup — a tech makes their login: name and email, then a
// username and password (Fred, 2026-10-02).
//
// The email must be the one Fred has on their contractor record; the portal
// links the login to that record at first sign-in (tech_claim_account), the
// same as before. The username is saved here with the service key
// (migration-099), only once Supabase has actually made a new login.
//
// The confirmation link goes out from FAJ's own email (Resend), not Supabase's
// built-in mailer: that one sends a few emails an hour from a Supabase
// address, and Kendell's never reached him on the first morning of the LDS
// jobs (Fred, 2026-10-19). The link opens /api/tech/confirm, which confirms
// the email and signs the tech straight in.
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

  // No email key: stop before the login is made, so a later try isn't told the email is taken.
  const resend = emailClient();
  if (!resend) return NextResponse.json({ ok: false, error: "Sign-up can't send its confirmation email right now. Tell Fred: email isn't set up on the server." }, { status: 503 });

  const origin = new URL(req.url).origin;
  // Makes the login (not yet confirmed) and hands back its confirmation token, sending nothing.
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'signup', email, password,
    options: { redirectTo: `${origin}/tech`, data: { full_name: name, username } },
  });
  if (error || !data?.user || !data.properties?.hashed_token) {
    const m = (error?.message ?? '').toLowerCase();
    if (m.includes('already') || error?.code === 'email_exists') {
      return NextResponse.json({
        ok: false, reason: 'email_taken',
        error: 'There is already a login for this email, so no email was sent. Sign in with your username or email and password, or tap "Forgot password?".',
      }, { status: 409 });
    }
    const msg = m.includes('rate limit') ? 'Too many tries. Wait a few minutes and try again.'
      : m.includes('password') ? 'Use a stronger password: at least 8 characters, not something common.'
      : "Couldn't make your login. Check your details and try again.";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }

  const link = `${origin}/api/tech/confirm?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=signup`;
  const mail = confirmLoginEmail({ name, link, username });
  const { error: sendError } = await resend.emails.send({
    from: process.env.FROM_EMAIL || 'FAJ Solutions <support@fajsolutions.com>',
    to: email,
    replyTo: process.env.REPLY_TO_EMAIL || undefined,
    subject: mail.subject,
    html: mail.html,
  });
  if (sendError) {
    // No email went out, so take the half-made login back off: the tech can simply try again.
    await admin.auth.admin.deleteUser(data.user.id);
    return NextResponse.json({ ok: false, error: "Couldn't send the confirmation email. Check the email address and try again." }, { status: 502 });
  }

  const { error: nameError } = await admin.from('login_usernames').insert({ user_id: data.user.id, username });
  return NextResponse.json({
    ok: true,
    confirmEmail: true,
    // Someone took the username in the same moment: the login still works by email.
    usernameSaved: !nameError,
  });
}
