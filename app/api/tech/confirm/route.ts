import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET /api/tech/confirm?token_hash=…&type=signup — the link in the "Confirm
// your FAJ tech login" email (app/api/tech/signup). It confirms the email and
// signs the tech in on this phone, then opens their jobs; /tech links the
// login to their tech record (tech_claim_account). A used or old link goes to
// the sign-in page: if the email is already confirmed, signing in just works.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const tokenHash = url.searchParams.get('token_hash') ?? '';
  const type = url.searchParams.get('type') === 'email' ? 'email' : 'signup';
  if (!tokenHash) return NextResponse.redirect(new URL('/tech/login', url.origin));
  const supabase = await createClient('field');
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  return NextResponse.redirect(new URL(error ? '/tech/login?confirm=again' : '/tech', url.origin));
}
