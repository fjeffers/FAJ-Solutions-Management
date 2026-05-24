import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// POST /api/portal/upload
// FormData: token, wo_id, file (binary)
export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const token  = formData.get('token')  as string | null;
    const wo_id  = formData.get('wo_id')  as string | null;
    const file   = formData.get('file')   as File   | null;

    if (!token || !wo_id || !file) {
      return NextResponse.json({ error: 'Missing token, wo_id, or file' }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );

    // Verify the token is valid
    const { data: contractor, error: ctErr } = await supabase
      .from('contractors')
      .select('id, user_id')
      .eq('portal_token', token)
      .single();

    if (ctErr || !contractor) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 403 });
    }

    // Build a safe file path: wo_{wo_id}/{timestamp}_{safename}
    const safeExt  = file.name.split('.').pop()?.replace(/[^a-z0-9]/gi, '') ?? 'bin';
    const safeName = `${Date.now()}.${safeExt}`;
    const path     = `wo_${wo_id}/${safeName}`;

    const arrayBuffer = await file.arrayBuffer();
    const uint8       = new Uint8Array(arrayBuffer);

    const { error: upErr } = await supabase.storage
      .from('portal-uploads')
      .upload(path, uint8, {
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      });

    if (upErr) {
      console.error('Storage upload error:', upErr);
      return NextResponse.json({ error: upErr.message }, { status: 500 });
    }

    const { data: { publicUrl } } = supabase.storage
      .from('portal-uploads')
      .getPublicUrl(path);

    // Append URL to the work order's doc_urls
    const { error: saveErr } = await supabase.rpc('save_portal_data', {
      p_token: token,
      p_wo_id: wo_id,
      p_field: 'doc_urls_append',
      p_value: { url: publicUrl },
    });

    if (saveErr) {
      console.error('save_portal_data append error:', saveErr);
      // File uploaded successfully but couldn't save URL — return URL anyway
    }

    return NextResponse.json({ ok: true, url: publicUrl });
  } catch (err) {
    console.error('Portal upload error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
