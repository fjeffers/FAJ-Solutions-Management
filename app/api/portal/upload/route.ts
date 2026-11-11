import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

// POST /api/portal/upload
// FormData: token, wo_id, file (binary)
//
// The emailed portal link asks the database first whether this token may
// upload to this job (get_portal_data only lists the token's assigned, open,
// in-scope jobs, the same gate portal_can applies). Only then is the file
// stored, with a content type taken from the allowlist below, never from the
// browser. If save_portal_data still refuses the record, the file is removed.
const MAX_BYTES = 4 * 1024 * 1024;
const BUCKET = 'portal-uploads';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Photos, PDFs and the office documents the portal's Q&A "document" answer accepts.
const ALLOWED: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain',
  csv: 'text/csv',
};

const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const token = formData.get('token');
    const wo_id = formData.get('wo_id');
    const file  = formData.get('file');

    if (typeof token !== 'string' || !token || typeof wo_id !== 'string' || !wo_id || !(file instanceof File)) {
      return fail('Missing token, wo_id, or file', 400);
    }
    if (!UUID_RE.test(wo_id)) return fail('Invalid job', 400);
    if (file.size === 0 || file.size > MAX_BYTES) return fail('That file is too large to send (4 MB max).', 413);

    const named = (file.name.includes('.') ? file.name.split('.').pop() ?? '' : '').toLowerCase();
    // A pasted or camera file may have no extension; fall back to its type, but only an allowed one.
    const ext = ALLOWED[named] ? named : Object.keys(ALLOWED).find((k) => ALLOWED[k] === file.type) ?? '';
    const contentType = ALLOWED[ext];
    if (!contentType) return fail('Only photos, PDFs and Office documents can be uploaded.', 415);

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );

    // May this token upload to this job? Checked before anything is stored.
    const { data: portal, error: pErr } = await supabase.rpc('get_portal_data', { p_token: token });
    const view = portal as { capabilities?: unknown; work_orders?: { id?: string }[] } | null;
    const caps = Array.isArray(view?.capabilities) ? view.capabilities : [];
    const jobs = Array.isArray(view?.work_orders) ? view.work_orders : [];
    if (pErr || !view) return fail('Invalid token', 403);
    if (!caps.includes('upload') || !jobs.some((w) => w?.id === wo_id)) {
      return fail('That job is closed or not assigned to this link.', 403);
    }

    const path  = `wo_${wo_id}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const admin = createAdminClient();

    const { error: upErr } = await admin.storage
      .from(BUCKET)
      .upload(path, new Uint8Array(await file.arrayBuffer()), { contentType, upsert: false });

    if (upErr) {
      console.error('Storage upload error:', upErr);
      return fail("Couldn't store the file. Try again.", 500);
    }

    const { data: { publicUrl } } = admin.storage.from(BUCKET).getPublicUrl(path);

    // Append URL to the work order's doc_urls (save_portal_data re-runs portal_can).
    const { data: saved, error: saveErr } = await supabase.rpc('save_portal_data', {
      p_token: token,
      p_wo_id: wo_id,
      p_field: 'doc_urls_append',
      p_value: { url: publicUrl },
    });
    const savedErr = (saved as { error?: string } | null)?.error;

    if (saveErr || savedErr) {
      console.error('save_portal_data append error:', saveErr ?? savedErr);
      await admin.storage.from(BUCKET).remove([path]);
      return fail("Couldn't add the file to the job.", savedErr ? 403 : 500);
    }

    return NextResponse.json({ ok: true, url: publicUrl });
  } catch (err) {
    console.error('Portal upload error:', err);
    return fail('Internal server error', 500);
  }
}
