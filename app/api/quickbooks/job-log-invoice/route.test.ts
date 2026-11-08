// POST /api/quickbooks/job-log-invoice: the job log's invoice made in QuickBooks (Fred, 2026-11-04: "i need to pase
// the invoice from INvoice to quick books invoice"), never twice under one number, only lines that add up.
import { describe, it, expect, vi, afterEach } from 'vitest';

const updates: Record<string, unknown>[] = [];
let savedInvoice: Record<string, unknown> = { number: '1042', date: '2026-10-25', terms: 30 };
function query(table: string) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq']) chain[m] = () => chain;
  chain.maybeSingle = async () => ({
    data: table === 'work_orders' ? { id: 'wo', wo_number: '191', external_wo_id: null, site_name: 'LDS Site 5006643', title: null, customer_name: 'LDS' }
      : { invoice: savedInvoice },
    error: null,
  });
  chain.update = (patch: Record<string, unknown>) => { updates.push(patch); return { eq: async () => ({ error: null }) }; };
  return chain;
}
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ rpc: async () => ({ data: { role: 'owner' }, error: null }), auth: { getUser: async () => ({ data: { user: { id: 'fred' } } }) }, from: query }),
}));
const session = vi.fn<() => Promise<unknown>>(async () => ({ environment: 'production', realm_id: 'r', access_token: 't' }));
vi.mock('@/lib/quickbooks-session', () => ({ getValidQboSession: () => session() }));
const qb = {
  findInvoiceByNumber: vi.fn<() => Promise<unknown>>(async () => null),
  findOrCreateCustomer: vi.fn(async () => 'c1'),
  findOrCreateServiceItem: vi.fn(async (_e: string, _r: string, _t: string, name: string) => `item:${name}`),
  createInvoice: vi.fn(async () => ({ id: '77', docNumber: '1042', total: 346, balance: 346 })),
};
vi.mock('@/lib/quickbooks', () => qb);

const { POST } = await import('./route');
const lines = [
  { date: '2026-10-19', item: 'Cabling', description: 'Paul (Lead): Installation', qty: 6, rate: 50, amount: 300 },
  { date: '2026-10-19', item: 'Traveling', description: 'Paul (Lead): Mileage', qty: 100, rate: 0.46, amount: 46 },
];
const post = (body: Record<string, unknown> = {}) => POST(new Request('http://localhost/api/quickbooks/job-log-invoice', {
  method: 'POST', body: JSON.stringify({ wo_id: 'wo', lines, total: 346, number: '1042', date: '2026-10-25', terms: 30, bill_to: 'TeamNetView', ...body }),
}));
afterEach(() => {
  vi.clearAllMocks();
  updates.length = 0;
  savedInvoice = { number: '1042', date: '2026-10-25', terms: 30 };
});

describe('POST /api/quickbooks/job-log-invoice', () => {
  it('makes the invoice in QuickBooks line by line, under its number, and keeps it with the invoice', async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, invoice_number: '1042', total: 346, sent: { id: '77', number: '1042', total: 346 } });
    expect(qb.findOrCreateCustomer).toHaveBeenCalledWith('production', 'r', 't', 'TeamNetView');
    const [, , , payload] = qb.createInvoice.mock.calls[0] as unknown as [string, string, string, Record<string, unknown>];
    expect(payload).toMatchObject({ DocNumber: '1042', TxnDate: '2026-10-25', DueDate: '2026-11-24', CustomerRef: { value: 'c1' } });
    expect((payload.Line as unknown[]).length).toBe(2);
    expect(updates[0]).toMatchObject({ invoice: { number: '1042', qbo: { id: '77', number: '1042', total: 346 } } });
  });

  it('makes none when QuickBooks already has the number', async () => {
    qb.findInvoiceByNumber.mockResolvedValueOnce({ id: '5', docNumber: '1042', total: 346 });
    const res = await post();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already has invoice 1042/);
    expect(qb.createInvoice).not.toHaveBeenCalled();
  });

  it('stops a retry when FAJ already recorded the QuickBooks invoice', async () => {
    savedInvoice = {
      number: '1042',
      date: '2026-10-25',
      terms: 30,
      qbo: { id: '77', number: '1042', total: 346, environment: 'production', realmId: 'r' },
    };
    const res = await post();
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: 'This invoice already exists in QuickBooks as 1042.',
      existing: { id: '77', number: '1042', total: 346, environment: 'production', realmId: 'r' },
    });
    expect(session).toHaveBeenCalled();
    expect(qb.createInvoice).not.toHaveBeenCalled();
  });

  it('allows the first production invoice when the saved copy came from the old Sandbox connection', async () => {
    savedInvoice = { number: '1042', date: '2026-10-25', terms: 30, qbo: { id: 'sandbox-77', number: '1042', total: 346 } };
    const res = await post();
    expect(res.status).toBe(200);
    expect(qb.createInvoice).toHaveBeenCalledOnce();
    expect(updates[0]).toMatchObject({
      invoice: { qbo: { id: '77', environment: 'production', realmId: 'r' } },
    });
  });

  it("sends nothing when a line doesn't add up or the total isn't the lines'", async () => {
    expect((await post({ lines: [{ ...lines[0], amount: 999 }], total: 999 })).status).toBe(400);
    expect((await post({ total: 1 })).status).toBe(400);
    expect((await post({ lines: [{ ...lines[0], item: 'Anything' }], total: 300 })).status).toBe(400);
    expect(qb.createInvoice).not.toHaveBeenCalled();
  });

  it('says to connect QuickBooks or use the import file when it isn’t connected', async () => {
    session.mockResolvedValueOnce(null);
    const res = await post();
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ not_connected: true, fix: expect.stringMatching(/import file/) });
  });
});
