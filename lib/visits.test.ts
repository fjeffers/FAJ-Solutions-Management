import { describe, it, expect } from 'vitest';
import { visitLineItem, visitAmount, deriveSiteName, billableHours, actualHours, expectedHours, hoursDisagree, rateAmount, rateUnit, buildRate, readPricing, writePricing, billsAtMinimum, rateIsAmbiguous, visitMilesTotal, visitMileageTotal, visitMaterialsTotal, visitDays, isMultiDay, syncVisitTotals, suspectSessions, hoursLookWrong, MINIMUM_BILLABLE_HOURS, visitInvoiceLines, visitInvoiceTotal, workOrderMoneyFromVisit } from './visits';

import type { SiteVisit } from './types';

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

describe('pricing a visit — one answer, not two competing fields', () => {
  it('opens a new visit on per hour, the common case', () => {
    expect(readPricing({ rate: null, total_project_price: null }))
      .toEqual({ amount: '', unit: 'hr' });
    expect(readPricing({ rate: '', total_project_price: null }))
      .toEqual({ amount: '', unit: 'hr' });
  });

  it('reads back what was set, either way round', () => {
    expect(readPricing({ rate: '$55/hr', total_project_price: null }))
      .toEqual({ amount: '55', unit: 'hr' });
    expect(readPricing({ rate: null, total_project_price: 540 }))
      .toEqual({ amount: '540', unit: 'flat' });
  });

  it('shows an old bare rate as flat, which is what it currently bills as', () => {
    // Not silently reinterpreted — the form shows the truth so it can be flipped.
    expect(readPricing({ rate: '55', total_project_price: null }))
      .toEqual({ amount: '55', unit: 'flat' });
  });

  it('lets a project price win, the way billing does', () => {
    expect(readPricing({ rate: '$55/hr', total_project_price: 2600 }))
      .toEqual({ amount: '2600', unit: 'flat' });
  });

  it('writes the pair so the two can never disagree', () => {
    expect(writePricing('55', 'hr')).toEqual({ rate: '$55/hr', total_project_price: null });
    expect(writePricing('540', 'flat')).toEqual({ rate: null, total_project_price: 540 });
    expect(writePricing('', 'hr')).toEqual({ rate: null, total_project_price: null });
  });

  it('keeps zero as a real no-charge visit', () => {
    expect(writePricing('0', 'flat')).toEqual({ rate: null, total_project_price: 0 });
    expect(readPricing({ rate: null, total_project_price: 0 })).toEqual({ amount: '0', unit: 'flat' });
  });

  it('round-trips through the form without drifting', () => {
    for (const [amount, unit] of [['55','hr'],['100','hr'],['540','flat'],['2600','flat']] as const) {
      expect(readPricing(writePricing(amount, unit) as never)).toEqual({ amount, unit });
    }
  });

  it('bills what the form says: per hour uses hours, flat does not', () => {
    const hourly = { ...base, hours: 2, travel_charge: 58.7, ...writePricing('55', 'hr') };
    const flat   = { ...base, hours: 6.75, travel_charge: 82.7, ...writePricing('540', 'flat') };
    expect(visitAmount(hourly)).toBe(168.7);   // 2 × 55 + 58.70
    expect(visitAmount(flat)).toBe(622.7);     // 540 once + 82.70
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

describe('visitInvoiceLines', () => {
  const site = { ...base, site_name: 'Roselle', site_code: '5798' };

  it('bills materials and other charges, which the invoice used to drop', () => {
    const lines = visitInvoiceLines({
      ...site, hours: 2, rate: '$55/hr',
      travel_charge: 58.7, materials_cost: 120, other_charges: 40,
      materials_description: 'CAT6 + faceplates',
    });
    expect(lines).toHaveLength(4);
    expect(lines[1].description).toContain('travel charge');
    expect(lines[2].description).toContain('materials: CAT6 + faceplates');
    expect(lines[3].description).toContain('other charges');
    expect(visitInvoiceTotal(lines)).toBe(328.7); // 110 + 58.70 + 120 + 40
  });

  it('comes to exactly what the visit is worth, for every shape', () => {
    const shapes = [
      { ...site, hours: 2, rate: '$55/hr', travel_charge: 58.7 },
      { ...site, hours: 9, rate: '$55/hr', travel_charge: 56.65, materials_cost: 120 },
      { ...site, hours: null, rate: null, total_project_price: 2600, travel_charge: 80.9 },
      { ...site, hours: 4.03, rate: '$55/hr', travel_charge: 87.25, other_charges: 40 },
      { ...site, hours: 19.83, rate: '$55/hr', travel_charge: 47.6, materials_cost: 12.34, other_charges: 5.67 },
      { ...site, hours: 0, rate: null, travel_charge: 0 },
    ];
    for (const v of shapes) {
      expect(visitInvoiceTotal(visitInvoiceLines(v)), JSON.stringify(v)).toBe(visitAmount(v));
    }
  });

  it('leaves out the parts that are zero rather than billing $0.00 lines', () => {
    const lines = visitInvoiceLines({ ...site, hours: 2, rate: '$55/hr', travel_charge: 0, materials_cost: 0, other_charges: null });
    expect(lines).toHaveLength(1);
  });

  it('names materials plainly when no description was typed', () => {
    const lines = visitInvoiceLines({ ...site, hours: 2, rate: '$55/hr', travel_charge: null, materials_cost: 75 });
    expect(lines[1].description).toBe('Roselle #5798 — materials');
  });
});

describe('workOrderMoneyFromVisit', () => {
  const site = { ...base, site_name: 'Hillside', site_code: '1331' };

  it('bills the travel to the CLIENT, and never as a payout to the tech', () => {
    // The Hillside job: 2h @ $55 plus 117.4 miles / $58.70 of travel.
    const wo = workOrderMoneyFromVisit(
      { ...site, hours: 2, rate: '$55/hr', miles: 117.4, travel_charge: 58.7 },
      'Frederick Jeffers',
    );
    expect(wo.total_amount).toBe(168.7);
    expect(wo.hours_worked).toBe(2);
    expect(wo.billable_travel).toBe(58.7);
    // Reimbursement is a separate commercial decision and varies by job.
    // Writing it here turned revenue into an expense and showed a loss.
    expect(wo.mileage_logs).toHaveLength(0);
  });

  it('does not treat materials Fred bought as a sale to the client', () => {
    const wo = workOrderMoneyFromVisit(
      { ...site, hours: 2, rate: '$55/hr', travel_charge: null, materials_cost: 120, materials_description: 'CAT6' },
      'Frederick Jeffers',
    );
    // Recorded as used, but his until he says the client bought it.
    expect(wo.materials_used[0].client_pays).toBe(false);
    expect(wo.billable_materials).toBe(null);
  });

  it('carries materials with the description typed on the visit', () => {
    const wo = workOrderMoneyFromVisit(
      { ...site, hours: 2, rate: '$55/hr', travel_charge: null, materials_cost: 120, materials_description: 'CAT6 + faceplates' },
      'Frederick Jeffers',
    );
    expect(wo.materials_used[0]).toMatchObject({ name: 'CAT6 + faceplates', quantity: 1, unit_cost: 120 });
  });

  it('spells out other charges rather than folding them in silently', () => {
    const wo = workOrderMoneyFromVisit(
      { ...site, hours: 2, rate: '$55/hr', travel_charge: null, other_charges: 40 },
      'Frederick Jeffers',
    );
    expect(wo.other_charges_note).toContain('40.00');
  });

  it('a flat-priced job is Fixed, with no hourly rate to contradict it', () => {
    const wo = workOrderMoneyFromVisit(
      { ...site, hours: null, rate: null, total_project_price: 2600, travel_charge: 80.9 },
      'Frederick Jeffers',
    );
    expect(wo.pay_type).toBe('Fixed');
    expect(wo.hourly_rate).toBe(null);
    expect(wo.hours_worked).toBe(null);
    expect(wo.total_amount).toBe(2680.9);
  });

  it('adds no empty rows when there was no travel or materials', () => {
    const wo = workOrderMoneyFromVisit({ ...site, hours: 2, rate: '$55/hr', travel_charge: 0 }, 'F');
    expect(wo.billable_travel).toBe(null);
    expect(wo.materials_used).toHaveLength(0);
    expect(wo.other_charges_note).toBe(null);
  });

  it('bills a travel charge that has no mileage recorded behind it', () => {
    const wo = workOrderMoneyFromVisit({ ...site, hours: 2, rate: '$55/hr', miles: null, travel_charge: 25 }, 'F');
    expect(wo.billable_travel).toBe(25);
  });
});

describe('rateIsAmbiguous', () => {
  const v = (rate: string | null, hours: number | null, price: number | null = null) =>
    ({ rate, hours, total_project_price: price } as Pick<SiteVisit, 'hours' | 'rate' | 'total_project_price'>);

  it('flags a bare number on a visit with hours', () => {
    // Cherry Hill 2026-06-01: "55" on 2 hours bills $55, not $110.
    expect(rateIsAmbiguous(v('55', 2))).toBe(true);
    expect(rateIsAmbiguous(v('100', 3))).toBe(true);
    expect(rateIsAmbiguous(v('540', 6.75))).toBe(true);
  });

  it('trusts a rate that states its unit', () => {
    expect(rateIsAmbiguous(v('$55/hr', 2))).toBe(false);
    expect(rateIsAmbiguous(v('55 / h', 2))).toBe(false);
    expect(rateIsAmbiguous(v('$540 flat', 6.75))).toBe(false);
  });

  it('treats a typed project price as the decision', () => {
    expect(rateIsAmbiguous(v('2600', 8, 2600))).toBe(false);
  });

  it('says nothing when there are no hours to bill', () => {
    // A flat "2600" with no hours is exactly what it looks like.
    expect(rateIsAmbiguous(v('2600', 0))).toBe(false);
    expect(rateIsAmbiguous(v('2600', null))).toBe(false);
  });

  it('ignores a blank rate or a rate that is only a note', () => {
    expect(rateIsAmbiguous(v(null, 2))).toBe(false);
    expect(rateIsAmbiguous(v('', 2))).toBe(false);
    expect(rateIsAmbiguous(v('see email', 2))).toBe(false);
  });
});

describe('the two-trip job: go out, buy parts, come back', () => {
  // Fred's own words: "go to the site today but they dont have meterials i
  // have to buy meterials and return to finish the job". One visit, two days,
  // two round trips, parts bought in between.
  const twoTrip = {
    visit_date: '2026-09-01',
    site_name: 'Swedesboro', site_code: '9291', visit_type: 'T&M',
    rate: '$55/hr',
    sessions: [
      { in: '2026-09-01T13:00:00Z', out: '2026-09-01T15:00:00Z' }, // Mon, 2h
      { in: '2026-09-02T13:00:00Z', out: '2026-09-02T17:00:00Z' }, // Tue, 4h
    ],
    hours: 6,
    miles: null, travel_charge: null,
    materials_cost: null, materials_description: null, other_charges: null,
    total_project_price: null,
    mileage_logs: [
      { id: 'm1', contractor_name: 'Fred', miles: 40, rate: 0.5, note: 'out', on: '2026-09-01' },
      { id: 'm2', contractor_name: 'Fred', miles: 40, rate: 0.5, note: 'back', on: '2026-09-02' },
    ],
    materials_used: [
      { id: 'p1', material_id: null, name: 'Faceplates', quantity: 4, unit_cost: 12, on: '2026-09-02' },
      { id: 'p2', material_id: null, name: 'Cat6 box', quantity: 1, unit_cost: 180, on: '2026-09-02' },
    ],
  } as unknown as SiteVisit;

  it('adds up every drive, not just one', () => {
    expect(visitMilesTotal(twoTrip)).toBe(80);
    expect(visitMileageTotal(twoTrip)).toBe(40);   // 80 mi @ $0.50
  });

  it('adds up every part, quantity included', () => {
    expect(visitMaterialsTotal(twoTrip)).toBe(228); // 4x$12 + 1x$180
  });

  it('bills labour plus both trips plus both parts', () => {
    // 6h @ $55 = 330, + $40 driving, + $228 parts
    expect(visitAmount(twoTrip)).toBe(598);
  });

  it('splits the visit into the days it actually happened on', () => {
    const days = visitDays(twoTrip);
    expect(days.map((d) => d.date)).toEqual(['2026-09-01', '2026-09-02']);
    expect(days[0]).toMatchObject({ hours: 2, miles: 40, travel: 20, materials: 0 });
    expect(days[1]).toMatchObject({ hours: 4, miles: 40, travel: 20, materials: 228 });
    expect(isMultiDay(twoTrip)).toBe(true);
  });

  it('counts a day that had a drive but no clock-in', () => {
    // Dropping parts off without working is still a day and still a drive.
    const v = { ...twoTrip, sessions: [twoTrip.sessions![0]] } as SiteVisit;
    const days = visitDays(v);
    expect(days).toHaveLength(2);
    expect(days[1]).toMatchObject({ date: '2026-09-02', hours: 0, miles: 40 });
  });

  it('brings the single columns back into line with the rows', () => {
    const synced = syncVisitTotals(twoTrip);
    expect(synced.miles).toBe(80);
    expect(synced.travel_charge).toBe(40);
    expect(synced.materials_cost).toBe(228);
    expect(synced.materials_description).toBe('Faceplates, Cat6 box');
  });

  it('names three or more parts without an unreadable run-on', () => {
    const synced = syncVisitTotals({
      ...twoTrip,
      materials_used: [
        { id: 'a', material_id: null, name: 'Faceplates', quantity: 1, unit_cost: 1 },
        { id: 'b', material_id: null, name: 'Cat6 box', quantity: 1, unit_cost: 1 },
        { id: 'c', material_id: null, name: 'Jacks', quantity: 1, unit_cost: 1 },
        { id: 'd', material_id: null, name: 'Patch cords', quantity: 1, unit_cost: 1 },
      ],
    } as SiteVisit);
    expect(synced.materials_description).toBe('Faceplates, Cat6 box +2 more');
  });

  it('carries every part onto the work order instead of one lumped line', () => {
    const money = workOrderMoneyFromVisit(twoTrip, 'Frederick Jeffers');
    expect(money.materials_used).toHaveLength(2);
    expect(money.materials_used.map((m) => m.name)).toEqual(['Faceplates', 'Cat6 box']);
    expect(money.materials_used[0].quantity).toBe(4);
    expect(money.materials_used[1].on).toBe('2026-09-02');
    expect(money.total_amount).toBe(598);
    // Reimbursing the tech for driving stays a separate decision, as before.
    expect(money.mileage_logs).toEqual([]);
  });
});

describe('a visit with no rows behaves exactly as it always did', () => {
  const plain = {
    visit_date: '2026-08-20', site_name: 'Easton', site_code: '1', visit_type: 'T&M',
    rate: '$55/hr', hours: 2, sessions: null,
    miles: 100, travel_charge: 50, materials_cost: 30, materials_description: 'Cable',
    other_charges: null, total_project_price: null,
    mileage_logs: [], materials_used: [],
  } as unknown as SiteVisit;

  it('falls back to the single columns', () => {
    expect(visitMilesTotal(plain)).toBe(100);
    expect(visitMileageTotal(plain)).toBe(50);
    expect(visitMaterialsTotal(plain)).toBe(30);
    expect(visitAmount(plain)).toBe(190);   // 2h x 55 + 50 + 30
  });

  it('is a single day', () => {
    expect(isMultiDay(plain)).toBe(false);
    expect(visitDays(plain).map((d) => d.date)).toEqual(['2026-08-20']);
  });

  it('leaves the single columns untouched when there are no rows', () => {
    const synced = syncVisitTotals(plain);
    expect(synced.miles).toBe(100);
    expect(synced.materials_cost).toBe(30);
    expect(synced.materials_description).toBe('Cable');
  });
});

describe('a clock somebody forgot to stop', () => {
  // The real one: a Swedesboro visit with a stint from 31 July to 1 September.
  // 787.5 hours on the visit, which at $55/hr bills $43,312.50 for a $55 call.
  const runaway = {
    sessions: [
      { in: '2026-08-30T05:30:00.000Z', out: '2026-08-30T23:30:00.000Z' },
      { in: '2026-07-31T10:30:00.000Z', out: '2026-09-01T12:00:00.000Z' },
    ],
  } as SiteVisit;

  it('names the stint that cannot be real', () => {
    const bad = suspectSessions(runaway);
    expect(bad).toHaveLength(2);          // 18h and 769.5h both exceed 16h
    expect(bad[1].hours).toBe(769.5);
    expect(hoursLookWrong(runaway)).toBe(true);
  });

  it('flags a clock that was never stopped', () => {
    const open = { sessions: [{ in: '2026-09-01T12:00:00Z', out: null }] } as SiteVisit;
    expect(suspectSessions(open)).toEqual([{ in: '2026-09-01T12:00:00Z', out: null, hours: null }]);
  });

  it('leaves a long but believable day alone', () => {
    // Twelve hours on site is a hard day, not a mistake.
    const longDay = {
      sessions: [{ in: '2026-09-01T11:00:00Z', out: '2026-09-01T23:00:00Z' }],
    } as SiteVisit;
    expect(hoursLookWrong(longDay)).toBe(false);
  });

  it('says nothing about a visit with no stints', () => {
    expect(hoursLookWrong({ sessions: null } as SiteVisit)).toBe(false);
    expect(hoursLookWrong({ sessions: [] } as unknown as SiteVisit)).toBe(false);
  });
});
