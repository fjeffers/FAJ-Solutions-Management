// The miles on the tech's phone follow the odometer photos (Fred, 2026-10-29: "Tech are complaining the
// take pictures a day it takes the milage but at the end it [shows] different figures").
import { describe, it, expect } from 'vitest';
import { buildDayLogs, type DayEvent } from './project-day';
import { dayMiles, driveMiles, driveMilesText, legKey } from './tech-miles';
import type { OdometerReading } from './wf';

const TZ = 'America/New_York';
const NOW = new Date('2026-10-29T12:00:00Z');
const run = (events: DayEvent[], readings: OdometerReading[]) => {
  const logs = buildDayLogs(events, NOW, TZ);
  const drives = driveMiles(logs.flatMap((d) => d.legs), readings);
  return { logs, drives, texts: logs.flatMap((d) => d.legs).map((l) => driveMilesText(drives.get(legKey(l)))) };
};

// Fred's Tuesday, Oct 27, as the phone has it for each job (my_day and my_odometer).
const NEW_YORK: DayEvent[] = [
  { kind: 'day_start', at: '2026-10-27T09:27:49.264Z' },
  { kind: 'travel_start', at: '2026-10-27T09:27:50.264Z', origin: 'other', dest: 'site' },
  { kind: 'travel_end', at: '2026-10-27T11:41:07.043Z', miles: 77.5 },
];
const NEW_YORK_ODO: OdometerReading[] = [
  { at: '2026-10-27T09:28:00.84Z', reading: 228889, moment: 'start' },
  { at: '2026-10-27T11:41:18.685Z', reading: 228978, moment: 'end' },
];
const JERSEY_CITY: DayEvent[] = [
  { kind: 'day_start', at: '2026-10-27T12:04:36.072Z' },
  { kind: 'travel_start', at: '2026-10-27T12:04:37.072Z', origin: 'other', dest: 'site' },
  { kind: 'travel_end', at: '2026-10-27T13:22:27.995Z', miles: 6.8 },
  { kind: 'travel_start', at: '2026-10-27T16:22:40.949Z', origin: 'site', dest: 'home' },
  { kind: 'travel_end', at: '2026-10-28T00:52:15.255Z', miles: 71.8 },
];
const JERSEY_CITY_ODO: OdometerReading[] = [
  { at: '2026-10-27T12:04:49.422Z', reading: 228978, moment: 'start' },
  { at: '2026-10-27T13:22:51.32Z', reading: 228998, moment: 'end' },
  { at: '2026-10-27T16:23:23.041Z', reading: 228998, moment: 'start' },
];

describe('the miles on the tech’s phone', () => {
  it('shows a drive’s miles from its two odometer photos, not the GPS', () => {
    const { logs, drives, texts } = run(NEW_YORK, NEW_YORK_ODO);
    expect(texts).toEqual(['89 mi (odometer 228,889 → 228,978)']);
    expect(dayMiles(logs[0], drives)).toEqual({ miles: 89, source: 'your odometer photos' });
  });

  it('shows the GPS, marked as GPS, for a drive without an end photo, and the start photo it has', () => {
    const { logs, drives, texts } = run(JERSEY_CITY, JERSEY_CITY_ODO);
    expect(texts).toEqual(['20 mi (odometer 228,978 → 228,998)', '71.8 mi (GPS) · odometer start 228,998']);
    expect(dayMiles(logs[0], drives)).toEqual({ miles: 91.8, source: 'odometer photos and GPS — the office can correct it' });
  });

  it('says GPS when there are no photos at all', () => {
    const { logs, drives, texts } = run(NEW_YORK, []);
    expect(texts).toEqual(['77.5 mi (GPS)']);
    expect(dayMiles(logs[0], drives)).toEqual({ miles: 77.5, source: 'from GPS — the office can correct it' });
  });

  it('pairs photos from before the phone knew start from end (migration 144)', () => {
    const { texts } = run(JERSEY_CITY, JERSEY_CITY_ODO.map(({ at, reading }) => ({ at, reading })));
    expect(texts[0]).toBe('20 mi (odometer 228,978 → 228,998)');
  });

  it('keeps the GPS when the photos can’t be right, as the bill does', () => {
    const { texts } = run(NEW_YORK, [NEW_YORK_ODO[0], { ...NEW_YORK_ODO[1], reading: 228000 }]);
    expect(texts).toEqual(['77.5 mi (GPS)']);
  });

  it('shows nothing for a drive still going with no photo yet', () => {
    const { logs, drives, texts } = run([{ kind: 'travel_start', at: '2026-10-29T11:30:00Z', origin: 'home', dest: 'site' }], []);
    expect(texts).toEqual(['']);
    expect(dayMiles(logs[0], drives)).toEqual({ miles: 0, source: '' });
  });
});
