import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { parseCensusMatch, parseNominatimMatch } from '@/lib/address-check';

// GET /api/address/check?q=<address> — the address in its standard form and
// its map position, for the job form's Check address (lib/address-check.ts).
// Signed-in office only. { ok: true, match } or { ok: true, match: null }.
export async function GET(req: Request) {
  const supabase = await createClient('admin');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const q = (new URL(req.url).searchParams.get('q') ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (q.length < 5) return NextResponse.json({ ok: false, error: 'Type the street, city and state first.' }, { status: 400 });

  try {
    const res = await fetch(`https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address=${encodeURIComponent(q)}`,
      { signal: AbortSignal.timeout(7000), cache: 'no-store' });
    if (res.ok) {
      const match = parseCensusMatch(await res.json());
      if (match) return NextResponse.json({ ok: true, match });
    }
  } catch { /* slow or down: try OpenStreetMap */ }
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&countrycodes=us&q=${encodeURIComponent(q)}`, {
      signal: AbortSignal.timeout(7000), cache: 'no-store',
      headers: { 'User-Agent': 'FAJ Solutions business app (app.fajsolutions.com)', 'Accept-Language': 'en' },
    });
    if (res.ok) return NextResponse.json({ ok: true, match: parseNominatimMatch(await res.json()) });
  } catch { /* nothing this time */ }
  return NextResponse.json({ ok: false, error: "The address lookup isn't answering. Try again in a minute." }, { status: 502 });
}
