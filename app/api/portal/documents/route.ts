import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// POST /api/portal/documents — a tech files their own onboarding paperwork.
//
// Two kinds:
//   w9       FormData: token, kind=w9, file        → uploads and marks received
//   contract JSON:     { token, kind:'contract', signed_name } → records the signature
//
// Authorization is NOT done here. portal_submit_document resolves the token
// itself and refuses anything that isn't kind='contractor', so a helper link
// cannot file a tax form or sign an agreement on the tech's behalf. This route
// only moves the file.
//
// W-9s carry a tax ID, so they go to the private `contractor-docs` bucket and are
// only ever referenced by path — never a public URL.
export async function POST(req: Request) {
  try {
    const contentType = req.headers.get('content-type') ?? '';

    // ── Contract signature (JSON) ──
    if (contentType.includes('application/json')) {
      const { token, kind, signed_name } = await req.json();
      if (!token || kind !== 'contract') {
        return NextResponse.json({ error: 'Missing token or unsupported kind' }, { status: 400 });
      }
      if (!signed_name?.trim()) {
        return NextResponse.json({ error: 'Type your full name to sign' }, { status: 400 });
      }

      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      );

      const { data, error } = await supabase.rpc('portal_submit_document', {
        p_token: token,
        p_kind: 'contract',
        p_value: null,
        p_signed_name: signed_name.trim(),
      });

      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      if (data?.error) return NextResponse.json({ error: data.error }, { status: 403 });
      return NextResponse.json({ ok: true });
    }

    // ── W-9 upload (multipart) ──
    const formData = await req.formData();
    const token = formData.get('token') as string | null;
    const kind = formData.get('kind') as string | null;
    const file = formData.get('file') as File | null;

    if (!token || kind !== 'w9' || !file) {
      return NextResponse.json({ error: 'Missing token, kind, or file' }, { status: 400 });
    }
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'File is larger than 10MB' }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );

    // Path is keyed by the token so one tech can never overwrite another's form.
    const safeExt = file.name.split('.').pop()?.replace(/[^a-z0-9]/gi, '') ?? 'pdf';
    const path = `w9/${token}/${Date.now()}.${safeExt}`;

    const uint8 = new Uint8Array(await file.arrayBuffer());
    const { error: upErr } = await supabase.storage
      .from('contractor-docs')
      .upload(path, uint8, { contentType: file.type || 'application/pdf', upsert: false });

    if (upErr) {
      console.error('W-9 upload error:', upErr);
      return NextResponse.json({ error: upErr.message }, { status: 500 });
    }

    // The RPC re-checks the token and that this is the contractor, not a helper.
    const { data, error } = await supabase.rpc('portal_submit_document', {
      p_token: token,
      p_kind: 'w9',
      p_value: path,
      p_signed_name: null,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (data?.error) return NextResponse.json({ error: data.error }, { status: 403 });

    return NextResponse.json({ ok: true, path });
  } catch (err) {
    console.error('Portal documents error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
