// POST /api/quickbooks/field-sheet-invoice for the Field Sheet's QuickBooks
// import file (Greptile on PR #19): the bill comes back without asking
// QuickBooks, so a lapsed connection never stops the file; and a bill Fred says
// QuickBooks imported is recorded as billed, so the same dates can't be billed
// again, but only while the sheet still bills what the file has, and under the
// same hold as creating an invoice, with the file's own date.
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
// field_sheet_invoices is filtered and written like the real table, with its one-hold-per-site rule.
function query(table: string) {
  const where: [string, unknown][] = [];
  const own = table === 'field_sheet_invoices';
  const rows = () => (tables[table] ?? []).filter((r) => !own || where.every(([k, v]) => r[k] === v));
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'order']) chain[m] = () => chain;
  for (const m of ['eq', 'is']) chain[m] = (k: string, v: unknown) => { where.push([k, v]); return chain; };
  chain.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(ok);
  chain.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null });
  chain.insert = (row: Record<string, unknown>) => ({
    select: () => ({
      single: async () => {
        if (tables[table].some((r) => r.wo_id === row.wo_id && r.qbo_invoice_id == null)) return { data: null, error: { code: '23505' } };
        const id = `row-${tables[table].length + 1}`;
        tables[table].push({ id, qbo_invoice_id: null, created_at: new Date().toISOString(), ...row });
        return { data: { id }, error: null };
      },
    }),
  });
  chain.update = (patch: Record<string, unknown>) => {
    const u: Record<string, unknown> = {};
    const apply = () => {
      beforeUpdate?.();
      const hit = tables[table].filter((r) => where.every(([k, v]) => r[k] === v));
      for (const r of hit) Object.assign(r, patch);
      return { data: hit.map((r) => ({ id: r.id })), error: null };
    };
    for (const m of ['eq', 'is']) u[m] = (k: string, v: unknown) => { where.push([k, v]); return u; };
    u.select = () => ({ then: (ok: (v: unknown) => unknown) => Promise.resolve(apply()).then(ok) });
    u.then = (ok: (v: unknown) => unknown) => Promise.resolve(apply()).then(ok);
    return u;
  };
  chain.delete = () => {
    const d: Record<string, unknown> = {};
    for (const m of ['eq', 'is']) d[m] = (k: string, v: unknown) => { where.push([k, v]); return d; };
    d.then = (ok: (v: unknown) => unknown) => { tables[table] = tables[table].filter((r) => !where.every(([k, v]) => r[k] === v)); return Promise.resolve({ error: null }).then(ok); };
    return d;
  };
  return chain;
}
// What another press of Imported does in the moment before this one saves.
let beforeUpdate: (() => void) | null = null;
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'fred' } } }) }, from: query }),
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: query }) }));
// A saved connection whose refresh fails.
const getValidQboSession = vi.fn(async () => { throw new Error('QuickBooks token request failed: invalid_grant'); });
vi.mock('@/lib/quickbooks-session', () => ({ getValidQboSession: () => getValidQboSession() }));
vi.mock('@/lib/timesheet', () => ({ timesheetFile: vi.fn(), timesheetLines: vi.fn(), timesheetPdf: vi.fn() }));

const { POST } = await import('./route');
const post = (body: Record<string, unknown>) =>
  POST(new Request('http://localhost/api/quickbooks/field-sheet-invoice', { method: 'POST', body: JSON.stringify({ wo_id: 'wo', ...body }) }));

afterEach(() => { getValidQboSession.mockClear(); tables.field_sheet_invoices = []; beforeUpdate = null; });
const billed = () => tables.field_sheet_invoices;

describe('POST /api/quickbooks/field-sheet-invoice, the import file', () => {
  it('gives the bill without asking QuickBooks, so a lapsed connection never stops the file', async () => {
    const res = await post({ dry_run: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ dry_run: true, customer: 'LDS', from: '2026-10-21', to: '2026-10-21', total: 206 });
    expect(getValidQboSession).not.toHaveBeenCalled();
  });

  // Fred, 2026-10-29: "I need a break down from each tech".
  it("gives each tech's hours, miles and materials with the bill, for the week's workbook", async () => {
    const j = await (await post({ dry_run: true })).json();
    expect(j.mileRate).toBe(0.6);
    expect(j.perTech).toEqual([{ tech: 'Dwayne Cudjoe', days: 1, hours: 2, travel: 0, total: 2, labor: 200, miles: 10, mileage: 6, materials: [], materialsTotal: 0 }]);
  });

  it('records a bill QuickBooks imported as billed, under the file’s number, the server’s total and the file’s date', async () => {
    const res = await post({ from: '2026-10-21', to: '2026-10-21', imported: true, total: 206, date: '2026-10-25' });
    expect(await res.json()).toEqual({ ok: true, imported: true, invoice_number: 'WO-19101402-1021', total: 206 });
    expect(billed()).toEqual([expect.objectContaining({
      user_id: 'fred', wo_id: 'wo', from_day: '2026-10-21', to_day: '2026-10-21', customer_name: 'LDS',
      qbo_invoice_id: 'import:WO-19101402-1021', qbo_invoice_number: 'WO-19101402-1021', total: 206, invoice_date: '2026-10-25',
    })]);
    expect(getValidQboSession).not.toHaveBeenCalled();
  });

  it('marks nothing while an invoice for the site is being created in another tab', async () => {
    const hold = { id: 'h1', wo_id: 'wo', from_day: '2026-10-21', to_day: '2026-10-21', customer_name: 'LDS', qbo_invoice_id: null, qbo_invoice_number: null, created_at: new Date().toISOString() };
    tables.field_sheet_invoices = [hold];
    const res = await post({ from: '2026-10-21', to: '2026-10-21', imported: true, total: 206, date: '2026-10-25' });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/being created in QuickBooks right now/);
    expect(billed()).toEqual([hold]);
  });

  it('marks nothing over an invoice that was cut off before QuickBooks answered, and clears an old one for other dates', async () => {
    const old = (from: string, to: string) => ({ id: `h-${from}`, wo_id: 'wo', from_day: from, to_day: to, customer_name: 'LDS', qbo_invoice_id: null, qbo_invoice_number: null, created_at: '2026-10-24T12:00:00Z' });
    tables.field_sheet_invoices = [old('2026-10-21', '2026-10-21')];
    const res = await post({ from: '2026-10-21', to: '2026-10-21', imported: true, total: 206, date: '2026-10-25' });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/cut off before QuickBooks answered/);
    tables.field_sheet_invoices = [old('2026-10-11', '2026-10-17')];
    expect(await (await post({ from: '2026-10-21', to: '2026-10-21', imported: true, total: 206, date: '2026-10-25' })).json()).toMatchObject({ ok: true });
    expect(billed().map((r) => r.qbo_invoice_id)).toEqual(['import:WO-19101402-1021']);
  });

  it('finishes marking the same bill when an earlier press was cut off, and Create invoice won’t bill those dates again', async () => {
    const cut = { id: 'h-cut', wo_id: 'wo', from_day: '2026-10-21', to_day: '2026-10-21', customer_name: 'LDS', qbo_invoice_id: null, qbo_invoice_number: 'WO-19101402-1021', created_at: '2026-10-24T12:00:00Z' };
    tables.field_sheet_invoices = [{ ...cut }];
    getValidQboSession.mockResolvedValueOnce({ environment: 'production', realm_id: 'r1', access_token: 't' } as never);
    const create = await post({});
    expect(create.status).toBe(409);
    expect((await create.json()).error).toMatch(/being marked imported as WO-19101402-1021/);
    expect(await (await post({ from: '2026-10-21', to: '2026-10-21', imported: true, total: 206, date: '2026-10-25' })).json()).toMatchObject({ ok: true });
    expect(billed()).toEqual([expect.objectContaining({ id: 'h-cut', qbo_invoice_id: 'import:WO-19101402-1021', invoice_date: '2026-10-25' })]);
  });

  it('says Billed only when the bill is saved: not when the hold went away, but yes when another press saved it first', async () => {
    const cut = { id: 'h-cut', wo_id: 'wo', from_day: '2026-10-21', to_day: '2026-10-21', customer_name: 'LDS', qbo_invoice_id: null, qbo_invoice_number: 'WO-19101402-1021', created_at: '2026-10-24T12:00:00Z' };
    const mark = () => post({ from: '2026-10-21', to: '2026-10-21', imported: true, total: 206, date: '2026-10-25' });
    tables.field_sheet_invoices = [{ ...cut }];
    beforeUpdate = () => { tables.field_sheet_invoices = []; };
    const gone = await mark();
    expect(gone.status).toBe(500);
    expect((await gone.json()).ok).toBeUndefined();
    tables.field_sheet_invoices = [{ ...cut }];
    beforeUpdate = () => { tables.field_sheet_invoices[0].qbo_invoice_id = 'import:WO-19101402-1021'; };
    expect(await (await mark()).json()).toMatchObject({ ok: true, invoice_number: 'WO-19101402-1021' });
    expect(billed()).toHaveLength(1);
  });

  it('marks nothing when the sheet bills something else now than the file has', async () => {
    const res = await post({ from: '2026-10-21', to: '2026-10-21', imported: true, total: 180 });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/changed since the file was made/);
    expect(billed()).toEqual([]);
  });

  it('marks nothing when the dates are already billed', async () => {
    const done = { id: 'i1', wo_id: 'wo', from_day: '2026-10-18', to_day: '2026-10-24', qbo_invoice_id: '311', qbo_invoice_number: '1042', created_at: '2026-10-24T20:00:00Z' };
    tables.field_sheet_invoices = [done];
    const res = await post({ from: '2026-10-21', to: '2026-10-21', imported: true, total: 206 });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already on QuickBooks invoice 1042/);
    expect(billed()).toEqual([done]);
  });
});
