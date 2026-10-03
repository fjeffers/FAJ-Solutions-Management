import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

// POST /api/tech/photo — a tech adds a stamped photo to their own job from the
// tech portal (Fred, 2026-10-02: "time and date and GPS location on the
// pictures"). FormData: wo_number, file (JPEG), taken_at, lat, lng, accuracy,
// source ('camera' | 'library').
//
// The tech's own session asks the database first whether this is their live
// job (wf_tech_photo_target, migration-100). Only then is the file stored, in
// the same place the emailed portal link puts job photos, and recorded on the
// job through wf_tech_add_photo — again as the tech — so the database, not
// this route, decides whose job it is.
const MAX_BYTES = 4 * 1024 * 1024;

export async function POST(req: Request) {
  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 }); }
  const woNumber = String(form.get('wo_number') ?? '').trim();
  const file = form.get('file');
  if (!woNumber || !(file instanceof Blob)) return NextResponse.json({ ok: false, error: 'Missing the job or the photo.' }, { status: 400 });
  if (file.size === 0 || file.size > MAX_BYTES) return NextResponse.json({ ok: false, error: 'That photo is too large to send.' }, { status: 413 });
  if (file.type && file.type !== 'image/jpeg') return NextResponse.json({ ok: false, error: 'Only photos can be added here.' }, { status: 415 });

  const num = (k: string) => {
    const v = form.get(k);
    const n = v == null || v === '' ? NaN : Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const takenAt = String(form.get('taken_at') ?? '');
  const source = form.get('source') === 'library' ? 'library' : 'camera';

  const supabase = await createClient();
  const { data: target, error: tErr } = await supabase.rpc('wf_tech_photo_target', { p_wo_number: woNumber });
  const woId = (target as { wo_id?: string } | null)?.wo_id;
  if (tErr || !woId) return NextResponse.json({ ok: false, error: 'That job is closed or no longer yours.' }, { status: 403 });

  const path = `wo_${woId}/tech_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
  const admin = createAdminClient();
  const { error: upErr } = await admin.storage.from('portal-uploads').upload(path, new Uint8Array(await file.arrayBuffer()), {
    contentType: 'image/jpeg', upsert: false,
  });
  if (upErr) return NextResponse.json({ ok: false, error: "Couldn't store the photo. Try again." }, { status: 500 });
  const { data: { publicUrl } } = admin.storage.from('portal-uploads').getPublicUrl(path);

  const { data: rec, error: rErr } = await supabase.rpc('wf_tech_add_photo', {
    p_wo_number: woNumber, p_path: path, p_url: publicUrl,
    p_taken_at: takenAt || new Date().toISOString(),
    p_lat: num('lat'), p_lng: num('lng'), p_accuracy: num('accuracy'), p_source: source,
  });
  if (rErr || !(rec as { ok?: boolean } | null)?.ok) {
    await admin.storage.from('portal-uploads').remove([path]);
    return NextResponse.json({ ok: false, error: "Couldn't add the photo to the job." }, { status: 400 });
  }
  return NextResponse.json({ ok: true, url: publicUrl });
}
