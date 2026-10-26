// @vitest-environment jsdom
//
// The Job log's pictures on the Gaffney job (WO 19101401): the receipts, the
// odometer and the site photos, each with a check mark. Tapping it leaves the
// picture out of the log, saved on the job; nothing is deleted. Fred,
// 2026-10-25: "put a x or check mark to add and remove photos"; "i can label
// then as recipe or none recipes"; a declined receipt "stay on the app".
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within, fireEvent, waitFor } from '@testing-library/react';
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
  job_day_events: [],
  // Paul's odometer on 10/19, as the Hours screen has it.
  field_sheet_days: [{ id: 's1', day: '2026-10-19', tech: 'Paul Gibbs', edits: { odoStart: 41200, odoEnd: 41218 }, added: false, hidden: false }],
};
const updates: Record<string, unknown>[] = [];
// How long each save takes; the first one slow, to check a quick run of taps still lands in order.
let saveDelays: number[] = [];
// Which saves fail, in order.
let saveFails: boolean[] = [];
// The punches come back only once this settles, to hold the log loading.
let punchesHeld: Promise<void> = Promise.resolve();
function query(table: string) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'order']) chain[m] = () => chain;
  chain.then = (ok: (v: unknown) => unknown) => (table === 'job_punches' ? punchesHeld : Promise.resolve())
    .then(() => ({ data: tables[table] ?? [], error: null })).then(ok);
  chain.maybeSingle = async () => ({ data: (tables[table] ?? [])[0] ?? null, error: null });
  chain.update = (row: Record<string, unknown>) => ({
    eq: async () => {
      await new Promise((ok) => setTimeout(ok, saveDelays.shift() ?? 0));
      updates.push(row);
      return { error: saveFails.shift() ? { message: 'offline' } : null };
    },
  });
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

afterEach(() => { cleanup(); updates.length = 0; saveDelays = []; saveFails = []; });

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
    await waitFor(() => expect(updates.at(-1)).toEqual({ job_log_left_out: [], job_log_receipt_photos: ['ph1'] }));
    const receipts = screen.getByRole('heading', { name: 'Receipts' }).parentElement!;
    expect(within(receipts).getByAltText(/receipt photo/i)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Photos' })).toBeNull();
  });

  it('leaves a picture out with its check mark, and puts it back with the x, saved on the job', async () => {
    const user = userEvent.setup();
    render(<JobLogReport w={wo} deliverables={[]} onClose={() => {}} />);
    await user.click(await screen.findByRole('button', { name: /leave out of the log: photo/i }));
    await waitFor(() => expect(updates.at(-1)).toEqual({ job_log_left_out: ['photo:ph1'], job_log_receipt_photos: [] }));
    const back = screen.getByRole('button', { name: /put back in the log: photo/i });
    expect(back.closest('.jl-avoid')!.classList.contains('no-print')).toBe(true);
    await user.click(back);
    await waitFor(() => expect(updates.at(-1)).toEqual({ job_log_left_out: [], job_log_receipt_photos: [] }));
  });

  it('takes a picture out with its ✗ and says the client won’t see it; a ✓ puts it back (Fred, 2026-10-26)', async () => {
    const user = userEvent.setup();
    render(<JobLogReport w={wo} deliverables={[]} onClose={() => {}} />);
    const take = await screen.findByRole('button', { name: /leave out of the log: materials, lowe's/i });
    expect(take.getAttribute('title')).toMatch(/tap ✗ to take it out; it stays on the job/i);
    expect(screen.queryByText(/not in the job log: the client won’t see it/i)).toBeNull();
    await user.click(take);
    const back = screen.getByRole('button', { name: /put back in the log: materials, lowe's/i });
    expect(back.getAttribute('title')).toMatch(/tap ✓ to put it back/i);
    expect(back.parentElement!.textContent).toMatch(/not in the job log: the client won’t see it\. still on the job\./i);
    expect(back.closest('.jl-avoid')!.classList.contains('no-print')).toBe(true);
    await waitFor(() => expect(updates.at(-1)).toEqual({ job_log_left_out: ['receipt:x1'], job_log_receipt_photos: [] }));
  });

  it('keeps every choice from a quick run of taps, even when a save is slow', async () => {
    saveDelays = [80, 0];
    render(<JobLogReport w={wo} deliverables={[]} onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /leave out of the log: photo/i }));
    // The first save is still going when the second tap comes.
    await new Promise((ok) => setTimeout(ok, 20));
    fireEvent.click(screen.getByRole('button', { name: /leave out of the log: odometer start/i }));
    await waitFor(() => expect(updates).toHaveLength(2));
    expect(updates.at(-1)).toEqual({ job_log_left_out: ['photo:ph1', 'odo:o1'], job_log_receipt_photos: [] });
  });

  it('shows a PDF receipt as a link to open, not a broken picture', async () => {
    const before = tables.job_expenses;
    tables.job_expenses = [{ id: 'x3', contractor_name: null, category: 'hotel', vendor: 'Quality Inn', amount: 350.74, expense_date: '2026-10-20', status: 'approved', receipt_path: 'r/hotel.pdf' }];
    try {
      render(<JobLogReport w={wo} deliverables={[]} onClose={() => {}} />);
      const link = await screen.findByRole('link', { name: /lodging, quality inn: \$350\.74/i });
      expect(link.getAttribute('href')).toBe('https://signed.test/r/hotel.pdf');
      expect(screen.queryByAltText(/quality inn/i)).toBeNull();
    } finally {
      tables.job_expenses = before;
    }
  });

  it('still saves a tap made while an earlier save fails', async () => {
    saveDelays = [80, 0];
    saveFails = [true, false];
    render(<JobLogReport w={wo} deliverables={[]} onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /leave out of the log: photo/i }));
    await new Promise((ok) => setTimeout(ok, 20));
    fireEvent.click(screen.getByRole('button', { name: /leave out of the log: odometer start/i }));
    await waitFor(() => expect(updates).toHaveLength(2));
    expect(updates.at(-1)).toEqual({ job_log_left_out: ['photo:ph1', 'odo:o1'], job_log_receipt_photos: [] });
    expect(screen.getByRole('button', { name: /put back in the log: odometer start/i })).toBeTruthy();
  });

  it("shows each day's miles with the odometer, and the total (Fred: \"i don't see the mileages on the job logs\")", async () => {
    render(<JobLogReport w={wo} deliverables={[]} onClose={() => {}} />);
    const table = (await screen.findByRole('heading', { name: 'Mileage' })).nextElementSibling as HTMLElement;
    const cells = [...table.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent));
    expect(cells).toEqual([
      ['Mon, Oct 19, 2026', 'Paul Gibbs', '41,200', '41,218', '18'],
      ['Total', '18'],
    ]);
  });
});

describe('Job log saved as a PDF', () => {
  it('is named for the site, its city and the days on the sheet, and the page gets its own name back after', async () => {
    const before = tables.field_sheet_days;
    // Paul drove down on Sunday 10/18, the day before the job's dates.
    tables.field_sheet_days = [...before, { id: 's0', day: '2026-10-18', tech: 'Paul Gibbs', edits: { miles: 458 }, added: true, hidden: false }];
    document.title = 'FAJ Solutions';
    try {
      const gaffney = { ...wo, external_wo_id: 'LDS-1110', customer_name: 'LDS', site_name: 'LDS Site 5011876', site_city: 'Gaffney', site_state: 'SC' } as EnrichedWorkOrder;
      const { unmount } = render(<JobLogReport w={gaffney} deliverables={[]} onClose={() => {}} />);
      await waitFor(() => expect(document.title).toBe('LDS-1110 Site 5011876 — Gaffney, SC · 10-18-2026 – 10-23-2026'));
      fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-19' } });
      fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-19' } });
      expect(document.title).toBe('LDS-1110 Site 5011876 — Gaffney, SC · 10-19-2026');
      unmount();
      expect(document.title).toBe('FAJ Solutions');
    } finally {
      tables.field_sheet_days = before;
    }
  });

  it('can’t be printed until the job’s days are in, so the PDF never goes without its dates', async () => {
    let release = () => {};
    punchesHeld = new Promise((ok) => { release = ok; });
    try {
      const gaffney = { ...wo, external_wo_id: 'LDS-1110', customer_name: 'LDS', site_name: 'LDS Site 5011876', site_city: 'Gaffney', site_state: 'SC' } as EnrichedWorkOrder;
      render(<JobLogReport w={gaffney} deliverables={[]} onClose={() => {}} />);
      const print = screen.getByRole('button', { name: /print \/ save as pdf/i }) as HTMLButtonElement;
      expect(print.disabled).toBe(true);
      expect(document.title).toBe('LDS-1110 Site 5011876 — Gaffney, SC');
      release();
      await waitFor(() => expect(print.disabled).toBe(false));
      expect(document.title).toBe('LDS-1110 Site 5011876 — Gaffney, SC · 10-19-2026 – 10-23-2026');
    } finally {
      punchesHeld = Promise.resolve();
    }
  });
});
