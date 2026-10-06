import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookieOptionsFor, sideForPath, type AuthSide } from './side';

// One client per sign-in (lib/supabase/side.ts): the office's at /admin, the
// tech portal's everywhere else. The library's own single shared client is
// switched off, or the first side used on a page load would serve both.
const clients: Partial<Record<AuthSide, SupabaseClient>> = {};

export function createClient(side?: AuthSide): SupabaseClient {
  const s: AuthSide = side ?? (typeof window !== 'undefined' ? sideForPath(window.location.pathname) : 'field');
  const cached = clients[s];
  if (cached) return cached;
  const options = cookieOptionsFor(s);
  const client = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { isSingleton: false, ...(options ? { cookieOptions: options } : {}) },
  );
  if (typeof window !== 'undefined') clients[s] = client;
  return client;
}
