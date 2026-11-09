import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'field_sheet_invoices') {
        return {
          select: () => ({
            eq: () => ({
              not: async () => ({
                data: [{
                  wo_id: 'wo-field', customer_name: 'NetView', qbo_invoice_id: 'qbo-field',
                  qbo_invoice_number: 'FS-22', total: 1000, sent_at: '2026-11-07T12:00:00Z',
                }],
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'job_log_rates') {
        return {
          select: () => ({
            eq: async () => ({
              data: [{
                wo_id: 'wo-job',
                invoice: { qbo: { id: 'qbo-job', number: 'LDS-5006902', total: 1800, at: '2026-11-08T12:00:00Z' } },
              }],
              error: null,
            }),
          }),
        };
      }
      return {
        select: () => ({
          in: async () => ({
            data: [
              { id: 'wo-field', customer_name: 'NetView' },
              { id: 'wo-job', customer_name: 'TeamNetView' },
            ],
            error: null,
          }),
        }),
      };
    },
  }),
}));

vi.mock('@/lib/quickbooks-session', () => ({
  getValidQboSession: async () => ({
    environment: 'production', realm_id: 'realm', access_token: 'token',
  }),
}));

vi.mock('@/lib/quickbooks', () => ({
  getInvoiceStatus: async (_environment: string, _realm: string, _token: string, id: string) => id === 'qbo-field'
    ? { id, docNumber: 'FS-22', total: 1000, balance: 250, emailStatus: 'EmailSent', updatedAt: null }
    : { id, docNumber: 'LDS-5006902', total: 1800, balance: 0, emailStatus: 'NeedToSend', updatedAt: null },
  invoicePaymentDates: async () => new Map([
    ['qbo-field', { amount: 750, latestDate: '2026-11-08' }],
    ['qbo-job', { amount: 1800, latestDate: '2026-11-09' }],
  ]),
}));

const { loadQuickBooksReceivables } = await import('./quickbooks-receivables');

describe('loadQuickBooksReceivables', () => {
  it('combines field-sheet and job-log invoices with live balances and payment dates', async () => {
    const rows = await loadQuickBooksReceivables('fred');
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        work_order_id: 'wo-field',
        qbo_invoice_number: 'FS-22',
        customer_name: 'NetView',
        status: 'partial',
        balance: 250,
        last_payment_at: '2026-11-08',
        email_status: 'EmailSent',
      }),
      expect.objectContaining({
        work_order_id: 'wo-job',
        qbo_invoice_number: 'LDS-5006902',
        customer_name: 'TeamNetView',
        status: 'paid',
        balance: 0,
        paid_at: '2026-11-09T12:00:00.000Z',
      }),
    ]));
  });
});
