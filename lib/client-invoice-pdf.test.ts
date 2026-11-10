import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDocument, PDFName } from 'pdf-lib';
import { clientExpenseFilename, clientInvoiceFilename, clientInvoicePdf, invoiceSite } from './client-invoice-pdf';
import type { Invoice } from './types';

const invoice = {
  id: 'i', invoice_number: 'INV-22', client_name: 'LDS', client_email: null, client_phone: null,
  title: 'Wilmington install', description: null, line_items: [{ id: '1', description: 'Hotel - Hampton Inn', quantity: 1, rate: 125 }],
  subtotal: 125, tax_rate: 0, tax_amount: 0, total: 125, status: 'sent', due_date: '2026-11-30',
  notes: 'Thank you', sent_at: null, paid_at: null, work_order_ids: ['wo'], quote_id: null, customer_id: null,
  share_token: 'token', user_id: null, created_at: '2026-11-09T12:00:00Z', updated_at: '2026-11-09T12:00:00Z',
} as Invoice;

describe('client invoice PDF', () => {
  const site = {
    wo_number: '19101452', client_reference: 'Site 5006902', site_name: 'LDS Site 5006902',
    site_city: 'Wilmington', site_state: 'NC', title: 'LDS - 5006902 - Wilmington NC',
  };

  it('names each download with the site number and name', () => {
    expect(invoiceSite(site, invoice)).toEqual({ number: '5006902', name: 'Wilmington NC' });
    expect(clientInvoiceFilename(invoice, site)).toBe('5006902 - Wilmington NC - Invoice INV-22.pdf');
    expect(clientExpenseFilename(invoice, {
      vendor: 'Quality Inn', category: 'hotel', expense_date: '2026-10-18', receipt_path: 'receipts/hotel.jpg',
    }, site)).toBe('5006902 - Wilmington NC - Expense - Quality Inn - 2026-10-18.jpg');
  });

  it('creates a readable PDF', async () => {
    const pdf = await PDFDocument.load(await clientInvoicePdf(invoice, [], site, [{
      label: '2026-10-18 - Quality Inn - $350.74',
      url: 'https://app.fajsolutions.com/invoice/token/expense/x1',
    }]));
    expect(pdf.getTitle()).toContain('5006902 Wilmington NC');
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getPages()[0].node.lookupMaybe(PDFName.of('Annots'), PDFArray)?.size()).toBe(1);
  });
});
