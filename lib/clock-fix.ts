// The office fixes a tech's clock (Fred, 2026-10-24: "in case some one forget
// to log in or the app was not working for them i need to be able to edit their
// hours"; "i have some still saying on site when they are not"). The punches
// are job_punches; wf_owner_fix_punch (migration 139) adds, moves and removes
// them. This file is the arithmetic the screen needs.

import { dayOf } from './project-day';

export type Punch = {
  id: string; wo_id: string; wo_number?: string; contractor_name: string; kind: 'in' | 'out'; at: string;
  /** The office added it. */
  by_office?: boolean | null;
  /** What the tech tapped, before the office moved it. */
  tapped_at?: string | null;
};

/** The punches a query returned, keeping only well-formed ones, oldest first. */
export function parsePunches(rows: unknown): Punch[] {
  if (!Array.isArray(rows)) return [];
  const out: Punch[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    if (!r || typeof r.id !== 'string' || typeof r.wo_id !== 'string' || typeof r.contractor_name !== 'string') continue;
    if ((r.kind !== 'in' && r.kind !== 'out') || typeof r.at !== 'string' || !Number.isFinite(Date.parse(r.at))) continue;
    out.push({
      id: r.id, wo_id: r.wo_id, contractor_name: r.contractor_name, kind: r.kind, at: r.at,
      wo_number: typeof r.wo_number === 'string' ? r.wo_number : undefined,
      by_office: r.by_office === true, tapped_at: typeof r.tapped_at === 'string' ? r.tapped_at : null,
    });
  }
  return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/** Each tech still clocked in on a job: their last punch there is a clock-in. Longest first. */
export function stillOnSite(punches: Punch[]): Punch[] {
  const last = new Map<string, Punch>();
  for (const p of parsePunches(punches)) last.set(`${p.wo_id}|${p.contractor_name}`, p);
  return [...last.values()].filter((p) => p.kind === 'in').sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/** A clock time typed for a day ("2026-10-21", "16:30") as the moment it is in that time zone. */
export function zonedIso(day: string, hhmm: string, timeZone: string): string | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  const t = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!d || !t || Number(t[1]) > 23 || Number(t[2]) > 59) return null;
  const wall = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]));
  // How far the zone's clock is from UTC at a moment; twice, so a day the clocks change lands right.
  const offset = (ms: number) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(ms));
    const n = (k: string) => Number(parts.find((p) => p.type === k)?.value);
    return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second')) - ms;
  };
  let ms = wall - offset(wall);
  ms = wall - offset(ms);
  return new Date(ms).toISOString();
}

/** "16:30" for a moment, in a time zone: what a time box shows. */
export function clockOf(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
}

/** The punches on one job, a day at a time, then by tech. */
export function punchDays(punches: Punch[], timeZone: string): { day: string; tech: string; list: Punch[] }[] {
  const by = new Map<string, { day: string; tech: string; list: Punch[] }>();
  for (const p of parsePunches(punches)) {
    const day = dayOf(p.at, timeZone);
    const k = `${day}|${p.contractor_name}`;
    if (!by.has(k)) by.set(k, { day, tech: p.contractor_name, list: [] });
    by.get(k)!.list.push(p);
  }
  return [...by.values()].sort((a, b) => a.day.localeCompare(b.day) || a.tech.localeCompare(b.tech));
}

/** What a refusal from wf_owner_fix_punch means, in words. */
export function fixReasonText(reason: string): string {
  switch (reason) {
    case 'not_owner': return 'Only the owner can change a tech’s clock.';
    case 'not_found': return 'That clock-in or job is no longer there. Refresh and try again.';
    case 'bad_time': return 'Pick a time that isn’t in the future.';
    case 'bad_tech': return 'Pick the technician.';
    case 'bad_kind': return 'Pick clock in or clock out.';
    default: return 'That didn’t save. Check your connection and try again.';
  }
}
