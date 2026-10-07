import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

// POST /api/tech/doc — a tech sends a scanned document (a PDF made on the
// phone) to their own job (Fred, 2026-10-07, about the iScanner app: "all the
// above for my tech to use"). FormData: wo_number, file (application/pdf),
// name, kind, pages.
//
// Like /api/tech/photo, the tech's own session asks the database first
// whether this is their live job (wf_tech_photo_target). Only then is the PDF
// stored — in the PRIVATE job-docs bucket under the owner's folder (migration
// 115), since a scan can hold signatures, IDs or tax forms — and recorded in
// job_docs. Techs get a confirmation, never a link back to the file.
const MAX_BYTES = 15 * 1024 * 1024;
const KINDS = new Set(['Signed work order', 'Receipt', 'Site sheet', 'Permit', 'Drawing', 'Other']);

export async function POST(req: Request) {
  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 }); }
  const woNumber = String(form.get('wo_number') ?? '').trim();
  const file = form.get('file');
  if (!woNumber || !(file instanceof Blob)) return NextResponse.json({ ok: false, error: 'Missing the job or the document.' }, { status: 400 });
  if (file.size === 0 || file.size > MAX_BYTES) return NextResponse.json({ ok: false, error: 'That document is too large to send (15 MB at most).' }, { status: 413 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  // A real PDF starts "%PDF-".
  if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
    return NextResponse.json({ ok: false, error: 'Only PDF documents can be sent here.' }, { status: 415 });
  }
  const name = String(form.get('name') ?? '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Scanned document';
  const kindIn = String(form.get('kind') ?? '');
  const kind = KINDS.has(kindIn) ? kindIn : 'Other';
  const pagesN = Number(form.get('pages'));
  const pages = Number.isFinite(pagesN) && pagesN > 0 && pagesN < 500 ? Math.round(pagesN) : null;

  const supabase = await createClient('field');
  const { data: target, error: tErr } = await supabase.rpc('wf_tech_photo_target', { p_wo_number: woNumber });
  const woId = (target as { wo_id?: string } | null)?.wo_id;
  if (tErr || !woId) return NextResponse.json({ ok: false, error: 'That job is closed or no longer yours.' }, { status: 403 });
  const { data: me } = await supabase.rpc('tech_me');
  const sentBy = (me as { name?: string } | null)?.name ?? null;

  const admin = createAdminClient();
  const { data: wo, error: wErr } = await admin.from('work_orders').select('user_id').eq('id', woId).maybeSingle();
  const ownerId = (wo as { user_id?: string } | null)?.user_id;
  if (wErr || !ownerId) return NextResponse.json({ ok: false, error: "Couldn't find the job." }, { status: 404 });

  const path = `${ownerId}/${woId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.pdf`;
  const { error: upErr } = await admin.storage.from('job-docs').upload(path, bytes, { contentType: 'application/pdf', upsert: false });
  if (upErr) return NextResponse.json({ ok: false, error: "Couldn't store the document. Try again." }, { status: 500 });

  const { error: rErr } = await admin.from('job_docs').insert({
    user_id: ownerId, wo_id: woId, path, name, kind, pages, bytes: bytes.length, sent_by: sentBy,
  });
  if (rErr) {
    await admin.storage.from('job-docs').remove([path]);
    return NextResponse.json({ ok: false, error: "Couldn't add the document to the job." }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
