import { describe, expect, it } from 'vitest';
import { feetInches, parseLength, scaleFrom } from './photo-measure';

describe('measuring on a photo', () => {
  it('lengths scale from a reference of known size', () => {
    const k = scaleFrom({ x: 0, y: 0 }, { x: 200, y: 0 }, 2)!; // a 2 ft tile is 200 px
    expect(k * 500).toBe(5); // so 500 px is 5 ft
    expect(scaleFrom({ x: 0, y: 0 }, { x: 1, y: 1 }, 2)).toBeNull(); // the two taps are on top of each other
    expect(scaleFrom({ x: 0, y: 0 }, { x: 100, y: 0 }, 0)).toBeNull();
  });

  it('reads the ways a tech types a length', () => {
    expect(parseLength('2')).toBe(2);
    expect(parseLength('2.5')).toBe(2.5);
    expect(parseLength("2'6")).toBe(2.5);
    expect(parseLength(`2' 6"`)).toBe(2.5);
    expect(parseLength('30in')).toBe(2.5);
    expect(parseLength('30"')).toBe(2.5);
    expect(parseLength('6 ft')).toBe(6);
    expect(parseLength('two')).toBeNull();
  });

  it('shows feet and inches', () => {
    expect(feetInches(2.5)).toBe(`2' 6"`);
    expect(feetInches(0.75)).toBe('9"');
    expect(feetInches(10)).toBe(`10'`);
  });
});
