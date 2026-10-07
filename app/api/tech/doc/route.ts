import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isDocKind } from '@/lib/job-docs';

// POST /api/tech/doc — a tech sends a document (a PDF made or signed on the
// phone) to their own job (Fred, 2026-10-07, about the iScanner app: "all the
// above for my tech to use", then "edit and sign pdfs"). FormData: wo_number,
// file (application/pdf), name, kind, pages.
//
// Like /api/tech/photo, the tech's own session asks the database first
// whether this is their live job (wf_tech_photo_target). Only then is the PDF
// stored — in the PRIVATE job-docs bucket under the owner's folder (migration
// 115), since a scan can hold signatures, IDs or tax forms — and recorded in
// job_docs. Techs get a confirmation, never a link back to the bucket.
//
// A long scan can be bigger than a server request may carry (about 4.5 MB on
// Vercel), so big files go straight to storage in two JSON steps instead:
//   { step: 'start', wo_number }  → a one-time upload ticket for a new file in
//                                   that job's folder
//   { step: 'finish', wo_number, path, name, kind, pages } → checks the file
//                                   arrived, is a PDF and fits, then files it.
const MAX_BYTES = 15 * 1024 * 1024;
const fail = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status });
const isPdf = (b: Uint8Array) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;

/** The tech's live job with this number: its id, its owner, and the tech's name. */
async function jobFor(woNumber: string): Promise<{ woId: string; ownerId: string; sentBy: string | null } | NextResponse> {
  const supabase = await createClient('field');
  const { data: target, error: tErr } = await supabase.rpc('wf_tech_photo_target', { p_wo_number: woNumber });
  const woId = (target as { wo_id?: string } | null)?.wo_id;
  if (tErr || !woId) return fail('That job is closed or no longer yours.', 403);
  const { data: me } = await supabase.rpc('tech_me');
  const sentBy = (me as { name?: string } | null)?.name ?? null;
  const { data: wo, error: wErr } = await createAdminClient().from('work_orders').select('user_id').eq('id', woId).maybeSingle();
  const ownerId = (wo as { user_id?: string } | null)?.user_id;
  if (wErr || !ownerId) return fail("Couldn't find the job.", 404);
  return { woId, ownerId, sentBy };
}

function docMeta(get: (k: string) => unknown) {
  const name = String(get('name') ?? '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Scanned document';
  const kindIn = String(get('kind') ?? '');
  const pagesN = Number(get('pages'));
  return {
    name,
    kind: isDocKind(kindIn) ? kindIn : 'Other',
    pages: Number.isFinite(pagesN) && pagesN > 0 && pagesN < 500 ? Math.round(pagesN) : null,
  };
}

const newPath = (ownerId: string, woId: string) => `${ownerId}/${woId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.pdf`;

async function record(job: { woId: string; ownerId: string; sentBy: string | null }, path: string, bytes: number, meta: ReturnType<typeof docMeta>) {
  const admin = createAdminClient();
  const { error } = await admin.from('job_docs').insert({
    user_id: job.ownerId, wo_id: job.woId, path, name: meta.name, kind: meta.kind, pages: meta.pages, bytes, sent_by: job.sentBy,
  });
  if (error) {
    await admin.storage.from('job-docs').remove([path]);
    return fail("Couldn't add the document to the job.", 400);
  }
  return NextResponse.json({ ok: true });
}

export async function POST(req: Request) {
  if ((req.headers.get('content-type') ?? '').includes('application/json')) return bigFile(req);

  let form: FormData;
  try { form = await req.formData(); } catch { return fail('Bad request', 400); }
  const woNumber = String(form.get('wo_number') ?? '').trim();
  const file = form.get('file');
  if (!woNumber || !(file instanceof Blob)) return fail('Missing the job or the document.', 400);
  if (file.size === 0 || file.size > MAX_BYTES) return fail('That document is too large to send (15 MB at most).', 413);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isPdf(bytes)) return fail('Only PDF documents can be sent here.', 415);
  const meta = docMeta((k) => form.get(k));

  const job = await jobFor(woNumber);
  if (job instanceof NextResponse) return job;
  const path = newPath(job.ownerId, job.woId);
  const { error: upErr } = await createAdminClient().storage.from('job-docs').upload(path, bytes, { contentType: 'application/pdf', upsert: false });
  if (upErr) return fail("Couldn't store the document. Try again.", 500);
  return record(job, path, bytes.length, meta);
}

async function bigFile(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const woNumber = String(body?.wo_number ?? '').trim();
  if (!body || !woNumber) return fail('Bad request', 400);
  const job = await jobFor(woNumber);
  if (job instanceof NextResponse) return job;
  const admin = createAdminClient();

  if (body.step === 'start') {
    const { data, error } = await admin.storage.from('job-docs').createSignedUploadUrl(newPath(job.ownerId, job.woId));
    if (error || !data) return fail("Couldn't get ready to send. Try again.", 500);
    return NextResponse.json({ ok: true, path: data.path, token: data.token });
  }
  if (body.step === 'finish') {
    const path = String(body.path ?? '');
    // Only a file this route itself handed out a ticket for, in this job's folder.
    if (!path.startsWith(`${job.ownerId}/${job.woId}/`) || !/^[0-9a-f-]+\/[0-9a-f-]+\/\d+_[a-z0-9]+\.pdf$/.test(path)) return fail('Bad request', 400);
    const { data: file, error } = await admin.storage.from('job-docs').download(path);
    if (error || !file) return fail("The document didn't arrive. Try again.", 400);
    if (file.size === 0 || file.size > MAX_BYTES || !isPdf(new Uint8Array(await file.slice(0, 5).arrayBuffer()))) {
      await admin.storage.from('job-docs').remove([path]);
      return fail(file.size > MAX_BYTES ? 'That document is too large to send (15 MB at most).' : 'Only PDF documents can be sent here.', file.size > MAX_BYTES ? 413 : 415);
    }
    return record(job, path, file.size, docMeta((k) => body[k]));
  }
  return fail('Bad request', 400);
}

// GET /api/tech/doc?id=… — a tech opens a document on their job to fill in or
// sign: one shared with the job's techs, or one they sent themselves
// (migration 116). The database says whether it's theirs to open
// (wf_tech_doc_path, only while the job is theirs and live); the file comes
// back through here, so a tech never holds a link to the private bucket.
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return fail('Bad request', 400);
  const supabase = await createClient('field');
  const { data: path, error } = await supabase.rpc('wf_tech_doc_path', { p_doc: id });
  if (error || typeof path !== 'string' || !path) return fail("That document isn't available on this job anymore.", 404);
  const { data: file, error: dErr } = await createAdminClient().storage.from('job-docs').download(path);
  if (dErr || !file) return fail("Couldn't open the document. Try again.", 404);
  return new NextResponse(file, {
    headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'private, no-store', 'Content-Disposition': 'inline' },
  });
}
