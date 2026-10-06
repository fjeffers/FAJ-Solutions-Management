import { describe, expect, it } from 'vitest';
import { onboardingEmail } from './onboarding-email';

describe('the paperwork email', () => {
  it('asks only for what is missing', () => {
    const w9Only = onboardingEmail({ name: 'Bryant Knight', portalUrl: 'https://x/p', needsW9: true, needsAgreement: false });
    expect(w9Only.subject).toBe('FAJ Solutions — your W-9');
    expect(w9Only.html).toContain('Your W-9.');
    expect(w9Only.html).not.toContain('contractor agreement.</strong>');
    expect(w9Only.html).toContain('Hi Bryant,');
    const both = onboardingEmail({ name: 'Davis Sanders', portalUrl: 'https://x/p' });
    expect(both.subject).toBe('FAJ Solutions — your W-9 and contractor agreement');
    expect(both.html).toContain('1. <strong>Your W-9.');
    expect(both.html).toContain('2. <strong>The contractor agreement.');
    const agreementOnly = onboardingEmail({ name: 'Ann', portalUrl: 'u', needsW9: false, needsAgreement: true });
    expect(agreementOnly.subject).toBe('FAJ Solutions — your contractor agreement');
  });

  it('never says "first job" or "welcome aboard" to someone who has worked for us', () => {
    const { html } = onboardingEmail({ name: 'Davis Sanders', portalUrl: 'u' });
    expect(html).not.toMatch(/first job|welcome aboard/i);
  });

  it('a name or link cannot break the email', () => {
    const { html } = onboardingEmail({ name: '<b>Eve</b>', portalUrl: 'https://x/"><script>' });
    expect(html).not.toContain('<b>Eve');
    expect(html).not.toContain('"><script>');
  });
});
