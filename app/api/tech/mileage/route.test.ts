// POST /api/tech/mileage: the miles a tech types go on their own day of their
// own live job, under the name on their login (Fred, 2026-10-27).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { dayOf } from '@/lib/project-day';

let user: { id: string } | null = { id: 'auth-fred' };
let job: { wo_id: string } | null = { wo_id: 'wo-1' };
const rpc = vi.fn(async () => ({ data: job, error: null }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc, auth: { getUser: async () => ({ data: { user } }) } }) }));
const lookups: Record<string, string>[] = [];
const admin = {
  from: () => {
    const f: Record<string, string> = {};
    const q = {
      select: () => q,
      eq: (k: string, v: string) => { f[k] = v; return q; },
      maybeSingle: async () => { lookups.push({ ...f }); return { data: f.auth_user_id === 'auth-fred' ? { name: 'Frederick Jeffers', user_id: 'owner-1' } : null }; },
    };
    return q;
  },
};
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => admin }));
const addDayMiles = vi.fn(async () => 95 as number | null);
vi.mock('@/lib/day-miles', async (original) => ({ ...(await original<typeof import('@/lib/day-miles')>()), addDayMiles }));

const { POST } = await import('./route');
const today = dayOf(new Date().toISOString(), 'America/New_York');

function post(f: Record<string, string>) {
  const form = new FormData();
  for (const [k, v] of Object.entries({ wo_number: '19101412', miles: '85', date: today, ...f })) form.set(k, v);
  return POST(new Request('http://localhost/api/tech/mileage', { method: 'POST', body: form }));
}

afterEach(() => { user = { id: 'auth-fred' }; job = { wo_id: 'wo-1' }; rpc.mockClear(); addDayMiles.mockClear(); lookups.length = 0; });

describe('POST /api/tech/mileage', () => {
  it("adds the miles to the tech's own day on their job", async () => {
    const res = await post({});
    expect(await res.json()).toEqual({ ok: true, miles: 85, extraMiles: 95 });
    expect(rpc).toHaveBeenCalledWith('wf_tech_photo_target', { p_wo_number: '19101412' });
    expect(lookups[0]).toEqual({ auth_user_id: 'auth-fred', portal_enabled: true });
    expect(addDayMiles).toHaveBeenCalledWith(admin, { woId: 'wo-1', tech: 'Frederick Jeffers', day: today, miles: 85, ownerId: 'owner-1' });
  });

  it('turns away miles that are not a number, a day in the future, a job that is not theirs, and no login', async () => {
    expect((await post({ miles: 'lots' })).status).toBe(400);
    expect((await post({ date: '2999-01-01' })).status).toBe(400);
    expect((await post({ date: '2020-01-01' })).status).toBe(400);
    job = null;
    expect((await post({})).status).toBe(403);
    user = null;
    expect((await post({})).status).toBe(401);
    expect(addDayMiles).not.toHaveBeenCalled();
  });

  it("says so when the miles didn't save", async () => {
    addDayMiles.mockResolvedValueOnce(null);
    const res = await post({});
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: "Couldn't add the miles. Try again." });
  });
});
