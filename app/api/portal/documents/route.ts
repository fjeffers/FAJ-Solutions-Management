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
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );

    // ── Contract signature, or typed W-9 details (JSON) ──
    if (contentType.includes('application/json')) {
      const body = await req.json();
      const { token, kind, signed_name } = body;

      // W-9 details the tech typed themselves. The RPC validates the TIN and
      // re-checks that this token belongs to the contractor, not a helper.
      if (kind === 'w9_details') {
        if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 });
        const { data, error } = await supabase.rpc('portal_submit_w9_details', {
          p_token: token,
          p_legal_name: body.legal_name ?? '',
          p_business_name: body.business_name ?? null,
          p_entity_type: body.entity_type ?? null,
          p_tax_id_type: body.tax_id_type ?? '',
          p_tax_id: body.tax_id ?? '',
          p_address: body.address ?? null,
          p_city: body.city ?? null,
          p_state: body.state ?? null,
          p_zip: body.zip ?? null,
          p_phone: body.phone ?? null,
          p_email: body.email ?? null,
          p_signed_name: signed_name ?? '',
          p_payment_method: body.payment_method ?? null,
          p_zelle_phone: body.zelle_phone ?? null,
          p_bank_name: body.bank_name ?? null,
          p_account_holder: body.account_holder ?? null,
          p_routing_number: body.routing_number ?? null,
          p_account_number: body.account_number ?? null,
          p_account_type: body.account_type ?? null,
        });
        if (error) return NextResponse.json({ error: error.message }, { status: 400 });
        if (data?.error) return NextResponse.json({ error: data.error }, { status: 400 });
        return NextResponse.json({ ok: true });
      }

      if (!token || kind !== 'contract') {
        return NextResponse.json({ error: 'Missing token or unsupported kind' }, { status: 400 });
      }
      if (!signed_name?.trim()) {
        return NextResponse.json({ error: 'Type your full name to sign' }, { status: 400 });
      }

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
