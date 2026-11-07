import { describe, it, expect } from 'vitest';
import { isNetviewJob, netviewAnswers, netviewCoordinator, netviewFormUrl, netviewInvoiceDetails, NETVIEW_FORM, type NetviewJob } from './netview-form';

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

  it('fills every answer the job and saved invoice know, and leaves direct deposit and the confirmation to Fred', () => {
    const a = netviewAnswers({
      job: wendys,
      invoice: {
        number: '1042', total: 299.02, date: '2026-10-25', from: '2026-10-16', to: '2026-10-16',
        rate: 'Fred Jeffers: $60.00/hr', quantity: 'Fred Jeffers: 2 hr',
        other: 'Fred Jeffers labor: 2 hr × $60.00/hr = $120.00\nMileage: $10.00',
      },
      ...who,
    });
    expect(a).toEqual({
      invoiceDate: '2026-10-25', serviceDate: '2026-10-16', vendor: 'FAJ Solutions',
      rate: 'Fred Jeffers: $60.00/hr', quantity: 'Fred Jeffers: 2 hr',
      other: 'Fred Jeffers labor: 2 hr × $60.00/hr = $120.00\nMileage: $10.00',
      total: '299.02', customer: "Wendy's", invoiceNumber: '1042', siteId: 'FLN5294 · Site 397 · FAJ WO 19101413',
      memo: "Wendy's #397 — Add 2 cameras (office & rear exterior) · Wendy's #397, Folsom, PA · 10/16/2026",
      coordinator: 'Karen Sparkman', enteredBy: 'Fred Jeffers', email: 'fajsolutions@gmail.com',
    });
  });

  it('turns the saved invoice into NetView rates, quantities and a full charge breakdown', () => {
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
      rate: 'Fred Jeffers: $60.00/hr',
      quantity: 'Fred Jeffers: 2 hr',
      other: [
        'Fred Jeffers labor: 2 hr × $60.00/hr = $120.00',
        'Fred Jeffers mileage: 15 mi × $0.60/mi = $9.00',
        'Fred Jeffers meals: $18.00',
        'Materials: $25.00',
        'Fred Jeffers hotel/travel: $100.00',
        'Totals: labor $120.00, mileage $9.00, meals $18.00, materials $25.00, travel $100.00, invoice $272.00',
      ].join('\n'),
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
    expect(u.searchParams.has('entry.1894271667')).toBe(false); // direct deposit: Fred's answer
    expect(u.searchParams.has('entry.894978173')).toBe(false); // "the invoice was emailed": Fred's answer
  });
});
