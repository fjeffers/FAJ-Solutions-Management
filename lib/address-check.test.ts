import { describe, it, expect } from 'vitest';
import { matchKind, parseCensusMatch, parseNominatimMatch, sameAddress, titleCase } from './address-check';

describe('check address', () => {
  it('reads the Census standard form and its position', () => {
    const census = { result: { addressMatches: [{ matchedAddress: '901 CANAL POINTE BLVD, PRINCETON, NJ, 08540', coordinates: { x: -74.6559, y: 40.3121 } }] } };
    expect(parseCensusMatch(census)).toEqual({
      street: '901 Canal Pointe Blvd', city: 'Princeton', state: 'NJ', zip: '08540',
      lat: 40.3121, lng: -74.6559, line: '901 Canal Pointe Blvd, Princeton, NJ 08540', source: 'census',
    });
    expect(parseCensusMatch({ result: { addressMatches: [] } })).toBeNull();
    expect(parseCensusMatch(null)).toBeNull();
  });
  it('keeps directions in capitals', () => {
    expect(titleCase('1140 NW ROUTE 73')).toBe('1140 NW Route 73');
  });
  it('reads OpenStreetMap when Census has nothing, with the state as two letters', () => {
    const osm = [{ lat: '40.31', lon: '-74.65', address: { house_number: '901', road: 'Canal Pointe Boulevard', town: 'Princeton', state: 'New Jersey', postcode: '08540' } }];
    expect(parseNominatimMatch(osm)).toMatchObject({ street: '901 Canal Pointe Boulevard', city: 'Princeton', state: 'NJ', zip: '08540', source: 'osm' });
    expect(parseNominatimMatch([{ lat: '1', lon: '2', address: { town: 'Princeton' } }])).toBeNull();
  });
  it('says how the find compares with what was typed', () => {
    // Real lookups, 2026-10-22: a typo landed on another street; the right address had no building on OpenStreetMap.
    expect(matchKind({ street: '901 Canal Rd' }, '901 Canal Point Blvd')).toBe('street');
    expect(matchKind({ street: 'Canal Pointe Boulevard' }, '901 Canal Pointe Blvd')).toBe('nobuilding');
    expect(matchKind({ street: '901 Canal Pointe Blvd' }, '901 canal pointe boulevard')).toBe('exact');
    expect(matchKind({ street: '903 Canal Pointe Blvd' }, '901 Canal Pointe Blvd')).toBe('street');
  });
  it('knows when the form already says the same thing', () => {
    const a = { street: '901 Canal Pointe Blvd', city: 'Princeton', state: 'NJ', zip: '08540' };
    expect(sameAddress(a, { site_address: '901 canal pointe blvd.', site_city: 'PRINCETON', site_state: 'nj', site_zip: '08540-1234' })).toBe(true);
    expect(sameAddress(a, { site_address: '901 Canal Point Blvd', site_city: 'Princeton', site_state: 'NJ', site_zip: '08540' })).toBe(false);
  });
});
