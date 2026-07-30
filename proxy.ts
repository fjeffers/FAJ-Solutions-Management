import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  const { pathname } = request.nextUrl;

  // Pages that must work without a session. Token-gated pages authorise
  // themselves against an unguessable token, and the password-reset pages are
  // by definition reached while logged out.
  //
  // ANY new public page goes in this list. It used to be a chain of
  // `isInvoiceRoute`-style booleans, which drifted: the name stopped describing
  // the set once the site report joined it, and both password-reset routes had
  // been missed entirely — a logged-out user following a reset link was bounced
  // to /login.
  const PUBLIC_PREFIXES = [
    '/portal/',        // contractor + helper portal
    '/invoice/',       // client invoice
    '/billing/',       // billing helper
    '/quote/',         // client quote
    '/site-report/',   // client site activity report
    '/reset-password', // request a reset — always logged out
    '/update-password',// set the new password from the emailed link
  ];

  const isAuthRoute = pathname.startsWith('/login');
  const isApiRoute  = pathname.startsWith('/api');

  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return response;

  if (!user && !isAuthRoute && !isApiRoute) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  if (user && isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // sw.js/manifest.json/icons must be served without an auth redirect, otherwise
  // the browser refuses to register the service worker ("behind a redirect").
  matcher: ['/((?!_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.json|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
