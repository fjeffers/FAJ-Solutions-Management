import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// PATCH /api/portal/update
// Body: { token, wo_id, field: 'wo_tasks'|'custom_qa'|'closeout_notes'|'doc_urls_append', value }
export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const { token, wo_id, field, value } = body;

    if (!token || !wo_id || !field || value === undefined) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );

    const { error } = await supabase.rpc('save_portal_data', {
      p_token: token,
      p_wo_id: wo_id,
      p_field: field,
      p_value: typeof value === 'string' ? JSON.parse(value) : value,
    });

    if (error) {
      console.error('save_portal_data error:', error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Portal update error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
