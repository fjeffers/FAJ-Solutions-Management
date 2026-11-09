import { describe, expect, it } from 'vitest';
import { businessSnapshot } from './BusinessCommandCenter';
import type { Contractor, EnrichedWorkOrder, Invoice, InvoicePayment, Material, Quote } from '@/lib/types';

describe('business command center', () => {
  it('summarizes CRM and ERP data without counting the same customer twice', () => {
    const workOrders = [
      { customer_name: "Wendy's", archived_at: null, wo_status: 'In Progress', scheduled_date: '2026-11-09', start_date: null },
      { customer_name: "wendy's", archived_at: null, wo_status: 'Open', scheduled_date: '2026-11-10', start_date: null },
      { customer_name: 'LDS', archived_at: '2026-11-01', wo_status: 'Paid', scheduled_date: null, start_date: null },
    ] as EnrichedWorkOrder[];
    const quotes = [
      { client_name: 'LDS', status: 'sent', total: 1200 },
      { client_name: 'New client', status: 'accepted', total: 500 },
    ] as Quote[];
    const invoices = [
      { id: 'i1', client_name: "Wendy's", status: 'sent', total: 1000, due_date: '2026-11-01' },
      { id: 'i2', client_name: 'New client', status: 'draft', total: 300, due_date: null },
      { id: 'i3', client_name: 'Paid client', status: 'paid', total: 900, due_date: '2026-10-01' },
    ] as Invoice[];
    const invoicePayments = [{ invoice_id: 'i1', amount: 250 }] as InvoicePayment[];
    const contractors = [{ on_hold: false }, { on_hold: true }, {}] as Contractor[];
    const materials = [
      { stock_quantity: 2, low_stock_threshold: 3 },
      { stock_quantity: 5, low_stock_threshold: 3 },
      { stock_quantity: 0, low_stock_threshold: null },
    ] as Material[];

    expect(businessSnapshot({
      workOrders, quotes, invoices, invoicePayments, contractors, materials, today: '2026-11-09',
    })).toEqual({
      customers: 4,
      openQuotes: 1,
      openQuoteValue: 1200,
      activeJobs: 2,
      todayJobs: 1,
      inField: 1,
      activeTechs: 2,
      outstandingInvoices: 1050,
      overdueInvoices: 1,
      inventoryItems: 3,
      lowStock: 1,
      completedJobs: 1,
    });
  });
});
