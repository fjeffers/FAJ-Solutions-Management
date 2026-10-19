// The client's two links for a day on site (migration 133; Fred, 2026-10-18):
// the Teams meeting, opened when the tech checks in on site ("they got to be on
// there all day until they leave the site"), and the client's own checkout
// form, opened when the tech goes off site for the day ("when they check out,
// they go to this form"). The app keeps its own on-site and off-site times
// either way; the checkout form is filled in with them where it can be.
import { dayOf, type DayEvent } from './project-day';

export type SiteLinks = {
  checkin?: string; checkout?: string;
  /** The client's numbers for the job (migration 135): the site (client_reference) and their ticket (external_wo_id). */
  siteId?: string; ticket?: string;
};

const web = (v: unknown): string | undefined => (typeof v === 'string' && /^https?:\/\/\S+$/i.test(v.trim()) ? v.trim() : undefined);

/** wf_tech_site_links() → the two links, each only when it is a web address. */
export function parseSiteLinks(raw: unknown): SiteLinks {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const out: SiteLinks = {};
  const checkin = web(r.checkin);
  const checkout = web(r.checkout);
  if (checkin) out.checkin = checkin;
  if (checkout) out.checkout = checkout;
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 80) : undefined);
  const siteId = text(r.site_id);
  const ticket = text(r.ticket);
  if (siteId) out.siteId = siteId;
  if (ticket) out.ticket = ticket;
  return out;
}

/**
 * The site number in a job's title, when the job doesn't keep it on its own:
 * "LDS-1110-5011876-Gaffney, NC", "LDS Site 5011876 — Gaffney" or
 * "Site ID 5006643 Goldsboro" → the number.
 */
export function siteIdOf(title: string | null | undefined): string | null {
  const t = title ?? '';
  const m = /\bLDS-\d+-(\d{4,})/i.exec(t) ?? /\bSite(?:\s*ID)?\s*#?\s*(\d{5,})\b/i.exec(t);
  return m ? m[1] : null;
}

function parts(iso: string, timeZone: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { y: p.year, m: p.month, d: p.day, h: p.hour === '24' ? '00' : p.hour, min: p.minute };
}
/** "07:30", the way the LDS form shows its times. */
export const clock24 = (iso: string, timeZone: string) => { const p = parts(iso, timeZone); return `${p.h}:${p.min}`; };
/** "10/19/2026", the LDS form's date. */
export const dateMDY = (iso: string, timeZone: string) => { const p = parts(iso, timeZone); return `${p.m}/${p.d}/${p.y}`; };

/** When the tech came on site on the day they leave: that day's first clock-in, up to leaving. */
export function onSiteSince(events: readonly DayEvent[], off: string, timeZone: string): string | null {
  const day = dayOf(off, timeZone);
  const ins = events
    .filter((e) => e.kind === 'in' && e.at <= off && dayOf(e.at, timeZone) === day)
    .map((e) => e.at)
    .sort();
  return ins[0] ?? null;
}

/**
 * The off-site time for the checkout form opened from the job's link: the last
 * time off site today, or now while the tech is still on site.
 */
export function lastOffOrNow(events: readonly DayEvent[], now: string, timeZone: string): string {
  const day = dayOf(now, timeZone);
  const today = (kind: string) => events.filter((e) => e.kind === kind && e.at <= now && dayOf(e.at, timeZone) === day).map((e) => e.at).sort();
  const lastOut = today('out').at(-1);
  const lastIn = today('in').at(-1);
  return lastOut && (!lastIn || lastOut >= lastIn) ? lastOut : now;
}

/**
 * The checkout form, filled in where it can be. A Smartsheet form fills a box
 * from its address (?Box name=value) and ignores names it doesn't have, so the
 * LDS form's own box names are sent: Site ID, Work Order #, Checkout Date,
 * Full Name, Time On Site, Time Off Site. The tech still picks their role,
 * adds any issues, checks it and submits it. Any other form opens as it is.
 */
export function checkoutFormUrl(link: string, f: {
  siteId: string | null; wo: string; name: string; on: string | null; off: string; timeZone: string;
}): string {
  if (!/^https:\/\/app\.smartsheet\.com\/b\/form\//i.test(link)) return link;
  const pairs: [string, string][] = [
    ['Site ID', f.siteId ?? ''],
    ['Work Order #', f.wo],
    ['Checkout Date', dateMDY(f.off, f.timeZone)],
    ['Full Name', f.name],
    ['Time On Site', f.on ? clock24(f.on, f.timeZone) : ''],
    ['Time Off Site', clock24(f.off, f.timeZone)],
  ];
  const q = pairs
    .filter(([, v]) => v.trim())
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v.trim())}`)
    .join('&');
  if (!q) return link;
  const [base, hash] = link.split('#');
  return `${base}${base.includes('?') ? '&' : '?'}${q}${hash ? `#${hash}` : ''}`;
}
