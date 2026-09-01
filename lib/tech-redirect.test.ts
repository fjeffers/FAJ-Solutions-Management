import { describe, it, expect, vi, beforeEach } from 'vitest';

// The RPC decides; this checks the app's half — that the answer is read
// correctly and that any failure leaves the person where they are.
const rpc = vi.fn();
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ rpc }) }));

import { belongsInTechPortal } from './tech-portal';

beforeEach(() => rpc.mockReset());

describe('who gets sent to the tech portal', () => {
  it("sends a tech away from the owner app", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    expect(await belongsInTechPortal()).toBe(true);
    expect(rpc).toHaveBeenCalledWith('belongs_in_tech_portal');
  });

  it('leaves the owner in the owner app', async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    expect(await belongsInTechPortal()).toBe(false);
  });

  it('leaves an owner who is also a contractor alone', async () => {
    // Fred is a contractor on his own jobs. The database answers false for
    // him; bouncing him to /tech would lock him out of his own business.
    rpc.mockResolvedValue({ data: false, error: null });
    expect(await belongsInTechPortal()).toBe(false);
  });

  it('fails safe: an error does not bounce anyone anywhere', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'network down' } });
    expect(await belongsInTechPortal()).toBe(false);
  });

  it('treats a missing answer as "stay put"', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await belongsInTechPortal()).toBe(false);
  });

  it('does not treat a truthy non-true value as a redirect', async () => {
    rpc.mockResolvedValue({ data: 'yes', error: null });
    expect(await belongsInTechPortal()).toBe(false);
  });
});
