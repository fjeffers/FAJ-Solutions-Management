// POST /api/tech/expense: a reading far bigger than a real receipt's is never
// parsed, and the expense still saves without it (Greptile on PR #7: the
// 32 KB guard before JSON.parse had no test of its own).
import { describe, it, expect, vi, afterEach } from 'vitest';

const rpc = vi.fn(async (...[name]: [string, Record<string, unknown>?]) => (name === 'wf_tech_photo_target' ? { data: { wo_id: 'wo-1' }, error: null } : { data: { ok: true }, error: null }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc }) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ storage: { from: () => ({ upload: vi.fn(), remove: vi.fn() }) } }) }));

const { POST } = await import('./route');

function post(ai: string) {
  const form = new FormData();
  form.set('wo_number', '19101401');
  form.set('amount', '14.50');
  form.set('category', 'meals');
  form.set('vendor', 'Diner');
  form.set('date', '2026-10-21');
  form.set('ai', ai);
  return POST(new Request('http://localhost/api/tech/expense', { method: 'POST', body: form }));
}
const saved = () => rpc.mock.calls.filter(([name]) => name === 'wf_tech_add_expense').map(([, args]) => args);

afterEach(() => { rpc.mockClear(); vi.restoreAllMocks(); });

describe('POST /api/tech/expense', () => {
  it('keeps a normal reading', async () => {
    const res = await post(JSON.stringify({ total: 14.5, vendor: 'Diner' }));
    expect(await res.json()).toEqual({ ok: true });
    expect(saved().at(-1)).toMatchObject({ p_amount: 14.5, p_ai: expect.objectContaining({ total: 14.5 }) });
  });

  it('never parses a reading over 32 KB, and still saves the expense without it', async () => {
    const parse = vi.spyOn(JSON, 'parse');
    const huge = JSON.stringify({ total: 14.5, items: Array.from({ length: 3000 }, (_, i) => ({ name: `item ${i}`, price: 1 })) });
    expect(huge.length).toBeGreaterThan(32_768);
    const res = await post(huge);
    expect(await res.json()).toEqual({ ok: true });
    expect(parse.mock.calls.some(([text]) => text === huge)).toBe(false);
    expect(saved().at(-1)).not.toHaveProperty('p_ai');
    expect(saved().at(-1)).toMatchObject({ p_wo_number: '19101401', p_amount: 14.5 });
  });
});
