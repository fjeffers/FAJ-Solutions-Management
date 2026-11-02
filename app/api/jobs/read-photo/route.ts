import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { aiReadPhoto } from '@/lib/photo-read-ai';
import { todayISO } from '@/lib/utils';
import { ownerOnly } from '@/lib/security';

// POST /api/jobs/read-photo — AI reads the odometer on a picture the office is
// adding to a tech's day (components/DayPictures; Fred, 2026-10-26: the app was
// down and the mileage is done by hand from the techs' photos). FormData: wo_id,
// file (JPEG). Fills the reading box; the office checks it before Add. Nothing
// is stored here.
const MAX_BYTES = 4 * 1024 * 1024;

export async function POST(req: Request) {
  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 }); }
  const woId = String(form.get('wo_id') ?? '');
  const file = form.get('file');
  if (!woId) return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 });
  if (!(file instanceof Blob) || file.size === 0) return NextResponse.json({ ok: false, error: 'Pick a picture first.' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ ok: false, error: 'That picture is too large.' }, { status: 413 });
  if (file.type && file.type !== 'image/jpeg') return NextResponse.json({ ok: false, error: 'Only a picture can be read.' }, { status: 415 });

  const supabase = await createClient('admin');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  const denied = await ownerOnly(supabase);
  if (denied) return denied;
  const { data: wo } = await supabase.from('work_orders').select('id').eq('id', woId).eq('user_id', user.id).maybeSingle();
  if (!wo) return NextResponse.json({ ok: false, error: 'That work order was not found.' }, { status: 404 });

  const r = await aiReadPhoto('odometer', file, todayISO());
  return NextResponse.json({ ok: true, result: r.result, source: r.source });
}
