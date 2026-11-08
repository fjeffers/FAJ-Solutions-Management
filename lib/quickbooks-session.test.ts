import { beforeEach, describe, expect, it, vi } from 'vitest';

const conn = { id: 'c1', access_token: 'old-access', refresh_token: 'old-refresh', token_expires_at: '2000-01-01T00:00:00Z' };
const updates: Record<string, unknown>[] = [];
const refreshAccessToken = vi.fn();

vi.mock('@/lib/quickbooks', () => ({ refreshAccessToken: (t: string) => refreshAccessToken(t) }));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: conn }) }) }),
      update: (row: Record<string, unknown>) => { updates.push(row); return { eq: async () => ({ error: null }) }; },
    }),
  }),
}));

import { getValidQboSession } from './quickbooks-session';

describe('getValidQboSession', () => {
  beforeEach(() => { updates.length = 0; refreshAccessToken.mockReset(); vi.spyOn(console, 'error').mockImplementation(() => {}); });

  it("keeps Intuit's rotated refresh token", async () => {
    refreshAccessToken.mockResolvedValue({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 });
    const s = await getValidQboSession('u1');
    expect(s?.access_token).toBe('new-access');
    expect(updates[0]).toMatchObject({ access_token: 'new-access', refresh_token: 'new-refresh' });
  });

  it('answers not connected when Intuit refuses the refresh token', async () => {
    refreshAccessToken.mockRejectedValue(new Error('QuickBooks token request failed: {"error":"invalid_grant"}'));
    expect(await getValidQboSession('u1')).toBeNull();
    expect(updates).toHaveLength(0);
  });
});
