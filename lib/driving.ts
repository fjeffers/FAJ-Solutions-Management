// Real-world driving mileage for the Site Log auto tracker.
// Nominatim (existing lib/geocode) turns addresses into coordinates;
// OSRM's public router returns actual road distance between them.
// Both are free public services — failures return null and never block.
import { geocodeAddress } from './geocode';

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
  const [home, site] = await Promise.all([geocodeAddress(homeAddress), geocodeAddress(siteAddress)]);
  if (!home || !site) return null;
  const oneWay = await drivingMiles(home, site);
  return oneWay == null ? null : Math.round(oneWay * 2 * 10) / 10;
}
