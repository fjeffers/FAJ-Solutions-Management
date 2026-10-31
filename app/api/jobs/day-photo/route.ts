import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { zonedIso } from '@/lib/clock-fix';
import { ownerOnly } from '@/lib/security';

// POST /api/jobs/day-photo — the office adds a picture to a tech's day on a job
// (Fred, 2026-10-24: "i need to add pictures also to the days also the odometer
// pictures"). FormData: wo_id, day (YYYY-MM-DD), tech, kind (site | odo_start |
// odo_end), reading (the odometer, needed for odo_*), ai_reading (what the AI
// read off the picture, optional), time (HH:MM, optional), file (JPEG).
//
// The owner's own session must see the job; then the file is stored and recorded
// where a tech's would be: a site photo with the job's photos (wo_photos, the
// public portal-uploads bucket, like app/api/tech/photo), an odometer photo with
// its reading (job_odometer, the private job-receipts bucket, like
// app/api/tech/odometer). Both are timed on that day, so the day's card, the
// Field Sheet and the timesheet PDF all find it.
const MAX_BYTES = 6 * 1024 * 1024;
const TZ = 'America/New_York';
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;

export async function POST(req: Request) {
  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 }); }
  const woId = String(form.get('wo_id') ?? '');
  const day = String(form.get('day') ?? '');
  const tech = String(form.get('tech') ?? '').trim().slice(0, 120);
  const kind = String(form.get('kind') ?? '');
  const time = String(form.get('time') ?? '');
  const readingRaw = String(form.get('reading') ?? '').replace(/[,\s]/g, '');
  const aiText = String(form.get('ai_reading') ?? '').trim();
  const aiRaw = aiText ? Number(aiText) : NaN;
  const aiReading = Number.isFinite(aiRaw) && aiRaw >= 0 && aiRaw < 10_000_000 ? Math.round(aiRaw * 10) / 10 : null;
  const file = form.get('file');
  if (!woId || !DAY.test(day) || !tech || !['site', 'odo_start', 'odo_end'].includes(kind)) return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 });
  if (!(file instanceof Blob) || file.size === 0) return NextResponse.json({ ok: false, error: 'Pick a picture first.' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ ok: false, error: 'That picture is too large.' }, { status: 413 });
  if (file.type && file.type !== 'image/jpeg') return NextResponse.json({ ok: false, error: 'Only a picture can be added here.' }, { status: 415 });
  const odo = kind !== 'site';
  const reading = readingRaw ? Number(readingRaw) : null;
  if (odo && (reading == null || !Number.isFinite(reading) || reading < 0 || reading >= 10_000_000)) {
    return NextResponse.json({ ok: false, error: 'Type the miles on the odometer.' }, { status: 400 });
  }

  const supabase = await createClient('admin');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  const denied = await ownerOnly(supabase);
  if (denied) return denied;
  const { data: wo } = await supabase.from('work_orders').select('id, wo_number').eq('id', woId).eq('user_id', user.id).maybeSingle();
  if (!wo) return NextResponse.json({ ok: false, error: 'That work order was not found.' }, { status: 404 });

  // On the day picked: the time typed, else the start of the day's work or its end for the odometer, midday for a photo.
  const at = zonedIso(day, TIME.test(time) ? time : kind === 'odo_start' ? '07:00' : kind === 'odo_end' ? '17:00' : '12:00', TZ);
  if (!at) return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 });
  const admin = createAdminClient();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  if (!odo) {
    const path = `wo_${wo.id}/office_${stamp}.jpg`;
    const { error: upErr } = await admin.storage.from('portal-uploads').upload(path, bytes, { contentType: 'image/jpeg', upsert: false });
    if (upErr) return NextResponse.json({ ok: false, error: "Couldn't store the picture. Try again." }, { status: 500 });
    const { data: { publicUrl } } = admin.storage.from('portal-uploads').getPublicUrl(path);
    const { error } = await admin.from('wo_photos').insert({
      user_id: user.id, wo_id: wo.id, wo_number: wo.wo_number, contractor_name: tech, path, url: publicUrl, taken_at: at, source: 'library', label: 'Added by the office',
    });
    if (error) {
      await admin.storage.from('portal-uploads').remove([path]);
      return NextResponse.json({ ok: false, error: "Couldn't add the picture to the day." }, { status: 500 });
    }
    return NextResponse.json({ ok: true, url: publicUrl });
  }

  const path = `${wo.id}/odo_office_${stamp}.jpg`;
  const { error: upErr } = await admin.storage.from('job-receipts').upload(path, bytes, { contentType: 'image/jpeg', upsert: false });
  if (upErr) return NextResponse.json({ ok: false, error: "Couldn't store the picture. Try again." }, { status: 500 });
  const { error } = await admin.from('job_odometer').insert({
    user_id: user.id, wo_id: wo.id, wo_number: wo.wo_number, contractor_name: tech, at,
    moment: kind === 'odo_start' ? 'start' : 'end', reading: Math.round(reading! * 10) / 10, ai_reading: aiReading, photo_path: path,
  });
  if (error) {
    await admin.storage.from('job-receipts').remove([path]);
    return NextResponse.json({ ok: false, error: "Couldn't add the odometer to the day." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
