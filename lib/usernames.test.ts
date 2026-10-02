import { describe, expect, it } from 'vitest';
import { normalizeUsername, usernameProblem, looksLikeEmail, suggestUsername } from './usernames';

describe('usernames', () => {
  it('are stored trimmed and lower-case', () => {
    expect(normalizeUsername('  JereJ ')).toBe('jerej');
  });
  it('accept the ordinary kinds', () => {
    for (const u of ['jere.jones', 'davis_s', 'mutema-d', 'fred77', 'abc']) expect(usernameProblem(u)).toBeNull();
  });
  it('say plainly what is wrong', () => {
    expect(usernameProblem('')).toMatch(/Pick/);
    expect(usernameProblem('ab')).toMatch(/at least 3/);
    expect(usernameProblem('jere jones')).toMatch(/spaces/);
    expect(usernameProblem('jere@x.com')).toMatch(/@/);
    expect(usernameProblem('.jere')).toMatch(/Start/);
    expect(usernameProblem('jere!')).toMatch(/only letters/);
    expect(usernameProblem('a'.repeat(31))).toMatch(/30/);
  });
  it('the sign-in box tells an email from a username', () => {
    expect(looksLikeEmail('jere@example.com')).toBe(true);
    expect(looksLikeEmail('jere.jones')).toBe(false);
  });
  it('suggests one from a name', () => {
    expect(suggestUsername('Jere Jones')).toBe('jere.jones');
    expect(suggestUsername("D'Andre  O'Neil")).toBe('dandre.oneil');
    expect(suggestUsername('Al')).toBe('');
  });
});
