// POST /api/jobs/day-photo: the office adds a site or odometer picture to a tech's day.
import { describe, it, expect, vi, afterEach } from 'vitest';

const inserted: { table: string; row: Record<string, unknown> }[] = [];
const uploads: string[] = [];
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    rpc: async () => ({ data: { role: 'owner' }, error: null }),
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: () => {
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq']) q[m] = () => q;
      q.maybeSingle = async () => ({ data: { id: 'wo-1', wo_number: '19101401' } });
      return q;
    },
  }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    storage: { from: (b: string) => ({
      upload: async (path: string) => { uploads.push(`${b}/${path}`); return { error: null }; },
      remove: async () => ({}),
      getPublicUrl: (path: string) => ({ data: { publicUrl: `https://x/${path}` } }),
    }) },
    from: (table: string) => ({ insert: async (row: Record<string, unknown>) => { inserted.push({ table, row }); return { error: null }; } }),
  }),
}));

const { POST } = await import('./route');
function post(fields: Record<string, string>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  form.set('file', new File([new Uint8Array([0xff, 0xd8, 0xff])], 'p.jpg', { type: 'image/jpeg' }));
  return POST(new Request('http://localhost/api/jobs/day-photo', { method: 'POST', body: form }));
}
afterEach(() => { inserted.length = 0; uploads.length = 0; });

describe('POST /api/jobs/day-photo', () => {
  it("adds a site photo to the tech's day, at midday on that day", async () => {
    const res = await post({ wo_id: 'wo-1', day: '2026-10-21', tech: 'Paul Gibbs', kind: 'site' });
    expect(await res.json()).toMatchObject({ ok: true });
    expect(uploads[0]).toMatch(/^portal-uploads\/wo_wo-1\/office_/);
    expect(inserted[0]).toMatchObject({ table: 'wo_photos', row: { wo_id: 'wo-1', contractor_name: 'Paul Gibbs', taken_at: '2026-10-21T16:00:00.000Z', source: 'library' } });
  });

  it('adds an odometer picture with its reading, kept private', async () => {
    const res = await post({ wo_id: 'wo-1', day: '2026-10-21', tech: 'Paul Gibbs', kind: 'odo_start', reading: '142,127' });
    expect(await res.json()).toMatchObject({ ok: true });
    expect(uploads[0]).toMatch(/^job-receipts\/wo-1\/odo_office_/);
    expect(inserted[0]).toMatchObject({ table: 'job_odometer', row: { moment: 'start', reading: 142127, at: '2026-10-21T11:00:00.000Z' } });
  });

  it('keeps what the AI read next to the reading, at the time the photo was taken (Fred, 2026-10-26)', async () => {
    await post({ wo_id: 'wo-1', day: '2026-10-26', tech: 'Paul Gibbs', kind: 'odo_end', reading: '142,180', ai_reading: '142180.4', time: '07:31' });
    expect(inserted[0]).toMatchObject({ table: 'job_odometer', row: { moment: 'end', reading: 142180, ai_reading: 142180.4, at: '2026-10-26T11:31:00.000Z' } });
    inserted.length = 0;
    await post({ wo_id: 'wo-1', day: '2026-10-26', tech: 'Paul Gibbs', kind: 'odo_end', reading: '142,180', ai_reading: 'junk' });
    expect(inserted[0].row.ai_reading).toBeNull();
  });

  it('asks for the reading on an odometer picture, and refuses a bad kind', async () => {
    expect((await post({ wo_id: 'wo-1', day: '2026-10-21', tech: 'Paul Gibbs', kind: 'odo_end' })).status).toBe(400);
    expect((await post({ wo_id: 'wo-1', day: '2026-10-21', tech: 'Paul Gibbs', kind: 'selfie' })).status).toBe(400);
    expect(inserted).toEqual([]);
  });
});
