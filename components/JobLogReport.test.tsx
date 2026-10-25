// @vitest-environment jsdom
//
// The Job log's pictures on the Gaffney job (WO 19101401): the receipts, the
// odometer and the site photos, each with a check mark. Tapping it leaves the
// picture out of the log, saved on the job; nothing is deleted. Fred,
// 2026-10-25: "put a x or check mark to add and remove photos"; "i can label
// then as recipe or none recipes"; a declined receipt "stay on the app".
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EnrichedWorkOrder } from '@/lib/types';

vi.mock('@/lib/toast', () => ({ toastError: vi.fn(), toastSuccess: vi.fn(), toastInfo: vi.fn() }));

const at = (day: string, hhmm: string) => new Date(`2026-10-${day}T${hhmm}:00-04:00`).toISOString();
const tables: Record<string, Record<string, unknown>[]> = {
  job_punches: [],
  wo_photos: [{ id: 'ph1', url: 'https://example.test/site.jpg', taken_at: at('21', '08:28'), lat: null, lng: null, contractor_name: 'Paul Gibbs' }],
  job_expenses: [
    { id: 'x1', contractor_name: 'Paul Gibbs', category: 'materials', vendor: "Lowe's", amount: 104.17, expense_date: '2026-10-21', status: 'approved', receipt_path: 'r/lowes.jpg' },
    { id: 'x2', contractor_name: 'Paul Gibbs', category: 'fuel', vendor: 'Circle K', amount: 76.75, expense_date: '2026-10-21', status: 'declined', decline_reason: 'duplicate', receipt_path: 'r/again.jpg' },
  ],
  job_odometer: [{ id: 'o1', contractor_name: 'Paul Gibbs', at: at('19', '07:10'), moment: 'start', reading: 41200, photo_path: 'odo/start.jpg' }],
  work_orders: [{ job_log_left_out: [], job_log_receipt_photos: [] }],
};
const updates: Record<string, unknown>[] = [];
function query(table: string) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order']) chain[m] = () => chain;
  chain.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: tables[table] ?? [], error: null }).then(ok);
  chain.maybeSingle = async () => ({ data: (tables[table] ?? [])[0] ?? null, error: null });
  chain.update = (row: Record<string, unknown>) => { updates.push(row); return { eq: async () => ({ error: null }) }; };
  return chain;
}
const storage = { from: () => ({ createSignedUrls: async (paths: string[]) => ({ data: paths.map((p) => ({ path: p, signedUrl: `https://signed.test/${p}` })) }) }) };
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ from: (t: string) => query(t), storage }) }));
vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => [] }));

const { default: JobLogReport } = await import('./JobLogReport');
const wo = {
  id: 'wo', wo_number: '19101401', title: 'Gaffney', contractor_names: ['Paul Gibbs'], contractor_name: 'Paul Gibbs',
  start_date: '2026-10-19', end_date: '2026-10-23', wo_status: 'Open', capture: [], custom_qa: [], wo_tasks: [],
} as unknown as EnrichedWorkOrder;

afterEach(() => { cleanup(); updates.length = 0; });

describe('Job log pictures', () => {
  it('has the receipts, the odometer and the site photos; a declined receipt is marked and never printed', async () => {
    render(<JobLogReport w={wo} deliverables={[]} onClose={() => {}} />);
    expect(await screen.findByRole('button', { name: /leave out of the log: materials, lowe's: \$104\.17/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /leave out of the log: odometer start: 41,200/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /leave out of the log: photo/i })).toBeTruthy();
    const declined = screen.getByAltText(/declined: fuel, circle k: \$76\.75 \(duplicate\)/i);
    expect(declined.closest('.jl-avoid')!.classList.contains('no-print')).toBe(true);
    expect(screen.queryByRole('button', { name: /circle k/i })).toBeNull();
  });

  it('labels a site photo a receipt, and it moves to the receipts', async () => {
    const user = userEvent.setup();
    render(<JobLogReport w={wo} deliverables={[]} onClose={() => {}} />);
    const chips = within(await screen.findByRole('group', { name: /label photo/i }));
    await user.click(chips.getByRole('button', { name: 'Receipt' }));
    expect(updates.at(-1)).toEqual({ job_log_receipt_photos: ['ph1'] });
    const receipts = screen.getByRole('heading', { name: 'Receipts' }).parentElement!;
    expect(within(receipts).getByAltText(/receipt photo/i)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Photos' })).toBeNull();
  });

  it('leaves a picture out with its check mark, and puts it back with the x, saved on the job', async () => {
    const user = userEvent.setup();
    render(<JobLogReport w={wo} deliverables={[]} onClose={() => {}} />);
    await user.click(await screen.findByRole('button', { name: /leave out of the log: photo/i }));
    expect(updates.at(-1)).toEqual({ job_log_left_out: ['photo:ph1'] });
    const back = screen.getByRole('button', { name: /put back in the log: photo/i });
    expect(back.closest('.jl-avoid')!.classList.contains('no-print')).toBe(true);
    await user.click(back);
    expect(updates.at(-1)).toEqual({ job_log_left_out: [] });
  });
});
