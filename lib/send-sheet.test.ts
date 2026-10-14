import { describe, it, expect } from 'vitest';
import { mailtoHref, sheetInvite, smsHref } from './send-sheet';

const URL_ = 'https://app.fajsolutions.com/sheet/abc';

describe('send the sheet', () => {
  it('the note greets by first name and carries the link', () => {
    const t = sheetInvite('Orange refresh', URL_, 'Dana Smith');
    expect(t.startsWith("Hi Dana, here's the live project sheet for Orange refresh.")).toBe(true);
    expect(t).toContain(URL_);
    expect(t).toContain('no login needed');
    expect(sheetInvite('P', URL_, '')).toMatch(/^Here's the live project sheet/);
  });
  it('a text opens Messages with the number and the note', () => {
    const h = smsHref('(484) 555-0101', 'Hi & link');
    expect(h).toBe('sms:+14845550101?&body=Hi%20%26%20link');
    expect(smsHref(null, 'x')).toBe('sms:?&body=x');
    expect(smsHref('not a phone', 'x')).toBe('sms:?&body=x');
  });
  it('an email opens the mail app with the address, subject and note', () => {
    expect(mailtoHref('dana@acme.com', 'Orange refresh', 'Hi')).toBe('mailto:dana@acme.com?subject=Live%20project%20sheet%3A%20Orange%20refresh&body=Hi');
    expect(mailtoHref('bad address', 'P', 'Hi')).toBe('mailto:?subject=Live%20project%20sheet%3A%20P&body=Hi');
  });
});
