// The job log (Fred, 2026-10-02: "can try job log") — one report per job:
// each visit with times and GPS, the checklist, the answers, the tech's notes
// and the stamped photos, ready to print or save as a PDF for a client. No
// money anywhere on it.
//
// Visits come from job_punches (every clock-in / clock-out, migration-102).
// Jobs worked before that only have contractor_time_logs' latest in/out per
// tech, which is used when a tech has no punches. Pure and unit-tested.
import type { TimeLog } from './types';

export type Punch = {
  contractor_name: string; kind: 'in' | 'out'; at: string;
  lat: number | null; lng: number | null; accuracy: number | null;
};

export type GpsPoint = { lat: number; lng: number; accuracy: number | null } | null;

export type Visit = {
  tech: string;
  /** YYYY-MM-DD of the clock-in, in the given time zone. */
  day: string;
  inAt: string;
  outAt: string | null;
  inGps: GpsPoint;
  outGps: GpsPoint;
  /** On the clock still (no clock-out yet). */
  open: boolean;
  ms: number;
};

export function dayOf(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

const gps = (lat: number | null | undefined, lng: number | null | undefined, acc?: number | null): GpsPoint =>
  lat != null && lng != null ? { lat, lng, accuracy: acc ?? null } : null;

/** Clock-ins paired with their clock-outs, per tech, oldest first. */
export function buildVisits(punches: Punch[], logs: TimeLog[], now: Date = new Date(), timeZone?: string): Visit[] {
  const visits: Visit[] = [];
  const byTech = new Map<string, Punch[]>();
  for (const p of punches) {
    const list = byTech.get(p.contractor_name) ?? [];
    list.push(p);
    byTech.set(p.contractor_name, list);
  }
  for (const [tech, list] of byTech) {
    list.sort((a, b) => a.at.localeCompare(b.at));
    let open: Punch | null = null;
    for (const p of list) {
      if (p.kind === 'in') {
        if (open) visits.push(make(tech, open, null, now, timeZone, false)); // an in with no out before the next in
        open = p;
      } else if (open) {
        visits.push(make(tech, open, p, now, timeZone, false));
        open = null;
      }
    }
    if (open) visits.push(make(tech, open, null, now, timeZone, true));
  }
  // Older jobs: no punches, only the latest in/out a tech recorded.
  for (const l of logs) {
    if (byTech.has(l.contractor_name) || !l.checked_in_at) continue;
    const out = l.checked_out_at;
    visits.push({
      tech: l.contractor_name, day: dayOf(l.checked_in_at, timeZone), inAt: l.checked_in_at, outAt: out,
      inGps: gps(l.checked_in_lat, l.checked_in_lng, l.checked_in_accuracy) ?? gps(l.arrived_lat, l.arrived_lng),
      outGps: gps(l.checked_out_lat, l.checked_out_lng, l.checked_out_accuracy),
      open: !out,
      ms: Math.max(0, Date.parse(out ?? now.toISOString()) - Date.parse(l.checked_in_at)),
    });
  }
  return visits.sort((a, b) => a.inAt.localeCompare(b.inAt));
}

function make(tech: string, i: Punch, o: Punch | null, now: Date, timeZone: string | undefined, stillOpen: boolean): Visit {
  const end = o ? Date.parse(o.at) : stillOpen ? now.getTime() : Date.parse(i.at);
  return {
    tech, day: dayOf(i.at, timeZone), inAt: i.at, outAt: o?.at ?? null,
    inGps: gps(i.lat, i.lng, i.accuracy), outGps: o ? gps(o.lat, o.lng, o.accuracy) : null,
    open: stillOpen, ms: Math.max(0, end - Date.parse(i.at)),
  };
}

/**
 * Each tech's own rows, in the order given, the job's crew first (Fred, 2026-10-29: "Show all of Paul
 * hours and total, Kendall total ... Paul and Kendall separated grouping").
 */
export function byTechGroups<T>(items: T[], techOf: (item: T) => string, crew: (string | null | undefined)[] = []): { tech: string; items: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const list = groups.get(techOf(item));
    if (list) list.push(item);
    else groups.set(techOf(item), [item]);
  }
  const rank = (t: string) => { const i = crew.indexOf(t); return i < 0 ? crew.length : i; };
  return [...groups].map(([tech, list]) => ({ tech, items: list })).sort((a, b) => rank(a.tech) - rank(b.tech) || a.tech.localeCompare(b.tech));
}

/** Only what falls between two days (inclusive); either end may be left open. */
export function inRange(day: string, from: string, to: string): boolean {
  return (!from || day >= from) && (!to || day <= to);
}

export function logTotals(visits: Visit[]) {
  return {
    ms: visits.reduce((s, v) => s + v.ms, 0),
    days: new Set(visits.map((v) => v.day)).size,
    techs: [...new Set(visits.map((v) => v.tech))],
  };
}

/** "3h 25m". */
export function hoursText(ms: number): string {
  const m = Math.round(ms / 60_000);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

export type LogJob = {
  wo_number: string; external_wo_id?: string | null; customer_name?: string | null;
  site_name?: string | null; site_city?: string | null; site_state?: string | null;
};

/** "10-18-2026": a file name can't have a slash. */
const fileDay = (d: string) => `${d.slice(5, 7)}-${d.slice(8, 10)}-${d.slice(0, 4)}`;

/**
 * The job log's name, which the print window gives the PDF it saves (Fred,
 * 2026-10-26: "when i save the job log can it be the site number and city"):
 * "LDS-1110 Site 5011876 — Gaffney, SC · 10-18-2026 – 10-23-2026". The client's
 * WO number (else FAJ's), the site without the client's name in front, the
 * city, and the first and last day the log covers.
 */
export function jobLogName(w: LogJob, first: string, last: string): string {
  const client = (w.customer_name ?? '').trim().toLowerCase();
  let site = (w.site_name ?? '').trim();
  if (client && site.toLowerCase().startsWith(`${client} `)) site = site.slice(client.length).trim();
  if (/^\d+$/.test(site)) site = `Site ${site}`;
  const city = [w.site_city, w.site_state].map((s) => (s ?? '').trim()).filter(Boolean).join(', ');
  const head = [w.external_wo_id?.trim() || `WO ${w.wo_number}`, site].filter(Boolean).join(' ') + (city ? ` — ${city}` : '');
  const days = first && last && first !== last ? `${fileDay(first)} – ${fileDay(last)}` : first || last ? fileDay(first || last) : '';
  return [head, days].filter(Boolean).join(' · ').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ');
}
