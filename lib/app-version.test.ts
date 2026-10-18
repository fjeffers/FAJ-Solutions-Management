import { describe, expect, it } from 'vitest';
import { needsUpdate } from './app-version';

describe('an open app that is out of date', () => {
  it('asks for an update only when the live build is a different one', () => {
    expect(needsUpdate('abc123', 'def456')).toBe(true);
    expect(needsUpdate('abc123', 'abc123')).toBe(false);
  });
  it('never on a local build or a bad answer', () => {
    expect(needsUpdate('dev', 'def456')).toBe(false);
    expect(needsUpdate('abc123', 'dev')).toBe(false);
    expect(needsUpdate('abc123', undefined)).toBe(false);
    expect(needsUpdate('abc123', '')).toBe(false);
  });
});
