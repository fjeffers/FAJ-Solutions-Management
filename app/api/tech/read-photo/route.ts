import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { aiReadPhoto } from '@/lib/photo-read-ai';
import type { PhotoKind } from '@/lib/photo-read';
import { todayISO } from '@/lib/utils';

// POST /api/tech/read-photo — AI reads an odometer or a receipt photo for the
// tech, to fill in the form (lib/photo-read.ts). FormData: wo_number, kind
// ('odometer' | 'receipt', or 'sort' for a photo picked from the phone: is it
// the odometer, and its reading), file (JPEG).
//
// Only for a tech on their own live job (wf_tech_photo_target). Nothing is
// stored here: the tech checks the numbers, then sends the photo with them
// (/api/tech/odometer, /api/tech/expense). With no key, or when the AI can't
// read it, the answer is empty and the tech types it in.
const MAX_BYTES = 4 * 1024 * 1024;

export async function POST(req: Request) {
  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 }); }
  const woNumber = String(form.get('wo_number') ?? '').trim();
  const kind = String(form.get('kind') ?? '') as PhotoKind;
  const file = form.get('file');
  if (!woNumber || !['odometer', 'receipt', 'sort'].includes(kind)) return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 });
  if (!(file instanceof Blob) || file.size === 0) return NextResponse.json({ ok: false, error: 'Take the photo first.' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ ok: false, error: 'That photo is too large to send.' }, { status: 413 });
  if (file.type && file.type !== 'image/jpeg') return NextResponse.json({ ok: false, error: 'It must be a photo.' }, { status: 415 });

  const supabase = await createClient('field');
  const { data: target } = await supabase.rpc('wf_tech_photo_target', { p_wo_number: woNumber });
  if (!(target as { wo_id?: string } | null)?.wo_id) return NextResponse.json({ ok: false, error: 'This job is closed or not yours.' }, { status: 403 });

  const r = await aiReadPhoto(kind, file, todayISO());
  return NextResponse.json({ ok: true, result: r.result, source: r.source });
}
