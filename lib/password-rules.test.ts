import { describe, expect, it } from 'vitest';
import { passwordProblem } from './password-rules';

describe('changing a password', () => {
  it('accepts a good new password', () => {
    expect(passwordProblem('Fajsolutions2026', 'Fajsolutions2026', 'old-password')).toBeNull();
    expect(passwordProblem('long enough', 'long enough')).toBeNull(); // email-link reset: no current password
  });
  it('says plainly what is wrong', () => {
    expect(passwordProblem('new-password', 'new-password', '')).toBe('Type your current password.');
    expect(passwordProblem('short', 'short', 'old')).toMatch(/at least 8/);
    expect(passwordProblem('new-password', 'new-passw0rd', 'old')).toMatch(/don't match/);
    expect(passwordProblem('same-password', 'same-password', 'same-password')).toMatch(/same as the current/);
    expect(passwordProblem(' padded-pass', ' padded-pass', 'old')).toMatch(/space/);
    expect(passwordProblem('x'.repeat(73), 'x'.repeat(73), 'old')).toMatch(/too long/);
  });
});
