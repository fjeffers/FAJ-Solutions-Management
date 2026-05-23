import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

type AdminResult =
  | { ok: true; user: User }
  | { ok: false; status: 401 | 403; error: string };

export async function requireAdminUser(): Promise<AdminResult> {
  const supabase = await createClient();
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
