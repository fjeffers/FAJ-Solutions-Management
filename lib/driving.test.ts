import { describe, it, expect, vi, afterEach } from 'vitest';
import { addressVariants, oneWayMiles } from './driving';

afterEach(() => { vi.unstubAllGlobals(); });

describe('oneWayMiles', () => {
  const answer = (body: unknown) => ({ ok: true, json: async () => body });
  it('is the road miles from one address to the other, to 0.1 mi (Fred, 2026-10-27)', async () => {
    const fetch = vi.fn(async (url: string) => (url.includes('nominatim')
      ? answer([{ lat: url.includes('Hotel') ? '39.16' : '38.69', lon: '-75.52' }])
      : answer({ routes: [{ distance: 68_073.5 }] })));
    vi.stubGlobal('fetch', fetch);
    expect(await oneWayMiles('1 Hotel Way, Dover, DE 19901', '20 Site Rd, Milford, DE 19963')).toBe(42.3);
    expect(fetch.mock.calls.some(([u]) => String(u).includes('router.project-osrm.org'))).toBe(true);
  });

  it("is null when an address can't be found, or either is blank", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => answer([])));
    expect(await oneWayMiles('Nowhere at all', '20 Site Rd, Milford, DE 19963')).toBeNull();
    expect(await oneWayMiles('', '20 Site Rd, Milford, DE 19963')).toBeNull();
  });
});

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
