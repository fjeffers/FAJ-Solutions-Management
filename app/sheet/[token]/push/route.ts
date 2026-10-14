import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { vapidKeys } from '@/lib/push-keys';
import { projectForToken } from '@/lib/project-sheet-load';

// Phone alerts from the live sheet itself (migration 124). Fred, 2026-10-14:
// "I want the alert to be within that sheet, not getting an email every
// time". Whoever has the link turns alerts on right on the sheet — no login.
//   GET    → the public key the phone needs
//   POST   → { endpoint, keys: { p256dh, auth } } this phone's sign-up
//   DELETE → { endpoint } stop alerts on this phone
// A sign-up belongs to the link it came through: "New link" stops it.
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();
  if (!(await projectForToken(admin, token))) return NextResponse.json({ ok: false }, { status: 404 });
  const { publicKey } = await vapidKeys(admin);
  return NextResponse.json({ ok: true, publicKey });
}

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();
  const p = await projectForToken(admin, token);
  if (!p) return NextResponse.json({ ok: false, error: 'This link no longer works.' }, { status: 404 });
  const b = (await req.json().catch(() => ({}))) as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  const endpoint = String(b.endpoint ?? '');
  const p256dh = String(b.keys?.p256dh ?? '');
  const auth = String(b.keys?.auth ?? '');
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000 || !p256dh || !auth) {
    return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 });
  }
  const { error } = await admin.from('sheet_push_subscriptions').upsert({
    user_id: p.userId, project_name: p.project, token, endpoint, p256dh, auth,
    user_agent: req.headers.get('user-agent')?.slice(0, 300) ?? null,
  }, { onConflict: 'endpoint' });
  if (error) return NextResponse.json({ ok: false, error: "Couldn't turn on alerts." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const b = (await req.json().catch(() => ({}))) as { endpoint?: string };
  await createAdminClient().from('sheet_push_subscriptions').delete().eq('endpoint', String(b.endpoint ?? '')).eq('token', token);
  return NextResponse.json({ ok: true });
}
