// POST /api/portal/upload: the emailed portal link adds a file to its own job.
import { describe, it, expect, vi, afterEach } from 'vitest';

const WO = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const uploads: { path: string; contentType?: string }[] = [];
const removed: string[] = [];
let portal: unknown = { capabilities: ['view', 'upload'], work_orders: [{ id: WO }] };
let saveResult: { data: unknown; error: unknown } = { data: { ok: true }, error: null };

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: async (fn: string) => (fn === 'get_portal_data' ? { data: portal, error: null } : saveResult),
  }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    storage: { from: () => ({
      upload: async (path: string, _b: unknown, o: { contentType?: string }) => { uploads.push({ path, contentType: o.contentType }); return { error: null }; },
      remove: async (paths: string[]) => { removed.push(...paths); return {}; },
      getPublicUrl: (path: string) => ({ data: { publicUrl: `https://x/${path}` } }),
    }) },
  }),
}));

const { POST } = await import('./route');
function post(woId: string, file: File) {
  const form = new FormData();
  form.set('token', 'tok');
  form.set('wo_id', woId);
  form.set('file', file);
  return POST(new Request('http://localhost/api/portal/upload', { method: 'POST', body: form }));
}
const jpg = () => new File([new Uint8Array([0xff, 0xd8, 0xff])], 'p.jpg', { type: 'image/jpeg' });

afterEach(() => {
  uploads.length = 0; removed.length = 0;
  portal = { capabilities: ['view', 'upload'], work_orders: [{ id: WO }] };
  saveResult = { data: { ok: true }, error: null };
});

describe('POST /api/portal/upload', () => {
  it("stores a photo on the link's own job with an allowlisted content type", async () => {
    const res = await post(WO, jpg());
    expect(await res.json()).toMatchObject({ ok: true });
    expect(uploads[0].path).toMatch(new RegExp(`^wo_${WO}/\\d+_\\w+\\.jpg$`));
    expect(uploads[0].contentType).toBe('image/jpeg');
  });

  it("stores nothing for a job that isn't assigned to this link", async () => {
    const res = await post(OTHER, jpg());
    expect(res.status).toBe(403);
    expect(uploads).toHaveLength(0);
  });

  it('stores nothing when the link lacks the upload capability', async () => {
    portal = { capabilities: ['view'], work_orders: [{ id: WO }] };
    expect((await post(WO, jpg())).status).toBe(403);
    expect(uploads).toHaveLength(0);
  });

  it('refuses HTML and other non-allowlisted files, whatever type the browser claims', async () => {
    expect((await post(WO, new File(['<script>'], 'x.html', { type: 'text/html' }))).status).toBe(415);
    expect((await post(WO, new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' }))).status).toBe(415);
    expect((await post(WO, new File(['<script>'], 'x', { type: 'text/html' }))).status).toBe(415);
    expect(uploads).toHaveLength(0);
  });

  it('sets the content type from the extension, not the browser', async () => {
    await post(WO, new File(['%PDF'], 'scope.pdf', { type: 'text/html' }));
    expect(uploads[0].contentType).toBe('application/pdf');
  });

  it('refuses files over the size limit', async () => {
    const big = new File([new Uint8Array(4 * 1024 * 1024 + 1)], 'big.jpg', { type: 'image/jpeg' });
    expect((await post(WO, big)).status).toBe(413);
    expect(uploads).toHaveLength(0);
  });

  it('removes the stored file when the record step refuses it', async () => {
    saveResult = { data: { error: 'Not allowed' }, error: null };
    const res = await post(WO, jpg());
    expect(res.status).toBe(403);
    expect(removed).toEqual([uploads[0].path]);
  });
});
