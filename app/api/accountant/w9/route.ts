import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

// GET /api/accountant/w9?contractor=<id> — the accountant opens one tech's W-9.
//
// W-9 files carry SSNs and live in the private contractor-docs bucket. Their
// path embeds the tech's portal token, so it never goes to the browser: this
// route checks the caller IS an accountant (acct_me, run as them), looks the
// path up for their business only, makes a link that lasts two minutes,
// records the view in Fred's activity log, and redirects.
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('contractor') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Bad request' }, { status: 400 });

  const supabase = await createClient();
  const { data: me } = await supabase.rpc('acct_me');
  const ctx = me as { owner_id?: string; name?: string } | null;
  if (!ctx?.owner_id) return NextResponse.json({ error: 'Not an accountant login' }, { status: 403 });

  const admin = createAdminClient();
  const { data: c } = await admin
    .from('contractors')
    .select('id, name, w9_file_path')
    .eq('id', id)
    .eq('user_id', ctx.owner_id)
    .maybeSingle();
  if (!c?.w9_file_path) return NextResponse.json({ error: 'No W-9 file on record for this tech' }, { status: 404 });

  const { data: signed, error } = await admin.storage.from('contractor-docs').createSignedUrl(c.w9_file_path, 120);
  if (error || !signed?.signedUrl) return NextResponse.json({ error: 'Could not open the file' }, { status: 500 });

  await admin.from('audit_log').insert({
    user_id: ctx.owner_id, action: 'view', entity_type: 'w9', entity_id: c.id,
    details: { label: `${ctx.name ?? 'Accountant'} opened the W-9 for ${c.name}`, by_assistant: ctx.name ?? 'Accountant', role: 'accountant' },
  });

  return NextResponse.redirect(signed.signedUrl);
}
