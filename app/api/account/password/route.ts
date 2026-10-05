import { NextResponse } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { passwordProblem } from '@/lib/password-rules';

// POST /api/account/password { current, next, confirm } — change your own
// password while signed in, for the owner and for techs (Fred, 2026-10-05:
// "whenever I try changing the PW it doesn't take, both for myself and tech").
//
// The browser used to call supabase.auth.updateUser on its own. Supabase
// refuses that for a sign-in that isn't fresh (it wants proof it's really you),
// so the change quietly never happened. Here the server checks the CURRENT
// password itself, on a throwaway client that never touches the signed-in
// cookies, and only then sets the new one with the service key. A wrong
// current password changes nothing.
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let body: { current?: unknown; next?: unknown; confirm?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 }); }
  const current = String(body.current ?? '');
  const next = String(body.next ?? '');
  const confirm = String(body.confirm ?? '');

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return NextResponse.json({ ok: false, error: 'Sign in again, then change your password.' }, { status: 401 });

  const problem = passwordProblem(next, confirm, current);
  if (problem) return NextResponse.json({ ok: false, error: problem }, { status: 400 });

  // Check the current password without touching this browser's sign-in.
  const check = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error: wrong } = await check.auth.signInWithPassword({ email: user.email, password: current });
  if (wrong) {
    const m = wrong.message.toLowerCase();
    const msg = m.includes('rate limit') || m.includes('too many')
      ? 'Too many tries. Wait a minute and try again.'
      : "Your current password isn't right. Try again, or sign out and use \"Forgot password?\".";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
  // End only that check's own sign-in; the user's real sign-in stays.
  await check.auth.signOut({ scope: 'local' }).catch(() => {});

  const { error } = await createAdminClient().auth.admin.updateUserById(user.id, { password: next });
  if (error) {
    return NextResponse.json({ ok: false, error: `The password wasn't changed: ${error.message}` }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
