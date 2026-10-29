// @vitest-environment jsdom
//
// The Field Sheet on screen: pull a job by its WO number, see the days from
// the techs' taps, type over a figure and decline a receipt. Against a fake
// database holding Week 1 on the LDS Goldsboro site.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EnrichedWorkOrder } from '@/lib/types';

vi.mock('@/lib/toast', () => ({ toastError: vi.fn(), toastSuccess: vi.fn(), toastInfo: vi.fn() }));
const downloadCSVText = vi.fn();
const downloadXLSXBook = vi.fn();
vi.mock('@/lib/export', () => ({ downloadXLSXBook: (...a: unknown[]) => downloadXLSXBook(...a), downloadCSVText: (...a: unknown[]) => downloadCSVText(...a) }));

const at = (day: string, hhmm: string) => new Date(`2026-10-${day}T${hhmm}:00-04:00`).toISOString();
const tables: Record<string, Record<string, unknown>[]> = {
  job_day_events: [
    { id: 'e1', wo_id: 'wo', contractor_name: 'Dwayne Cudjoe', kind: 'travel_start', at: at('21', '07:38'), origin: 'hotel', dest: 'hotel', miles: null },
    { id: 'e2', wo_id: 'wo', contractor_name: 'Dwayne Cudjoe', kind: 'travel_end', at: at('21', '07:44'), origin: null, dest: null, miles: 2.2 },
    { id: 'e3', wo_id: 'wo', contractor_name: 'Dwayne Cudjoe', kind: 'travel_start', at: at('21', '17:18'), origin: 'hotel', dest: 'hotel', miles: null },
    { id: 'e4', wo_id: 'wo', contractor_name: 'Dwayne Cudjoe', kind: 'travel_end', at: at('21', '17:27'), origin: null, dest: null, miles: 2.2 },
  ],
  job_punches: [],
  job_odometer: [],
  job_expenses: [
    { id: 'x1', contractor_name: 'Dwayne Cudjoe', category: 'fuel', vendor: 'Sheetz', amount: 64, expense_date: '2026-10-22', note: null, receipt_path: null, status: 'approved', decline_reason: null, paid_by: 'tech' },
    { id: 'x2', contractor_name: null, category: 'hotel', vendor: 'Hampton Inn', amount: 226, expense_date: '2026-10-21', note: null, receipt_path: null, status: 'approved', decline_reason: null, paid_by: 'faj' },
  ],
  wo_photos: [],
  field_sheets: [{ settings: { mileRate: 0.6 } }],
  field_sheet_days: [],
  user_settings: [{ mileage_rate: 0.7 }],
  customers: [
    { id: 'cu1', name: 'NetView', billing_email: 'ap@netview.com', default_mileage_rate: 0.6, payment_terms: 'Net 30' },
    { id: 'cu2', name: "Wendy's", billing_email: null, default_mileage_rate: null, payment_terms: null },
  ],
  field_sheet_invoices: [],
};
const upserts: [string, Record<string, unknown>][] = [];
const rpc = vi.fn(async () => ({ data: { ok: true, status: 'declined' }, error: null }));

function query(table: string) {
  const result = () => ({ data: tables[table] ?? [], error: null });
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'gte', 'lt', 'lte', 'order', 'limit', 'delete']) chain[m] = () => chain;
  chain.then = (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, bad);
  chain.maybeSingle = async () => ({ data: (tables[table] ?? [])[0] ?? null, error: null });
  chain.single = async () => ({ data: { id: 'saved-1' }, error: null });
  chain.upsert = (row: Record<string, unknown>) => { upserts.push([table, row]); return chain; };
  return chain;
}
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (t: string) => query(t),
    rpc,
    auth: { getUser: async () => ({ data: { user: { email: 'fajsolutions@gmail.com', user_metadata: { full_name: 'Fred Jeffers' } } } }) },
    storage: { from: () => ({ createSignedUrls: async () => ({ data: [] }) }) },
  }),
}));

const { default: FieldSheetView } = await import('./FieldSheetView');

const wo = {
  id: 'wo', wo_number: '19101402', external_wo_id: 'LDS-1106', client_reference: '5006643', site_name: 'LDS Site 5006643', title: 'LDS Site 5006643',
  site_address: '1000 Eleventh Street', site_city: 'Goldsboro', site_state: 'NC', site_zip: '27530',
  contractor_names: ['Dwayne Cudjoe', 'Raja Bennett'], contractor_name: 'Dwayne Cudjoe', start_date: '2026-10-21', end_date: '2026-10-21', is_project: false,
} as unknown as EnrichedWorkOrder;

afterEach(() => { cleanup(); upserts.length = 0; rpc.mockClear(); downloadCSVText.mockClear(); downloadXLSXBook.mockClear(); vi.unstubAllGlobals(); vi.useRealTimers(); tables.job_punches = []; });

describe('Field Sheet', () => {
  it('pulls the job by the client ticket and shows the day from the drives, with the guess marked', async () => {
    const user = userEvent.setup();
    render(<FieldSheetView workOrders={[wo]} />);
    await user.type(screen.getByLabelText(/work order number/i), 'LDS-1106');
    await user.click(screen.getByRole('button', { name: /pull it up/i }));
    expect(await screen.findByText('LDS Site 5006643')).toBeTruthy();
    const arrived = screen.getByLabelText('arrived Dwayne Cudjoe 2026-10-21') as HTMLInputElement;
    expect(arrived.value).toBe('07:44');
    expect(arrived.closest('td')!.title).toMatch(/worked out from the drives/i);
    // Raja is on the job with nothing in the app that day.
    expect(screen.getByText('Nothing in the app for this day.')).toBeTruthy();
    // 9.57 h on site, 4.4 mi at the sheet's $0.60, not the account's $0.70.
    const hours = screen.getByLabelText('hours Dwayne Cudjoe 2026-10-21') as HTMLInputElement;
    expect(hours.placeholder).toBe('9.57');
    expect(screen.getAllByText('$2.64').length).toBeGreaterThan(0);
  });

  it('saves a typed-over figure as the office’s edit, keyed by the day and tech', async () => {
    const user = userEvent.setup();
    render(<FieldSheetView workOrders={[wo]} />);
    await user.type(screen.getByLabelText(/work order number/i), '19101402{Enter}');
    const hours = await screen.findByLabelText('hours Dwayne Cudjoe 2026-10-21');
    await user.type(hours, '9');
    await user.tab();
    expect(upserts).toContainEqual(['field_sheet_days', expect.objectContaining({ wo_id: 'wo', day: '2026-10-21', tech: 'Dwayne Cudjoe', edits: { hours: 9 } })]);
  });

  it('declines a receipt through the same approval as WorkFlow', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'prompt').mockReturnValue('Entered twice');
    render(<FieldSheetView workOrders={[wo]} />);
    await user.type(screen.getByLabelText(/work order number/i), '19101402{Enter}');
    const approved = (await screen.findByText('Approved: on the bill (2)')).parentElement!;
    await user.click(within(approved).getByRole('button', { name: 'Decline' }));
    expect(rpc).toHaveBeenCalledWith('wf_owner_decide_expense', { p_id: 'x1', p_approve: false, p_reason: 'Entered twice' });
  });

  it('offers Remove, not Decline, on a receipt the office added itself', async () => {
    const user = userEvent.setup();
    render(<FieldSheetView workOrders={[wo]} />);
    await user.type(screen.getByLabelText(/work order number/i), '19101402{Enter}');
    const approved = (await screen.findByText('Approved: on the bill (2)')).parentElement!;
    const hotel = within(approved).getByText('$226.00').closest('div')!;
    expect(within(hotel).getByText('Paid by FAJ')).toBeTruthy();
    expect(within(hotel).getByRole('button', { name: 'Remove' })).toBeTruthy();
    expect(within(hotel).queryByRole('button', { name: 'Decline' })).toBeNull();
  });

  it('bills each day at the client’s hourly rate and sends the week to QuickBooks', async () => {
    const user = userEvent.setup();
    const posted: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
      posted.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ ok: true, invoice_number: '1042', total: 816.09, sent_to: 'ap@netview.com', photos_attached: 0 }), { status: 200 });
    }));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<FieldSheetView workOrders={[wo]} />);
    await user.type(screen.getByLabelText(/work order number/i), '19101402{Enter}');
    // Picking the client fills their email and mileage rate.
    const client = await screen.findByLabelText('Client');
    await user.clear(client);
    await user.type(client, 'NetView');
    await user.tab();
    expect(upserts.at(-1)).toEqual(['field_sheets', expect.objectContaining({ settings: expect.objectContaining({ client: 'NetView', customerId: 'cu1', email: 'ap@netview.com', mileRate: 0.6 }) })]);
    await user.type(screen.getByLabelText('$ per hour on site'), '85');
    await user.tab();
    // Dwayne, Wed: 9.57 h × $85 + 4.4 mi × $0.60, as totals.
    expect(await screen.findByText('Hours on site: 9.57 h')).toBeTruthy();
    expect(screen.getAllByText('$816.09').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /create the invoice in quickbooks/i }));
    expect(posted).toEqual([{ wo_id: 'wo', send: true, photos: false, timesheet: true }]);
  });

  it('never sends a new client’s invoice to the last client’s email', async () => {
    const user = userEvent.setup();
    render(<FieldSheetView workOrders={[wo]} />);
    await user.type(screen.getByLabelText(/work order number/i), '19101402{Enter}');
    // The box is drawn afresh after each save, so it's found again each time.
    const pick = async (name: string) => {
      const box = await screen.findByLabelText('Client');
      await user.clear(box);
      await user.type(box, name);
      await user.tab();
    };
    await pick('NetView');
    expect(upserts.at(-1)?.[1]).toMatchObject({ settings: expect.objectContaining({ email: 'ap@netview.com' }) });
    // Wendy's has no billing email on file: the email empties instead of staying NetView's.
    await pick("Wendy's");
    expect(upserts.at(-1)?.[1]).toMatchObject({ settings: expect.objectContaining({ client: "Wendy's", customerId: 'cu2', email: '' }) });
    // A name that isn't a customer yet empties it too.
    await pick('Acme');
    expect(upserts.at(-1)?.[1]).toMatchObject({ settings: expect.objectContaining({ client: 'Acme', customerId: null, email: '' }) });
  });

  it('gives the client a plain report: one line per day, the times on site, no raw taps', async () => {
    const user = userEvent.setup();
    render(<FieldSheetView workOrders={[wo]} />);
    await user.type(screen.getByLabelText(/work order number/i), '19101402{Enter}');
    await user.click(await screen.findByRole('button', { name: /client report/i }));
    const report = document.getElementById('job-log-root')!;
    expect(within(report).getByText('FIELD SHEET')).toBeTruthy();
    expect(within(report).getByText('7:44 AM – 5:18 PM')).toBeTruthy();
    expect(within(report).getAllByText('9.57 h').length).toBeGreaterThan(0);
    expect(report.textContent).not.toMatch(/Hotel → Hotel/);
    // Raja's blank day isn't on the client's copy.
    expect(report.textContent).not.toMatch(/Raja Bennett/);
  });

  // Fred, 2026-10-29: "show tech one hours and then tech 2 hours heading hours the head 2 milages ... head 3 materials".
  it('breaks the week down by tech: hours, then mileage, then materials, on the sheet, the Excel and the client report', async () => {
    const user = userEvent.setup();
    tables.job_expenses = [...tables.job_expenses,
      { id: 'x3', contractor_name: 'Raja Bennett', category: 'materials', vendor: "Lowe's", amount: 47.48, expense_date: '2026-10-21', note: null, receipt_path: null, status: 'approved', decline_reason: null, paid_by: 'tech' }];
    try {
      render(<FieldSheetView workOrders={[wo]} />);
      await user.type(screen.getByLabelText(/work order number/i), '19101402{Enter}');
      const section = (await screen.findByText('By tech')).closest('section')!;
      const heads = within(section).getAllByRole('heading', { level: 4 }).map((h) => h.textContent);
      expect(heads).toEqual(['1. Hours', '2. Mileage', '3. Materials']);
      const [hours, miles, materials] = within(section).getAllByRole('table');
      expect(within(hours).getByText('Dwayne Cudjoe').closest('tr')!.textContent).toContain('9.57');
      expect(within(miles).getByText('Dwayne Cudjoe').closest('tr')!.textContent).toBe('Dwayne Cudjoe4.4$2.64');
      // Only what was bought for the job: not the fuel (in the mileage) or the hotel (its own line).
      expect(within(materials).getAllByRole('row').map((r) => r.textContent)).toEqual([
        'TechnicianDateForStoreAmount', "Raja BennettWed, Oct 21MaterialsLowe's$47.48", 'Raja Bennett total$47.48', 'Total$47.48',
      ]);

      await user.click(screen.getByRole('button', { name: /excel/i }));
      const sheets = downloadXLSXBook.mock.calls.at(-1)![1] as { name: string; rows: unknown[][] }[];
      expect(sheets.map((x) => x.name)).toEqual(['Field sheet', 'Receipts', 'By tech']);

      await user.click(screen.getByRole('button', { name: /client report/i }));
      const report = document.getElementById('job-log-root')!;
      expect(within(report).getByText('By technician')).toBeTruthy();
      expect(within(report).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['1. Hours', '2. Mileage', '3. Materials']);
    } finally {
      tables.job_expenses = tables.job_expenses.filter((e) => e.id !== 'x3');
    }
  });

  it('lists who is still clocked in and clocks them out at the time the office types', async () => {
    const user = userEvent.setup();
    tables.job_punches = [{ id: 'p1', wo_id: 'wo', wo_number: '19101402', contractor_name: 'Dwayne Cudjoe', kind: 'in', at: at('21', '07:44') }];
    rpc.mockResolvedValueOnce({ data: { ok: true, id: 'p2' }, error: null } as never);
    render(<FieldSheetView workOrders={[wo]} />);
    expect(await screen.findByText('Still on site')).toBeTruthy();
    await user.type(screen.getByLabelText('clock-out time Dwayne Cudjoe WO 19101402'), '17:18');
    await user.click(screen.getByRole('button', { name: /clock out/i }));
    expect(rpc).toHaveBeenCalledWith('wf_owner_fix_punch', expect.objectContaining({
      p_op: 'add', p_wo_id: 'wo', p_tech: 'Dwayne Cudjoe', p_kind: 'out', p_at: '2026-10-21T21:18:00.000Z',
    }));
  });

  it('enters a day in plain boxes: what the app has fills in, every box changes, Save keeps it', async () => {
    const user = userEvent.setup();
    render(<FieldSheetView workOrders={[wo]} />);
    await user.type(screen.getByLabelText(/work order number/i), '19101402{Enter}');
    expect(await screen.findByText('Enter a day')).toBeTruthy();
    // Dwayne on Wed the 21st: the app's arrival is filled in.
    expect((screen.getByLabelText('Arrived on site') as HTMLInputElement).value).toBe('07:44');
    await user.type(screen.getByLabelText('Odometer start'), '41200');
    await user.type(screen.getByLabelText('Odometer end'), '41290');
    await user.type(screen.getByLabelText('Hours on site'), '8');
    await user.click(screen.getByRole('button', { name: 'Save this day' }));
    expect(upserts).toContainEqual(['field_sheet_days', expect.objectContaining({
      day: '2026-10-21', tech: 'Dwayne Cudjoe', edits: { odoStart: 41200, odoEnd: 41290, hours: 8 },
    })]);
    // A day the app doesn't have: blank boxes, typed in and saved as a day the office added.
    const day = screen.getByLabelText('Day');
    await user.clear(day);
    await user.type(day, '2026-10-22');
    expect((screen.getByLabelText('Arrived on site') as HTMLInputElement).value).toBe('');
    await user.type(screen.getByLabelText('Hours on site'), '6.5');
    await user.type(screen.getByLabelText('Notes for this day'), 'Pulled cable, second floor');
    await user.click(screen.getByRole('button', { name: 'Save this day' }));
    expect(upserts).toContainEqual(['field_sheet_days', expect.objectContaining({
      day: '2026-10-22', tech: 'Dwayne Cudjoe', added: true, edits: { hours: 6.5, note: 'Pulled cable, second floor' },
    })]);
  });

  // Fred, 2026-10-25: "i need a auto sheet to enter into quickbooks" (the app
  // couldn't connect), and "each site their own bill and netview link to matched".
  const dryRun = (posted: unknown[], customer = 'LDS') => vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as { imported?: boolean };
    posted.push(body);
    if (body.imported) return new Response(JSON.stringify({ ok: true, imported: true, invoice_number: 'WO-19101402-1021', total: 1009.64 }), { status: 200 });
    return new Response(JSON.stringify({
      dry_run: true, customer, from: '2026-10-21', to: '2026-10-21', memo: 'LDS Site 5006643 — Goldsboro, NC · WO 19101402',
      lines: [
        { kind: 'labor', date: '2026-10-21', description: 'Wed, Oct 21 · Dwayne Cudjoe · on site 9.57 h', qty: 9.57, rate: 100, amount: 957 },
        { kind: 'mileage', date: '2026-10-21', description: 'Wed, Oct 21 · Dwayne Cudjoe · mileage 4.4 mi', qty: 4.4, rate: 0.6, amount: 2.64 },
        { kind: 'meals', date: null, description: 'Meals: 1 tech-days × $50', qty: 1, rate: 50, amount: 50 },
      ],
      total: 1009.64,
    }), { status: 200 });
  }));
  const netviewAnswer = (href: string, entry: number) => new URL(href).searchParams.get(`entry.${entry}`);

  it("makes the sheet's QuickBooks import file from the server's bill, with NetView's form for the same invoice", async () => {
    const user = userEvent.setup();
    const posted: unknown[] = [];
    dryRun(posted);
    render(<FieldSheetView workOrders={[{ ...wo, customer_name: 'LDS', buyer_company: 'NetView' } as EnrichedWorkOrder]} />);
    await user.type(screen.getByLabelText(/work order number/i), '19101402{Enter}');
    await user.click(await screen.findByRole('button', { name: /quickbooks import file/i }));
    expect(posted).toEqual([{ wo_id: 'wo', dry_run: true }]);
    expect(downloadCSVText).toHaveBeenCalledTimes(1);
    const [name, csv] = downloadCSVText.mock.calls[0] as [string, string];
    expect(name).toBe('QuickBooks import WO 19101402.csv');
    expect(csv.split('\n')).toHaveLength(4);
    expect(csv).toContain('"WO-19101402-1021","LDS"');
    expect(csv).toContain('"Wed, Oct 21 · Dwayne Cudjoe · on site 9.57 h","9.57","100.00","957.00","10/21/2026"');
    const form = await screen.findByRole('link', { name: /fill netview form/i });
    expect(netviewAnswer(form.getAttribute('href')!, 1582831326)).toBe('WO-19101402-1021');
    expect(netviewAnswer(form.getAttribute('href')!, 1510356417)).toBe('1009.64');
    // Only the full total: QuickBooks has the breakdown.
    expect(netviewAnswer(form.getAttribute('href')!, 1719028500)).toBeNull();
    expect(netviewAnswer(form.getAttribute('href')!, 2058828780)).toBeNull();
  });

  it('makes one QuickBooks import file for every site still to bill that week, and marks a bill billed only when Fred says it was imported', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-25T15:00:00Z'));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    const posted: unknown[] = [];
    // The sheet bills NetView; nothing on the job itself says NetView.
    dryRun(posted, 'NetView');
    render(<FieldSheetView workOrders={[{ ...wo, customer_name: 'LDS' } as EnrichedWorkOrder]} />);
    await user.click(await screen.findByRole('button', { name: 'QuickBooks import file (1 site)' }));
    expect(posted).toEqual([{ wo_id: 'wo', from: '2026-10-18', to: '2026-10-24', dry_run: true }]);
    const [name, csv] = downloadCSVText.mock.calls[0] as [string, string];
    expect(name).toBe('QuickBooks import 2026-10-18 to 2026-10-24.csv');
    expect(csv).toContain('"WO-19101402-1021","NetView","10/25/2026","11/24/2026","Net 30"');
    const made = (await screen.findByText('WO-19101402-1021')).closest('div')!;
    expect(within(made).getByText(/\$1,009\.64/)).toBeTruthy();
    // The form has the file's number and date, even a day later.
    vi.setSystemTime(new Date('2026-10-26T15:00:00Z'));
    const form = within(made).getByRole('link', { name: /fill netview form/i }).getAttribute('href')!;
    expect(netviewAnswer(form, 1582831326)).toBe('WO-19101402-1021');
    expect(netviewAnswer(form, 270691041)).toBe('2026-10-25');
    // Downloading marks nothing; Imported does, for the bill's own dates and total.
    await user.click(within(made).getByRole('button', { name: 'Imported' }));
    expect(posted.at(-1)).toEqual({ wo_id: 'wo', from: '2026-10-21', to: '2026-10-21', imported: true, total: 1009.64, date: '2026-10-25' });
    expect(await within(made).findByText('Billed')).toBeTruthy();
  });

  // Fred, 2026-10-25: "on the excel sheet each site on a separate page".
  it('makes the week’s bills an Excel workbook, each site on its own tab', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-25T15:00:00Z'));
    const user = userEvent.setup();
    const posted: unknown[] = [];
    dryRun(posted);
    render(<FieldSheetView workOrders={[{ ...wo, customer_name: 'LDS' } as EnrichedWorkOrder]} />);
    await user.click(await screen.findByRole('button', { name: /excel, a tab per site/i }));
    expect(posted).toEqual([{ wo_id: 'wo', from: '2026-10-18', to: '2026-10-24', dry_run: true }]);
    expect(downloadXLSXBook).toHaveBeenCalledTimes(1);
    const [name, book] = downloadXLSXBook.mock.calls[0] as [string, { name: string; rows: unknown[][] }[]];
    expect(name).toBe('Bills 2026-10-18 to 2026-10-24.xlsx');
    expect(book.map((t) => t.name)).toEqual(['Goldsboro', 'All sites']);
    expect(book[0].rows[0]).toEqual(['FAJ Solutions', 'Invoice WO-19101402-1021']);
    expect(book[0].rows).toContainEqual(['Cabling', 'Wed, Oct 21 · Dwayne Cudjoe · on site 9.57 h', 9.57, 100, 957]);
    expect(book[0].rows.at(-1)).toEqual(['', '', '', 'Total', 1009.64]);
  });

  it('puts the tabs in the order the sites were first worked that week, not by WO number', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-25T15:00:00Z'));
    // Gaffney (WO 19101401) first worked Friday, Dover (WO 19101403) Monday.
    const before = tables.job_day_events;
    tables.job_day_events = [
      { id: 'g', wo_id: 'gaffney', contractor_name: 'Paul Gibbs', kind: 'travel_start', at: at('23', '07:00'), origin: 'hotel', dest: 'hotel', miles: null },
      { id: 'd', wo_id: 'dover', contractor_name: 'Frederick Jeffers', kind: 'travel_start', at: at('19', '07:00'), origin: 'home', dest: 'home', miles: null },
    ];
    try {
      const user = userEvent.setup();
      dryRun([]);
      const job = (id: string, wo_number: string, site_city: string) => ({ ...wo, id, wo_number, site_city, customer_name: 'LDS' }) as EnrichedWorkOrder;
      render(<FieldSheetView workOrders={[job('gaffney', '19101401', 'Gaffney'), job('dover', '19101403', 'Dover')]} />);
      await user.click(await screen.findByRole('button', { name: /excel, a tab per site/i }));
      const [, book] = downloadXLSXBook.mock.calls[0] as [string, { name: string }[]];
      expect(book.map((t) => t.name)).toEqual(['Dover', 'Gaffney', 'All sites']);
    } finally {
      tables.job_day_events = before;
    }
  });
});
