import { exchangeCodeForTokens, getCompanyName } from '@/lib/quickbooks';
import { createAdminClient } from '@/lib/supabase/admin';
import { NextResponse } from 'next/server';

// Start against Sandbox until verified (see Phase 11 plan notes) — flip via env var once ready.
const ENVIRONMENT = (process.env.QBO_ENVIRONMENT === 'production' ? 'production' : 'sandbox') as 'sandbox' | 'production';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const realmId = searchParams.get('realmId');
  const userId = searchParams.get('state');
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  if (!code || !realmId || !userId) {
    return NextResponse.redirect(`${baseUrl}/?qbo_error=missing_params`);
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const companyName = await getCompanyName(ENVIRONMENT, realmId, tokens.access_token);

    const admin = createAdminClient();
    await admin.from('quickbooks_connections').upsert({
      user_id: userId,
      realm_id: realmId,
      company_name: companyName,
      environment: ENVIRONMENT,
      refresh_token: tokens.refresh_token,
      access_token: tokens.access_token,
      token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      connected_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });

    return NextResponse.redirect(`${baseUrl}/?qbo_connected=1`);
  } catch (err) {
    console.error('QuickBooks OAuth callback error:', err);
    return NextResponse.redirect(`${baseUrl}/?qbo_error=connect_failed`);
  }
}
