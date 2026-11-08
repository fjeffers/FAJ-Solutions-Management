import { createAdminClient } from '@/lib/supabase/admin';
import { refreshAccessToken } from '@/lib/quickbooks';

/**
 * Loads a user's QBO connection and returns a guaranteed-valid access token, refreshing if needed.
 * Intuit rotates the refresh token, so the new one is kept; one Intuit refuses means QuickBooks
 * must be connected again, answered as not connected (null) rather than a crash.
 */
export async function getValidQboSession(userId: string) {
  const admin = createAdminClient();
  const { data: conn } = await admin.from('quickbooks_connections').select('*').eq('user_id', userId).single();
  if (!conn) return null;

  let accessToken = conn.access_token as string;
  if (!conn.token_expires_at || new Date(conn.token_expires_at) <= new Date()) {
    let refreshed: Awaited<ReturnType<typeof refreshAccessToken>>;
    try {
      refreshed = await refreshAccessToken(conn.refresh_token);
    } catch (e) {
      console.error('QuickBooks refresh failed; reconnect needed', (e as Error).message);
      return null;
    }
    accessToken = refreshed.access_token;
    await admin.from('quickbooks_connections').update({
      access_token: accessToken,
      ...(refreshed.refresh_token ? { refresh_token: refreshed.refresh_token } : {}),
      token_expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
    }).eq('id', conn.id);
  }

  return { ...conn, access_token: accessToken } as typeof conn & { access_token: string };
}
