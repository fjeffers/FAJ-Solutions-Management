import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

// POST /api/jobs/signature — the customer's signature, taken in WorkFlow by
// Fred himself (Fred, 2026-10-04: "in admin so i can make changes"). FormData:
// wo_number, file (JPEG). Stored with the job's photos, the same place a tech's
// signature goes (app/api/tech/photo). The owner's own session must be able to
// see the job; only then is the file stored and recorded.
const MAX_BYTES = 4 * 1024 * 1024;

export async function POST(req: Request) {
  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 }); }
  const woNumber = String(form.get('wo_number') ?? '').trim();
  const file = form.get('file');
  if (!woNumber || !(file instanceof Blob)) return NextResponse.json({ ok: false, error: 'Missing the job or the signature.' }, { status: 400 });
  if (file.size === 0 || file.size > MAX_BYTES) return NextResponse.json({ ok: false, error: 'That signature is too large.' }, { status: 413 });
  if (file.type && file.type !== 'image/jpeg') return NextResponse.json({ ok: false, error: 'Only a signature picture can be added here.' }, { status: 415 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  const { data: wo } = await supabase.from('work_orders').select('id, wo_number')
    .eq('user_id', user.id).eq('wo_number', woNumber).is('archived_at', null).limit(1).maybeSingle();
  if (!wo) return NextResponse.json({ ok: false, error: 'That job was not found, or it is closed.' }, { status: 404 });

  const path = `wo_${wo.id}/signoff_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
  const admin = createAdminClient();
  const { error: upErr } = await admin.storage.from('portal-uploads').upload(path, new Uint8Array(await file.arrayBuffer()), {
    contentType: 'image/jpeg', upsert: false,
  });
  if (upErr) return NextResponse.json({ ok: false, error: "Couldn't store the signature. Try again." }, { status: 500 });
  const { data: { publicUrl } } = admin.storage.from('portal-uploads').getPublicUrl(path);

  const { error: rErr } = await admin.from('wo_photos').insert({
    user_id: user.id, wo_id: wo.id, wo_number: wo.wo_number, contractor_name: 'Office (customer sign-off)',
    path, url: publicUrl, taken_at: new Date().toISOString(), source: 'camera',
  });
  if (rErr) {
    await admin.storage.from('portal-uploads').remove([path]);
    return NextResponse.json({ ok: false, error: "Couldn't add the signature to the job." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, url: publicUrl });
}
