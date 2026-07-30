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
  const supabase = await createClient();
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

  const { fields, matched, email } = parsed;

  // Dedupe on the content itself. Pasting the same email twice — easy to do when
  // you're working through an inbox by hand — must not create two work orders.
  // A site + ticket pair identifies a dispatch; otherwise fall back to the body.
  const identity = fields.client_reference || fields.external_wo_id
    ? `${fields.client_reference}:${fields.external_wo_id}`
    : createHash('sha1').update(`${email.subject}\n${email.body}`).digest('hex');

  const { data: inserted, error } = await supabase
    .from('import_queue')
    .upsert({
      user_id: user.id,
      // Reuse the existing source values so ImportQueueView labels it correctly;
      // a generic paste is closest to an internal doc.
      source: matched === 'netview' ? 'netview_smartsheet'
        : matched === 'fieldnation' ? 'field_nation'
        : 'google_docs',
      external_dedupe_key: `pasted:${identity}`,
      parsed_fields: fields,
      raw_snippet: `${email.subject}\n${email.body}`.slice(0, 500),
      status: 'pending',
    }, { onConflict: 'user_id,source,external_dedupe_key', ignoreDuplicates: true })
    .select('id');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // ignoreDuplicates returns nothing when it was already queued — say so plainly
  // rather than reporting a success that didn't add anything.
  if (!inserted || inserted.length === 0) {
    return NextResponse.json({ ok: true, duplicate: true, matched });
  }

  return NextResponse.json({ ok: true, duplicate: false, matched, id: inserted[0].id, fields });
}
