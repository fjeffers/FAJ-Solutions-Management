import { describe, expect, it } from 'vitest';
import { buildVisits, byTechGroups, inRange, logTotals, hoursText, dayOf, jobLogName, type Punch } from './job-log';
import type { TimeLog } from './types';

const tz = 'America/New_York';
const p = (tech: string, kind: 'in' | 'out', at: string, lat: number | null = 40.6884): Punch =>
  ({ contractor_name: tech, kind, at, lat, lng: lat == null ? null : -75.2207, accuracy: lat == null ? null : 9 });

describe('the job log', () => {
  it('pairs every clock-in with its clock-out, day by day', () => {
    const v = buildVisits([
      p('Jere', 'in', '2026-10-01T12:00:00Z'), p('Jere', 'out', '2026-10-01T16:30:00Z'),
      p('Jere', 'in', '2026-10-02T13:00:00Z', null), p('Jere', 'out', '2026-10-02T15:00:00Z'),
    ], [], new Date('2026-10-03T00:00:00Z'), tz);
    expect(v.map((x) => [x.day, hoursText(x.ms), !!x.inGps])).toEqual([
      ['2026-10-01', '4h 30m', true],
      ['2026-10-02', '2h 00m', false],
    ]);
    expect(logTotals(v)).toEqual({ ms: 6.5 * 3600_000, days: 2, techs: ['Jere'] });
  });

  it('a tech still on the clock counts up to now; a forgotten clock-out counts nothing', () => {
    const v = buildVisits([
      p('Davis', 'in', '2026-10-01T12:00:00Z'),
      p('Davis', 'in', '2026-10-02T12:00:00Z'),
    ], [], new Date('2026-10-02T13:00:00Z'), tz);
    expect(v.map((x) => [x.open, hoursText(x.ms)])).toEqual([[false, '0m'], [true, '1h 00m']]);
  });

  it('older jobs fall back to the latest in/out on file', () => {
    const log = { contractor_name: 'Mutema', checked_in_at: '2026-09-20T13:00:00Z', checked_out_at: '2026-09-20T17:00:00Z',
      checked_in_lat: null, checked_in_lng: null, arrived_lat: 40.1, arrived_lng: -75.1 } as unknown as TimeLog;
    const [v] = buildVisits([], [log], new Date(), tz);
    expect([v.tech, v.day, hoursText(v.ms), v.inGps?.lat]).toEqual(['Mutema', '2026-09-20', '4h 00m', 40.1]);
    // …but never twice for a tech who has punches.
    expect(buildVisits([p('Mutema', 'in', '2026-10-01T12:00:00Z'), p('Mutema', 'out', '2026-10-01T13:00:00Z')], [log], new Date(), tz)).toHaveLength(1);
  });

  it('days are local, and a range keeps both ends', () => {
    expect(dayOf('2026-10-02T02:00:00Z', tz)).toBe('2026-10-01'); // 10 PM the night before in Easton
    expect(inRange('2026-10-01', '2026-10-01', '2026-10-02')).toBe(true);
    expect(inRange('2026-10-03', '', '2026-10-02')).toBe(false);
    expect(inRange('2026-09-30', '', '')).toBe(true);
  });
});

describe('the job log’s name, which the saved PDF gets', () => {
  const gaffney = { wo_number: '19101401', external_wo_id: 'LDS-1110', customer_name: 'LDS', site_name: 'LDS Site 5011876', site_city: 'Gaffney', site_state: 'SC' };

  it('is the client’s WO, the site number, the city and the days, with no slash a file name can’t have', () => {
    expect(jobLogName(gaffney, '2026-10-18', '2026-10-23')).toBe('LDS-1110 Site 5011876 — Gaffney, SC · 10-18-2026 – 10-23-2026');
    expect(jobLogName(gaffney, '2026-10-19', '2026-10-19')).toBe('LDS-1110 Site 5011876 — Gaffney, SC · 10-19-2026');
  });

  it('makes a bare site number a site, and does without what the job doesn’t have', () => {
    expect(jobLogName({ ...gaffney, site_name: ' 5333202', site_city: 'Fayetteville', site_state: 'NC' }, '2026-10-26', '2026-10-30'))
      .toBe('LDS-1110 Site 5333202 — Fayetteville, NC · 10-26-2026 – 10-30-2026');
    expect(jobLogName({ wo_number: '19101450', site_name: 'Store 12/B', site_city: 'Newark', site_state: null }, '', ''))
      .toBe('WO 19101450 Store 12-B — Newark');
  });
});

describe('each tech on their own', () => {
  // Fred, 2026-10-29: "Show all of Paul hours and total, Kendall total ... Paul and Kendall separated grouping".
  it('groups the days by tech, the crew in its order first, each tech\u2019s days kept in order', () => {
    const days = [
      { tech: 'Kendell Newbold', day: '2026-10-19' }, { tech: 'Paul Gibbs', day: '2026-10-19' },
      { tech: 'Kendell Newbold', day: '2026-10-20' }, { tech: 'Office', day: '2026-10-20' }, { tech: 'Paul Gibbs', day: '2026-10-20' },
    ];
    expect(byTechGroups(days, (d) => d.tech, ['Paul Gibbs', 'Kendell Newbold']).map((g) => [g.tech, g.items.map((d) => d.day)])).toEqual([
      ['Paul Gibbs', ['2026-10-19', '2026-10-20']],
      ['Kendell Newbold', ['2026-10-19', '2026-10-20']],
      ['Office', ['2026-10-20']],
    ]);
  });
});
