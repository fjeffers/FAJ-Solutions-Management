import { createClient } from '@/lib/supabase/server';
import { getGmailAuthUrl } from '@/lib/gmail';
import { NextResponse } from 'next/server';

export async function GET() {
  const supabase = await createClient('admin');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // state carries the user id through Google's redirect so the callback can attribute
  // the resulting tokens to the right account without relying solely on session cookies.
  return NextResponse.redirect(getGmailAuthUrl(user.id));
}
