import { describe, expect, it } from 'vitest';
import { techAppEmail } from './tech-app-email';

describe('the tech app email', () => {
  it('a first-timer gets the create-your-login steps with the email on file', () => {
    const { subject, html } = techAppEmail({ name: 'Bryant Knight', email: 'b@example.com', appUrl: 'https://app.fajsolutions.com/tech', hasLogin: false });
    expect(subject).toBe('Your FAJ Solutions tech app');
    expect(html).toContain('Hi Bryant,');
    expect(html).toContain('First time? Create your login');
    expect(html).toContain('b@example.com');
    expect(html).toContain('href="https://app.fajsolutions.com/tech"');
    expect(html).toContain('Add to Home Screen');
  });

  it('someone who already has a login is just told to sign in', () => {
    const { html } = techAppEmail({ name: 'Fred', email: 'f@example.com', appUrl: 'u', hasLogin: true });
    expect(html).toContain('Sign in');
    expect(html).not.toContain('Create your login');
  });

  it('never mentions the office side', () => {
    for (const hasLogin of [true, false]) {
      const { html, subject } = techAppEmail({ name: 'A', email: 'a@b.c', appUrl: 'https://app.fajsolutions.com/tech', hasLogin });
      expect(`${subject} ${html}`).not.toMatch(/admin|management|business manager|office app/i);
    }
  });

  it('a name cannot break the email', () => {
    expect(techAppEmail({ name: '<b>x</b>', email: '<i>', appUrl: 'u', hasLogin: false }).html).not.toMatch(/<b>x|<i>/);
  });
});

describe('the confirm-your-login email (Fred, 2026-10-19)', async () => {
  const { confirmLoginEmail } = await import('./tech-app-email');
  it('carries the link and the username, and nothing about the office', () => {
    const m = confirmLoginEmail({ name: 'Kendell Newbold', link: 'https://app.fajsolutions.com/api/tech/confirm?token_hash=abc&type=signup', username: 'kendal.newbold' });
    expect(m.subject).toBe('Confirm your FAJ tech login');
    expect(m.html).toContain('Hi Kendell,');
    expect(m.html).toContain('href="https://app.fajsolutions.com/api/tech/confirm?token_hash=abc&amp;type=signup"');
    expect(m.html).toContain('kendal.newbold');
    expect(m.html).not.toMatch(/admin|office/i);
  });
});
