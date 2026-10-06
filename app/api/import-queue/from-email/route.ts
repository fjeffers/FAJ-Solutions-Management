import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { createClient } from '@/lib/supabase/server';
import { parsePastedEmail } from '@/lib/email-parsers/pasted';

// Paste or upload an email → import_queue → review → work order.
//
// The Gmail integration needs a redirect URI registered in Google Cloud Console,
// which is still outstanding, so the automatic import can't run. This is the
// manual door into the same pipeline: the parsed result is queued as 'pending'
// and nothing reaches work_orders until it's approved, exactly like a fetched
// email.
//
// Accepts either JSON `{ raw }` from the paste box, or multipart with a `file`
// (.eml / .txt / .msg exported as text) for a dragged-in message.

export const dynamic = 'force-dynamic';

const MAX_BYTES = 2 * 1024 * 1024;

export async function POST(req: Request) {
  const supabase = await createClient('admin');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // ── Get the raw text, whichever way it arrived ──
  let raw = '';
  const contentType = req.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    raw = String((await req.json())?.raw ?? '');
  } else {
    const form = await req.formData();
    const file = form.get('file') as File | null;
    if (file) {
      if (file.size > MAX_BYTES) {
        return NextResponse.json({ error: 'That file is larger than 2MB.' }, { status: 400 });
      }
      raw = await file.text();
    } else {
      raw = String(form.get('raw') ?? '');
    }
  }

  if (!raw.trim()) {
    return NextResponse.json({ error: 'Nothing to import — paste the email first.' }, { status: 400 });
  }

  const parsed = parsePastedEmail(raw);
  if (!parsed) {
    return NextResponse.json({ error: "Couldn't read anything usable out of that." }, { status: 422 });
  }

  const { jobs, matched } = parsed;

  // One queue row per job. A go-back list covers a run of sites — the real one
  // that prompted this carried eighteen — and each is its own work order.
  const source = matched === 'netview' ? 'netview_smartsheet'
    : matched === 'fieldnation' ? 'field_nation'
    : 'google_docs';

  const rows = jobs.map((fields) => {
    // Dedupe per job, so re-pasting the list after Karen adds a site queues only
    // the new one instead of eighteen duplicates. Site + ticket identifies a
    // job; without either, fall back to a hash of that job's own text.
    const identity = fields.client_reference || fields.external_wo_id
      ? `${fields.client_reference}:${fields.external_wo_id}`
      : createHash('sha1').update(`${fields.title}\n${fields.description}`).digest('hex');

    return {
      user_id: user.id,
      source,
      external_dedupe_key: `pasted:${identity}`,
      parsed_fields: fields,
      raw_snippet: `${fields.title}\n${fields.site_address ?? ''}\n${fields.description}`.slice(0, 500),
      status: 'pending',
    };
  });

  const { data: inserted, error } = await supabase
    .from('import_queue')
    .upsert(rows, { onConflict: 'user_id,source,external_dedupe_key', ignoreDuplicates: true })
    .select('id');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // ignoreDuplicates returns only what was actually added, so the difference is
  // what was already queued. Report both rather than claiming a clean success.
  const added = inserted?.length ?? 0;
  return NextResponse.json({
    ok: true,
    matched,
    found: jobs.length,
    added,
    duplicates: jobs.length - added,
    sites: jobs.map((j) => j.client_reference).filter(Boolean),
  });
}
