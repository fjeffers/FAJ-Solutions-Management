// POST /api/send-email without RESEND_API_KEY: Send to tech showed "Failed to
// execute 'json' on 'Response': Unexpected end of JSON input" because
// `new Resend()` threw and the route answered with an empty body (Fred,
// 2026-10-24). It now answers in JSON with what is missing.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { EMAIL_NOT_SET_UP } from '@/lib/email-client';

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'owner-1' } } }) } }),
}));

const { POST } = await import('./route');

const send = () => POST(new NextRequest('http://localhost/api/send-email', {
  method: 'POST',
  body: JSON.stringify({ type: 'work_order', to: 'tech@example.com', subject: 'Work Order #1', data: { workOrder: { id: 'wo-1' }, recipients: [] } }),
}));

afterEach(() => { vi.unstubAllEnvs(); });

describe('POST /api/send-email', () => {
  it('says email is not set up, in JSON, when the server has no key', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    const res = await send();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: EMAIL_NOT_SET_UP });
  });
});
