// Check in (Fred, 2026-10-18, going live the next day: "they leave home, they
// sign into the app, hit Check in, then it asks them from where, then asks for
// a GPS photo of the starting mileage, along with any other things listed").
//
// One drop-down names the whole drive ("Home → Hotel", "Hotel → Site", "Site →
// Hotel"…), recorded as FAJ's travel_start with its origin and destination
// (lib/project-day.ts). After the drive is picked, the starting mileage photo
// (when the job asks for odometer photos, lib/capture.ts), then whatever the
// office listed for check-in on the job: a photo, or a short answer.
//
// Pure and unit-tested (lib/checkin.test.ts). The screen is components/wf/CheckIn.tsx.
import type { Dest, Origin, Trip } from './project-day';

export type Drive = { key: string; origin: Origin; dest: Dest; label: string };

/** Every drive, in the order Fred listed them. */
export const DRIVES: Drive[] = [
  { key: 'home-hotel', origin: 'home', dest: 'hotel', label: 'Home → Hotel' },
  { key: 'hotel-site', origin: 'hotel', dest: 'site', label: 'Hotel → Site' },
  { key: 'site-hotel', origin: 'site', dest: 'hotel', label: 'Site → Hotel' },
  { key: 'home-site', origin: 'home', dest: 'site', label: 'Home → Site' },
  { key: 'site-home', origin: 'site', dest: 'home', label: 'Site → Home' },
  { key: 'hotel-home', origin: 'hotel', dest: 'home', label: 'Hotel → Home' },
  { key: 'site-next', origin: 'site', dest: 'next_site', label: 'Site → Next site' },
];

/**
 * The drives offered. After Work done only the drive back is left (to the hotel
 * or home). Where the tech is now puts the likely drives first; nothing is
 * picked for them.
 */
export function drivesFor(from: Origin | null, afterWork = false): Drive[] {
  const list = afterWork ? DRIVES.filter((l) => l.dest === 'hotel' || l.dest === 'home') : DRIVES;
  if (!from) return list;
  return [...list.filter((l) => l.origin === from), ...list.filter((l) => l.origin !== from)];
}

export const driveOf = (key: string): Drive | null => DRIVES.find((l) => l.key === key) ?? null;

// ── The four activities (Fred, 2026-10-18) ──────────────────────────────────
// Check in asks which one, and the choice is saved: a drive as FAJ's
// travel_start with its origin and destination, work on site as the clock-in.
// Reports read the activity back from those (activityOf), so there is one
// record, not two that could disagree.

export type Activity = 'to_site' | 'between_sites' | 'from_site' | 'on_site';
export const ACTIVITY_LABEL: Record<Activity, string> = {
  to_site: 'Travel to site', between_sites: 'Site-to-site travel', from_site: 'Travel from site', on_site: 'Work on site',
};

/** Which activity a drive is, by where it starts and ends. Home → Hotel is the trip out; Hotel → Home the trip back. */
export function activityOf(origin: Origin | null | undefined, dest: Dest | null | undefined): Activity {
  if (dest === 'next_site') return 'between_sites';
  if (dest === 'site') return 'to_site';
  if (origin === 'site' || dest === 'home') return 'from_site';
  return 'to_site';
}

/**
 * Where a tech can be traveling to, in the order Fred listed them (2026-10-18:
 * "traveling where list (hotel, site, home, fuel etc) then I need on site
 * login bottom"). Where they're leaving from comes from their own taps.
 */
export const TRAVEL_TO: { dest: Dest; label: string }[] = [
  { dest: 'hotel', label: 'Hotel' },
  { dest: 'site', label: 'Site' },
  { dest: 'home', label: 'Home' },
  { dest: 'fuel', label: 'Fuel' },
  { dest: 'next_site', label: 'Next site' },
];

/** The check-in choice for starting work where the tech already is: no drive, the clock-in. */
export const ON_SITE_KEY = 'on-site';

/**
 * Check in's choices: "Traveling to" (hotel, site, home, fuel, the next site),
 * then "On site" at the bottom. After Work done only the drive back (hotel,
 * home or fuel). The next site is offered only when leaving a site.
 */
export function checkInChoices(from: Origin | null, afterWork = false): { group: 'travel' | 'on_site'; label: string; options: { key: string; label: string }[] }[] {
  const to = TRAVEL_TO.filter((t) => (afterWork ? ['hotel', 'home', 'fuel'].includes(t.dest) : t.dest !== 'next_site' || from === 'site'));
  const groups: { group: 'travel' | 'on_site'; label: string; options: { key: string; label: string }[] }[] = [
    { group: 'travel', label: 'Traveling to', options: to.map((t) => ({ key: `to-${t.dest}`, label: t.label })) },
  ];
  if (!afterWork) groups.push({ group: 'on_site', label: 'On site', options: [{ key: ON_SITE_KEY, label: 'Log in on site: start work' }] });
  return groups;
}

/** The drive a check-in choice means: from where the tech is now (their own taps), to where they picked. */
export function checkInDrive(key: string, from: Origin | null): Drive | null {
  const t = TRAVEL_TO.find((x) => `to-${x.dest}` === key);
  if (!t) return null;
  const origin: Origin = t.dest === 'next_site' ? 'site' : from ?? 'other';
  return { key, origin, dest: t.dest, label: `${ORIGIN_LABEL_FOR[origin]} → ${t.dest === 'next_site' ? 'Next site' : t.label}` };
}
const ORIGIN_LABEL_FOR: Record<Origin, string> = { home: 'Home', hotel: 'Hotel', site: 'Site', other: 'Here', fuel: 'Fuel stop' };

/** The drive as FAJ's Start travel takes it (DayActions.startTrip). */
export function tripOf(drive: Drive): { trip: Trip; from: Origin } {
  const trip: Trip = drive.dest === 'next_site' ? 'between' : drive.dest;
  return { trip, from: drive.origin };
}

// ── What the office asks for at check-in ────────────────────────────────────

export type StartAsk = { id: string; label: string; kind: 'photo' | 'answer' };
export const START_ASK_MAX = 10;

/** A stored list (work_orders.start_asks, a template's startAsks) → safe items. */
export function parseStartAsks(raw: unknown): StartAsk[] {
  if (!Array.isArray(raw)) return [];
  const out: StartAsk[] = [];
  const ids = new Set<string>();
  for (const a of raw) {
    if (!a || typeof a !== 'object') continue;
    const o = a as Record<string, unknown>;
    const label = typeof o.label === 'string' ? o.label.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
    const id = typeof o.id === 'string' && /^[a-z0-9-]{1,40}$/.test(o.id) ? o.id : '';
    if (!label || !id || ids.has(id)) continue;
    ids.add(id);
    out.push({ id, label, kind: o.kind === 'answer' ? 'answer' : 'photo' });
    if (out.length >= START_ASK_MAX) break;
  }
  return out;
}

/** Add one; null when the label is empty or there are already ten. */
export function addStartAsk(list: StartAsk[], label: string, kind: StartAsk['kind'], idSeed: string): StartAsk[] | null {
  const l = label.replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!l || list.length >= START_ASK_MAX) return null;
  const id = `ask-${idSeed.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10) || String(list.length + 1)}`;
  if (list.some((a) => a.id === id)) return null;
  return [...list, { id, label: l, kind }];
}

/** Longest message to the office: wf_tech_site_send keeps 2,000 characters. */
export const NOTE_MAX = 1900;

/**
 * The answers as messages for the office: "Check-in, Home → Site · Truck: F-150
 * · Fuel: Full". Long answers go on as many messages as it takes, so none is cut off.
 */
export function checkInNotes(drive: Drive | null, asks: StartAsk[], answers: Record<string, string>): string[] {
  const parts = asks.filter((a) => a.kind === 'answer' && (answers[a.id] ?? '').trim())
    .map((a) => `${a.label}: ${answers[a.id].replace(/\s+/g, ' ').trim()}`.slice(0, NOTE_MAX - 40));
  if (parts.length === 0) return [];
  const head = `Check-in${drive ? `, ${drive.label}` : ''}`;
  const out: string[] = [];
  let line = head;
  for (const p of parts) {
    if (line.length + 3 + p.length > NOTE_MAX) { out.push(line); line = `${head} (continued)`; }
    line += ` · ${p}`;
  }
  out.push(line);
  return out;
}

/** What's still needed before Done: the drive, the mileage (when asked) and every item. */
export function checkInMissing(input: {
  needsDrive: boolean; drive: Drive | null; needsMileage: boolean; mileage: string; hasMileagePhoto: boolean;
  asks: StartAsk[]; answers: Record<string, string>; photos: Record<string, boolean>;
}): string[] {
  const out: string[] = [];
  if (input.needsDrive && !input.drive) out.push('Pick where you are driving');
  if (input.needsMileage) {
    if (!input.hasMileagePhoto) out.push('Take the photo of the starting mileage');
    const n = Number(input.mileage.replace(/[,\s]/g, ''));
    if (!input.mileage.trim() || !Number.isFinite(n) || n < 0 || n >= 10_000_000) out.push('Enter the starting mileage');
  }
  for (const a of input.asks) {
    if (a.kind === 'photo' && !input.photos[a.id]) out.push(`Photo: ${a.label}`);
    if (a.kind === 'answer' && !(input.answers[a.id] ?? '').trim()) out.push(`Answer: ${a.label}`);
  }
  return out;
}
