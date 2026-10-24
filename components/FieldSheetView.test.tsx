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
    { id: 'x1', contractor_name: 'Dwayne Cudjoe', category: 'fuel', vendor: 'Sheetz', amount: 64, expense_date: '2026-10-22', note: null, receipt_path: null, status: 'approved', decline_reason: null },
  ],
  wo_photos: [],
  field_sheets: [{ settings: { mileRate: 0.6 } }],
  field_sheet_days: [],
  user_settings: [{ mileage_rate: 0.7 }],
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

afterEach(() => { cleanup(); upserts.length = 0; rpc.mockClear(); });

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
    const approved = (await screen.findByText('Approved: on the bill (1)')).parentElement!;
    await user.click(within(approved).getByRole('button', { name: 'Decline' }));
    expect(rpc).toHaveBeenCalledWith('wf_owner_decide_expense', { p_id: 'x1', p_approve: false, p_reason: 'Entered twice' });
  });
});
