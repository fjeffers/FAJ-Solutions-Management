// Real-world driving mileage for the Site Log auto tracker.
// Nominatim (existing lib/geocode) turns addresses into coordinates;
// OSRM's public router returns actual road distance between them.
// Both are free public services — failures return null and never block.
import { geocodeAddress } from './geocode';

// Field addresses are messy: "State Farm 768 N Bethlehem Pike Ste 102",
// "1140 Route 73, Mt.laurel, NJ 8054". Nominatim wants them cleaner, so we
// try progressively looser variants: cleaned exact -> highway number form
// (Route 73 -> NJ-73) -> city-level (close enough for mileage).
export function addressVariants(addr: string): string[] {
  let a = addr.replace(/\s+/g, ' ').trim();
  a = a.replace(/^State Farm\s+/i, '');
  a = a.replace(/\bSte\.?\s*\w+\b,?/gi, '');
  a = a.replace(/\bMt\.?\s*laurel\b/gi, 'Mount Laurel');
  a = a.replace(/\bMt\.?\s+/g, 'Mount ');
  a = a.replace(/,?\s+(NJ|PA)\s+(\d{4})$/, (_m, st, zip) => `, ${st} 0${zip}`);
  a = a.replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim();
  const out = [a];
  const state = /\bNJ\b/.test(a) ? 'NJ' : 'PA';
  const hwy = a.replace(/\b(?:U\.?S\.?\s*)?(?:Route|Rt\.?|Highway|Hwy)\s*(\d+)\b(\s*(?:West|South|North|East))?/gi, `${state}-$1`);
  if (hwy !== a) out.push(hwy);
  const cityMatch = a.match(/([A-Za-z .]+,?\s*(?:NJ|PA)\s*\d{5})\s*$/);
  if (cityMatch) out.push(cityMatch[1].trim());
  const parts = a.split(',');
  if (parts.length >= 2) out.push(parts.slice(1).join(',').trim());
  return out.filter((x, i) => x && out.indexOf(x) === i);
}

async function geocodeFlexible(addr: string): Promise<{ lat: number; lng: number } | null> {
  for (const q of addressVariants(addr)) {
    const hit = await geocodeAddress(q);
    if (hit) return hit;
  }
  return null;
}

export async function drivingMiles(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): Promise<number | null> {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false`;
    const res = await fetch(url);
    const data = await res.json();
    const meters = data?.routes?.[0]?.distance;
    return typeof meters === 'number' ? meters / 1609.344 : null;
  } catch {
    return null;
  }
}

/** Home → site → home, rounded to 0.1 mi. Null if either address won't geocode. */
export async function roundTripMiles(homeAddress: string, siteAddress: string): Promise<number | null> {
  if (!homeAddress?.trim() || !siteAddress?.trim()) return null;
  const [home, site] = await Promise.all([geocodeFlexible(homeAddress), geocodeFlexible(siteAddress)]);
  if (!home || !site) return null;
  const oneWay = await drivingMiles(home, site);
  return oneWay == null ? null : Math.round(oneWay * 2 * 10) / 10;
}
