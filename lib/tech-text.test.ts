import { afterEach, describe, expect, it, vi } from 'vitest';
import { newJobNeedsEmail, newWorkOrderText, textPhone } from './tech-text';
import { techAppInviteBlock } from './tech-app-email';

describe('new job text', () => {
  const t = newWorkOrderText({
    woNumber: '19101399', title: 'NetView LDS-1110 — Gaffney SC site 5011876',
    schedule: 'Oct 19, 2026, 8:00 AM – Oct 24, 2026', link: 'https://app.fajsolutions.com/tech?wo=aa-11',
  });

  it('says what and when, with a link to the job', () => {
    expect(t).toBe('FAJ Solutions: new assignment available, WO 19101399\nNetView LDS-1110 — Gaffney SC site 5011876\nOct 19, 2026, 8:00 AM – Oct 24, 2026\nOpen: https://app.fajsolutions.com/tech?wo=aa-11');
  });

  it('never carries money', () => {
    expect(t).not.toMatch(/\$|pay|price|total/i);
  });
});

describe('texting', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('sends nothing until Twilio is set up', async () => {
    vi.stubEnv('TWILIO_ACCOUNT_SID', '');
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    expect(await textPhone('610-555-0100', 'hi')).toBe('not_set_up');
    expect(f).not.toHaveBeenCalled();
  });

  it('needs a real phone number', async () => {
    expect(await textPhone('', 'hi')).toBe('no_phone');
    expect(await textPhone('555-0100', 'hi')).toBe('no_phone');
  });

  it('texts the number once Twilio is set up', async () => {
    vi.stubEnv('TWILIO_ACCOUNT_SID', 'AC1'); vi.stubEnv('TWILIO_AUTH_TOKEN', 'tok'); vi.stubEnv('TWILIO_FROM_NUMBER', '+16105550199');
    const f = vi.fn().mockResolvedValue({ ok: true }); vi.stubGlobal('fetch', f);
    expect(await textPhone('(610) 555-0100', 'hi')).toBe('sent');
    expect(String((f.mock.calls[0][1] as { body: URLSearchParams }).body)).toContain('To=%2B16105550100');
  });
});

describe('when a new job still needs an email', () => {
  it('first time (not in the app yet): always', () => {
    expect(newJobNeedsEmail({ inApp: false, pushed: 0, texted: 'not_tried' })).toBe(true);
  });
  it('in the app and the phone pop-up reached them: no email', () => {
    expect(newJobNeedsEmail({ inApp: true, pushed: 1, texted: 'not_set_up' })).toBe(false);
  });
  it('in the app and the text reached them: no email', () => {
    expect(newJobNeedsEmail({ inApp: true, pushed: 0, texted: 'sent' })).toBe(false);
  });
  it('in the app but nothing reached them (pop-ups off, no texting): the email still goes', () => {
    expect(newJobNeedsEmail({ inApp: true, pushed: 0, texted: 'not_set_up' })).toBe(true);
    expect(newJobNeedsEmail({ inApp: true, pushed: 0, texted: 'failed' })).toBe(true);
  });
});

describe('get-the-app part of the first email', () => {
  const b = techAppInviteBlock('https://app.fajsolutions.com/tech');
  it('points at the tech app and the real sign-in steps', () => {
    expect(b).toContain('href="https://app.fajsolutions.com/tech"');
    expect(b).toContain('First time? Create your login');
    expect(b).toContain('Add to Home Screen');
    expect(b).toContain('Turn on pop-ups');
  });
  it('says nothing about the office', () => {
    expect(b).not.toMatch(/admin|office|Fred/i);
  });
});
