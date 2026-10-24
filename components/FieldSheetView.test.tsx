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
vi.mock('@/lib/export', () => ({ downloadXLSXBook: vi.fn() }));

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
  customers: [{ id: 'cu1', name: 'NetView', billing_email: 'ap@netview.com', default_mileage_rate: 0.6, payment_terms: 'Net 30' }],
  field_sheet_invoices: [],
};
const upserts: [string, Record<string, unknown>][] = [];
const rpc = vi.fn(async () => ({ data: { ok: true, status: 'declined' }, error: null }));

function query(table: string) {
  const result = () => ({ data: tables[table] ?? [], error: null });
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'delete']) chain[m] = () => chain;
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
    storage: { from: () => ({ createSignedUrls: async () => ({ data: [] }) }) },
  }),
}));

const { default: FieldSheetView } = await import('./FieldSheetView');

const wo = {
  id: 'wo', wo_number: '19101402', external_wo_id: 'LDS-1106', client_reference: '5006643', site_name: 'LDS Site 5006643', title: 'LDS Site 5006643',
  site_address: '1000 Eleventh Street', site_city: 'Goldsboro', site_state: 'NC', site_zip: '27530',
  contractor_names: ['Dwayne Cudjoe', 'Raja Bennett'], contractor_name: 'Dwayne Cudjoe', start_date: '2026-10-21', end_date: '2026-10-21', is_project: false,
} as unknown as EnrichedWorkOrder;

afterEach(() => { cleanup(); upserts.length = 0; rpc.mockClear(); vi.unstubAllGlobals(); });

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
    // Dwayne, Wed: 9.57 h × $85 + 4.4 mi × $0.60.
    expect(await screen.findByText('Wed, Oct 21 · Dwayne Cudjoe · on site 9.57 h')).toBeTruthy();
    expect(screen.getAllByText('$816.09').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /create the invoice in quickbooks/i }));
    expect(posted).toEqual([{ wo_id: 'wo', send: true, photos: false }]);
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
});
