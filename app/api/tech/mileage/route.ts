import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { dayOf } from '@/lib/project-day';
import { addDayMiles, parseMiles } from '@/lib/day-miles';

// POST /api/tech/mileage — a tech adds miles by hand to a day on their own job,
// from Add an expense with Mileage picked (Fred, 2026-10-27: "for mileage ...
// it's supposed to basically go to mileage"). FormData: wo_number, miles,
// date (YYYY-MM-DD). The miles go on top of the day's own, as its Extra miles
// on Hours (lib/day-miles.ts), like an odometer reading the tech taps; the
// office can change them there.
//
// The tech's own session asks whether this is their live job
// (wf_tech_photo_target), as a receipt does; their name is the one on their
// portal login, the name their day lines are kept under.
const TZ = 'America/New_York';
const MAX_DAYS_BACK = 60;

export async function POST(req: Request) {
  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 }); }
  const woNumber = String(form.get('wo_number') ?? '').trim();
  const miles = parseMiles(String(form.get('miles') ?? ''));
  const date = String(form.get('date') ?? '').slice(0, 10);
  if (!woNumber) return NextResponse.json({ ok: false, error: 'Missing the job.' }, { status: 400 });
  if (miles == null) return NextResponse.json({ ok: false, error: 'Enter the miles, like 85.' }, { status: 400 });
  const today = dayOf(new Date().toISOString(), TZ);
  const earliest = dayOf(new Date(Date.now() - MAX_DAYS_BACK * 86_400_000).toISOString(), TZ);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today || date < earliest) {
    return NextResponse.json({ ok: false, error: 'That date is too far back or in the future.' }, { status: 400 });
  }

  const supabase = await createClient('field');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  const { data: target } = await supabase.rpc('wf_tech_photo_target', { p_wo_number: woNumber });
  const woId = (target as { wo_id?: string } | null)?.wo_id;
  if (!woId) return NextResponse.json({ ok: false, error: "That job isn't open for you any more." }, { status: 403 });

  const admin = createAdminClient();
  const { data: me } = await admin.from('contractors').select('name, user_id').eq('auth_user_id', user.id).eq('portal_enabled', true).maybeSingle();
  const tech = (me as { name?: string } | null)?.name?.trim();
  const ownerId = (me as { user_id?: string } | null)?.user_id;
  if (!tech || !ownerId) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const extra = await addDayMiles(admin, { woId, tech, day: date, miles, ownerId });
  if (extra == null) return NextResponse.json({ ok: false, error: "Couldn't add the miles. Try again." }, { status: 500 });
  return NextResponse.json({ ok: true, miles, extraMiles: extra });
}
