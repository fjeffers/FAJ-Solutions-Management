import { describe, it, expect } from 'vitest';
import { clockOf, parsePunches, punchDays, stillOnSite, zonedIso, type Punch } from './clock-fix';

const TZ = 'America/New_York';
const p = (id: string, tech: string, kind: 'in' | 'out', at: string, wo = 'wo'): Punch => ({ id, wo_id: wo, contractor_name: tech, kind, at });

describe('fixing a tech’s clock', () => {
  it('finds who is still clocked in: their last punch on a job is a clock-in', () => {
    const list = [
      p('1', 'Fred', 'in', '2026-10-21T11:51:45Z', 'lds'), // never clocked out
      p('2', 'Dwayne', 'in', '2026-10-21T11:44:00Z'), p('3', 'Dwayne', 'out', '2026-10-21T21:18:00Z'),
      p('4', 'Raja', 'out', '2026-10-22T20:00:00Z'), p('5', 'Raja', 'in', '2026-10-23T12:00:00Z'),
    ];
    expect(stillOnSite(list).map((x) => x.id)).toEqual(['1', '5']);
  });

  it('turns a time typed for a day into the moment, summer and winter', () => {
    expect(zonedIso('2026-10-21', '17:18', TZ)).toBe('2026-10-21T21:18:00.000Z'); // EDT
    expect(zonedIso('2026-11-02', '07:00', TZ)).toBe('2026-11-02T12:00:00.000Z'); // EST, after the clocks change
    expect(zonedIso('2026-10-21', '25:00', TZ)).toBeNull();
    expect(zonedIso('Oct 21', '07:00', TZ)).toBeNull();
    expect(clockOf('2026-10-21T21:18:00Z', TZ)).toBe('17:18');
  });

  it('lists a job’s clock a day and a tech at a time, and drops rows that aren’t punches', () => {
    const rows = [
      { id: 'a', wo_id: 'wo', contractor_name: 'Dwayne', kind: 'out', at: '2026-10-21T21:18:00Z' },
      { id: 'b', wo_id: 'wo', contractor_name: 'Dwayne', kind: 'in', at: '2026-10-21T11:44:00Z', by_office: true },
      { id: 'c', wo_id: 'wo', contractor_name: 'Ana', kind: 'in', at: '2026-10-22T01:30:00Z' }, // 9:30 PM on the 21st in New York
      { id: 'd', wo_id: 'wo', contractor_name: 'Ana', kind: 'lunch', at: '2026-10-21T16:00:00Z' },
      null,
    ];
    expect(parsePunches(rows).map((x) => x.id)).toEqual(['b', 'a', 'c']);
    expect(parsePunches(rows)[0].by_office).toBe(true);
    expect(punchDays(parsePunches(rows), TZ).map((d) => [d.day, d.tech, d.list.map((x) => x.id)]))
      .toEqual([['2026-10-21', 'Ana', ['c']], ['2026-10-21', 'Dwayne', ['b', 'a']]]);
  });
});
