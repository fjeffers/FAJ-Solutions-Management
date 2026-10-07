import { describe, expect, it } from 'vitest';
import { agoText, freshness, fromPhotos, fromPunches, fromTimeLogs, latestByTech } from './tech-locations';

const NOW = Date.parse('2026-10-06T18:00:00Z');

describe('where everyone is', () => {
  it('each tech shows where they were last seen, from punches, time logs and photos', () => {
    const all = [
      ...fromPunches([
        { contractor_name: 'Ann', kind: 'in', at: '2026-10-06T13:00:00Z', lat: 40.6, lng: -75.2, wo_number: '101' },
        { contractor_name: 'Ann', kind: 'out', at: '2026-10-06T17:30:00Z', lat: 40.7, lng: -75.3, wo_number: '101' },
        { contractor_name: 'Bo', kind: 'in', at: '2026-10-05T13:00:00Z', lat: null, lng: null }, // no location: skipped
      ]),
      ...fromTimeLogs([{
        contractor_name: 'Bo', wo_number: '202',
        travel_start_at: '2026-10-04T12:00:00Z', travel_start_lat: 39.9, travel_start_lng: -75.1,
        arrived_at: '2026-10-04T13:00:00Z', arrived_lat: 39.95, arrived_lng: -75.15,
      }]),
      ...fromPhotos([{ contractor_name: 'Ann', taken_at: '2026-10-06T16:00:00Z', lat: 40.65, lng: -75.25, wo_number: '101' }]),
    ];
    const latest = latestByTech(all);
    expect(latest.map((s) => `${s.name} ${s.what} ${s.woNumber}`)).toEqual(['Ann Clocked out 101', 'Bo Arrived 202']);
  });

  it('a 0,0 location (no GPS fix) is never used', () => {
    expect(fromPhotos([{ contractor_name: 'Ann', taken_at: '2026-10-06T16:00:00Z', lat: 0, lng: 0 }])).toEqual([]);
  });

  it('how fresh, in plain words', () => {
    expect(freshness('2026-10-06T17:00:00Z', NOW)).toBe('live');
    expect(freshness('2026-10-04T17:00:00Z', NOW)).toBe('older');
    expect(agoText('2026-10-06T17:59:30Z', NOW)).toBe('just now');
    expect(agoText('2026-10-06T17:48:00Z', NOW)).toBe('12 min ago');
    expect(agoText('2026-10-06T15:00:00Z', NOW)).toBe('3 h ago');
    expect(agoText('2026-10-04T15:00:00Z', NOW)).toBe('Oct 4');
  });
});
