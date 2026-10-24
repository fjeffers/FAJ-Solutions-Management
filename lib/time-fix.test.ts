import { describe, expect, it } from 'vitest';
import { fixProblem, fromLocalInput, tapLabel, toLocalInput } from './time-fix';

const NY = 'America/New_York';

describe('local time boxes in New York', () => {
  it('reads a summer time', () => {
    expect(fromLocalInput('2026-07-10T16:30', NY)).toBe('2026-07-10T20:30:00.000Z');
  });
  it('reads a winter time', () => {
    expect(fromLocalInput('2026-12-01T07:05', NY)).toBe('2026-12-01T12:05:00.000Z');
  });
  it('round-trips', () => {
    for (const iso of ['2026-10-24T14:45:00.000Z', '2026-03-08T12:00:00.000Z', '2026-11-01T05:30:00.000Z']) {
      expect(fromLocalInput(toLocalInput(iso, NY), NY)).toBe(iso);
    }
  });
  it('shows the New York wall clock', () => {
    expect(toLocalInput('2026-10-24T14:45:00.000Z', NY)).toBe('2026-10-24T10:45');
  });
  it('turns down what isn’t a time', () => {
    expect(fromLocalInput('', NY)).toBeNull();
    expect(fromLocalInput('10:45', NY)).toBeNull();
  });
});

describe('fixProblem', () => {
  const now = new Date('2026-10-24T20:00:00Z');
  it('allows a correction on the same day', () => {
    expect(fixProblem('2026-10-23T23:45:00Z', '2026-10-23T20:30:00Z', now)).toBeNull();
  });
  it('refuses the future', () => {
    expect(fixProblem('2026-10-24T19:00:00Z', '2026-10-24T22:00:00Z', now)).toMatch(/hasn’t happened/);
  });
  it('refuses more than 2 days from the phone', () => {
    expect(fixProblem('2026-10-23T12:00:00Z', '2026-10-20T12:00:00Z', now)).toMatch(/2 days/);
  });
});

describe('tapLabel', () => {
  it('names taps as the tech saw them', () => {
    expect(tapLabel({ kind: 'out' })).toBe('Off site');
    expect(tapLabel({ kind: 'travel_end', dest: 'home' })).toBe('Arrived home');
    expect(tapLabel({ kind: 'travel_start', dest: 'site' })).toBe('Started travel');
  });
});
