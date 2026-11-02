import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { dayOf } from '@/lib/project-day';
import { addDayMiles, parseMiles } from '@/lib/day-miles';
import { parseEdits } from '@/lib/field-sheet';

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
//
// GET /api/tech/mileage?wo_number= — the miles this tech added by hand on the
// job, by day ({ days: { 'YYYY-MM-DD': miles } }), for the week's total on the
// tech's time and travel.
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

  const who = await techOnJob(woNumber);
  if ('error' in who) return who.error;
  const { woId, tech, ownerId, admin } = who;

  const extra = await addDayMiles(admin, { woId, tech, day: date, miles, ownerId });
  if (extra == null) return NextResponse.json({ ok: false, error: "Couldn't add the miles. Try again." }, { status: 500 });
  return NextResponse.json({ ok: true, miles, extraMiles: extra });
}

export async function GET(req: Request) {
  const woNumber = (new URL(req.url).searchParams.get('wo_number') ?? '').trim();
  if (!woNumber) return NextResponse.json({ ok: false, error: 'Missing the job.' }, { status: 400 });
  const who = await techOnJob(woNumber);
  if ('error' in who) return who.error;
  const { data, error } = await who.admin.from('field_sheet_days').select('day, edits, hidden')
    .eq('wo_id', who.woId).eq('tech', who.tech);
  if (error) return NextResponse.json({ ok: false, error: "Couldn't load your miles." }, { status: 500 });
  const days: Record<string, number> = {};
  for (const r of (data ?? []) as { day: string; edits: unknown; hidden?: boolean }[]) {
    const mi = parseEdits(r.edits).extraMiles ?? 0;
    if (!r.hidden && mi > 0) days[String(r.day).slice(0, 10)] = mi;
  }
  return NextResponse.json({ ok: true, days });
}

/** The signed-in tech, by the name on their portal login, on their own live job (wf_tech_photo_target). */
type TechOnJob = { error: NextResponse } | { woId: string; tech: string; ownerId: string; admin: ReturnType<typeof createAdminClient> };
async function techOnJob(woNumber: string): Promise<TechOnJob> {
  const supabase = await createClient('field');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 }) };
  const { data: target } = await supabase.rpc('wf_tech_photo_target', { p_wo_number: woNumber });
  const woId = (target as { wo_id?: string } | null)?.wo_id;
  if (!woId) return { error: NextResponse.json({ ok: false, error: "That job isn't open for you any more." }, { status: 403 }) };

  const admin = createAdminClient();
  const { data: me } = await admin.from('contractors').select('name, user_id').eq('auth_user_id', user.id).eq('portal_enabled', true).maybeSingle();
  const tech = (me as { name?: string } | null)?.name?.trim();
  const ownerId = (me as { user_id?: string } | null)?.user_id;
  if (!tech || !ownerId) return { error: NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 }) };
  return { woId, tech, ownerId, admin };
}
