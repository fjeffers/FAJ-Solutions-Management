// POST /api/quickbooks/field-sheet-invoice for the Field Sheet's QuickBooks
// import file (Greptile on PR #19): the bill comes back without asking
// QuickBooks, so a lapsed connection never stops the file; and a bill Fred says
// QuickBooks imported is recorded as billed, so the same dates can't be billed
// again, but only while the sheet still bills what the file has.
import { describe, it, expect, vi, afterEach } from 'vitest';

const at = (hhmm: string) => new Date(`2026-10-21T${hhmm}:00-04:00`).toISOString();
const tables: Record<string, Record<string, unknown>[]> = {
  work_orders: [{
    id: 'wo', wo_number: '19101402', external_wo_id: 'LDS-1106', site_name: 'LDS Site 5006643', title: 'LDS Site 5006643', site_city: 'Goldsboro', site_state: 'NC',
    customer_name: 'LDS', contractor_name: 'Dwayne Cudjoe', contractor_names: ['Dwayne Cudjoe'], start_date: '2026-10-21', end_date: '2026-10-21',
  }],
  field_sheets: [{ settings: { labor: 'hourly', rate: 100, mileRate: 0.6 } }],
  // Dwayne on site 8:00 to 10:00 and 10 miles: 2 h × $100 + 10 mi × $0.60.
  field_sheet_days: [{ id: 'd1', day: '2026-10-21', tech: 'Dwayne Cudjoe', edits: { arrived: '08:00', leftSite: '10:00', miles: 10 }, added: false, hidden: false }],
  job_day_events: [], job_punches: [{ contractor_name: 'Dwayne Cudjoe', kind: 'in', at: at('08:00') }],
  job_odometer: [], job_expenses: [], wo_photos: [], user_settings: [{ mileage_rate: 0.7 }],
  field_sheet_invoices: [],
};
function query(table: string) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'is', 'order']) chain[m] = () => chain;
  chain.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: tables[table] ?? [], error: null }).then(ok);
  chain.maybeSingle = async () => ({ data: (tables[table] ?? [])[0] ?? null, error: null });
  return chain;
}
const inserted: Record<string, unknown>[] = [];
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'fred' } } }) }, from: query }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (t: string) => Object.assign(query(t), { insert: async (row: Record<string, unknown>) => { inserted.push(row); return { error: null }; } }),
  }),
}));
// A saved connection whose refresh fails.
const getValidQboSession = vi.fn(async () => { throw new Error('QuickBooks token request failed: invalid_grant'); });
vi.mock('@/lib/quickbooks-session', () => ({ getValidQboSession: () => getValidQboSession() }));
vi.mock('@/lib/timesheet', () => ({ timesheetFile: vi.fn(), timesheetLines: vi.fn(), timesheetPdf: vi.fn() }));

const { POST } = await import('./route');
const post = (body: Record<string, unknown>) =>
  POST(new Request('http://localhost/api/quickbooks/field-sheet-invoice', { method: 'POST', body: JSON.stringify({ wo_id: 'wo', ...body }) }));

afterEach(() => { inserted.length = 0; getValidQboSession.mockClear(); tables.field_sheet_invoices = []; });

describe('POST /api/quickbooks/field-sheet-invoice, the import file', () => {
  it('gives the bill without asking QuickBooks, so a lapsed connection never stops the file', async () => {
    const res = await post({ dry_run: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ dry_run: true, customer: 'LDS', from: '2026-10-21', to: '2026-10-21', total: 206 });
    expect(getValidQboSession).not.toHaveBeenCalled();
  });

  it('records a bill QuickBooks imported as billed, under the file’s number and the server’s total', async () => {
    const res = await post({ from: '2026-10-21', to: '2026-10-21', imported: true, total: 206 });
    expect(await res.json()).toEqual({ ok: true, imported: true, invoice_number: 'WO-19101402-1021', total: 206 });
    expect(inserted).toEqual([{
      user_id: 'fred', wo_id: 'wo', from_day: '2026-10-21', to_day: '2026-10-21', customer_name: 'LDS',
      qbo_invoice_id: 'import:WO-19101402-1021', qbo_invoice_number: 'WO-19101402-1021', total: 206,
    }]);
    expect(getValidQboSession).not.toHaveBeenCalled();
  });

  it('marks nothing when the sheet bills something else now than the file has', async () => {
    const res = await post({ from: '2026-10-21', to: '2026-10-21', imported: true, total: 180 });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/changed since the file was made/);
    expect(inserted).toEqual([]);
  });

  it('marks nothing when the dates are already billed', async () => {
    tables.field_sheet_invoices = [{ from_day: '2026-10-18', to_day: '2026-10-24', qbo_invoice_id: '311', qbo_invoice_number: '1042', created_at: '2026-10-24T20:00:00Z' }];
    const res = await post({ from: '2026-10-21', to: '2026-10-21', imported: true, total: 206 });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already on QuickBooks invoice 1042/);
    expect(inserted).toEqual([]);
  });
});
