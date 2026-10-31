import { createClient } from '@/lib/supabase/server';
import { getGmailAuthUrl } from '@/lib/gmail';
import { NextResponse } from 'next/server';
import { ownerOnly } from '@/lib/security';

export async function GET() {
  const supabase = await createClient('admin');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const denied = await ownerOnly(supabase);
  if (denied) return denied;

  // state carries the user id through Google's redirect so the callback can attribute
  // the resulting tokens to the right account without relying solely on session cookies.
  return NextResponse.redirect(getGmailAuthUrl(user.id));
}
