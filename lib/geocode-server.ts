// Map positions for job sites, looked up on the server (Fred, 2026-10-04:
// "show full address and distance" on the tech's Available list).
//
// The US Census geocoder first: free, no key, and good at US street
// addresses. OpenStreetMap's Nominatim second, for what Census can't place.
// Best effort only — a job with no position just shows no distance.

export type LatLng = { lat: number; lng: number };

/** The first match in a Census "onelineaddress" answer. */
export function parseCensus(data: unknown): LatLng | null {
  const m = (data as { result?: { addressMatches?: { coordinates?: { x?: unknown; y?: unknown } }[] } })
    ?.result?.addressMatches?.[0]?.coordinates;
  const lat = Number(m?.y), lng = Number(m?.x);
  return Number.isFinite(lat) && Number.isFinite(lng) && m?.y != null && m?.x != null ? { lat, lng } : null;
}

/** The first match in a Nominatim search answer. */
export function parseNominatim(data: unknown): LatLng | null {
  const r = Array.isArray(data) ? (data[0] as { lat?: unknown; lon?: unknown } | undefined) : undefined;
  const lat = Number(r?.lat), lng = Number(r?.lon);
  return r && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

/** "123 Main St, Easton, PA 18042" from a job's site fields. */
export function siteLine(w: { site_address?: string | null; site_city?: string | null; site_state?: string | null; site_zip?: string | null }): string {
  const cityState = [w.site_city, [w.site_state, w.site_zip].filter(Boolean).join(' ')].filter((x) => x && String(x).trim()).join(', ');
  return [w.site_address, cityState].filter((x) => x && String(x).trim()).join(', ');
}

export async function geocodeSite(address: string): Promise<LatLng | null> {
  if (!address.trim()) return null;
  try {
    const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address=${encodeURIComponent(address)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000), cache: 'no-store' });
    if (res.ok) {
      const hit = parseCensus(await res.json());
      if (hit) return hit;
    }
  } catch { /* slow or down — try the other one */ }
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(address)}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(6000), cache: 'no-store',
      headers: { 'User-Agent': 'FAJ Solutions business app (app.fajsolutions.com)', 'Accept-Language': 'en' },
    });
    if (res.ok) return parseNominatim(await res.json());
  } catch { /* no position this time */ }
  return null;
}
