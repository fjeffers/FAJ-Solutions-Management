import { describe, it, expect } from 'vitest';
import { NAV_APPS, navLink } from './navigation';

const addr = { address: '901 Canal Pointe Blvd, Princeton, NJ 08540', lat: null, lng: null };
const pin = { address: '901 Canal Pointe Blvd, Princeton, NJ 08540', lat: 40.3121, lng: -74.6559 };

describe('directions in the tech\'s own app', () => {
  it('offers Google Maps, Waze and Apple Maps', () => {
    expect(NAV_APPS.map((a) => a.label)).toEqual(['Google Maps', 'Waze', 'Apple Maps']);
  });
  it('goes to the address when there is no GPS point', () => {
    expect(navLink('google', addr)).toBe('https://www.google.com/maps/dir/?api=1&destination=901%20Canal%20Pointe%20Blvd%2C%20Princeton%2C%20NJ%2008540');
    expect(navLink('waze', addr)).toBe('https://waze.com/ul?q=901%20Canal%20Pointe%20Blvd%2C%20Princeton%2C%20NJ%2008540&navigate=yes');
    expect(navLink('apple', addr)).toBe('https://maps.apple.com/?daddr=901%20Canal%20Pointe%20Blvd%2C%20Princeton%2C%20NJ%2008540&dirflg=d');
  });
  it("goes to the site's GPS point when the office has one", () => {
    expect(navLink('waze', pin)).toBe('https://waze.com/ul?ll=40.312100%2C-74.655900&navigate=yes');
    expect(navLink('google', pin)).toContain('destination=40.312100%2C-74.655900');
  });
  it('has nothing to open with no address and no point', () => {
    expect(navLink('google', { address: '  ', lat: null, lng: null })).toBeNull();
    expect(navLink('waze', { address: '', lat: 0, lng: 0 })).toBeNull();
  });
});
