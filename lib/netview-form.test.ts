import { describe, it, expect } from 'vitest';
import { isNetviewJob, netviewAnswers, netviewBillingCustomer, netviewCoordinator, netviewCustomerSite, netviewFormUrl, netviewInvoiceDetails, netviewInvoiceNumber, NETVIEW_FORM, type NetviewJob } from './netview-form';

// WO 19101413, Wendy's #397, as it is on live.
const wendys: NetviewJob = {
  wo_number: '19101413', external_wo_id: 'FLN5294', client_reference: '397', customer_name: "Wendy's",
  buyer_company: 'NetView', source_platform: 'NetView', title: "Wendy's #397 — Add 2 cameras (office & rear exterior)",
  site_name: "Wendy's #397", site_city: 'Folsom', site_state: 'PA',
  contacts: [
    { name: 'Karen Sparkman', email: 'karen.sparkman@teamnetview.com', label: 'NetView Dispatcher / Coordinator' },
    { name: 'Brandi Bowen', email: '', label: 'CC on assignment' },
  ],
};
const who = { vendor: 'FAJ Solutions', enteredBy: 'Fred Jeffers', email: 'fajsolutions@gmail.com' };

describe('NetView form', () => {
  it('knows a NetView job by the buyer, the platform, a contact or the client billed', () => {
    expect(isNetviewJob(wendys)).toBe(true);
    expect(isNetviewJob({ wo_number: '1', contacts: [{ name: 'K', email: 'k@TeamNetView.com ' }] })).toBe(true);
    expect(isNetviewJob({ wo_number: '1' }, 'Netview')).toBe(true);
    expect(isNetviewJob({ wo_number: '1', buyer_company: 'LDS', customer_name: 'LDS' }, 'LDS')).toBe(false);
  });

  it('picks the NetView coordinator, not the CC', () => {
    expect(netviewCoordinator(wendys.contacts)).toBe('Karen Sparkman');
    expect(netviewCoordinator([{ name: 'Ann', email: 'ann@teamnetview.com', label: '' }, { name: 'Bo', label: 'Site manager' }])).toBe('Bo');
    expect(netviewCoordinator([])).toBe('');
  });

  it('fills every answer the job and saved invoice know, including FAJ direct deposit and payroll confirmation', () => {
    const a = netviewAnswers({
      job: wendys,
      invoice: {
        number: '1042', total: 299.02, date: '2026-10-25', from: '2026-10-16', to: '2026-10-16',
        rate: '$60.00/hr',
      },
      ...who,
    });
    expect(a).toEqual({
      invoiceDate: '2026-10-25', serviceDate: '2026-10-16', vendor: 'FAJ Solutions',
      rate: '$60.00/hr', quantity: '', other: '',
      total: '299.02', customer: "Wendy's 397 - Folsom, PA", invoiceNumber: '1042', siteId: 'FLN5294 · Site 397 · FAJ WO 19101413',
      memo: "Wendy's #397 — Add 2 cameras (office & rear exterior) · Wendy's #397, Folsom, PA · 10/16/2026",
      coordinator: 'Karen Sparkman', enteredBy: 'Fred Jeffers', email: 'fajsolutions@gmail.com',
      directDeposit: 'Yes', invoiceEmailed: 'Yes',
    });
  });

  it('uses the LDS site number when an LDS job has no separate site name', () => {
    const a = netviewAnswers({
      job: { wo_number: '9', customer_name: 'LDS', buyer_company: 'NetView', client_reference: '5006643' },
      invoice: { number: '1043', total: 100, date: '2026-10-25', from: '2026-10-20', to: '2026-10-20' },
      ...who,
    });
    expect(a.customer).toBe('LDS 5006643');
  });

  it("adds a Field Nation site number to the visited site's name", () => {
    expect(netviewCustomerSite({
      wo_number: '1',
      site_name: "Wendy's - Franklin, NJ",
      external_wo_id: 'FLN5302',
      site_city: 'Franklin',
      site_state: 'NJ',
    })).toBe("Wendy's 5302 - Franklin, NJ");
  });

  it('finds an LDS site number in the work-order title and pairs it with the city', () => {
    expect(netviewCustomerSite({
      wo_number: '1',
      customer_name: 'TeamNetView',
      title: 'LDS1106 Site 5006643 — Goldsboro, NC',
      site_city: 'Goldsboro',
      site_state: 'NC',
    })).toBe('LDS 5006643 - Goldsboro, NC');
  });

  it('leaves the invoice number blank until QuickBooks creates one', () => {
    expect(netviewInvoiceNumber()).toBe('');
    expect(netviewInvoiceNumber('  QB-1042 ')).toBe('QB-1042');
  });

  it("bills Wendy's work to NetView and LDS work to TeamNetView", () => {
    expect(netviewBillingCustomer({ wo_number: '1', title: "Wendy's Franklin, NJ" })).toBe('NetView');
    expect(netviewBillingCustomer({ wo_number: '2', title: 'LDS1106 Site 5006643' })).toBe('TeamNetView');
  });

  it('sends NetView only the hourly rate, without a quantity or charge breakdown', () => {
    expect(netviewInvoiceDetails({
      techs: [{
        tech: 'Fred Jeffers',
        hours: { qty: 2, rate: 60, amount: 120 },
        mileage: { amount: 9, lines: [{ qty: 15, rate: 0.6 }] },
        meals: { amount: 18 },
        materials: { amount: 25 },
        travel: { amount: 100 },
      }],
      totals: { labor: 120, mileage: 9, meals: 18, materials: 25, travel: 100, total: 272 },
    })).toEqual({
      rate: '$60.00/hr',
    });
  });

  it('gives the week’s dates in the memo', () => {
    const a = netviewAnswers({ job: wendys, invoice: { number: '1042', total: 500, date: '2026-10-25', from: '2026-10-12', to: '2026-10-16' }, ...who });
    expect(a.memo).toContain('10/12/2026 – 10/16/2026');
  });

  it('makes a pre-filled link with only the answers given', () => {
    const a = netviewAnswers({ job: { wo_number: '7' }, invoice: { number: 'A&B 1', total: 10, date: '2026-10-25', from: '2026-10-20', to: '2026-10-20' }, ...who });
    const u = new URL(netviewFormUrl(a));
    expect(`${u.origin}${u.pathname}`).toBe(NETVIEW_FORM);
    expect(u.searchParams.get('usp')).toBe('pp_url');
    expect(u.searchParams.get('entry.1582831326')).toBe('A&B 1');
    expect(u.searchParams.get('entry.116346627')).toBe('2026-10-20');
    expect(u.searchParams.has('entry.1450654372')).toBe(false); // no coordinator known
    expect(u.searchParams.get('entry.1894271667')).toBe('Yes');
    expect(u.searchParams.get('entry.894978173')).toBe('Yes');
  });
});
