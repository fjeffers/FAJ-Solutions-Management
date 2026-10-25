import { describe, it, expect } from 'vitest';
import { groupLines, isNetviewJob, netviewAnswers, netviewCoordinator, netviewFormUrl, NETVIEW_FORM, type NetviewJob, type NetviewLine } from './netview-form';

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
const line = (kind: string, qty: number, rate: number, description = kind): NetviewLine => ({ kind, description, qty, rate, amount: Math.round(qty * rate * 100) / 100 });
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

  it('adds up each tech-day into one line per rate', () => {
    const g = groupLines([line('labor', 10, 65), line('travel', 0.5, 30), line('labor', 10.32, 65), line('mileage', 8, 0.7), line('mileage', 10, 0.7),
      line('meals', 1, 50), line('meals', 1, 50), line('receipt', 1, 12.4, 'Materials — Home Depot')]);
    expect(g.map((l) => [l.kind, l.description, l.qty, l.amount])).toEqual([
      ['labor', 'Labor', 20.32, 1320.8], ['travel', 'Travel', 0.5, 15], ['mileage', 'Mileage', 18, 12.6],
      ['meals', 'Meals', 1, 100], ['receipt', 'Materials — Home Depot', 1, 12.4],
    ]);
  });

  it('fills every answer the job knows, and leaves direct deposit and the confirmation to Fred', () => {
    const lines = [line('labor', 3, 65), line('mileage', 148.6, 0.7)];
    const a = netviewAnswers({ job: wendys, invoice: { number: '1042', total: 299.02, date: '2026-10-25', from: '2026-10-16', to: '2026-10-16' }, lines, ...who });
    expect(a).toEqual({
      invoiceDate: '2026-10-25', serviceDate: '2026-10-16', vendor: 'FAJ Solutions',
      rate: '$65.00/hr', quantity: '3 hours', other: 'Mileage: 148.6 mi × $0.70 = $104.02',
      total: '299.02', customer: "Wendy's", invoiceNumber: '1042', siteId: 'FLN5294 · Site 397 · FAJ WO 19101413',
      memo: "Wendy's #397 — Add 2 cameras (office & rear exterior) · Wendy's #397, Folsom, PA · 10/16/2026",
      coordinator: 'Karen Sparkman', enteredBy: 'Fred Jeffers', email: 'fajsolutions@gmail.com',
    });
  });

  it('gives only the total when the lines are not this invoice’s', () => {
    const a = netviewAnswers({ job: wendys, invoice: { number: '1042', total: 500, date: '2026-10-25', from: '2026-10-12', to: '2026-10-16' }, lines: [line('labor', 3, 65)], ...who });
    expect([a.rate, a.quantity, a.other, a.total]).toEqual(['', '', '', '500.00']);
    expect(a.memo).toContain('10/12/2026 – 10/16/2026');
  });

  it('makes a pre-filled link with only the answers given', () => {
    const a = netviewAnswers({ job: { wo_number: '7' }, invoice: { number: 'A&B 1', total: 10, date: '2026-10-25', from: '2026-10-20', to: '2026-10-20' }, lines: [], ...who });
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
