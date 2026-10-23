// Directions to a job in the tech's own navigation app (Fred, 2026-10-22:
// "waze and maps into the app"). Each link opens that app on a phone that has
// it, and its website otherwise. The site's GPS point is used when the office
// has one, so a new or rural address still lands on the right spot.
// Pure and unit-tested (lib/navigation.test.ts).

export type NavTarget = { address: string; lat: number | null; lng: number | null };
export type NavApp = 'google' | 'waze' | 'apple';

export const NAV_APPS: { key: NavApp; label: string }[] = [
  { key: 'google', label: 'Google Maps' },
  { key: 'waze', label: 'Waze' },
  { key: 'apple', label: 'Apple Maps' },
];

const point = (t: NavTarget): string | null =>
  t.lat != null && t.lng != null && Number.isFinite(t.lat) && Number.isFinite(t.lng) && !(t.lat === 0 && t.lng === 0)
    ? `${t.lat.toFixed(6)},${t.lng.toFixed(6)}`
    : null;

/** The link that starts directions to the job in that app; null with no address and no point. */
export function navLink(app: NavApp, t: NavTarget): string | null {
  const p = point(t);
  const address = t.address.trim();
  if (!p && !address) return null;
  const q = encodeURIComponent(p ?? address);
  switch (app) {
    case 'google': return `https://www.google.com/maps/dir/?api=1&destination=${q}`;
    case 'waze': return p ? `https://waze.com/ul?ll=${q}&navigate=yes` : `https://waze.com/ul?q=${q}&navigate=yes`;
    case 'apple': return `https://maps.apple.com/?daddr=${q}&dirflg=d`;
  }
}
