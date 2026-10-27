import { describe, it, expect } from 'vitest';
import { addressVariants } from './driving';

describe('addressVariants', () => {
  it('cleans State Farm prefixes and suite numbers', () => {
    const v = addressVariants('State Farm 768 N Bethlehem Pike Ste 102 Ambler, PA 19002-2658');
    expect(v[0]).not.toMatch(/State Farm|Ste/);
  });

  it('offers a highway-number variant for Route addresses', () => {
    const v = addressVariants('1140 Route 73, Mt.laurel, NJ 08054');
    expect(v.some((x) => x.includes('NJ-73'))).toBe(true);
    expect(v[0]).toContain('Mount Laurel');
  });

  it('pads 4-digit zips and falls back to city level', () => {
    const v = addressVariants('356 Route 72 West, Manahawkin, NJ 8050');
    expect(v[0]).toContain('08050');
    expect(v[v.length - 1].length).toBeLessThan(v[0].length);
  });

  it('keeps a clean address as the first exact try', () => {
    const v = addressVariants('310 Macdade Boulevard, Folsom, PA 19033');
    expect(v[0]).toBe('310 Macdade Boulevard, Folsom, PA 19033');
  });
});
