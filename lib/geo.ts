// Where and when, for the tech portal (Fred, 2026-10-02: "GPS on the portal
// and time and date and GPS location on the pictures").
//
// getPosition() is the phone's GPS, best effort: it never holds a tap up for
// more than a few seconds, and it works with no signal (GPS is satellites, not
// the network). The rest is pure and unit-tested (lib/geo.test.ts).

export type Position = { lat: number; lng: number; accuracy: number | null };

/** Why the last getPosition() came back empty: the phone said no, or it had no fix in time. */
export type GpsProblem = 'blocked' | 'no_fix';
let lastProblem: GpsProblem = 'no_fix';

function ask(opts: PositionOptions, timeoutMs: number): Promise<Position | GpsProblem> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (p: Position | GpsProblem) => { if (!settled) { settled = true; resolve(p); } };
    const timer = setTimeout(() => finish('no_fix'), timeoutMs + 500);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        clearTimeout(timer);
        finish({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Number.isFinite(p.coords.accuracy) ? p.coords.accuracy : null });
      },
      (e) => { clearTimeout(timer); finish(e.code === 1 ? 'blocked' : 'no_fix'); },
      { ...opts, timeout: timeoutMs },
    );
  });
}

/**
 * The phone's location, or null when it is off, refused, or too slow.
 * GPS first; when it has no fix in time (indoors, early morning: a tech at
 * 5:31 AM on 2026-10-26 couldn't check in), the phone's quicker Wi-Fi and
 * cell-tower location, up to 5 minutes old. A refusal is not asked again.
 */
export async function getPosition(timeoutMs = 6000): Promise<Position | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) { lastProblem = 'no_fix'; return null; }
  let r = await ask({ enableHighAccuracy: true, maximumAge: 30_000 }, timeoutMs);
  if (r === 'no_fix') r = await ask({ enableHighAccuracy: false, maximumAge: 300_000 }, 4000);
  if (typeof r === 'string') { lastProblem = r; return null; }
  return r;
}

/**
 * Clock-ins and drives need a fix (2026-10-20: "travel time and each clock in
 * should require gps"). Shown when the phone gives no position, and the tap is
 * not saved: what to tell the tech, by what went wrong.
 */
export function gpsMessage(problem: GpsProblem): string {
  return problem === 'blocked'
    ? 'Location is blocked for this app. Tap the icon left of the web address (or phone Settings → Apps → your browser → Permissions), set Location to Allow, then try again.'
    : "Your phone couldn't find where you are. Check Location is on (swipe down from the top of the screen), step near a window or outside, then try again.";
}

/** The message for the last getPosition() that came back empty. */
export const noGpsMessage = () => gpsMessage(lastProblem);

/** "40.68840, -75.22070" — five places is about a metre. */
export function fmtCoords(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

/** A Google Maps link to a point. */
export function mapLink(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lng.toFixed(6)}`;
}

/** "Fri, Oct 2, 2026 · 8:31:07 PM EDT" in the phone's own time zone. */
export function fmtStampTime(at: Date, timeZone?: string): string {
  const day = at.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone });
  const time = at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short', timeZone });
  return `${day} · ${time}`;
}

/**
 * The lines printed along the bottom of a job photo. Says plainly when there
 * was no GPS fix, and when a photo came from the phone's library rather than
 * the camera (its time and place are when it was ADDED, not when it was taken).
 */
export function stampLines(o: {
  woNumber: string; title?: string; at: Date; pos: Position | null; fromLibrary?: boolean; timeZone?: string;
}): string[] {
  const head = ['FAJ Solutions', `WO ${o.woNumber}`, o.title?.trim()].filter(Boolean).join(' · ');
  const when = `${o.fromLibrary ? 'Added ' : ''}${fmtStampTime(o.at, o.timeZone)}`;
  const where = o.pos
    ? `GPS ${fmtCoords(o.pos.lat, o.pos.lng)}${o.pos.accuracy != null ? ` (±${Math.round(o.pos.accuracy)} m)` : ''}`
    : 'GPS: location not available';
  return [head.length > 70 ? `${head.slice(0, 67)}…` : head, when, where];
}

/** Straight-line miles between two points (for "12.4 mi away"). */
export function milesBetween(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
