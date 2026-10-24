// POST /api/tech/signup without RESEND_API_KEY: the route used to make the
// login first and then crash on the email, leaving a login with no
// confirmation (and "already a login for this email" on the next try). It now
// stops before the login is made.
import { describe, it, expect, vi, afterEach } from 'vitest';

const generateLink = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
    auth: { admin: { generateLink, deleteUser: vi.fn() } },
  }),
}));

const { POST } = await import('./route');

afterEach(() => { vi.unstubAllEnvs(); generateLink.mockClear(); });

describe('POST /api/tech/signup', () => {
  it('makes no login when the confirmation email cannot go', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    const res = await POST(new Request('http://localhost/api/tech/signup', {
      method: 'POST',
      body: JSON.stringify({ name: 'Paul Gibbs', email: 'paul@example.com', username: 'paulg', password: 'longenough1' }),
    }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, error: expect.stringContaining("email isn't set up") });
    expect(generateLink).not.toHaveBeenCalled();
  });
});
