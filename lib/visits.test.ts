import { describe, it, expect } from 'vitest';
import { visitLineItem, visitAmount } from './visits';

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
