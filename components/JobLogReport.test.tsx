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
vi.mock('@/lib/job-log-xlsx', () => ({ downloadJobLogXlsx: vi.fn(async () => {}) }));

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
// Tables whose read fails.
const readFails = new Set<string>();
// Rows written with upsert (the rates), by table.
const upserts: { table: string; row: Record<string, unknown>; onConflict?: string }[] = [];
// How long each save takes; the first one slow, to check a quick run of taps still lands in order.
let saveDelays: number[] = [];
// Which saves fail, in order.
let saveFails: boolean[] = [];
// The job's saved sheet kept, as the database would, once a save lands.
let persistSheet = false;
// The punches come back only once this settles, to hold the log loading.
let punchesHeld: Promise<void> = Promise.resolve();
// How many times each table was read.
const reads: Record<string, number> = {};
function query(table: string) {
  reads[table] = (reads[table] ?? 0) + 1;
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'order']) chain[m] = () => chain;
  chain.then = (ok: (v: unknown) => unknown) => (table === 'job_punches' ? punchesHeld : Promise.resolve())
    .then(() => ({ data: tables[table] ?? [], error: null })).then(ok);
  chain.maybeSingle = async () => (readFails.has(table) ? { data: null, error: { message: 'offline' } } : { data: (tables[table] ?? [])[0] ?? null, error: null });
  chain.upsert = async (row: Record<string, unknown>, opts?: { onConflict?: string }) => {
    await new Promise((ok) => setTimeout(ok, saveDelays.shift() ?? 0));
    upserts.push({ table, row, onConflict: opts?.onConflict });
    return { error: null };
  };
  chain.update = (row: Record<string, unknown>) => ({
    eq: async () => {
      await new Promise((ok) => setTimeout(ok, saveDelays.shift() ?? 0));
      updates.push(row);
      if (persistSheet && table === 'work_orders' && 'job_log_sheet' in row) tables.work_orders = [{ ...tables.work_orders[0], job_log_sheet: row.job_log_sheet }];
      return { error: saveFails.shift() ? { message: 'offline' } : null };
    },
  });
  return chain;
}
const storage = { from: () => ({ createSignedUrls: async (paths: string[]) => ({ data: paths.map((p) => ({ path: p, signedUrl: `https://signed.test/${p}` })) }) }) };
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ from: (t: string) => query(t), storage }) }));
vi.stubGlobal('fetch', async (url: string) => ({ ok: true, json: async () => (url === '/api/jobs/day-photo' ? { ok: true, url: 'https://example.test/added.jpg' } : []) }));
// The stamp draws on a canvas, which the test browser hasn't got.
vi.mock('@/lib/photo-stamp', () => ({ stampPhoto: async () => new Blob(['jpeg'], { type: 'image/jpeg' }) }));

const { default: JobLogReport } = await import('./JobLogReport');
const { toastError } = await import('@/lib/toast');
const { downloadJobLogXlsx } = await import('@/lib/job-log-xlsx');
const wo = {
  id: 'wo', wo_number: '19101401', title: 'Gaffney', contractor_names: ['Paul Gibbs'], contractor_name: 'Paul Gibbs',
  start_date: '2026-10-19', end_date: '2026-10-23', wo_status: 'Open', capture: [], custom_qa: [], wo_tasks: [],
} as unknown as EnrichedWorkOrder;

afterEach(() => { cleanup(); updates.length = 0; upserts.length = 0; saveDelays = []; saveFails = []; });

describe('Job log pictures', () => {
  it('has the receipts, the odometer and the site photos; a declined receipt is marked and never printed', async () => {
    render(<JobLogReport w={wo} deliverables={[]} onClose={() => {}} />);
    expect(await screen.findByRole('button', { name: /leave out of the log: materials, lowe's: \$104\.17/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /leave out of the log: odometer start: 41,200/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /leave out of the log: photo/i })).toBeTruthy();
    const declined = screen.getByAltText(/declined: fuel, circle k: \$76\.75 \(duplicate\)/i);
    expect(declined.closest('.jl-avoid')!.classList.contains('no-print')).toBe(true);
    // It has its ✗ like every picture (Fred, 2026-10-26: "remove on every photo and receipt").
    expect(screen.getByRole('button', { name: /leave out of the log: declined: fuel, circle k/i })).toBeTruthy();
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
    await user.click(screen.getByLabelText(/pictures left out \(1\)/i));
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
    // The mark Fred sees: ✗ on a picture in the log, ✓ on one left out.
    expect([!!take.querySelector('svg.lucide-x'), !!take.querySelector('svg.lucide-check')]).toEqual([true, false]);
    expect(screen.queryByText(/not in the job log: the client won’t see it/i)).toBeNull();
    await user.click(take);
    await user.click(screen.getByLabelText(/pictures left out \(1\)/i));
    const back = screen.getByRole('button', { name: /put back in the log: materials, lowe's/i });
    expect(back.getAttribute('title')).toMatch(/tap ✓ to put it back/i);
    expect([!!back.querySelector('svg.lucide-x'), !!back.querySelector('svg.lucide-check')]).toEqual([false, true]);
    expect(back.parentElement!.textContent).toMatch(/not in the job log: the client won’t see it\. still on the job\./i);
    expect(back.closest('.jl-avoid')!.classList.contains('no-print')).toBe(true);
    await waitFor(() => expect(updates.at(-1)).toEqual({ job_log_left_out: ['receipt:x1'], job_log_receipt_photos: [] }));
  });

  it('takes a picture out of the log on screen too, until "Pictures left out" is ticked (Fred: "why am still see the one i removed")', async () => {
    const user = userEvent.setup();
    render(<JobLogReport w={wo} deliverables={[]} onClose={() => {}} />);
    await user.click(await screen.findByRole('button', { name: /leave out of the log: materials, lowe's/i }));
    expect(screen.queryByAltText(/materials, lowe's/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /put back in the log: materials, lowe's/i })).toBeNull();
    const toast = (await import('@/lib/toast')).toastSuccess as unknown as ReturnType<typeof vi.fn>;
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/taken out of the job log\. it’s still on the job/i));
    // The others stay, and the declined receipt still shows, marked.
    expect(screen.getByRole('button', { name: /leave out of the log: odometer start/i })).toBeTruthy();
    expect(screen.getByAltText(/declined: fuel, circle k/i)).toBeTruthy();
    await user.click(screen.getByLabelText(/pictures left out \(1\)/i));
    expect(screen.getByAltText(/materials, lowe's/i).closest('.jl-avoid')!.classList.contains('no-print')).toBe(true);
    await user.click(screen.getByRole('button', { name: /put back in the log: materials, lowe's/i }));
    expect(screen.queryByLabelText(/pictures left out/i)).toBeNull();
    // Taken out again, it goes off the screen again.
    await user.click(screen.getByRole('button', { name: /leave out of the log: materials, lowe's/i }));
    expect(screen.queryByAltText(/materials, lowe's/i)).toBeNull();
    expect((screen.getByLabelText(/pictures left out \(1\)/i) as HTMLInputElement).checked).toBe(false);
  });

  it('takes a declined receipt off the screen with its ✗ too (Fred: "remove on every photo and receipt")', async () => {
    const user = userEvent.setup();
    render(<JobLogReport w={wo} deliverables={[]} onClose={() => {}} />);
    await user.click(await screen.findByRole('button', { name: /leave out of the log: declined: fuel, circle k/i }));
    await waitFor(() => expect(updates.at(-1)).toEqual({ job_log_left_out: ['receipt:x2'], job_log_receipt_photos: [] }));
    expect(screen.queryByAltText(/circle k/i)).toBeNull();
    await user.click(screen.getByLabelText(/pictures left out \(1\)/i));
    const back = screen.getByRole('button', { name: /put back in the log: declined: fuel, circle k/i });
    expect(back.parentElement!.textContent).toMatch(/declined/i);
    expect(back.parentElement!.textContent).toMatch(/not in the job log: the client won’t see it/i);
  });

  it('says a picture is taken out only once that is saved (Greptile on PR #24)', async () => {
    const toast = await import('@/lib/toast');
    (toast.toastSuccess as unknown as ReturnType<typeof vi.fn>).mockClear();
    saveFails = [true];
    render(<JobLogReport w={wo} deliverables={[]} onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /leave out of the log: materials, lowe's/i }));
    await waitFor(() => expect(toast.toastError).toHaveBeenCalledWith(expect.stringMatching(/didn't save/i)));
    expect(toast.toastSuccess).not.toHaveBeenCalled();
    // Back where it was.
    expect(screen.getByRole('button', { name: /leave out of the log: materials, lowe's/i })).toBeTruthy();
  });

  it('takes the next picture off the screen after the dates hide the ones left out (Greptile on PR #24)', async () => {
    const user = userEvent.setup();
    render(<JobLogReport w={wo} deliverables={[]} onClose={() => {}} />);
    await user.click(await screen.findByRole('button', { name: /leave out of the log: materials, lowe's: \$104/i }));
    await user.click(screen.getByLabelText(/pictures left out \(1\)/i));
    // Only 10/19: the 10/21 receipt left out isn't in these dates, so neither is the box.
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-19' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-19' } });
    expect(screen.queryByLabelText(/pictures left out/i)).toBeNull();
    await user.click(screen.getByRole('button', { name: /leave out of the log: odometer start/i }));
    expect(screen.queryByAltText(/odometer start/i)).toBeNull();
    expect((screen.getByLabelText(/pictures left out \(1\)/i) as HTMLInputElement).checked).toBe(false);
  });

  it('has Download on every picture, named for the job, what it is, whose and the day, and an Add photos button (Fred, 2026-10-26)', async () => {
    render(<JobLogReport w={wo} deliverables={[]} onClose={() => {}} />);
    const lowes = await screen.findByRole('link', { name: /download materials, lowe's: \$104\.17/i });
    expect(lowes.getAttribute('download')).toBe("WO 19101401 Materials Lowe's $104.17 Paul Gibbs 10-21-2026.jpg");
    expect(lowes.classList.contains('no-print')).toBe(true);
    expect(screen.getByRole('link', { name: /download odometer start: 41,200/i }).getAttribute('download')).toBe('WO 19101401 Odometer start 41200 Paul Gibbs 10-19-2026.jpg');
    expect(screen.getByRole('link', { name: /download photo/i }).getAttribute('download')).toBe('WO 19101401 Photo Paul Gibbs 10-21-2026.jpg');
    expect(screen.getByRole('button', { name: /add photos/i })).toBeTruthy();
  });

  it('reads only the photos again after the office adds some, so a choice tapped meanwhile stays (Greptile on PR #23)', async () => {
    const before = tables.wo_photos;
    try {
      render(<JobLogReport w={wo} deliverables={[]} onClose={() => {}} />);
      await screen.findByRole('link', { name: /download photo/i });
      const choicesRead = reads.work_orders;
      tables.wo_photos = [...before, { id: 'ph2', url: 'https://example.test/added.jpg', taken_at: at('22', '12:00'), lat: null, lng: null, contractor_name: 'Office' }];
      fireEvent.change(screen.getByLabelText('Pictures to add to the job'), { target: { files: [new File(['x'], 'a.jpg', { type: 'image/jpeg' })] } });
      fireEvent.click(screen.getByRole('button', { name: 'Add to the job' }));
      await waitFor(() => expect(screen.getAllByRole('link', { name: /download photo/i })).toHaveLength(2));
      expect(reads.work_orders).toBe(choicesRead);
      // The one just added is marked New, as it sits under its own day among the others
      // (Fred, 2026-10-26: "when i add a photo it not saving on the job log").
      const added = screen.getAllByAltText(/^photo/i).find((img) => img.getAttribute('src') === 'https://example.test/added.jpg')!;
      expect(added.parentElement!.textContent).toMatch(/^New/);
      const first = screen.getAllByAltText(/^photo/i).find((img) => img.getAttribute('src') === 'https://example.test/site.jpg')!;
      expect(first.parentElement!.textContent).not.toMatch(/New/);
    } finally {
      tables.wo_photos = before;
    }
  });

  it('saves a PNG receipt as a PNG (Greptile on PR #23)', async () => {
    const before = tables.job_expenses;
    tables.job_expenses = [{ id: 'x4', contractor_name: 'Paul Gibbs', category: 'materials', vendor: 'Home Depot', amount: 12.5, expense_date: '2026-10-20', status: 'approved', receipt_path: 'r/office_1.png' }];
    try {
      render(<JobLogReport w={wo} deliverables={[]} onClose={() => {}} />);
      const link = await screen.findByRole('link', { name: /download materials, home depot/i });
      expect(link.getAttribute('download')).toBe('WO 19101401 Materials Home Depot $12.50 Paul Gibbs 10-20-2026.png');
    } finally {
      tables.job_expenses = before;
    }
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
      const link = await screen.findByRole('link', { name: /^lodging, quality inn: \$350\.74/i });
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
    fireEvent.click(screen.getByLabelText(/pictures left out \(2\)/i));
    expect(screen.getByRole('button', { name: /put back in the log: odometer start/i })).toBeTruthy();
  });

  it("shows each day's miles with the odometer, and the total (Fred: \"i don't see the mileages on the job logs\")", async () => {
    render(<JobLogReport w={wo} deliverables={[]} onClose={() => {}} />);
    const table = (await screen.findByRole('heading', { name: 'Mileage' })).nextElementSibling as HTMLElement;
    const cells = [...table.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent));
    // Laid out like the hours (Fred, 2026-10-30): name and date on every row, the tech's total, then the overall total.
    expect(cells).toEqual([
      ['Paul Gibbs', '10/19/2026', '41,200', '41,218', '18'],
      ['Paul Gibbs total miles · 1 day', '18'],
      ['Overall total miles', '18'],
    ]);
  });
});

describe('Job log meals, materials and other receipts', () => {
  // Fred, 2026-10-30: below the hours and the mileage, "the same with ... food then materials etc",
  // and "meals get entered by receipt so does materials": what the tech said the receipt was for.
  it("lists each tech's receipts and total, the lead tech first, then the overall total", async () => {
    const before = tables.job_expenses;
    const ex = (id: string, tech: string, category: string, vendor: string | null, amount: number, day: string, status = 'approved') =>
      ({ id, contractor_name: tech, category, vendor, amount, expense_date: `2026-10-${day}`, status, decline_reason: null, receipt_path: `r/${id}.jpg` });
    tables.job_expenses = [
      ex('m1', 'Kendell Newbold', 'meals', 'Bojangles', 12.25, '19'),
      ex('m2', 'Paul Gibbs', 'meals', 'Waffle House', 18.5, '19'),
      ex('t1', 'Paul Gibbs', 'materials', "Lowe's", 47.48, '20'),
      ex('t2', 'Paul Gibbs', 'materials', "Lowe's", 104.17, '21'),
      ex('h1', 'Paul Gibbs', 'hotel', 'Quality Inn', 350.74, '18'),
      { ...ex('f1', 'Paul Gibbs', 'fuel', null, 76.75, '21'), note: ' Van, drive home ' },
      // Neither is on the log: one declined, one still waiting on Fred.
      ex('f2', 'Paul Gibbs', 'fuel', 'Circle K', 76.75, '21', 'declined'),
      ex('m3', 'Kendell Newbold', 'meals', 'Subway', 9.99, '20', 'submitted'),
    ];
    try {
      render(<JobLogReport w={{ ...wo, contractor_names: ['Kendell Newbold', 'Paul Gibbs'], lead_contractor_name: 'Paul Gibbs' } as EnrichedWorkOrder} deliverables={[]} onClose={() => {}} />);
      const rows = async (name: string) => {
        const table = (await screen.findByRole('heading', { name })).nextElementSibling as HTMLElement;
        return [...table.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent));
      };
      expect(await rows('Meals')).toEqual([
        ['Paul Gibbs', '10/19/2026', 'Waffle House', '$18.50'],
        ['Paul Gibbs total meals · 1 receipt', '$18.50'],
        ['Kendell Newbold', '10/19/2026', 'Bojangles', '$12.25'],
        ['Kendell Newbold total meals · 1 receipt', '$12.25'],
        ['Overall total meals', '$30.75'],
      ]);
      expect(await rows('Materials')).toEqual([
        ['Paul Gibbs', '10/20/2026', "Lowe's", '$47.48'],
        ['Paul Gibbs', '10/21/2026', "Lowe's", '$104.17'],
        ['Paul Gibbs total materials · 2 receipts', '$151.65'],
        ['Overall total materials', '$151.65'],
      ]);
      expect(screen.getByText('Kendell Newbold: no materials on this job.')).toBeTruthy();
      expect(await rows('Other receipts')).toEqual([
        ['Paul Gibbs', '10/18/2026', 'Lodging', 'Quality Inn', '$350.74'],
        ['Paul Gibbs', '10/21/2026', 'Fuel · Van, drive home', '—', '$76.75'],
        ['Paul Gibbs total · 2 receipts', '$427.49'],
        ['Overall total other receipts', '$427.49'],
      ]);
      // The same totals at the top.
      expect(screen.getByText('Meals', { selector: 'div' }).nextElementSibling!.textContent).toBe('$30.75');
      expect(screen.getByText('Materials', { selector: 'div' }).nextElementSibling!.textContent).toBe('$151.65');
      expect(screen.getByText('Other receipts', { selector: 'div' }).nextElementSibling!.textContent).toBe('$427.49');
      // Only some days picked: the line speaks for those dates, not the whole job (Greptile on PR #38).
      fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-20' } });
      expect(await screen.findByText('Kendell Newbold: no materials in these dates.')).toBeTruthy();
    } finally {
      tables.job_expenses = before;
    }
  });
});

describe('Job log, each tech on their own', () => {
  // Fred, 2026-10-29: "Show all of Paul hours and total, Kendall total ... Paul and Kendall separated grouping".
  it("lists the lead tech's days and total first, then the helper's, then all techs", async () => {
    const before = tables.job_punches;
    tables.job_punches = [
      { contractor_name: 'Kendell Newbold', kind: 'in', at: at('19', '07:37'), lat: null, lng: null, accuracy: null },
      { contractor_name: 'Paul Gibbs', kind: 'in', at: at('19', '07:37'), lat: null, lng: null, accuracy: null },
      { contractor_name: 'Kendell Newbold', kind: 'out', at: at('19', '17:37'), lat: null, lng: null, accuracy: null },
      { contractor_name: 'Paul Gibbs', kind: 'out', at: at('19', '17:37'), lat: null, lng: null, accuracy: null },
      { contractor_name: 'Kendell Newbold', kind: 'in', at: at('20', '07:50'), lat: null, lng: null, accuracy: null },
      { contractor_name: 'Paul Gibbs', kind: 'in', at: at('20', '07:50'), lat: null, lng: null, accuracy: null },
      { contractor_name: 'Kendell Newbold', kind: 'out', at: at('20', '18:09'), lat: null, lng: null, accuracy: null },
      { contractor_name: 'Paul Gibbs', kind: 'out', at: at('20', '12:20'), lat: null, lng: null, accuracy: null },
    ];
    try {
      // Fred, 2026-10-29: "Lead tech first and then helper tech": Paul leads, though Kendell is listed first.
      render(<JobLogReport w={{ ...wo, contractor_names: ['Kendell Newbold', 'Paul Gibbs'], lead_contractor_name: 'Paul Gibbs' } as EnrichedWorkOrder} deliverables={[]} onClose={() => {}} />);
      // The heading shows "Loading…" first; wait for the table itself (CodeRabbit on PR #35).
      const heading = await screen.findByRole('heading', { name: 'Time on site' });
      const table = await waitFor(() => {
        const next = heading.nextElementSibling;
        expect(next?.tagName).toBe('TABLE');
        expect(next!.querySelectorAll('tbody tr').length).toBeGreaterThan(1);
        return next as HTMLElement;
      });
      // Fred, 2026-10-29: "Paul 10/23 8am to 5pm total 9 ... Final Hours 19 hours ... Overall total worked 36",
      // and "Don't show the money all we want to see is how much was on site".
      // Laid out like Fred's own sheet (2026-10-30): Name | date | clock in | clock out | break | hours, the date with its year.
      expect([...table.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual(['Name', 'Date', 'Clock in', 'Clock out', 'Break', 'Hours']);
      const rows = [...table.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent));
      expect(rows).toEqual([
        ['Paul Gibbs', '10/19/2026', '7:37 AM', '5:37 PM', '—', '10'],
        ['Paul Gibbs', '10/20/2026', '7:50 AM', '12:20 PM', '—', '4.5'],
        ['Paul Gibbs final hours · 2 days', '14.5'],
        ['Kendell Newbold', '10/19/2026', '7:37 AM', '5:37 PM', '—', '10'],
        ['Kendell Newbold', '10/20/2026', '7:50 AM', '6:09 PM', '—', '10.32'],
        ['Kendell Newbold final hours · 2 days', '20.32'],
        ['Overall total worked', '34.82'],
      ]);
      expect(within(table).queryByText(/\$/)).toBeNull();
      // The summary at the top shows the same hours as the table's last line.
      expect(screen.getByText('Hours on site').nextElementSibling!.textContent).toBe('34.82');
    } finally {
      tables.job_punches = before;
    }
  });
  it('ends with the overall total worked when one tech did the job', async () => {
    const before = tables.job_punches;
    tables.job_punches = [
      { contractor_name: 'Paul Gibbs', kind: 'in', at: at('19', '08:00'), lat: null, lng: null, accuracy: null },
      { contractor_name: 'Paul Gibbs', kind: 'out', at: at('19', '17:00'), lat: null, lng: null, accuracy: null },
    ];
    try {
      render(<JobLogReport w={wo} deliverables={[]} onClose={() => {}} />);
      const heading = await screen.findByRole('heading', { name: 'Time on site' });
      const table = await waitFor(() => {
        const next = heading.nextElementSibling;
        expect(next?.tagName).toBe('TABLE');
        return next as HTMLElement;
      });
      const rows = [...table.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent));
      expect(rows).toEqual([
        ['Paul Gibbs', '10/19/2026', '8:00 AM', '5:00 PM', '—', '9'],
        ['Paul Gibbs final hours · 1 day', '9'],
        ['Overall total worked', '9'],
      ]);
    } finally {
      tables.job_punches = before;
    }
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

  it('heads the page with the client WO, the site number and address, the schedule and the technicians (Fred, 2026-10-30)', async () => {
    const gaffney = { ...wo, external_wo_id: 'LDS-1110', customer_name: 'LDS', site_name: 'LDS Site 5011876', site_address: '701 West Buford Street', site_city: 'Gaffney', site_state: 'SC' } as EnrichedWorkOrder;
    render(<JobLogReport w={gaffney} deliverables={[]} onClose={() => {}} />);
    const head = screen.getByText('Client WO #:').parentElement!.parentElement!;
    expect([...head.children].map((d) => d.textContent)).toEqual([
      'Client WO #: LDS-1110', 'Site number: 5011876', 'Site address: 701 West Buford Street, Gaffney, SC',
      'Schedule: Mon, Oct 19 – Fri, Oct 23, 2026', 'Technician: Paul Gibbs',
    ]);
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

describe('Job log edited by the office', () => {
  // Fred, 2026-10-30: "Used this layout with what we have and I need to edit all of it hours time milages
  // materials etc all of it", in the app and in Excel ("Both"), with no billable total ("No, keep it off").
  const rowsOf = (heading: HTMLElement) => [...(heading.nextElementSibling as HTMLElement).querySelectorAll('tbody tr')]
    .map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent));
  const withPunches = async (run: () => Promise<void>) => {
    const before = tables.job_punches;
    tables.job_punches = [
      { contractor_name: 'Paul Gibbs', kind: 'in', at: at('19', '08:00'), lat: null, lng: null, accuracy: null },
      { contractor_name: 'Paul Gibbs', kind: 'out', at: at('19', '17:00'), lat: null, lng: null, accuracy: null },
    ];
    try { await run(); } finally { tables.job_punches = before; }
  };

  it('edits the hours, the miles and the receipts, saves them on the job, and the log shows them', () => withPunches(async () => {
    render(<JobLogReport w={wo} deliverables={[]} onClose={() => {}} />);
    const edit = await screen.findByRole('button', { name: /edit time sheet/i });
    await waitFor(() => expect((edit as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(edit);
    // What's edited is the time sheet; the page keeps its name, Job log (Fred, 2026-10-30).
    expect(screen.getByRole('heading', { name: 'Time sheet' })).toBeTruthy();
    expect(screen.getByText('JOB LOG')).toBeTruthy();
    // While editing, the print and Excel wait for the save.
    expect((screen.getByRole('button', { name: /print \/ save as pdf/i }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /excel/i }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Clock out, time row 1'), { target: { value: '17:30' } });
    fireEvent.change(screen.getByLabelText('Break, time row 1'), { target: { value: '0.5' } });
    // 8:00 to 5:30 less half an hour.
    expect(screen.getByText('Total 9 hours')).toBeTruthy();
    // The odometer's end typed again: the miles follow it.
    fireEvent.click(screen.getByRole('button', { name: 'Mileage (1)' }));
    fireEvent.change(screen.getByLabelText('Odometer end, miles row 1'), { target: { value: '41230' } });
    expect((screen.getByLabelText('Miles, miles row 1') as HTMLInputElement).value).toBe('30');
    // A meal receipt added by hand: the job's tech and first day to start with.
    fireEvent.click(screen.getByRole('button', { name: 'Meals (0)' }));
    const meals = screen.getByRole('heading', { name: 'Meals' }).parentElement!;
    fireEvent.click(within(meals).getByRole('button', { name: /add a row/i }));
    fireEvent.change(screen.getByLabelText('Store, meals row 1'), { target: { value: ' Waffle House ' } });
    fireEvent.change(screen.getByLabelText('Amount, meals row 1'), { target: { value: '18.50' } });
    // And the declined fuel never was on it; the Lowe's receipt stays.
    fireEvent.click(screen.getByRole('button', { name: /save time sheet/i }));

    await waitFor(() => expect(updates.at(-1)).toEqual({
      job_log_sheet: {
        time: [{ tech: 'Paul Gibbs', day: '2026-10-19', in: '08:00', out: '17:30', brk: 0.5 }],
        miles: [{ tech: 'Paul Gibbs', day: '2026-10-19', start: 41200, end: 41230, miles: 30 }],
        meals: [{ tech: 'Paul Gibbs', day: '2026-10-19', store: 'Waffle House', amount: 18.5 }],
        materials: [{ tech: 'Paul Gibbs', day: '2026-10-21', store: "Lowe's", amount: 104.17 }],
        other: [],
      },
    }));
    expect(rowsOf(await screen.findByRole('heading', { name: 'Time on site' }))).toEqual([
      ['Paul Gibbs', '10/19/2026', '8:00 AM', '5:30 PM', '0.5', '9'],
      ['Paul Gibbs final hours · 1 day', '9'],
      ['Overall total worked', '9'],
    ]);
    expect(rowsOf(screen.getByRole('heading', { name: 'Mileage' }))[0]).toEqual(['Paul Gibbs', '10/19/2026', '41,200', '41,230', '30']);
    expect(rowsOf(screen.getByRole('heading', { name: 'Meals' }))[0]).toEqual(['Paul Gibbs', '10/19/2026', 'Waffle House', '$18.50']);
    expect(screen.getByText(/the job log shows your time sheet/i)).toBeTruthy();
    // The job's hours and miles in one line, no money on it (Fred: "i dont want it mix"), and no billable total.
    expect(screen.getByText('JOB TOTAL').parentElement!.textContent).toBe('JOB TOTALHours 9Miles 30');
    expect(screen.queryByText(/billable/i)).toBeNull();
  }));

  it('shows a day as the office retimed it on the Hours screen, in place of its clock-ins (Fred: "edit the time sheet and it shows on the job logs")', () => withPunches(async () => {
    const before = tables.field_sheet_days;
    // Paul clocked 8:00 to 5:00 on 10/19; the office set 8:30 to 5:00 with a 30-minute lunch on the Hours screen.
    tables.field_sheet_days = [{ id: 's1', day: '2026-10-19', tech: 'Paul Gibbs', edits: { odoStart: 41200, odoEnd: 41218, arrived: '08:30', leftSite: '17:00', lunch: 30 }, added: false, hidden: false }];
    try {
      render(<JobLogReport w={wo} deliverables={[]} onClose={() => {}} />);
      const heading = await screen.findByRole('heading', { name: 'Time on site' });
      await waitFor(() => expect(rowsOf(heading)[0]).toEqual(['Paul Gibbs', '10/19/2026', '8:30 AM', '5:00 PM', '0.5', '8']));
      expect(rowsOf(heading)).toHaveLength(3);
      expect(screen.getByText('Hours on site').nextElementSibling!.textContent).toBe('8');
    } finally {
      tables.field_sheet_days = before;
    }
  }));

  it('leaves a day hidden on the Hours screen off the job log', () => withPunches(async () => {
    const before = tables.field_sheet_days;
    tables.field_sheet_days = [{ id: 's1', day: '2026-10-19', tech: 'Paul Gibbs', edits: { odoStart: 41200, odoEnd: 41218 }, added: false, hidden: true }];
    try {
      render(<JobLogReport w={wo} deliverables={[]} onClose={() => {}} />);
      await screen.findByRole('button', { name: /edit time sheet/i });
      await waitFor(() => expect(screen.getByRole('heading', { name: 'Materials' })).toBeTruthy());
      expect(screen.queryByRole('heading', { name: 'Time on site' })).toBeNull();
      expect(screen.queryByRole('heading', { name: 'Mileage' })).toBeNull();
    } finally {
      tables.field_sheet_days = before;
    }
  }));

  it('reads the saved sheet when the log is closed and opened again while the save is still going (Greptile on PR #39)', () => withPunches(async () => {
    const before = tables.work_orders;
    persistSheet = true;
    saveDelays = [200];
    try {
      const first = render(<JobLogReport w={wo} deliverables={[]} onClose={() => {}} />);
      const edit = await screen.findByRole('button', { name: /edit time sheet/i });
      await waitFor(() => expect((edit as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(edit);
      fireEvent.change(screen.getByLabelText('Clock out, time row 1'), { target: { value: '16:00' } });
      fireEvent.click(screen.getByRole('button', { name: /save time sheet/i }));
      first.unmount();
      render(<JobLogReport w={wo} deliverables={[]} onClose={() => {}} />);
      const heading = await screen.findByRole('heading', { name: 'Time on site' });
      await waitFor(() => expect(rowsOf(heading)[0]).toEqual(['Paul Gibbs', '10/19/2026', '8:00 AM', '4:00 PM', '—', '8']));
    } finally {
      tables.work_orders = before;
      persistSheet = false;
    }
  }));

  it('takes only a number in a number box, so the box never shows one figure and saves another (Greptile on PR #39)', () => withPunches(async () => {
    render(<JobLogReport w={wo} deliverables={[]} onClose={() => {}} />);
    const edit = await screen.findByRole('button', { name: /edit time sheet/i });
    await waitFor(() => expect((edit as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(edit);
    fireEvent.click(screen.getByRole('button', { name: 'Materials (1)' }));
    const amount = screen.getByLabelText('Amount, materials row 1') as HTMLInputElement;
    expect(amount.value).toBe('104.17');
    fireEvent.change(amount, { target: { value: '18..50' } });
    expect(amount.value).toBe('104.17');
    fireEvent.change(amount, { target: { value: '$1,018.50' } });
    expect(amount.value).toBe('$1,018.50');
    const materials = screen.getByRole('heading', { name: 'Materials' }).parentElement!;
    expect(within(materials).getByText('Total $1,018.50')).toBeTruthy();
  }));

  it('opens each part of the time sheet from its button, hotels with the other receipts (Fred: "where do i edit hotels materials and meals and milages? i only see hours")', () => withPunches(async () => {
    render(<JobLogReport w={wo} deliverables={[]} onClose={() => {}} />);
    const edit = await screen.findByRole('button', { name: /edit time sheet/i });
    await waitFor(() => expect((edit as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(edit);
    const parts = screen.getByRole('group', { name: 'Time sheet sections' });
    expect(within(parts).getAllByRole('button').map((t) => t.textContent)).toEqual(['Hours (1)', 'Mileage (1)', 'Meals (0)', 'Materials (1)', 'Hotels & other (0)']);
    // The hours first; one part at a time.
    expect(screen.getByRole('button', { name: 'Hours (1)' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Mileage (1)' }).getAttribute('aria-pressed')).toBe('false');
    const shownNow = (label: string) => !screen.getByLabelText(label).closest('[hidden]');
    expect(shownNow('Clock in, time row 1')).toBe(true);
    expect(shownNow('Odometer start, miles row 1')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Mileage (1)' }));
    expect(shownNow('Odometer start, miles row 1')).toBe(true);
    expect(shownNow('Clock in, time row 1')).toBe(false);
    // A number half typed stays as typed when another part is opened and back (CodeRabbit on PR #40).
    fireEvent.change(screen.getByLabelText('Odometer end, miles row 1'), { target: { value: '41230.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Hours (1)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mileage (1)' }));
    expect((screen.getByLabelText('Odometer end, miles row 1') as HTMLInputElement).value).toBe('41230.');
    // A hotel added by hand: what it was for, the store and the amount; it counts on its button.
    fireEvent.click(screen.getByRole('button', { name: 'Hotels & other (0)' }));
    const other = screen.getByRole('heading', { name: 'Hotels & other receipts' }).parentElement!;
    fireEvent.click(within(other).getByRole('button', { name: /add a row/i }));
    fireEvent.change(screen.getByLabelText('For, other row 1'), { target: { value: 'Hotel' } });
    fireEvent.change(screen.getByLabelText('Store, other row 1'), { target: { value: 'Hampton Inn' } });
    fireEvent.change(screen.getByLabelText('Amount, other row 1'), { target: { value: '129' } });
    expect(screen.getByRole('button', { name: 'Hotels & other (1)' })).toBeTruthy();
    expect(within(other).getByText('Total $129.00')).toBeTruthy();
    // An edit stays when another part is opened and back.
    fireEvent.click(screen.getByRole('button', { name: 'Hours (1)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hotels & other (1)' }));
    expect((screen.getByLabelText('Store, other row 1') as HTMLInputElement).value).toBe('Hampton Inn');
  }));

  it("keeps a row's Hours screen hours until both clock times replace them; the break comes off them (Greptile on PR #39)", async () => {
    const before = tables.work_orders;
    tables.work_orders = [{ job_log_left_out: [], job_log_receipt_photos: [], job_log_sheet: {
      time: [{ tech: 'Paul Gibbs', day: '2026-10-20', in: '', out: '', brk: 0, hours: 6 }], miles: [], meals: [], materials: [], other: [],
    } }];
    try {
      render(<JobLogReport w={wo} deliverables={[]} onClose={() => {}} />);
      const edit = await screen.findByRole('button', { name: /edit time sheet/i });
      await waitFor(() => expect((edit as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(edit);
      const time = screen.getByRole('heading', { name: 'Time on site' }).parentElement!;
      expect(within(time).getByText('Total 6 hours')).toBeTruthy();
      // A break typed too big, then cleared: the six hours are back, not more (Greptile on PR #39).
      fireEvent.change(screen.getByLabelText('Break, time row 1'), { target: { value: '7' } });
      expect(within(time).getByText('Total 0 hours')).toBeTruthy();
      fireEvent.change(screen.getByLabelText('Break, time row 1'), { target: { value: '' } });
      expect(within(time).getByText('Total 6 hours')).toBeTruthy();
      fireEvent.change(screen.getByLabelText('Break, time row 1'), { target: { value: '0.5' } });
      expect(within(time).getByText('Total 5.5 hours')).toBeTruthy();
      // One clock time isn't enough to replace them.
      fireEvent.change(screen.getByLabelText('Clock in, time row 1'), { target: { value: '08:00' } });
      expect(within(time).getByText('Total 5.5 hours')).toBeTruthy();
      // Both: the hours follow the times.
      fireEvent.change(screen.getByLabelText('Clock out, time row 1'), { target: { value: '17:00' } });
      expect(within(time).getByText('Total 8.5 hours')).toBeTruthy();
    } finally {
      tables.work_orders = before;
    }
  });

  it("won't save a row without a name, and says which", () => withPunches(async () => {
    vi.mocked(toastError).mockClear();
    render(<JobLogReport w={wo} deliverables={[]} onClose={() => {}} />);
    const edit = await screen.findByRole('button', { name: /edit time sheet/i });
    await waitFor(() => expect((edit as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(edit);
    fireEvent.change(screen.getByLabelText('Name, time row 1'), { target: { value: '  ' } });
    fireEvent.click(screen.getByRole('button', { name: /save time sheet/i }));
    expect(toastError).toHaveBeenCalledWith('Each row needs a name and a date: Time on site row 1.');
    expect(updates.some((u) => 'job_log_sheet' in u)).toBe(false);
    // Cancel: back to the log as it was.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(rowsOf(await screen.findByRole('heading', { name: 'Time on site' }))[0]).toEqual(['Paul Gibbs', '10/19/2026', '8:00 AM', '5:00 PM', '—', '9']);
  }));

  it('shows the sheet the job has saved, and starts over from the app when asked', async () => {
    const before = tables.work_orders;
    tables.work_orders = [{ job_log_left_out: [], job_log_receipt_photos: [], job_log_sheet: {
      time: [{ tech: 'Paul Gibbs', day: '2026-10-19', in: '07:00', out: '15:00', brk: 0 }], miles: [], meals: [], materials: [], other: [],
    } }];
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      render(<JobLogReport w={wo} deliverables={[]} onClose={() => {}} />);
      expect(rowsOf(await screen.findByRole('heading', { name: 'Time on site' }))[0]).toEqual(['Paul Gibbs', '10/19/2026', '7:00 AM', '3:00 PM', '—', '8']);
      // Its miles were taken out, so there's no mileage; the receipts too.
      expect(screen.queryByRole('heading', { name: 'Mileage' })).toBeNull();
      expect(screen.queryByRole('heading', { name: 'Materials' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: /start over from the app/i }));
      await waitFor(() => expect(updates.at(-1)).toEqual({ job_log_sheet: null }));
      // The app's again: no clock-ins on this job, the Field Sheet's 18 miles and the Lowe's receipt.
      expect(rowsOf(await screen.findByRole('heading', { name: 'Mileage' }))[0]).toEqual(['Paul Gibbs', '10/19/2026', '41,200', '41,218', '18']);
      expect(screen.queryByRole('heading', { name: 'Time on site' })).toBeNull();
      expect(screen.queryByText(/the job log shows your time sheet/i)).toBeNull();
    } finally {
      tables.work_orders = before;
      confirm.mockRestore();
    }
  });

  it("saves Excel as Fred's workbook with the log's rows, named like the PDF", async () => {
    vi.mocked(downloadJobLogXlsx).mockClear();
    const gaffney = { ...wo, external_wo_id: 'LDS-1110', customer_name: 'LDS', site_name: 'LDS Site 5011876', site_city: 'Gaffney', site_state: 'SC' } as EnrichedWorkOrder;
    render(<JobLogReport w={gaffney} deliverables={[]} onClose={() => {}} />);
    const excel = screen.getByRole('button', { name: /excel/i }) as HTMLButtonElement;
    await waitFor(() => expect(excel.disabled).toBe(false));
    fireEvent.click(excel);
    expect(downloadJobLogXlsx).toHaveBeenCalledWith(
      'LDS-1110 Site 5011876 — Gaffney, SC · 10-19-2026 – 10-23-2026 · Time sheet.xlsx',
      expect.objectContaining({
        miles: [{ tech: 'Paul Gibbs', day: '2026-10-19', start: 41200, end: 41218, miles: 18 }],
        materials: [{ tech: 'Paul Gibbs', day: '2026-10-21', store: "Lowe's", amount: 104.17 }],
      }),
      { title: 'Gaffney', lines: ['Client: LDS · Client WO #: LDS-1110 · FAJ WO #: 19101401', 'Site: LDS Site 5011876 — Gaffney, SC', 'Technician: Paul Gibbs'], range: 'Whole job', crew: ['Paul Gibbs'] },
      // The tech's copy: no rates.
      undefined,
    );
  });

  it("makes a client's copy with each tech's rates and the dollars, and a tech's copy without (Fred: \"the client just asked for this\")", () => withPunches(async () => {
    vi.mocked(downloadJobLogXlsx).mockClear();
    render(<JobLogReport w={wo} deliverables={[]} onClose={() => {}} />);
    const print = await screen.findByRole('button', { name: /print \/ save as pdf/i }) as HTMLButtonElement;
    await waitFor(() => expect(print.disabled).toBe(false));
    // The tech's copy first: no rates, no charges.
    expect(screen.getByRole('button', { name: 'Tech copy (no rates)' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByLabelText('$ per hour, Paul Gibbs')).toBeNull();
    expect(screen.queryByText('Rate')).toBeNull();
    expect(screen.queryByText('TOTAL CHARGES')).toBeNull();
    const techTitle = document.title;

    fireEvent.click(screen.getByRole('button', { name: 'Client copy (rates)' }));
    expect(document.title).toBe(`${techTitle} · Client copy`);
    // The rates table starts with a row for each tech on the sheet; with no rate set, nothing's charged, and Fred is told whose.
    expect((screen.getByLabelText('Name, rate row 1') as HTMLSelectElement).value).toBe('Paul Gibbs');
    // No client copy with no rates on it, so never one saying $0.00 (CodeRabbit on PR #40).
    expect(print.disabled).toBe(true);
    expect((screen.getByRole('button', { name: /excel/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Set a rate and save it to print the client’s copy.')).toBeTruthy();
    expect(screen.getByText('Not charged (no rates): Paul Gibbs.')).toBeTruthy();
    expect(screen.queryByText('TOTAL CHARGES')).toBeNull();
    fireEvent.change(screen.getByLabelText('$ per hour, Paul Gibbs'), { target: { value: '65' } });
    fireEvent.change(screen.getByLabelText('$ per mile, Paul Gibbs'), { target: { value: '.70' } });
    // The total as they're typed (Fred: "i enter the rates and it shows the total"); the page waits for the save, so
    // even the browser's own print never has rates that aren't kept (CodeRabbit on PR #40).
    expect(screen.getByText('Total $597.60')).toBeTruthy();
    expect(screen.queryByText('TOTAL CHARGES')).toBeNull();
    // Saved before it's printed, so what the client gets is what's kept.
    expect(print.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /save rates/i }));
    await waitFor(() => expect(print.disabled).toBe(false));
    expect(upserts).toEqual([{ table: 'job_log_rates', row: expect.objectContaining({ wo_id: 'wo', rates: { 'Paul Gibbs': { hour: 65, mile: 0.7 } } }), onConflict: 'wo_id' }]);
    expect(screen.queryByText(/Not charged/)).toBeNull();
    // Each row of the hours gets the rate and its dollars, and the miles the mileage rate (Fred: "in the hours should
    // get the rate and the same for the milage gets the milages rate"); the totals have the dollars too.
    expect(rowsOf(screen.getByRole('heading', { name: 'Time on site' }))).toEqual([
      ['Paul Gibbs', '10/19/2026', '8:00 AM', '5:00 PM', '—', '9', '$65.00/hr', '$585.00'],
      ['Paul Gibbs final hours · 1 day', '9', '', '$585.00'],
      ['Overall total worked', '9', '', '$585.00'],
    ]);
    expect(rowsOf(screen.getByRole('heading', { name: 'Mileage' }))).toEqual([
      ['Paul Gibbs', '10/19/2026', '41,200', '41,218', '18', '$0.70/mi', '$12.60'],
      ['Paul Gibbs total miles · 1 day', '18', '', '$12.60'],
      ['Overall total miles', '18', '', '$12.60'],
    ]);
    expect(screen.getByText('TOTAL CHARGES').parentElement!.textContent).toBe('TOTAL CHARGESHours $585.00Mileage $12.60Total $597.60');
    // The hours and miles band stays as it was.
    expect(screen.getByText('JOB TOTAL').parentElement!.textContent).toBe('JOB TOTALHours 9Miles 18');

    fireEvent.click(screen.getByRole('button', { name: /excel/i }));
    expect(downloadJobLogXlsx).toHaveBeenCalledWith(expect.stringMatching(/ · Client time sheet\.xlsx$/), expect.anything(), expect.anything(),
      { 'Paul Gibbs': { hour: 65, mile: 0.7 } });

    // Back to the tech's copy: none of it.
    fireEvent.click(screen.getByRole('button', { name: 'Tech copy (no rates)' }));
    expect(document.title).toBe(techTitle);
    expect(screen.queryByText(/TOTAL CHARGES|\$585|\$65\.00/)).toBeNull();
    expect(rowsOf(screen.getByRole('heading', { name: 'Time on site' }))[0]).toEqual(['Paul Gibbs', '10/19/2026', '8:00 AM', '5:00 PM', '—', '9']);
  }));

  it('has a table to add a tech\'s rates or take them out (Fred: "on the job log give me a table to add or remove rates")', () => withPunches(async () => {
    tables.job_log_rates = [{ rates: { 'Paul Gibbs': { hour: 65, mile: 0.7 } } }];
    const helper = { ...wo, contractor_names: ['Paul Gibbs', 'Kendell Newbold'] } as EnrichedWorkOrder;
    try {
      render(<JobLogReport w={helper} deliverables={[]} onClose={() => {}} />);
      const print = await screen.findByRole('button', { name: /print \/ save as pdf/i }) as HTMLButtonElement;
      await waitFor(() => expect(print.disabled).toBe(false));
      fireEvent.click(screen.getByRole('button', { name: 'Client copy (rates)' }));
      await waitFor(() => expect((screen.getByLabelText('$ per hour, Paul Gibbs') as HTMLInputElement).value).toBe('65'));
      // Kendell's on the job: added with his own rate, per hour only; an empty box isn't charged.
      fireEvent.click(screen.getByRole('button', { name: /add a rate/i }));
      expect((screen.getByLabelText('Name, rate row 2') as HTMLSelectElement).value).toBe('Kendell Newbold');
      expect((screen.getByRole('button', { name: /add a rate/i }) as HTMLButtonElement).disabled).toBe(true);
      fireEvent.change(screen.getByLabelText('$ per hour, Kendell Newbold'), { target: { value: '55' } });
      expect(print.disabled).toBe(true);
      fireEvent.click(screen.getByRole('button', { name: /save rates/i }));
      await waitFor(() => expect(print.disabled).toBe(false));
      expect(upserts.at(-1)!.row).toMatchObject({ rates: { 'Paul Gibbs': { hour: 65, mile: 0.7 }, 'Kendell Newbold': { hour: 55, mile: null } } });
      expect(screen.getByText('TOTAL CHARGES').parentElement!.textContent).toBe('TOTAL CHARGESHours $585.00Mileage $12.60Total $597.60');
      // Paul's rates taken out: he isn't charged, and Fred is told.
      fireEvent.click(screen.getByRole('button', { name: 'Take out Paul Gibbs' }));
      fireEvent.click(screen.getByRole('button', { name: /save rates/i }));
      await waitFor(() => expect(upserts.at(-1)!.row).toMatchObject({ rates: { 'Kendell Newbold': { hour: 55, mile: null } } }));
      // His rows keep the columns with no rate or dollars on them.
      await waitFor(() => expect(rowsOf(screen.getByRole('heading', { name: 'Time on site' }))[0]).toEqual(['Paul Gibbs', '10/19/2026', '8:00 AM', '5:00 PM', '—', '9', '—', '—']));
      expect(screen.getByText('TOTAL CHARGES').parentElement!.textContent).toBe('TOTAL CHARGESHours $0.00Mileage $0.00Total $0.00');
      expect(screen.getByText('Not charged (no rates): Paul Gibbs.')).toBeTruthy();
    } finally {
      delete tables.job_log_rates;
    }
  }));

  it('keeps the rates on the job: the client copy has them when the log opens again, to the decimal typed', () => withPunches(async () => {
    tables.job_log_rates = [{ rates: { 'Paul Gibbs': { hour: 65, mile: 0.725 } } }];
    try {
      render(<JobLogReport w={wo} deliverables={[]} onClose={() => {}} />);
      const print = await screen.findByRole('button', { name: /print \/ save as pdf/i }) as HTMLButtonElement;
      await waitFor(() => expect(print.disabled).toBe(false));
      fireEvent.click(screen.getByRole('button', { name: 'Client copy (rates)' }));
      await waitFor(() => expect((screen.getByLabelText('$ per hour, Paul Gibbs') as HTMLInputElement).value).toBe('65'));
      expect(print.disabled).toBe(false);
      // $0.725 a mile shows as typed, so 18 × it = $13.05 can be checked (Greptile on PR #40).
      expect(rowsOf(screen.getByRole('heading', { name: 'Mileage' }))[0]).toEqual(['Paul Gibbs', '10/19/2026', '41,200', '41,218', '18', '$0.725/mi', '$13.05']);
      expect(screen.getByText('TOTAL CHARGES').parentElement!.textContent).toBe('TOTAL CHARGESHours $585.00Mileage $13.05Total $598.05');
    } finally {
      delete tables.job_log_rates;
    }
  }));

  it('keeps a rate changed while the rates were saving (Greptile on PR #40)', () => withPunches(async () => {
    render(<JobLogReport w={wo} deliverables={[]} onClose={() => {}} />);
    const print = await screen.findByRole('button', { name: /print \/ save as pdf/i }) as HTMLButtonElement;
    await waitFor(() => expect(print.disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Client copy (rates)' }));
    fireEvent.change(screen.getByLabelText('$ per hour, Paul Gibbs'), { target: { value: '65' } });
    saveDelays = [50];
    fireEvent.click(screen.getByRole('button', { name: /save rates/i }));
    // Changed again before that save is back.
    fireEvent.change(screen.getByLabelText('$ per hour, Paul Gibbs'), { target: { value: '70' } });
    await waitFor(() => expect(upserts).toHaveLength(1));
    expect(upserts[0].row).toMatchObject({ rates: { 'Paul Gibbs': { hour: 65, mile: null } } });
    // The 70 stays in the box, still to save, so nothing prints until it is.
    await waitFor(() => expect(screen.getByText('Save the rates, then print or download.')).toBeTruthy());
    expect((screen.getByLabelText('$ per hour, Paul Gibbs') as HTMLInputElement).value).toBe('70');
    expect(print.disabled).toBe(true);
  }));

  it("won't save over the rates, or print a client copy, when the saved rates didn't load (Greptile, CodeRabbit on PR #40)", () => withPunches(async () => {
    readFails.add('job_log_rates');
    try {
      render(<JobLogReport w={wo} deliverables={[]} onClose={() => {}} />);
      const print = await screen.findByRole('button', { name: /print \/ save as pdf/i }) as HTMLButtonElement;
      await waitFor(() => expect(print.disabled).toBe(false));
      fireEvent.click(screen.getByRole('button', { name: 'Client copy (rates)' }));
      expect(screen.getByRole('alert').textContent).toMatch(/saved rates didn’t load/);
      expect(print.disabled).toBe(true);
      expect((screen.getByRole('button', { name: /excel/i }) as HTMLButtonElement).disabled).toBe(true);
      fireEvent.change(screen.getByLabelText('$ per hour, Paul Gibbs'), { target: { value: '65' } });
      expect((screen.getByRole('button', { name: /save rates/i }) as HTMLButtonElement).disabled).toBe(true);
      // The tech's copy has no rates, so it prints as ever.
      fireEvent.click(screen.getByRole('button', { name: 'Tech copy (no rates)' }));
      expect(print.disabled).toBe(false);
    } finally {
      readFails.delete('job_log_rates');
    }
  }));
});
