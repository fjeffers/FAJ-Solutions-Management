// Street addresses for the project sheet (Fred, 2026-10-14: "Mike started
// traveling at 6:47 AM from 123 Main St for site #4454 - Orange, NJ").
// Migration 120.
//
// A tap's GPS position → "123 Main St, Orange, NJ", looked up once on the
// server with OpenStreetMap's Nominatim (free, no key; the same service
// lib/geocode-server.ts falls back to) and kept on job_day_events.place.
// Arriving on site needs no lookup: that's the job's own address.
//
// A tech's home stays private: the sheet shows the town only (townOf).

type Raw = Record<string, unknown>;
const str = (v: unknown): string => (v == null ? '' : String(v).trim());

/** A Nominatim reverse answer → "123 Main St, Orange, NJ" ('' when it has no town). */
export function placeFromNominatim(data: unknown): string {
  const a = (data && typeof data === 'object' ? (data as Raw).address : null) as Raw | null;
  if (!a || typeof a !== 'object') return '';
  const street = [str(a.house_number), str(a.road)].filter(Boolean).join(' ');
  const town = str(a.city) || str(a.town) || str(a.village) || str(a.hamlet) || str(a.suburb) || str(a.municipality) || str(a.county);
  const iso = str(a['ISO3166-2-lvl4']);
  const state = /^US-[A-Z]{2}$/.test(iso) ? iso.slice(3) : str(a.state);
  if (!town && !street) return '';
  return [street, town, state].filter(Boolean).join(', ');
}

/** "123 Main St, Orange, NJ" → "Orange, NJ" (for a tech's home). */
export function townOf(place: string): string {
  const parts = place.split(',').map((p) => p.trim()).filter(Boolean);
  return parts.length >= 3 ? parts.slice(-2).join(', ') : place;
}

/** One lookup; null when the service couldn't be reached (try again later). */
export async function reversePlace(lat: number, lng: number): Promise<string | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&lat=${lat}&lon=${lng}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(6000), cache: 'no-store',
      headers: { 'User-Agent': 'FAJ Solutions business app (app.fajsolutions.com)', 'Accept-Language': 'en' },
    });
    if (!res.ok) return null;
    return placeFromNominatim(await res.json());
  } catch {
    return null;
  }
}

/** Taps whose place is worth looking up: where they clocked in, set off from, or signed out. */
export function needsPlace(r: Raw): boolean {
  const kind = str(r.kind);
  const lat = Number(r.lat), lng = Number(r.lng);
  if (r.place != null || r.lat == null || r.lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return kind === 'day_start' || kind === 'travel_start' || (kind === 'travel_end' && str(r.dest) !== 'site' && str(r.dest) !== 'next_site');
}

type Admin = { from: (t: string) => { update: (v: Raw) => { eq: (c: string, v: string) => PromiseLike<unknown> } } };

/**
 * Look up and keep the addresses still missing on these job_day_events rows
 * (newest first, at most `limit`, a second apart as Nominatim asks). Fills the
 * rows in place so the caller can use them straight away.
 */
export async function fillPlaces(admin: Admin, rows: Raw[], limit = 3): Promise<void> {
  const todo = rows.filter(needsPlace).sort((a, b) => str(b.at).localeCompare(str(a.at))).slice(0, limit);
  for (let n = 0; n < todo.length; n++) {
    if (n > 0) await new Promise((r) => setTimeout(r, 1100));
    const r = todo[n];
    const place = await reversePlace(Number(r.lat), Number(r.lng));
    if (place == null) continue;
    r.place = place;
    if (str(r.id)) await admin.from('job_day_events').update({ place }).eq('id', str(r.id));
  }
}
