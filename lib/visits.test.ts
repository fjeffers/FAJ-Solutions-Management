import { describe, it, expect } from 'vitest';
import { visitLineItem, visitAmount, deriveSiteName, billableHours, actualHours, expectedHours, hoursDisagree, rateAmount, rateUnit, buildRate, billsAtMinimum, MINIMUM_BILLABLE_HOURS } from './visits';

// total_project_price is required on SiteVisit, so it belongs in the shared
// fixture — individual cases override it when the price is the thing under test.
const base = {
  visit_date: '2026-06-20',
  site_name: 'Roselle',
  site_code: '5798',
  visit_type: 'T&M' as const,
  total_project_price: null,
};

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
    const li = visitLineItem({ visit_date: null, site_name: null, site_code: '10760', visit_type: 'T&M', hours: 2, rate: '$55/hr', total_project_price: null });
    expect(li.description).toContain('#10760');
    expect(li.quantity).toBe(2);
  });
});

describe('two-hour billing minimum', () => {
  it('bills a short visit at the minimum, not the time logged', () => {
    const li = visitLineItem({ ...base, hours: 0.75, rate: '$55/hr' });
    expect(li.quantity).toBe(2);
    expect(visitAmount({ ...base, hours: 0.75, rate: '$55/hr', travel_charge: null })).toBe(110);
  });

  it('says so on the line item so the client is not surprised', () => {
    const li = visitLineItem({ ...base, hours: 0.75, rate: '$55/hr' });
    expect(li.description).toContain('0.75h on site');
    expect(li.description).toContain('2h minimum');
  });

  it('leaves visits at or over the minimum exactly as logged', () => {
    expect(visitLineItem({ ...base, hours: 2, rate: '$55/hr' }).quantity).toBe(2);
    expect(visitLineItem({ ...base, hours: 9, rate: '$55/hr' }).quantity).toBe(9);
    expect(visitLineItem({ ...base, hours: 9, rate: '$55/hr' }).description).toContain('9h @ $55/hr');
    expect(visitLineItem({ ...base, hours: 9, rate: '$55/hr' }).description).not.toContain('minimum');
  });

  it('never invents time on a visit nobody has logged yet', () => {
    expect(billableHours(null)).toBe(null);
    expect(billableHours(undefined)).toBe(null);
    expect(billableHours(0)).toBe(0);
  });

  it('does not touch flat rates or project prices — hours are irrelevant there', () => {
    expect(visitAmount({ ...base, hours: 0.5, rate: '$250 flat rate', travel_charge: null })).toBe(250);
    expect(visitAmount({ ...base, hours: 0.5, rate: '$55/hr', total_project_price: 2600, travel_charge: null })).toBe(2600);
  });

  it('still adds travel on top of a minimum-billed visit', () => {
    expect(visitAmount({ ...base, hours: 0.5, rate: '$55/hr', travel_charge: 56.65 })).toBe(166.65);
  });

  it('carries the minimum into an unpriced visit awaiting a rate', () => {
    expect(visitLineItem({ ...base, hours: 1, rate: null }).quantity).toBe(2);
  });

  it('exposes the minimum as a constant rather than a magic number', () => {
    expect(MINIMUM_BILLABLE_HOURS).toBe(2);
  });
});

describe('Line Total matches the tracker — SUM(labor, mileage, materials, other)', () => {
  it('adds materials and other charges on top of labor and travel', () => {
    expect(visitAmount({
      ...base, hours: 3, rate: '$55/hr', travel_charge: 27.5,
      materials_cost: 120, other_charges: 15,
    })).toBe(327.5); // 165 + 27.50 + 120 + 15
  });

  it('treats each of the four parts as optional', () => {
    expect(visitAmount({ ...base, hours: 3, rate: '$55/hr', travel_charge: null })).toBe(165);
    expect(visitAmount({ ...base, hours: null, rate: null, travel_charge: null, materials_cost: 90 })).toBe(90);
    expect(visitAmount({ ...base, hours: null, rate: null, travel_charge: null, other_charges: 40 })).toBe(40);
  });

  it('adds materials to a flat-rate visit too', () => {
    expect(visitAmount({
      ...base, hours: null, rate: '$250 flat rate', travel_charge: null, materials_cost: 50,
    })).toBe(300);
  });

  it('adds them to a fixed project price as well', () => {
    expect(visitAmount({
      ...base, hours: 9, rate: '$55/hr', total_project_price: 2600,
      travel_charge: 56.65, materials_cost: 100, other_charges: 25,
    })).toBe(2781.65);
  });
});

describe('rate entry — the unit is chosen, never guessed', () => {
  it('reads the amount out of any notation', () => {
    expect(rateAmount('$55/hr')).toBe('55');
    expect(rateAmount('55')).toBe('55');
    expect(rateAmount('$250 flat rate')).toBe('250');
    expect(rateAmount('100 / h')).toBe('100');
    expect(rateAmount(null)).toBe('');
  });

  it('reads the unit, treating a bare number as flat — which is the trap', () => {
    expect(rateUnit('$55/hr')).toBe('hr');
    expect(rateUnit('55 / h')).toBe('hr');
    expect(rateUnit('55')).toBe('flat');
    expect(rateUnit('$250 flat rate')).toBe('flat');
    expect(rateUnit(null)).toBe('flat');
  });

  it('writes text the billing parser reads back the same way', () => {
    expect(buildRate('55', 'hr')).toBe('$55/hr');
    expect(buildRate('250', 'flat')).toBe('$250 flat');
    expect(buildRate('', 'hr')).toBe(null);
    expect(buildRate(null, 'flat')).toBe(null);
  });

  it('round-trips: what the form writes, the form reads back unchanged', () => {
    for (const [amount, unit] of [['55','hr'],['100','hr'],['250','flat'],['2600','flat']] as const) {
      const text = buildRate(amount, unit)!;
      expect(rateAmount(text)).toBe(amount);
      expect(rateUnit(text)).toBe(unit);
    }
  });

  it('the hourly form bills hours × rate, the flat form bills once', () => {
    expect(visitAmount({ ...base, hours: 2, rate: buildRate('55','hr'),   travel_charge: 58.7 })).toBe(168.7);
    expect(visitAmount({ ...base, hours: 2, rate: buildRate('55','flat'), travel_charge: 58.7 })).toBe(113.7);
  });
});

describe('the per-visit breakdown adds up to the per-visit total', () => {
  // The card shows "Labor + Mileage + Materials + Other = Total". If rounding
  // made those disagree by a cent the card would be quietly lying.
  const cases = [
    { ...base, hours: 3,     rate: '$55/hr', travel_charge: 27.5,  materials_cost: 120,   other_charges: 15 },
    { ...base, hours: 6.73,  rate: '$55/hr', travel_charge: 69.95, materials_cost: null,  other_charges: null },
    { ...base, hours: 2.21,  rate: '$55/hr', travel_charge: 62.1,  materials_cost: null,  other_charges: null },
    { ...base, hours: 0.75,  rate: '$55/hr', travel_charge: 56.65, materials_cost: 33.33, other_charges: 11.11 },
    { ...base, hours: 19.83, rate: '$55/hr', travel_charge: 47.6,  materials_cost: null,  other_charges: null },
    { ...base, hours: null,  rate: '2600',   travel_charge: 90.3,  materials_cost: null,  other_charges: null },
  ];

  it.each(cases)('holds for %o', (v) => {
    const li = visitLineItem(v);
    const labor = Math.round(li.quantity * li.rate * 100) / 100;
    const parts = labor
      + Number(v.travel_charge ?? 0)
      + Number(v.materials_cost ?? 0)
      + Number(v.other_charges ?? 0);
    expect(Math.round(parts * 100) / 100).toBe(visitAmount(v));
  });
});

describe('actualHours — the real clock time behind a lifted figure', () => {
  it('totals the completed stints', () => {
    expect(actualHours([
      { in: '2026-08-05T13:00:00Z', out: '2026-08-05T13:45:00Z' },
    ])).toBe(0.75);
  });

  it('adds up a multi-day job', () => {
    expect(actualHours([
      { in: '2026-06-04T20:15:00Z', out: '2026-06-04T23:45:00Z' },
      { in: '2026-06-05T10:00:00Z', out: '2026-06-05T13:15:00Z' },
    ])).toBe(6.75);
  });

  it('ignores a stint that is still running', () => {
    expect(actualHours([
      { in: '2026-08-05T13:00:00Z', out: '2026-08-05T14:00:00Z' },
      { in: '2026-08-06T09:00:00Z', out: null },
    ])).toBe(1);
  });

  it('returns null when there is nothing to total', () => {
    expect(actualHours(null)).toBe(null);
    expect(actualHours([])).toBe(null);
    expect(actualHours([{ in: '2026-08-05T13:00:00Z', out: null }])).toBe(null);
  });

  it('counts only time on site, never the nights between visits', () => {
    // The Kellogg 5800 shape: two stints four days apart. First-in to last-out
    // is 94.79 hours; the work was 6.73.
    const stints = [
      { in: '2026-07-31T17:45:00.000Z', out: '2026-07-31T22:45:00.000Z' },
      { in: '2026-08-04T14:49:00.000Z', out: '2026-08-04T16:32:40.832Z' },
    ];
    expect(actualHours(stints)).toBe(6.73);

    const firstIn = new Date(stints[0].in).getTime();
    const lastOut = new Date(stints[1].out).getTime();
    const gap = Math.round(((lastOut - firstIn) / 3600000) * 100) / 100;
    expect(gap).toBe(94.79);
    expect(actualHours(stints)).toBeLessThan(gap);
  });

  it('flags hours that have drifted away from the stints', () => {
    const kellogg = [
      { in: '2026-07-31T17:45:00.000Z', out: '2026-07-31T22:45:00.000Z' },
      { in: '2026-08-04T14:49:00.000Z', out: '2026-08-04T16:32:40.832Z' },
    ];
    expect(expectedHours(kellogg)).toBe(6.73);
    expect(hoursDisagree(94.79, kellogg)).toBe(true);   // the bug
    expect(hoursDisagree(6.73, kellogg)).toBe(false);   // after the fix
  });

  it('does not flag a short visit lifted to the minimum', () => {
    const short = [{ in: '2026-08-05T13:00:00Z', out: '2026-08-05T13:45:00Z' }];
    expect(expectedHours(short)).toBe(2);
    expect(hoursDisagree(2, short)).toBe(false);
  });

  it('tolerates rounding, not real drift', () => {
    const s = [{ in: '2026-08-05T09:00:00Z', out: '2026-08-05T14:00:00Z' }];
    expect(hoursDisagree(5.05, s)).toBe(false);
    expect(hoursDisagree(5.5, s)).toBe(true);
  });

  it('says nothing when there is nothing clocked to compare against', () => {
    expect(hoursDisagree(9, null)).toBe(false);
    expect(hoursDisagree(9, [])).toBe(false);
    expect(hoursDisagree(null, [{ in: '2026-08-05T09:00:00Z', out: '2026-08-05T14:00:00Z' }])).toBe(false);
  });

  it('is the figure the badge compares against the stored hours', () => {
    // 45 minutes on site, stored as 2 — the card shows both.
    const onSite = actualHours([{ in: '2026-08-05T13:00:00Z', out: '2026-08-05T13:45:00Z' }]);
    expect(billableHours(onSite)).toBe(2);
    expect(onSite).toBe(0.75);
  });
});

describe('billsAtMinimum — when to flag the visit in the UI', () => {
  it('flags a short hourly visit', () => {
    expect(billsAtMinimum({ hours: 0.75, rate: '$55/hr', total_project_price: null })).toBe(true);
    expect(billsAtMinimum({ hours: 1.99, rate: '55 / h', total_project_price: null })).toBe(true);
  });

  it('does not flag a visit already at or over the minimum', () => {
    expect(billsAtMinimum({ hours: 2, rate: '$55/hr', total_project_price: null })).toBe(false);
    expect(billsAtMinimum({ hours: 8, rate: '$55/hr', total_project_price: null })).toBe(false);
  });

  it('does not flag flat rates or project prices — hours do not bill there', () => {
    expect(billsAtMinimum({ hours: 0.5, rate: '$250 flat rate', total_project_price: null })).toBe(false);
    expect(billsAtMinimum({ hours: 0.5, rate: '2600', total_project_price: null })).toBe(false);
    expect(billsAtMinimum({ hours: 0.5, rate: '$55/hr', total_project_price: 2600 })).toBe(false);
  });

  it('does not flag an unlogged or zero visit', () => {
    expect(billsAtMinimum({ hours: null, rate: '$55/hr', total_project_price: null })).toBe(false);
    expect(billsAtMinimum({ hours: 0, rate: '$55/hr', total_project_price: null })).toBe(false);
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
