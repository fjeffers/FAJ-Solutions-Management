import { createHash } from 'crypto';
import { NextResponse } from 'next/server';
import { ownerOnly } from '@/lib/security';
import { parseSimplySubPackage } from '@/lib/simplysub';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const supabase = await createClient('admin');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const denied = await ownerOnly(supabase);
  if (denied) return denied;

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'Choose the SimplySub JSON package.' }, { status: 400 });
  if (file.size > 2_000_000) return NextResponse.json({ error: 'That package is too large.' }, { status: 413 });

  let json: unknown;
  try { json = JSON.parse(await file.text()); }
  catch { return NextResponse.json({ error: 'That package is not valid JSON.' }, { status: 400 }); }

  let fields;
  try { fields = parseSimplySubPackage(json, String(form?.get('deliverable_link') ?? '')); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not read that package.' }, { status: 422 }); }

  const key = createHash('sha256').update(`simplysub:${fields.external_wo_id}`).digest('hex');
  const { data: existing } = await supabase.from('import_queue').select('id, status').eq('user_id', user.id).eq('external_dedupe_key', key).maybeSingle();
  if (existing) return NextResponse.json({ imported: 0, duplicate: true, status: existing.status });

  const { error } = await supabase.from('import_queue').insert({
    user_id: user.id,
    source: 'simplysub',
    external_dedupe_key: key,
    parsed_fields: fields,
    raw_snippet: `SimplySub job ${fields.external_wo_id} · ${(fields.source_documents ?? []).length} source document(s)`,
    status: 'pending',
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ imported: 1, documents: fields.source_documents?.length ?? 0, tasks: fields.wo_tasks?.length ?? 0 });
}
