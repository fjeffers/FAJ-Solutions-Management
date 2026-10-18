import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// Job emails from Fred's Gmail (migration 134; Fred, 2026-10-18: "find the job
// emails for me"). The Google script in Fred's own account (lib/inbox-script.ts)
// calls this with its private key:
//   GET  /api/inbox?key=…   which emails to look for (the search kept in the app)
//   POST /api/inbox         { key, emails: [{ id, from, subject, at, body }] }
// The key is checked in the database (inbox_settings / inbox_add); without the
// right key nothing is read or written. No login: the script has none.

const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
const goodKey = (k: unknown): k is string => typeof k === 'string' && /^[a-f0-9]{40,100}$/.test(k);
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get('key');
  if (!goodKey(key)) return NextResponse.json({ ok: false }, { status: 403 });
  const { data, error } = await db().rpc('inbox_settings', { p_token: key });
  const r = (data ?? {}) as { ok?: boolean; query?: string };
  if (error || !r.ok) return NextResponse.json({ ok: false }, { status: 403 });
  return NextResponse.json({ ok: true, query: r.query });
}

export async function POST(req: Request) {
  let body: { key?: unknown; emails?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'bad_json' }, { status: 400 }); }
  if (!goodKey(body.key)) return NextResponse.json({ ok: false }, { status: 403 });
  if (!Array.isArray(body.emails)) return NextResponse.json({ ok: false, error: 'no_emails' }, { status: 400 });
  const emails = body.emails.slice(0, 50).flatMap((e) => {
    if (!e || typeof e !== 'object') return [];
    const x = e as Record<string, unknown>;
    const id = text(x.id, 100);
    if (!id) return [];
    return [{ id, from: text(x.from, 400), subject: text(x.subject, 500), at: text(x.at, 40), body: text(x.body, 30000) }];
  });
  const { data, error } = await db().rpc('inbox_add', { p_token: body.key, p_emails: emails });
  const r = (data ?? {}) as { ok?: boolean; added?: number };
  if (error || !r.ok) return NextResponse.json({ ok: false }, { status: 403 });
  return NextResponse.json({ ok: true, added: r.added ?? 0 });
}
