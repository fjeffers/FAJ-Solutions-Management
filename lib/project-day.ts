// The project day (Fred, 2026-10-13: "my jobs, and right under my jobs ...
// projects ... the starting travel, when you're on site, when you're leaving
// the site, and it needs to calculate the mileage"). Migration 117.
//
// A tech on a project job goes through the day in order:
//   Start travel (from home or the hotel)  → travel_start, GPS
//   Start job (arrived on site)             → travel_end + clock 'in'
//   Lunch / Back from lunch                 → lunch_start / lunch_end
//   Off site                                → clock 'out'
//   Travel to the hotel / home / next site  → travel_start (from the site)
//   Arrived — sign out                      → travel_end
// Travel and lunch taps live in job_day_events; Start job and Off site are the
// ordinary clock (job_punches), so hours and pay are worked out as before.
//
// Pure and unit-tested (lib/project-day.test.ts).

export type DayKind = 'day_start' | 'travel_start' | 'travel_end' | 'lunch_start' | 'lunch_end' | 'in' | 'out';
// 'fuel' and 'materials': stops on the way (Fred, 2026-10-18; migrations 131, 132).
export type Origin = 'home' | 'hotel' | 'site' | 'other' | 'fuel' | 'materials';
export type Dest = 'site' | 'hotel' | 'home' | 'next_site' | 'fuel' | 'materials';

export type DayEvent = {
  kind: DayKind;
  at: string;
  origin?: Origin | null;
  dest?: Dest | null;
  /** Miles for the leg that ends here (travel_end only). */
  miles?: number | null;
  /** The miles were typed by the office (Add miles on a drive), not the phone's GPS (miles_from_gps false). */
  milesTyped?: boolean;
  /** Who tapped (the office reads every tech's taps). */
  tech?: string;
  /** The job_day_events row, so the office can correct the miles. */
  id?: string;
  /** Street address of the tap's GPS position (migration 120, lib/places.ts). */
  place?: string;
};

const KINDS: DayKind[] = ['day_start', 'travel_start', 'travel_end', 'lunch_start', 'lunch_end', 'in', 'out'];
const ORIGINS: Origin[] = ['home', 'hotel', 'site', 'other', 'fuel', 'materials'];
const DESTS: Dest[] = ['site', 'hotel', 'home', 'next_site', 'fuel', 'materials'];

export const ORIGIN_LABEL: Record<Origin, string> = { home: 'Home', hotel: 'Hotel', site: 'Site', other: 'Other', fuel: 'Fuel stop', materials: 'Materials pickup' };
export const DEST_LABEL: Record<Dest, string> = { site: 'Site', hotel: 'Hotel', home: 'Home', next_site: 'Next site', fuel: 'Fuel stop', materials: 'Materials pickup' };

/** "On the way home", "On the way to the hotel" (not "to the home", Fred's screenshot 2026-10-22). */
export const onTheWay = (dest: Dest): string => (dest === 'home' ? 'On the way home' : `On the way to the ${DEST_LABEL[dest].toLowerCase()}`);

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v);

/** wf_tech_jobs → my_day (or job_day_events / job_punches rows) → clean taps, oldest first. */
export function parseDayEvents(raw: unknown): DayEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: DayEvent[] = [];
  for (const r of raw) {
    if (!isObj(r)) continue;
    const kind = String(r.kind ?? '') as DayKind;
    const at = String(r.at ?? '');
    if (!KINDS.includes(kind) || !Number.isFinite(Date.parse(at))) continue;
    const ev: DayEvent = { kind, at };
    const o = String(r.origin ?? '') as Origin;
    const d = String(r.dest ?? '') as Dest;
    if (ORIGINS.includes(o)) ev.origin = o;
    if (DESTS.includes(d)) ev.dest = d;
    const m = r.miles == null || r.miles === '' ? NaN : Number(r.miles);
    if (Number.isFinite(m) && m >= 0) ev.miles = m;
    if (ev.miles != null && r.miles_from_gps === false) ev.milesTyped = true;
    if (typeof r.contractor_name === 'string' && r.contractor_name) ev.tech = r.contractor_name;
    else if (typeof r.tech === 'string' && r.tech) ev.tech = r.tech;
    if (typeof r.id === 'string' && r.id) ev.id = r.id;
    if (typeof r.place === 'string' && r.place.trim()) ev.place = r.place.trim();
    out.push(ev);
  }
  return sortEvents(out);
}

const ORDER: Record<DayKind, number> = { travel_end: 0, in: 1, lunch_start: 2, lunch_end: 3, out: 4, day_start: 5, travel_start: 6 };

/** Oldest first; taps at the same moment in the order they happen (arrive before start job). */
export function sortEvents(events: DayEvent[]): DayEvent[] {
  return [...events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || ORDER[a.kind] - ORDER[b.kind]);
}

/** YYYY-MM-DD of a moment in a time zone. */
export function dayOf(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

// ── Where the tech is in the day ────────────────────────────────────────────

export type DayState =
  | { stage: 'ready' }
  /** Clocked in for the day (migration 118), not driving and not on site. */
  | { stage: 'clocked'; since: string }
  | { stage: 'travel'; since: string; dest: Dest; origin: Origin | null }
  | { stage: 'onsite'; since: string; lunchMs: number }
  | { stage: 'lunch'; since: string; onSiteSince: string; lunchMs: number }
  | { stage: 'offsite'; since: string };

/**
 * The one thing the tech can do next, from their taps on this job. Off site
 * lasts until they set off (or until the next day: an evening with no drive
 * starts fresh in the morning).
 */
export function dayState(events: DayEvent[], now: Date = new Date(), timeZone?: string): DayState {
  let st: DayState = { stage: 'ready' };
  // Fred, 2026-10-13: "it should start with clock-in then it should ask for
  // travel". The day starts at Clock in and ends on arriving at the hotel or home.
  let clockIn: string | null = null;
  for (const e of sortEvents(events)) {
    const t = Date.parse(e.at);
    // A day left open (clocked in or off site, never signed out) is over once
    // a tap comes on a later day — or this morning's Clock in is ignored
    // (Fred, 2026-10-14: Clock in tapped 7 times and never moved on).
    if ((st.stage === 'offsite' || st.stage === 'clocked') && dayOf(st.since, timeZone) !== dayOf(e.at, timeZone)) {
      st = { stage: 'ready' };
      clockIn = null;
    }
    switch (e.kind) {
      case 'day_start':
        if (st.stage === 'ready') { clockIn = e.at; st = { stage: 'clocked', since: e.at }; }
        break;
      case 'travel_start':
        st = { stage: 'travel', since: e.at, dest: e.dest ?? 'site', origin: e.origin ?? null };
        break;
      case 'travel_end':
        if (st.stage === 'travel') {
          if (st.dest === 'hotel' || st.dest === 'home') { clockIn = null; st = { stage: 'ready' }; }
          else st = { stage: 'clocked', since: clockIn ?? e.at };
        }
        break;
      case 'in':
        st = { stage: 'onsite', since: e.at, lunchMs: 0 };
        break;
      case 'lunch_start':
        if (st.stage === 'onsite') st = { stage: 'lunch', since: e.at, onSiteSince: st.since, lunchMs: st.lunchMs };
        break;
      case 'lunch_end':
        if (st.stage === 'lunch') st = { stage: 'onsite', since: st.onSiteSince, lunchMs: st.lunchMs + Math.max(0, t - Date.parse(st.since)) };
        break;
      case 'out':
        if (st.stage === 'onsite' || st.stage === 'lunch') st = { stage: 'offsite', since: e.at };
        break;
    }
  }
  // A day left open (off site with no drive, or clocked in and never signed
  // out) starts fresh the next morning.
  if ((st.stage === 'offsite' || st.stage === 'clocked') && dayOf(st.since, timeZone) !== dayOf(now.toISOString(), timeZone)) return { stage: 'ready' };
  return st;
}

/** Time on site so far, lunch taken out. */
export function onSiteMs(st: DayState, now: Date = new Date()): number {
  if (st.stage === 'onsite') return Math.max(0, now.getTime() - Date.parse(st.since) - st.lunchMs);
  if (st.stage === 'lunch') return Math.max(0, Date.parse(st.since) - Date.parse(st.onSiteSince) - st.lunchMs);
  return 0;
}

// ── The log: travel legs and time on site, per tech per day ────────────────

export type Leg = {
  tech: string; day: string; start: string; end: string | null;
  origin: Origin | null; dest: Dest; ms: number; miles: number | null;
  /** The miles were typed by the office (Add miles), not the GPS: they go on top of the odometer's. */
  milesTyped?: boolean;
  /** The travel_end row holding the miles (the office can correct it). */
  endId: string | null;
};

export type SiteSpan = { tech: string; day: string; in: string; out: string | null; lunchMs: number; ms: number };

export type DayLog = {
  tech: string; day: string; legs: Leg[]; spans: SiteSpan[];
  travelMs: number; onSiteMs: number; lunchMs: number; miles: number;
  /** Clock in (the first that day) and signing out on arriving at the hotel or home. */
  clockIn: string | null; signOut: string | null;
};

/** Every tech's taps on a job → one log per tech per day, oldest first. */
export function buildDayLogs(events: DayEvent[], now: Date = new Date(), timeZone?: string): DayLog[] {
  const byTech = new Map<string, DayEvent[]>();
  for (const e of events) {
    const k = e.tech ?? '';
    byTech.set(k, [...(byTech.get(k) ?? []), e]);
  }
  const legs: Leg[] = [];
  const spans: SiteSpan[] = [];
  const clockIns: { tech: string; at: string }[] = [];
  const nowMs = now.getTime();
  for (const [tech, list] of byTech) {
    const evs = sortEvents(list);
    let leg: { start: DayEvent } | null = null;
    let span: { in: DayEvent; lunchMs: number; lunchFrom: number | null } | null = null;
    const closeLeg = (end: DayEvent | null) => {
      if (!leg) return;
      const s = leg.start;
      const endMs = end ? Date.parse(end.at) : nowMs;
      legs.push({
        tech, day: dayOf(s.at, timeZone), start: s.at, end: end?.at ?? null,
        origin: s.origin ?? null, dest: s.dest ?? 'site', ms: Math.max(0, endMs - Date.parse(s.at)),
        miles: end?.kind === 'travel_end' && end.miles != null ? end.miles : null,
        milesTyped: end?.kind === 'travel_end' && end.miles != null && end.milesTyped === true,
        endId: end?.kind === 'travel_end' ? end.id ?? null : null,
      });
      leg = null;
    };
    const closeSpan = (out: DayEvent | null) => {
      if (!span) return;
      const endMs = out ? Date.parse(out.at) : nowMs;
      const lunch = span.lunchMs + (span.lunchFrom != null ? Math.max(0, endMs - span.lunchFrom) : 0);
      spans.push({
        tech, day: dayOf(span.in.at, timeZone), in: span.in.at, out: out?.at ?? null, lunchMs: lunch,
        ms: Math.max(0, endMs - Date.parse(span.in.at) - lunch),
      });
      span = null;
    };
    for (const e of evs) {
      switch (e.kind) {
        case 'day_start': clockIns.push({ tech, at: e.at }); break;
        case 'travel_start': closeLeg(e); leg = { start: e }; break;
        case 'travel_end': closeLeg(e); break;
        case 'in': closeLeg(e); closeSpan(e); span = { in: e, lunchMs: 0, lunchFrom: null }; break;
        case 'lunch_start': if (span && span.lunchFrom == null) span.lunchFrom = Date.parse(e.at); break;
        case 'lunch_end':
          if (span && span.lunchFrom != null) { span.lunchMs += Math.max(0, Date.parse(e.at) - span.lunchFrom); span.lunchFrom = null; }
          break;
        case 'out': closeSpan(e); break;
      }
    }
    closeLeg(null);
    closeSpan(null);
  }
  // A leg that ran into "Start job" without its own end: the 'in' closed it,
  // which shows up above as a leg ending at the in (no miles). Fine.
  const keys = new Map<string, DayLog>();
  const keyOf = (tech: string, day: string) => `${day}|${tech}`;
  const get = (tech: string, day: string) => {
    const k = keyOf(tech, day);
    let d = keys.get(k);
    if (!d) { d = { tech, day, legs: [], spans: [], travelMs: 0, onSiteMs: 0, lunchMs: 0, miles: 0, clockIn: null, signOut: null }; keys.set(k, d); }
    return d;
  };
  for (const c of clockIns) {
    const d = get(c.tech, dayOf(c.at, timeZone));
    if (!d.clockIn || c.at < d.clockIn) d.clockIn = c.at;
  }
  for (const l of legs) {
    const d = get(l.tech, l.day); d.legs.push(l); d.travelMs += l.ms; d.miles += l.miles ?? 0;
    if ((l.dest === 'hotel' || l.dest === 'home') && l.end && (!d.signOut || l.end > d.signOut)) d.signOut = l.end;
  }
  for (const s of spans) { const d = get(s.tech, s.day); d.spans.push(s); d.onSiteMs += s.ms; d.lunchMs += s.lunchMs; }
  const out = [...keys.values()];
  for (const d of out) {
    d.legs.sort((a, b) => a.start.localeCompare(b.start));
    d.spans.sort((a, b) => a.in.localeCompare(b.in));
    d.miles = Math.round(d.miles * 10) / 10;
  }
  return out.sort((a, b) => a.day.localeCompare(b.day) || a.tech.localeCompare(b.tech));
}

const MIN = 60_000;
/** A "drive" over half an hour with under half a mile: the tech never tapped arriving. */
const stood = (l: Pick<Leg, 'end' | 'miles' | 'ms'>) => l.end != null && l.miles != null && l.miles < 0.5 && l.ms > 30 * MIN;

/**
 * A day with drives but no clock-in on site: on site is the longest stretch,
 * two hours or more, between one drive ending and the next starting. Paul
 * Gibbs, 2026-10-21: he picked Hotel for the morning drive to the site, so
 * the app signed him out on arrival and counted no time on site, though he
 * was there 8:26 AM to 4:50 PM. Null when there is no such stretch.
 */
export function gapOnSite(legs: Pick<Leg, 'start' | 'end' | 'miles' | 'ms'>[]): { arrived: string; leftSite: string; ms: number } | null {
  const mine = [...legs].sort((a, b) => a.start.localeCompare(b.start));
  let best: { arrived: string; leftSite: string; ms: number } | null = null;
  for (let i = 0; i < mine.length - 1; i++) {
    const end = stood(mine[i]) ? mine[i].start : mine[i].end;
    if (!end) continue;
    const ms = Date.parse(mine[i + 1].start) - Date.parse(end);
    if (ms >= 120 * MIN && (!best || ms > best.ms)) best = { arrived: end, leftSite: mine[i + 1].start, ms };
  }
  return best;
}

export type DayTotals = { travelMs: number; onSiteMs: number; lunchMs: number; miles: number; days: number };

export function totalsOf(logs: DayLog[]): DayTotals {
  const t = logs.reduce((s, d) => ({
    travelMs: s.travelMs + d.travelMs, onSiteMs: s.onSiteMs + d.onSiteMs, lunchMs: s.lunchMs + d.lunchMs,
    miles: s.miles + d.miles, days: s.days,
  }), { travelMs: 0, onSiteMs: 0, lunchMs: 0, miles: 0, days: 0 });
  t.days = new Set(logs.map((d) => d.day)).size;
  t.miles = Math.round(t.miles * 10) / 10;
  return t;
}

/** "Home → Site", "Site → Hotel", "Between sites". */
export function legLabel(l: Pick<Leg, 'origin' | 'dest'>): string {
  if (l.dest === 'next_site') return 'Between sites';
  if (!l.origin) return `Travel to ${DEST_LABEL[l.dest].toLowerCase()}`;
  return `${ORIGIN_LABEL[l.origin]} → ${DEST_LABEL[l.dest]}`;
}

// ── Start travel: one dropdown (Fred, 2026-10-13: "hotel home site between
// site ... make it a drop down") ─────────────────────────────────────────────

export type Trip = 'hotel' | 'home' | 'site' | 'between' | 'fuel' | 'materials';
export const TRIPS: { key: Trip; label: string }[] = [
  { key: 'hotel', label: 'Hotel' },
  { key: 'home', label: 'Home' },
  { key: 'site', label: 'Site' },
  { key: 'between', label: 'Between sites' },
  { key: 'fuel', label: 'Fuel' },
  { key: 'materials', label: 'Materials' },
];

/**
 * Where the tech is leaving from, from their own taps: the site they just
 * left, else wherever their last drive ended (the hotel, home), else unknown.
 */
export function lastPlace(events: DayEvent[], now: Date = new Date(), timeZone?: string): Origin | null {
  if (dayState(events, now, timeZone).stage === 'offsite') return 'site';
  const evs = sortEvents(events);
  for (let i = evs.length - 1; i >= 0; i--) {
    const e = evs[i];
    if (e.kind === 'day_start') continue;
    if (e.kind === 'out' || e.kind === 'in') return 'site';
    if (e.kind === 'travel_start') {
      const d = e.dest ?? 'site';
      return d === 'hotel' ? 'hotel' : d === 'home' ? 'home' : d === 'fuel' ? 'fuel' : d === 'materials' ? 'materials' : 'site';
    }
  }
  return null;
}

/** The trip picked in the dropdown → what the drive is recorded as. */
export function tripLeg(trip: Trip, events: DayEvent[], now: Date = new Date(), timeZone?: string): { origin: Origin | null; dest: Dest } {
  if (trip === 'between') return { origin: 'site', dest: 'next_site' };
  return { origin: lastPlace(events, now, timeZone), dest: trip };
}

/** 5400000 → "1.5 h" (for reports, where whole decimals read easier than 1h 30m). */
export const hoursOf = (ms: number): number => Math.round((ms / 3_600_000) * 100) / 100;
