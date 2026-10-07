// Where everyone is (Fred, 2026-10-06, about SimplySub: "there's also GPS to
// see where everyone is"). Each tech's last known spot, from everything the
// app records with a location:
//   clock punches   (job_punches: in / out, with lat/lng)
//   time-log record (contractor_time_logs: started driving, arrived)
//   job photos      (wo_photos: where the photo was taken)
// The newest of those, per tech, is where they were last seen. Nothing here
// tracks anyone in the background — it's only ever the last thing they did.
//
// Pure and unit-tested; components/DispatchMapView.tsx draws it.

export type Sighting = {
  name: string;
  lat: number;
  lng: number;
  /** When (ISO). */
  at: string;
  /** What they were doing: "Clocked in", "Took a photo"… */
  what: string;
  woNumber?: string | null;
};

const ok = (lat: unknown, lng: unknown) =>
  typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);

export function fromPunches(rows: { contractor_name: string | null; kind: string; at: string; lat: number | null; lng: number | null; wo_number?: string | null }[]): Sighting[] {
  return rows.filter((r) => r.contractor_name && ok(r.lat, r.lng)).map((r) => ({
    name: r.contractor_name!, lat: r.lat!, lng: r.lng!, at: r.at,
    what: r.kind === 'out' ? 'Clocked out' : 'Clocked in', woNumber: r.wo_number ?? null,
  }));
}

export function fromTimeLogs(rows: {
  contractor_name: string; wo_number?: string | null;
  travel_start_at: string | null; travel_start_lat: number | null; travel_start_lng: number | null;
  arrived_at: string | null; arrived_lat: number | null; arrived_lng: number | null;
}[]): Sighting[] {
  const out: Sighting[] = [];
  for (const r of rows) {
    if (r.arrived_at && ok(r.arrived_lat, r.arrived_lng)) out.push({ name: r.contractor_name, lat: r.arrived_lat!, lng: r.arrived_lng!, at: r.arrived_at, what: 'Arrived', woNumber: r.wo_number ?? null });
    if (r.travel_start_at && ok(r.travel_start_lat, r.travel_start_lng)) out.push({ name: r.contractor_name, lat: r.travel_start_lat!, lng: r.travel_start_lng!, at: r.travel_start_at, what: 'Started driving', woNumber: r.wo_number ?? null });
  }
  return out;
}

export function fromPhotos(rows: { contractor_name: string | null; taken_at: string | null; created_at?: string | null; lat: number | null; lng: number | null; wo_number?: string | null }[]): Sighting[] {
  return rows.filter((r) => r.contractor_name && ok(r.lat, r.lng) && (r.taken_at || r.created_at)).map((r) => ({
    name: r.contractor_name!, lat: r.lat!, lng: r.lng!, at: (r.taken_at || r.created_at)!, what: 'Took a photo', woNumber: r.wo_number ?? null,
  }));
}

/** Each tech's newest sighting, most recently seen first. */
export function latestByTech(all: Sighting[]): Sighting[] {
  const best = new Map<string, Sighting>();
  for (const s of all) {
    const t = Date.parse(s.at);
    if (!Number.isFinite(t)) continue;
    const cur = best.get(s.name);
    if (!cur || t > Date.parse(cur.at)) best.set(s.name, s);
  }
  return [...best.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/** Seen in the last 2 hours: likely still there. Earlier today: today. Before that: older. */
export function freshness(at: string, now = Date.now()): 'live' | 'today' | 'older' {
  const ms = now - Date.parse(at);
  if (ms < 2 * 3600 * 1000) return 'live';
  const d = new Date(at), n = new Date(now);
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate() ? 'today' : 'older';
}

/** "just now", "12 min ago", "3 h ago", "Oct 4". */
export function agoText(at: string, now = Date.now()): string {
  const min = Math.round((now - Date.parse(at)) / 60000);
  if (min < 2) return 'just now';
  if (min < 60) return `${min} min ago`;
  if (min < 24 * 60) return `${Math.round(min / 60)} h ago`;
  return new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
