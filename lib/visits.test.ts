import { describe, it, expect } from 'vitest';
import { visitLineItem, visitAmount, deriveSiteName } from './visits';

const base = { visit_date: '2026-06-20', site_name: 'Roselle', site_code: '5798', visit_type: 'T&M' as const };

describe('visitLineItem', () => {
  it('bills hourly rates as hours x rate', () => {
    const li = visitLineItem({ ...base, hours: 9, rate: '$55/hr' });
    expect(li.quantity).toBe(9);
    expect(li.rate).toBe(55);
    expect(li.description).toContain('Roselle #5798');
    expect(li.description).toContain('9h @ $55/hr');
  });

  it('bills plain numbers and "flat rate" text as one flat line', () => {
    expect(visitLineItem({ ...base, hours: null, rate: '2600' })).toMatchObject({ quantity: 1, rate: 2600 });
    expect(visitLineItem({ ...base, hours: null, rate: '$250 flat rate' })).toMatchObject({ quantity: 1, rate: 250 });
  });

  it('leaves unpriced visits at rate 0 with hours carried', () => {
    const li = visitLineItem({ ...base, hours: 2, rate: null });
    expect(li).toMatchObject({ quantity: 2, rate: 0 });
    expect(li.description).toContain('set rate');
  });

  it('lets a typed project price outrank the free-text rate', () => {
    const li = visitLineItem({ ...base, hours: 9, rate: '$55/hr', total_project_price: 2600 });
    expect(li).toMatchObject({ quantity: 1, rate: 2600 });
    expect(li.description).toContain('project price');
    // Travel still bills on top of a fixed price.
    expect(visitAmount({ ...base, hours: 9, rate: '$55/hr', total_project_price: 2600, travel_charge: 56.65 })).toBe(2656.65);
  });

  it('treats a zero project price as a real no-charge visit, not a blank', () => {
    expect(visitAmount({ ...base, hours: 3, rate: '$55/hr', total_project_price: 0, travel_charge: null })).toBe(0);
  });

  it('falls back to the rate text when no project price is set', () => {
    expect(visitAmount({ ...base, hours: 9, rate: '$55/hr', total_project_price: null, travel_charge: null })).toBe(495);
  });

  it('totals a visit as labor plus travel', () => {
    expect(visitAmount({ ...base, hours: 9, rate: '$55/hr', travel_charge: 56.65 })).toBe(551.65);
    expect(visitAmount({ ...base, hours: null, rate: '2600', travel_charge: null })).toBe(2600);
    expect(visitAmount({ ...base, hours: 2, rate: null, travel_charge: 10 })).toBe(10);
  });

  it('handles missing date and site name', () => {
    const li = visitLineItem({ visit_date: null, site_name: null, site_code: '10760', visit_type: 'T&M', hours: 2, rate: '$55/hr' });
    expect(li.description).toContain('#10760');
    expect(li.quantity).toBe(2);
  });
});

describe('deriveSiteName', () => {
  it('uses a NetView sheet title as-is — it is already the location', () => {
    expect(deriveSiteName('EDGEWATER II')).toBe('EDGEWATER II');
    expect(deriveSiteName('Mt. Laurel')).toBe('Mt. Laurel');
    expect(deriveSiteName('WOODBURY HTS')).toBe('WOODBURY HTS');
  });

  it('takes the last segment of a slash-delimited email-parsed title', () => {
    expect(deriveSiteName("Wendy's / Site ID 5519 / NJ & Philly / Project / PERTH AMBOY"))
      .toBe('PERTH AMBOY');
  });

  it('preserves casing rather than prettifying — re-casing mangles numerals', () => {
    expect(deriveSiteName('VOORHEES 1')).toBe('VOORHEES 1');
  });

  it('falls back to the customer name when there is no title', () => {
    expect(deriveSiteName(null, "Wendy's")).toBe("Wendy's");
    expect(deriveSiteName('   ', 'State Farm')).toBe('State Farm');
  });

  it('returns null when it has nothing to work with', () => {
    expect(deriveSiteName(null)).toBeNull();
    expect(deriveSiteName('', '')).toBeNull();
    expect(deriveSiteName('///')).toBeNull();
  });
});
