import { describe, expect, it } from 'vitest';
import { followUps, mailLink, smsLink, type FuInvoice, type FuJob, type FuQuote } from './follow-ups';

const base = 'https://app.example.com';
const today = '2026-11-08';
const inv = (o: Partial<FuInvoice> = {}): FuInvoice => ({
  id: 'i1', invoice_number: 'INV-7', status: 'sent', due_date: '2026-11-01', total: 500,
  client_name: 'Dana Smith', client_email: 'dana@x.com', client_phone: '(555) 123-4567', share_token: 'tok', ...o,
});
const quote = (o: Partial<FuQuote> = {}): FuQuote => ({
  id: 'q1', quote_number: 'Q-3', status: 'sent', created_at: '2026-10-20T10:00:00Z', sent_at: null, total: 900,
  client_name: 'Lee', client_email: null, client_phone: '5551112222', share_token: 'qt', ...o,
});
const job = (o: Partial<FuJob> = {}): FuJob => ({ id: 'w1', wo_number: '191', title: 'Rack install', contractor_name: 'Paul Reed', wo_status: 'Assigned', ...o });
const run = (o: Partial<Parameters<typeof followUps>[0]> = {}) =>
  followUps({ invoices: [], paidByInvoice: new Map(), quotes: [], jobs: [], techs: [], today, base, ...o });

describe('followUps', () => {
  it('writes an overdue reminder with what is still owed and the pay link', () => {
    const [f] = run({ invoices: [inv()], paidByInvoice: new Map([['i1', 200]]) });
    expect(f.title).toBe('Invoice INV-7: $300.00 overdue');
    expect(f.detail).toBe('Dana Smith · 7 days late');
    expect(f.body).toContain('Hi Dana,');
    expect(f.body).toContain(`${base}/invoice/tok`);
  });

  it('skips invoices that are paid, not due yet, drafts or void', () => {
    expect(run({ invoices: [inv(), inv({ id: 'i2', due_date: '2026-11-08' }), inv({ id: 'i3', status: 'draft' })], paidByInvoice: new Map([['i1', 500]])})).toEqual([]);
  });

  it('follows up a quote after a quiet week, not before', () => {
    expect(run({ quotes: [quote()] })[0].body).toContain(`${base}/quote/qt`);
    expect(run({ quotes: [quote({ sent_at: '2026-11-05T10:00:00Z' })] })).toEqual([]);
    expect(run({ quotes: [quote({ status: 'accepted' })] })).toEqual([]);
  });

  it('nudges a tech who has not answered, without the pay', () => {
    const techs = [{ name: 'Paul Reed', phone: '555-000-1111', email: null, portal_token: 'pt' }];
    const [f] = run({ jobs: [job()], techs });
    expect(f.title).toBe("Paul Reed hasn't answered WO 191");
    expect(f.body).toContain(`${base}/portal/pt`);
    expect(f.body).not.toContain('$');
    expect(run({ jobs: [job({ assignment_responses: { 'Paul Reed': { status: 'accepted' } } })], techs })).toEqual([]);
    expect(run({ jobs: [job({ wo_status: 'Paid' }), job({ id: 'w2', contractor_name: '' })], techs })).toEqual([]);
  });

  it('builds text and email links only when there is a number or address', () => {
    const [f] = run({ invoices: [inv()] });
    expect(smsLink(f)).toMatch(/^sms:5551234567\?&body=Hi%20Dana/);
    expect(mailLink(f)).toMatch(/^mailto:dana@x\.com\?subject=Reminder/);
    expect(mailLink(run({ quotes: [quote()] })[0])).toBeNull();
  });
});
