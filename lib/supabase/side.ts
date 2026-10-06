// Two separate sign-ins (Fred, 2026-10-06: "this login should be separated
// from admin and tech, and the tech should not see the admin login or
// anything about admin").
//
//   'admin'  the office at /admin. Its own cookie, ADMIN_AUTH_COOKIE.
//   'field'  everything else: the tech portal (/tech), the assistant and
//            accountant sections. Supabase's default cookie, unchanged, so
//            nobody already signed in there was signed out by this.
//
// One browser can now hold both at once — Fred's office login and his tech
// login — and signing in or out on one side never touches the other.
//
// Pages pick their side by address. A request to /api picks it by the page it
// came from (the Referer; same-origin requests always carry the full address
// under the app's Referrer-Policy); with no Referer, the office's sign-in is
// used if this browser has one.

export type AuthSide = 'admin' | 'field';

export const ADMIN_AUTH_COOKIE = 'sb-faj-admin-auth-token';

/** The side a page belongs to. `/` and `/login` only forward into the office. */
export function sideForPath(pathname: string): AuthSide {
  return pathname === '/admin' || pathname.startsWith('/admin/') || pathname === '/' || pathname === '/login' || pathname.startsWith('/login/')
    ? 'admin' : 'field';
}

/** The side an /api request belongs to. */
export function sideForApiRequest(referer: string | null | undefined, hasAdminCookie: boolean): AuthSide {
  if (referer) {
    try { return sideForPath(new URL(referer).pathname); } catch { /* not a URL — fall through */ }
  }
  return hasAdminCookie ? 'admin' : 'field';
}

export function hasAdminSessionCookie(cookieNames: string[]): boolean {
  return cookieNames.some((n) => n === ADMIN_AUTH_COOKIE || n.startsWith(`${ADMIN_AUTH_COOKIE}.`));
}

/** The cookie options for a side: a name for the office, Supabase's default otherwise. */
export function cookieOptionsFor(side: AuthSide): { name: string } | undefined {
  return side === 'admin' ? { name: ADMIN_AUTH_COOKIE } : undefined;
}
