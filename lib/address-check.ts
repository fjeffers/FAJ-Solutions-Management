// "Check address" on the job form (Fred, 2026-10-22: "put the correct address
// on the GPS to basically auto correct ... make sure we have the accurate
// address"). The office types the site address; the server asks the US Census
// geocoder (free, no key, the same one lib/geocode-server.ts uses), which
// answers with the address in its standard form and its map position. The
// office sees it and taps Use this. OpenStreetMap is the fallback.
// Pure and unit-tested (lib/address-check.test.ts); the route is
// app/api/address/check.

export type CheckedAddress = {
  street: string; city: string; state: string; zip: string;
  lat: number; lng: number;
  /** "901 Canal Pointe Blvd, Princeton, NJ 08540" */
  line: string;
  source: 'census' | 'osm';
};

const STREET_ABBR = new Set(['NE', 'NW', 'SE', 'SW', 'N', 'S', 'E', 'W', 'US', 'PO']);

/** "CANAL POINTE BLVD" → "Canal Pointe Blvd"; directions and route letters stay capitals. */
export function titleCase(s: string): string {
  return s.trim().toLowerCase().split(/\s+/).map((w) => {
    const up = w.toUpperCase();
    if (STREET_ABBR.has(up)) return up;
    return w.replace(/^([a-z])/, (c) => c.toUpperCase());
  }).join(' ');
}

const lineOf = (a: { street: string; city: string; state: string; zip: string }) =>
  [a.street, a.city, [a.state, a.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');

/** The first match in a Census "onelineaddress" answer: "901 CANAL POINTE BLVD, PRINCETON, NJ, 08540". */
export function parseCensusMatch(data: unknown): CheckedAddress | null {
  const m = (data as { result?: { addressMatches?: { matchedAddress?: unknown; coordinates?: { x?: unknown; y?: unknown } }[] } })
    ?.result?.addressMatches?.[0];
  const lat = Number(m?.coordinates?.y), lng = Number(m?.coordinates?.x);
  if (!m || typeof m.matchedAddress !== 'string' || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const parts = m.matchedAddress.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 4) return null;
  const [street, city, state, zip] = [titleCase(parts[0]), titleCase(parts[1]), parts[2].toUpperCase(), parts[3]];
  const a = { street, city, state, zip };
  return { ...a, lat, lng, line: lineOf(a), source: 'census' };
}

const US_STATE: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT', delaware: 'DE',
  'district of columbia': 'DC', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR',
  pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT',
  vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
};

/** The first match in a Nominatim search answer with addressdetails=1. Needs a street and a town. */
export function parseNominatimMatch(data: unknown): CheckedAddress | null {
  const r = Array.isArray(data) ? (data[0] as { lat?: unknown; lon?: unknown; address?: Record<string, unknown> } | undefined) : undefined;
  const lat = Number(r?.lat), lng = Number(r?.lon);
  const a = r?.address;
  if (!r || !a || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const s = (k: string) => (a[k] == null ? '' : String(a[k]).trim());
  const street = [s('house_number'), s('road')].filter(Boolean).join(' ');
  const city = s('city') || s('town') || s('village') || s('hamlet') || s('suburb');
  const iso = s('ISO3166-2-lvl4');
  const state = /^US-[A-Z]{2}$/.test(iso) ? iso.slice(3) : US_STATE[s('state').toLowerCase()] ?? s('state');
  const zip = s('postcode').slice(0, 10);
  if (!road(street) || !city) return null;
  const parts = { street, city, state, zip };
  return { ...parts, lat, lng, line: lineOf(parts), source: 'osm' };
}
const road = (street: string) => street.replace(/^\d+[a-z]?\b\s*/i, '').trim();

const SUFFIX: Record<string, string> = {
  boulevard: 'blvd', street: 'st', avenue: 'ave', road: 'rd', drive: 'dr', lane: 'ln', court: 'ct', place: 'pl',
  parkway: 'pkwy', highway: 'hwy', route: 'rte', circle: 'cir', terrace: 'ter', trail: 'trl', square: 'sq',
  north: 'n', south: 's', east: 'e', west: 'w',
};
const houseNumber = (street: string) => street.trim().match(/^(\d+[a-z]?)\b/i)?.[1]?.toLowerCase() ?? '';
const streetName = (street: string) => street.trim().replace(/^\d+[a-z]?\b\s*/i, '').toLowerCase()
  .replace(/[.,#]/g, ' ').split(/\s+/).filter(Boolean).map((w) => SUFFIX[w] ?? w).join(' ');

/**
 * How the found address compares with what was typed:
 * 'exact'    the same building on the same street (spelling and abbreviations aside)
 * 'street'   a different street than typed: look before using it
 * 'nobuilding' the street was found but not that building number
 */
export function matchKind(found: { street: string }, typedStreet: string | null | undefined): 'exact' | 'street' | 'nobuilding' {
  const typed = (typedStreet ?? '').trim();
  const n = houseNumber(typed);
  if (n && !houseNumber(found.street)) return 'nobuilding';
  if (n && houseNumber(found.street) !== n) return 'street';
  return streetName(found.street) === streetName(typed) ? 'exact' : 'street';
}

/** Is the checked address what the form already says (ignoring case and spacing)? */
export function sameAddress(a: { street: string; city: string; state: string; zip: string }, form: {
  site_address?: string | null; site_city?: string | null; site_state?: string | null; site_zip?: string | null;
}): boolean {
  const n = (v: string | null | undefined) => (v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return n(a.street) === n(form.site_address) && n(a.city) === n(form.site_city)
    && n(a.state) === n(form.site_state) && n(a.zip).slice(0, 5) === n(form.site_zip).slice(0, 5);
}
