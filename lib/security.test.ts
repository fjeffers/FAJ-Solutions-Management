import { describe, it, expect } from 'vitest';
import { ownerOnly } from './security';

const client = (data: unknown, error: unknown = null) => ({ rpc: async () => ({ data, error }) }) as never;

describe('ownerOnly', () => {
  it('lets the business owner through', async () => {
    expect(await ownerOnly(client({ role: 'owner' }))).toBeNull();
  });

  it.each(['tech', 'staff', 'none'])('refuses a %s login', async (role) => {
    const res = await ownerOnly(client({ role }));
    expect(res?.status).toBe(403);
    expect((await res!.json()).error).toContain('administrator');
  });

  it('refuses when the role cannot be checked', async () => {
    const res = await ownerOnly(client(null, { message: 'network' }));
    expect(res?.status).toBe(503);
  });
});
