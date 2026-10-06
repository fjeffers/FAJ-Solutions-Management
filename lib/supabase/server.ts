import { createServerClient } from '@supabase/ssr';
import { cookies, headers } from 'next/headers';
import { cookieOptionsFor, hasAdminSessionCookie, sideForApiRequest, type AuthSide } from './side';

/**
 * The signed-in user for a server route. Pass the side when a route belongs
 * to one (the office's routes 'admin', the tech portal's 'field'); otherwise
 * it's worked out from the page that made the request (lib/supabase/side.ts).
 */
export async function createClient(side?: AuthSide) {
  const cookieStore = await cookies();
  const s: AuthSide = side ?? sideForApiRequest(
    (await headers()).get('referer'),
    hasAdminSessionCookie(cookieStore.getAll().map((c) => c.name)),
  );
  const options = cookieOptionsFor(s);
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      ...(options ? { cookieOptions: options } : {}),
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {}
        },
      },
    }
  );
}
