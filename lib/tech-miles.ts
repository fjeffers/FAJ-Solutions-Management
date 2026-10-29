// The miles a tech reads on the phone, from the odometer photos they took
// (Fred, 2026-10-29: "Tech are complaining the take pictures a day it takes the
// milage but at the end it [shows] different figures"). The phone used to show
// each drive's GPS miles under the photos just taken. Now a drive with a start
// and an end photo shows the miles between them, paired the way the office's
// bill pairs them (matchOdometer) and left out the same way when they can't be
// right (odoProblems), so the phone and the bill agree. Any other drive shows
// its GPS miles, marked as such.
//
// Pure and unit-tested (lib/tech-miles.test.ts).
import type { DayLog, Leg } from './project-day';
import { matchOdometer, odoProblems, type OdoRow } from './weekly-bill';
import type { OdometerReading } from './wf';

export type DriveMiles = {
  miles: number | null;
  /** Where the miles come from: the drive's two odometer photos, or the phone's GPS. */
  by: 'odometer' | 'gps' | null;
  /** The drive's odometer photos, start and end. */
  start: number | null;
  end: number | null;
};

const r1 = (n: number) => Math.round(n * 10) / 10;
const n = (x: number) => x.toLocaleString('en-US');
export const legKey = (l: Pick<Leg, 'tech' | 'start'>) => `${l.tech}|${l.start}`;

/** One tech's drives (the phone's own) with that tech's odometer photos → each drive's miles, by legKey. */
export function driveMiles(legs: Leg[], readings: OdometerReading[]): Map<string, DriveMiles> {
  const tech = legs[0]?.tech ?? '';
  // A photo from before migration 144 has no moment: matchOdometer lets it be either end.
  const rows: OdoRow[] = readings.map((o) => ({
    wo_id: '', contractor_name: tech, at: o.at, moment: o.moment ?? null, reading: o.reading, ai_reading: null, photo_path: null,
  }));
  const matched = matchOdometer(legs, rows);
  const problems = odoProblems(matched);
  return new Map(matched.map((l) => {
    const odo = l.odoMiles != null && l.odoMiles >= 0 && !problems.has(l);
    return [legKey(l), {
      miles: odo ? l.odoMiles : l.miles != null ? r1(l.miles) : null,
      by: odo ? 'odometer' : l.miles != null ? 'gps' : null,
      start: l.odoStart?.reading ?? null,
      end: l.odoEnd?.reading ?? null,
    } satisfies DriveMiles];
  }));
}

/** "89 mi (odometer 228,889 → 228,978)", "6.8 mi (GPS)", "odometer start 228,998"; '' with nothing. */
export function driveMilesText(d: DriveMiles | undefined): string {
  if (!d) return '';
  if (d.by === 'odometer') return `${d.miles} mi (odometer ${n(d.start!)} → ${n(d.end!)})`;
  const startOnly = d.start != null && d.end == null ? `odometer start ${n(d.start)}` : '';
  if (d.by === 'gps') return [`${d.miles} mi (GPS)`, startOnly].filter(Boolean).join(' · ');
  return startOnly;
}

/** The day's miles on the phone: its drives added up, and where they come from. */
export function dayMiles(log: DayLog, drives: Map<string, DriveMiles>): { miles: number; source: string } {
  const list = log.legs.map((l) => drives.get(legKey(l))).filter((d): d is DriveMiles => d?.miles != null);
  const by = new Set(list.map((d) => d.by));
  const source = by.size === 0 ? ''
    : by.size > 1 ? 'odometer photos and GPS — the office can correct it'
    : by.has('odometer') ? 'your odometer photos'
    : 'from GPS — the office can correct it';
  return { miles: r1(list.reduce((t, d) => t + (d.miles ?? 0), 0)), source };
}
