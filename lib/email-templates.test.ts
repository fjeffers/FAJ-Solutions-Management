import { describe, expect, it } from 'vitest';
import { clock12, techJobUrl, techStatusWord, scheduleLine, workOrderEmail, paymentConfirmationEmail } from './email-templates';
import { fmtDate } from './utils';
import type { Payment, WorkOrder } from './types';

// Fred tested the tech side on himself (Gaffney, WO 19101399, 2026-10-18) and
// the job email showed the client's price as "Your Pay", "Open" on an assigned
// job and "08:00". These pin what a tech's emails may and may not say.
const gaffney = {
  id: 'w1', wo_number: '19101399', title: 'NetView LDS-1110 — Gaffney SC site 5011876', wo_status: 'Open',
  contractor_name: 'Frederick Jeffers', contractor_names: ['Frederick Jeffers'], contractor_pay: null,
  total_amount: 866.46, start_date: '2026-10-19', start_time: '08:00', end_date: '2026-10-24', end_time: null,
  site_address: '701 West Buford Street', site_city: 'Gaffney', site_state: 'SC', site_zip: '29340',
  service_type: 'Network / IT', external_wo_id: 'LDS-1110',
} as unknown as WorkOrder;

describe('tech job email', () => {
  it('writes times the way people read them', () => {
    expect(clock12('08:00')).toBe('8:00 AM');
    expect(clock12('17:30')).toBe('5:30 PM');
    expect(clock12('12:05')).toBe('12:05 PM');
    expect(clock12('00:15')).toBe('12:15 AM');
    expect(clock12('9am')).toBe('9am');
  });

  it('gives the schedule in one line', () => {
    expect(scheduleLine(gaffney)).toBe(`${fmtDate('2026-10-19')}, 8:00 AM – ${fmtDate('2026-10-24')}`);
    expect(scheduleLine({ start_date: '2026-10-19', start_time: '10:00', end_date: '2026-10-19', end_time: '17:00' }))
      .toBe(`${fmtDate('2026-10-19')}, 10:00 AM – 5:00 PM`);
  });

  it('calls an Open job with a tech on it "Assigned to you"', () => {
    expect(techStatusWord(gaffney)).toBe('Assigned to you');
    expect(techStatusWord({ ...gaffney, wo_status: 'In Progress' })).toBe('In Progress');
    expect(techStatusWord({ wo_status: 'Open', contractor_name: null, contractor_names: [] } as unknown as WorkOrder)).toBe('Open');
  });

  it('never shows the job price, and shows pay only when it is given', () => {
    const html = workOrderEmail(gaffney, undefined, { techPay: null, jobUrl: 'https://x/tech?wo=w1' });
    expect(html).not.toContain('866.46');
    expect(html).not.toContain('Your Pay');
    expect(html).toContain('8:00 AM');
    expect(html).toContain('Assigned to you');
    expect(html).toContain('29340');
    expect(workOrderEmail(gaffney, undefined, { techPay: 400 })).toContain('Your Pay');
  });

  it('the job button opens the job in the tech app, not the old portal', () => {
    expect(techJobUrl('https://app.fajsolutions.com/', 'abc-123')).toBe('https://app.fajsolutions.com/tech?wo=abc-123');
    expect(techJobUrl('https://x', 'a b')).toBe('https://x/tech?wo=a%20b');
    const html = workOrderEmail(gaffney, undefined, { jobUrl: techJobUrl('https://x', 'w1') });
    expect(html).toContain('href="https://x/tech?wo=w1"');
    expect(html).toContain('Open the job in the FAJ Tech app');
    expect(html).not.toContain('Open My Portal');
    const offer = workOrderEmail(gaffney, undefined, { jobUrl: 'https://x/tech?wo=w1', acceptUrl: 'https://x/a', declineUrl: 'https://x/d' });
    expect(offer).toContain('Open the job in the FAJ Tech app ↗');
  });

  it('the payment receipt a tech gets never shows the job price', () => {
    const payment = { id: 'p1', contractor_name: 'Frederick Jeffers', wo_number: '19101399', amount: 400, method: 'Zelle', payment_date: '2026-10-25', notes: null } as unknown as Payment;
    const html = paymentConfirmationEmail(payment, gaffney);
    expect(html).not.toContain('866.46');
    expect(html).not.toContain('WO Total');
    expect(html).toContain('400.00');
  });
});
