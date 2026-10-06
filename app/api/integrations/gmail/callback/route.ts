import { exchangeCodeForTokens, getUserEmail } from '@/lib/gmail';
import { createAdminClient } from '@/lib/supabase/admin';
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const userId = searchParams.get('state'); // set by /connect
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  if (!code || !userId) {
    return NextResponse.redirect(`${baseUrl}/admin?gmail_error=missing_code`);
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const email = await getUserEmail(tokens.access_token);

    const admin = createAdminClient();
    await admin.from('gmail_connections').upsert({
      user_id: userId,
      connected_email: email,
      refresh_token: tokens.refresh_token,
      access_token: tokens.access_token,
      token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    }, { onConflict: 'user_id' });

    return NextResponse.redirect(`${baseUrl}/admin?gmail_connected=1`);
  } catch (err) {
    console.error('Gmail OAuth callback error:', err);
    return NextResponse.redirect(`${baseUrl}/admin?gmail_error=connect_failed`);
  }
}
