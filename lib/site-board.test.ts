import { describe, it, expect } from 'vitest';
import {
  groupVisits, sortVisits, totalsOf, pillFor, groupColor, GROUP_BY_LABEL,
} from './site-board';
import type { SiteVisit } from './types';

// Real shapes from the statement: an hourly T&M visit, a flat-rate project and
// an unpriced revisit. Only the fields the board reads are set.
const v = (over: Record<string, unknown>): SiteVisit => ({
  id: Math.random().toString(36).slice(2),
  visit_date: '2026-08-21',
  program: "Wendy's",
  site_code: '1331',
  site_name: 'Hillside',
  visit_type: 'T&M',
  hours: 2,
  rate: '$55/hr',
  miles: 117.4,
  travel_charge: 58.7,
  materials_cost: null,
  other_charges: null,
  total_project_price: null,
  invoice_status: 'not_invoiced',
  payment_status: 'unpaid',
  ...over,
} as SiteVisit);

describe('totalsOf', () => {
  it('sums hours, miles, labour and the line total', () => {
    const t = totalsOf([
      v({ hours: 2, rate: '$55/hr', miles: 117.4, travel_charge: 58.7 }),
      v({ hours: 9, rate: '$55/hr', miles: 113.3, travel_charge: 56.65 }),
    ]);
    expect(t.count).toBe(2);
    expect(t.hours).toBe(11);
    expect(t.miles).toBe(230.7);
    expect(t.labor).toBe(605);            // (2 + 9) x 55
    expect(t.total).toBe(720.35);         // 605 + 58.70 + 56.65
  });

  it('is zero across the board for no rows, not NaN', () => {
    expect(totalsOf([])).toEqual({ count: 0, hours: 0, miles: 0, labor: 0, total: 0 });
  });

  it('counts a flat-rate project once rather than by the hour', () => {
    // Folsom: 2,600 flat with 161.8 miles. Hours must not multiply the fee.
    const t = totalsOf([v({ hours: null, rate: 'Flat rate', total_project_price: 2600, travel_charge: 80.9 })]);
    expect(t.total).toBe(2680.9);
  });
});

describe('groupVisits', () => {
  it('puts everything in one group when grouping is off', () => {
    const rows = [v({}), v({})];
    const groups = groupVisits(rows, 'none');
    expect(groups).toHaveLength(1);
    expect(groups[0].rows).toHaveLength(2);
  });

  it('groups by customer and totals each one separately', () => {
    const groups = groupVisits([
      v({ program: "Wendy's", hours: 2, travel_charge: 58.7 }),
      v({ program: "Wendy's", hours: 2, travel_charge: 0 }),
      v({ program: 'State Farm', hours: 4, travel_charge: 0 }),
    ], 'program');
    expect(groups.map((g) => g.label)).toEqual(['State Farm', "Wendy's"]);
    expect(groups[0].totals).toMatchObject({ count: 1, hours: 4, total: 220 });
    expect(groups[1].totals).toMatchObject({ count: 2, hours: 4, total: 278.7 });
  });

  it('groups by month in calendar order, not alphabetically', () => {
    const groups = groupVisits([
      v({ visit_date: '2026-08-04' }),
      v({ visit_date: '2026-06-20' }),
      v({ visit_date: '2026-07-31' }),
    ], 'month');
    expect(groups.map((g) => g.label)).toEqual(['June 2026', 'July 2026', 'August 2026']);
  });

  it('sends undated visits to their own group at the end', () => {
    const groups = groupVisits([
      v({ visit_date: null }),
      v({ visit_date: '2026-06-20' }),
    ], 'month');
    expect(groups.map((g) => g.label)).toEqual(['June 2026', 'No date']);
  });

  it('puts not-invoiced first when grouping by invoice status', () => {
    const groups = groupVisits([
      v({ invoice_status: 'na' }),
      v({ invoice_status: 'invoiced' }),
      v({ invoice_status: 'not_invoiced' }),
    ], 'invoice_status');
    expect(groups.map((g) => g.label)).toEqual(['Not invoiced', 'Invoiced', 'No charge']);
  });

  it('treats a missing invoice status as not invoiced rather than dropping it', () => {
    const groups = groupVisits([v({ invoice_status: null })], 'invoice_status');
    expect(groups[0].label).toBe('Not invoiced');
    expect(groups[0].rows).toHaveLength(1);
  });

  it('names the blank buckets instead of grouping under an empty heading', () => {
    expect(groupVisits([v({ program: null })], 'program')[0].label).toBe('No customer');
    expect(groupVisits([v({ visit_type: null })], 'visit_type')[0].label).toBe('No work type');
  });

  it('keeps every row — grouping never loses one', () => {
    const rows = [v({ program: 'A' }), v({ program: 'B' }), v({ program: null })];
    for (const by of ['program', 'month', 'visit_type', 'invoice_status', 'site'] as const) {
      const total = groupVisits(rows, by).reduce((s, g) => s + g.rows.length, 0);
      expect(total, `grouping by ${by}`).toBe(rows.length);
    }
  });

  it('preserves the incoming row order inside a group', () => {
    const a = v({ program: 'X', site_code: 'first' });
    const b = v({ program: 'X', site_code: 'second' });
    expect(groupVisits([a, b], 'program')[0].rows.map((r) => r.site_code)).toEqual(['first', 'second']);
  });
});

describe('sortVisits', () => {
  it('sorts by a money column both ways', () => {
    const rows = [
      v({ site_code: 'small', hours: 2, rate: '$55/hr', travel_charge: 0 }),
      v({ site_code: 'big', hours: 9, rate: '$55/hr', travel_charge: 0 }),
    ];
    expect(sortVisits(rows, 'line_total', 'asc').map((r) => r.site_code)).toEqual(['small', 'big']);
    expect(sortVisits(rows, 'line_total', 'desc').map((r) => r.site_code)).toEqual(['big', 'small']);
  });

  it('sinks blanks to the bottom in both directions', () => {
    const rows = [
      v({ site_code: 'undated', visit_date: null }),
      v({ site_code: 'dated', visit_date: '2026-06-20' }),
    ];
    expect(sortVisits(rows, 'visit_date', 'asc').map((r) => r.site_code)).toEqual(['dated', 'undated']);
    expect(sortVisits(rows, 'visit_date', 'desc').map((r) => r.site_code)).toEqual(['dated', 'undated']);
  });

  it('orders site codes as numbers, so 9 comes before 10', () => {
    const rows = [v({ site_code: '10760' }), v({ site_code: '9263' }), v({ site_code: '663' })];
    expect(sortVisits(rows, 'site_code', 'asc').map((r) => r.site_code)).toEqual(['663', '9263', '10760']);
  });

  it('returns the rows untouched when nothing is sorted', () => {
    const rows = [v({ site_code: 'b' }), v({ site_code: 'a' })];
    expect(sortVisits(rows, null, 'asc')).toBe(rows);
  });

  it('does not mutate the array it was given', () => {
    const rows = [v({ site_code: 'b' }), v({ site_code: 'a' })];
    sortVisits(rows, 'site_code', 'asc');
    expect(rows.map((r) => r.site_code)).toEqual(['b', 'a']);
  });
});

describe('pillFor', () => {
  it('colours the statuses that carry meaning', () => {
    expect(pillFor('not_invoiced').label).toBe('Not Invoiced');
    expect(pillFor('paid').label).toBe('Paid');
    expect(pillFor('T&M').label).toBe('T&M');
  });

  it('shows a dash for an empty value rather than a blank chip', () => {
    expect(pillFor(null).label).toBe('—');
    expect(pillFor('  ').label).toBe('—');
  });

  it('still renders an unknown value instead of swallowing it', () => {
    expect(pillFor('something_new').label).toBe('something_new');
  });
});

describe('group colours', () => {
  it('cycles rather than running out', () => {
    expect(groupColor(0)).toBe(groupColor(8));
    expect(groupColor(0)).not.toBe(groupColor(1));
  });
});

describe('GROUP_BY_LABEL', () => {
  it('names every grouping the board offers', () => {
    expect(Object.keys(GROUP_BY_LABEL)).toEqual(
      ['none', 'program', 'month', 'visit_type', 'invoice_status', 'site'],
    );
  });
});
