import { createAdminClient } from '@/lib/supabase/admin';
import { refreshAccessToken } from '@/lib/quickbooks';

/** Loads a user's QBO connection and returns a guaranteed-valid access token, refreshing if needed. */
export async function getValidQboSession(userId: string) {
  const admin = createAdminClient();
  const { data: conn } = await admin.from('quickbooks_connections').select('*').eq('user_id', userId).single();
  if (!conn) return null;

  let accessToken = conn.access_token as string;
  if (!conn.token_expires_at || new Date(conn.token_expires_at) <= new Date()) {
    const refreshed = await refreshAccessToken(conn.refresh_token);
    accessToken = refreshed.access_token;
    await admin.from('quickbooks_connections').update({
      access_token: accessToken,
      token_expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
    }).eq('id', conn.id);
  }

  return { ...conn, access_token: accessToken } as typeof conn & { access_token: string };
}
