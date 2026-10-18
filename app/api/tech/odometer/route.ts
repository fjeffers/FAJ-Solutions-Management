import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

// POST /api/tech/odometer — a tech records the odometer at the start or end of
// a drive on their own job (migration 128). FormData: wo_number, at (ISO time
// of the photo), reading (what the tech confirmed), ai_reading (what the AI
// read, optional), file (JPEG, optional).
//
// The same steps as a receipt (/api/tech/expense): the tech's own session asks
// whether this is their live job, the photo goes to the private job-receipts
// bucket under that job as odo_….jpg, then wf_tech_add_odometer records it as
// the tech and checks everything again.
const MAX_BYTES = 4 * 1024 * 1024;

const REASONS: Record<string, string> = {
  closed_or_not_yours: 'This job is closed or not yours.',
  bad_reading: 'Enter the miles on the odometer.',
  bad_file: "Couldn't store the odometer photo. Try again.",
};

export async function POST(req: Request) {
  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 }); }
  const woNumber = String(form.get('wo_number') ?? '').trim();
  const reading = Number(String(form.get('reading') ?? '').replace(/[,\s]/g, ''));
  const aiRaw = String(form.get('ai_reading') ?? '').trim();
  const aiReading = aiRaw ? Number(aiRaw) : null;
  const at = String(form.get('at') ?? '');
  const file = form.get('file');
  if (!woNumber) return NextResponse.json({ ok: false, error: 'Missing the job.' }, { status: 400 });
  if (!Number.isFinite(reading) || reading < 0 || reading >= 10_000_000) return NextResponse.json({ ok: false, error: REASONS.bad_reading }, { status: 400 });
  if (!Number.isFinite(Date.parse(at))) return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 });

  const supabase = await createClient('field');
  const { data: target } = await supabase.rpc('wf_tech_photo_target', { p_wo_number: woNumber });
  const woId = (target as { wo_id?: string } | null)?.wo_id;
  if (!woId) return NextResponse.json({ ok: false, error: REASONS.closed_or_not_yours }, { status: 403 });

  const admin = createAdminClient();
  let path: string | null = null;
  if (file instanceof Blob && file.size > 0) {
    if (file.size > MAX_BYTES) return NextResponse.json({ ok: false, error: 'That photo is too large to send.' }, { status: 413 });
    if (file.type && file.type !== 'image/jpeg') return NextResponse.json({ ok: false, error: 'It must be a photo.' }, { status: 415 });
    path = `${woId}/odo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
    const { error: upErr } = await admin.storage.from('job-receipts').upload(path, new Uint8Array(await file.arrayBuffer()), {
      contentType: 'image/jpeg', upsert: false,
    });
    if (upErr) return NextResponse.json({ ok: false, error: REASONS.bad_file }, { status: 500 });
  }

  const { data, error } = await supabase.rpc('wf_tech_add_odometer', {
    p_wo_number: woNumber, p_at: at, p_reading: reading,
    p_ai_reading: aiReading != null && Number.isFinite(aiReading) ? aiReading : null, p_photo_path: path,
  });
  const r = (data ?? {}) as { ok?: boolean; reason?: string };
  if (error || !r.ok) {
    if (path) await admin.storage.from('job-receipts').remove([path]);
    // Before migration 128 the function isn't there.
    if (error?.code === 'PGRST202') return NextResponse.json({ ok: false, error: "Odometer photos aren't switched on yet. Ask the office." }, { status: 501 });
    return NextResponse.json({ ok: false, error: REASONS[r.reason ?? ''] ?? "Couldn't save the odometer. Try again." }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
