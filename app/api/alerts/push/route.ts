import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { vapidKeys } from '@/lib/push-keys';

// Phone pop-ups for project alerts (migration 119).
//   GET    → the public key the browser needs to sign up for pop-ups
//   POST   → this device's pop-up sign-up, for the signed-in office login
//   DELETE → stop pop-ups on this device ({ endpoint })
export const dynamic = 'force-dynamic';

export async function GET() {
  const { publicKey } = await vapidKeys(createAdminClient());
  return NextResponse.json({ publicKey });
}

async function signedIn() {
  const supabase = await createClient('admin');
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function POST(req: Request) {
  const user = await signedIn();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  const endpoint = String(body.endpoint ?? '');
  const p256dh = String(body.keys?.p256dh ?? '');
  const auth = String(body.keys?.auth ?? '');
  if (!/^https:\/\//.test(endpoint) || !p256dh || !auth) return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 });
  const { error } = await createAdminClient().from('push_subscriptions').upsert({
    auth_user_id: user.id, endpoint, p256dh, auth, user_agent: req.headers.get('user-agent')?.slice(0, 300) ?? null,
  }, { onConflict: 'endpoint' });
  if (error) return NextResponse.json({ ok: false, error: "Couldn't turn on pop-ups." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const user = await signedIn();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { endpoint?: string };
  await createAdminClient().from('push_subscriptions').delete().eq('endpoint', String(body.endpoint ?? '')).eq('auth_user_id', user.id);
  return NextResponse.json({ ok: true });
}
