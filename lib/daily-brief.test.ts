import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildDailyBrief } from './daily-brief';

// Minimal stand-in for the service-role client: the composer only ever calls
// .from(table).select('*').
const fakeAdmin = (tables: Record<string, unknown[]>) =>
  ({
    from: (t: string) => ({ select: async () => ({ data: tables[t] ?? [], error: null }) }),
  }) as unknown as SupabaseClient;

const visit = (over: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(),
  visit_date: '2026-07-20',
  site_name: 'Roselle',
  site_code: '5798',
  visit_type: 'T&M',
  hours: 4,
  rate: '$55/hr',
  travel_charge: 0,
  invoice_status: 'not_invoiced',
  payment_status: 'unpaid',
  time_in: null,
  time_out: null,
  program: 'Wendys',
  ...over,
});

const invoice = (over: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(),
  invoice_number: 'INV-2026-001',
  client_name: 'State Farm',
  status: 'sent',
  total: 1000,
  due_date: null,
  ...over,
});

describe('buildDailyBrief', () => {
  it('never counts an archived visit as work still to bill (Fred, 2026-10-06)', async () => {
    const brief = await buildDailyBrief(
      fakeAdmin({
        site_visits: [visit({ site_name: 'MT. Laurel', site_code: '1114', rate: '$0/hr', hours: null, archived_at: '2026-09-26T12:00:00Z' })],
      }),
    );
    expect(brief.quiet).toBe(true);
    expect(brief.html).not.toContain('MT. Laurel');
  });

  it('leads with never-sent drafts and totals them', async () => {
    const brief = await buildDailyBrief(
      fakeAdmin({
        invoices: [
          invoice({ invoice_number: 'INV-2026-001', status: 'draft', total: 9809.01 }),
          invoice({ invoice_number: 'INV-2026-002', status: 'draft', total: 4100, client_name: 'Wendys' }),
        ],
      }),
    );

    expect(brief.stats.draftCount).toBe(2);
    expect(brief.stats.draftTotal).toBe(13909);
    expect(brief.subject).toContain('$13,909');
    expect(brief.subject).toContain('never sent');
    expect(brief.html).toContain('INV-2026-001');
    expect(brief.quiet).toBe(false);
  });

  it('excludes drafts from outstanding so money is never double-counted', async () => {
    const brief = await buildDailyBrief(
      fakeAdmin({
        invoices: [invoice({ status: 'draft', total: 5000 }), invoice({ status: 'sent', total: 2000 })],
      }),
    );
    expect(brief.stats.draftTotal).toBe(5000);
    expect(brief.stats.outstanding).toBe(2000);
  });

  it('counts overdue invoices with days late, net of payments', async () => {
    const inv = invoice({ status: 'sent', total: 1000, due_date: '2020-01-01' });
    const brief = await buildDailyBrief(
      fakeAdmin({
        invoices: [inv],
        invoice_payments: [{ invoice_id: inv.id, amount: 400 }],
      }),
    );
    expect(brief.stats.overdueCount).toBe(1);
    expect(brief.stats.overdueTotal).toBe(600);
    expect(brief.html).toContain('days late');
  });

  it('bills only not_invoiced visits — "na" means deliberately not billable', async () => {
    const brief = await buildDailyBrief(
      fakeAdmin({
        site_visits: [
          visit({ invoice_status: 'not_invoiced' }),
          visit({ invoice_status: 'na' }),
          visit({ invoice_status: 'invoiced' }),
        ],
      }),
    );
    expect(brief.stats.needsInvoiceCount).toBe(1);
    expect(brief.stats.needsInvoiceTotal).toBe(220); // 4h x $55
  });

  it('flags a check-in older than 18h as a forgotten checkout', async () => {
    const stale = new Date(Date.now() - 30 * 3600 * 1000).toISOString();
    const fresh = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    const brief = await buildDailyBrief(
      fakeAdmin({
        site_visits: [
          visit({ invoice_status: 'invoiced', time_in: stale, time_out: null }),
          visit({ invoice_status: 'invoiced', time_in: fresh, time_out: null }),
        ],
      }),
    );
    expect(brief.stats.stuckCheckouts).toBe(1);
  });

  it('goes quiet when nothing is sitting still', async () => {
    const brief = await buildDailyBrief(
      fakeAdmin({
        site_visits: [visit({ invoice_status: 'invoiced' })],
        invoices: [invoice({ status: 'paid', total: 500 })],
      }),
    );
    expect(brief.quiet).toBe(true);
    expect(brief.subject).toContain('all clear');
    expect(brief.html).toContain('All clear');
  });

  it('is FAJ only — never mentions FHJ, a separate company (Fred, 2026-10-08)', async () => {
    const brief = await buildDailyBrief(fakeAdmin({}));
    expect(brief.html).not.toMatch(/FHJ|Dream Destinations|travel lead/i);
    expect(Object.keys(brief.stats).some((k) => /fhj/i.test(k))).toBe(false);
  });
});
