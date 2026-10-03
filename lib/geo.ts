// Where and when, for the tech portal (Fred, 2026-10-02: "GPS on the portal
// and time and date and GPS location on the pictures").
//
// getPosition() is the phone's GPS, best effort: it never holds a tap up for
// more than a few seconds, and it works with no signal (GPS is satellites, not
// the network). The rest is pure and unit-tested (lib/geo.test.ts).

export type Position = { lat: number; lng: number; accuracy: number | null };

/** The phone's location, or null when it is off, refused, or too slow. */
export function getPosition(timeoutMs = 6000): Promise<Position | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (p: Position | null) => { if (!settled) { settled = true; resolve(p); } };
    const timer = setTimeout(() => finish(null), timeoutMs + 500);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        clearTimeout(timer);
        finish({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Number.isFinite(p.coords.accuracy) ? p.coords.accuracy : null });
      },
      () => { clearTimeout(timer); finish(null); },
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: timeoutMs },
    );
  });
}

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
