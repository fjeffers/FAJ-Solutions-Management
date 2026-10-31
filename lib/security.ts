import type { SupabaseClient, User } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

type AdminResult =
  | { ok: true; user: User }
  | { ok: false; status: 401 | 403; error: string };

export async function requireAdminUser(): Promise<AdminResult> {
  const supabase = await createClient('admin');
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user?.email) {
    return { ok: false, status: 401, error: 'Authentication required' };
  }

  const adminEmail = process.env.ADMIN_EMAIL ?? process.env.NEXT_PUBLIC_ADMIN_EMAIL;
  if (adminEmail) {
    return user.email.toLowerCase() === adminEmail.toLowerCase()
      ? { ok: true, user }
      : { ok: false, status: 403, error: 'Admin access required' };
  }

  const { data: contractor } = await supabase
    .from('contractors')
    .select('id')
    .eq('email', user.email)
    .maybeSingle();

  if (contractor) {
    return { ok: false, status: 403, error: 'Admin access required' };
  }

  return { ok: true, user };
}

export function parseEmailList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value.join(',') : String(value ?? '');
  return raw
    .split(',')
    .map((email) => email.trim())
    .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
}

/**
 * Office-only server routes: signed in is not enough, it must be the business
 * owner's login (Fred, 2026-10-31: "tech only see the tech app and admin only
 * me"). A tech or staff login gets 403. If the role can't be checked, the
 * route refuses rather than guessing. Returns the refusal, or null to go on.
 */
export async function ownerOnly(supabase: Pick<SupabaseClient, 'rpc'>): Promise<NextResponse | null> {
  const { data, error } = await supabase.rpc('wf_role');
  if (error) {
    return NextResponse.json({ ok: false, error: "Couldn't check who is signed in. Try again." }, { status: 503 });
  }
  if ((data as { role?: string } | null)?.role !== 'owner') {
    return NextResponse.json({ ok: false, error: 'Only the administrator login can do this.' }, { status: 403 });
  }
  return null;
}
