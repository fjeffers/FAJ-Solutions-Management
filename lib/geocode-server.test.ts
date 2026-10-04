import { describe, expect, it } from 'vitest';
import { parseCensus, parseNominatim, siteLine } from './geocode-server';

describe('job site positions', () => {
  it('reads a Census match (x is longitude, y is latitude)', () => {
    expect(parseCensus({ result: { addressMatches: [{ coordinates: { x: -75.2207, y: 40.6884 } }] } }))
      .toEqual({ lat: 40.6884, lng: -75.2207 });
    expect(parseCensus({ result: { addressMatches: [] } })).toBeNull();
    expect(parseCensus(null)).toBeNull();
  });
  it('reads a Nominatim match', () => {
    expect(parseNominatim([{ lat: '40.6884', lon: '-75.2207' }])).toEqual({ lat: 40.6884, lng: -75.2207 });
    expect(parseNominatim([])).toBeNull();
  });
  it('builds one address line, skipping blanks', () => {
    expect(siteLine({ site_address: '627 E Main St', site_city: 'Laurens', site_state: 'SC', site_zip: '29360' }))
      .toBe('627 E Main St, Laurens, SC 29360');
    expect(siteLine({ site_address: '1 Main', site_city: '', site_state: 'PA', site_zip: null })).toBe('1 Main, PA');
  });
});
