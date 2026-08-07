const geocodeCache: Record<string, { lat: number; lng: number }> = {};

/**
 * Map pin for a site address. Best-effort and NEVER load-bearing: this runs
 * inside saveWorkOrder, so anything it does slowly, the Save button does slowly.
 *
 * The catch here was already non-blocking, but a hung request is not an
 * exception — it is silence. Nominatim rate-limits aggressively and can simply
 * not answer, and `fetch` has no default timeout, so a save could sit forever
 * with no error and no toast. Losing a pin is nothing; losing a work order
 * because the map service was busy is not.
 */
export async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  if (!address) return null;
  if (geocodeCache[address]) return geocodeCache[address];
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`;
    const res = await fetch(url, {
      headers: { 'Accept-Language': 'en' },
      // Nominatim's usage policy asks for an identifying agent; requests
      // without one are the first to get throttled.
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data && data[0]) {
      const coords = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
      geocodeCache[address] = coords;
      return coords;
    }
  } catch { /* timed out, offline, or throttled — the save carries on */ }
  return null;
}
