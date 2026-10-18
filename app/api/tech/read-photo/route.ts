import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { workspaceHeader } from '@/lib/anthropic-headers';
import { PHOTO_READ_MODEL, photoPrompt, photoSchema, sanitizeOdometer, sanitizeReceipt, type PhotoKind } from '@/lib/photo-read';
import { parseModelJson } from '@/lib/wo-ai';
import { todayISO } from '@/lib/utils';

// POST /api/tech/read-photo — AI reads an odometer or a receipt photo for the
// tech, to fill in the form (lib/photo-read.ts). FormData: wo_number, kind
// ('odometer' | 'receipt'), file (JPEG).
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
  if (!woNumber || (kind !== 'odometer' && kind !== 'receipt')) return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 });
  if (!(file instanceof Blob) || file.size === 0) return NextResponse.json({ ok: false, error: 'Take the photo first.' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ ok: false, error: 'That photo is too large to send.' }, { status: 413 });
  if (file.type && file.type !== 'image/jpeg') return NextResponse.json({ ok: false, error: 'It must be a photo.' }, { status: 415 });

  const supabase = await createClient('field');
  const { data: target } = await supabase.rpc('wf_tech_photo_target', { p_wo_number: woNumber });
  if (!(target as { wo_id?: string } | null)?.wo_id) return NextResponse.json({ ok: false, error: 'This job is closed or not yours.' }, { status: 403 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ ok: true, result: null, source: 'no-key' });

  const today = todayISO();
  try {
    const client = new Anthropic({ apiKey, defaultHeaders: workspaceHeader() });
    const message = await client.beta.messages.create({
      model: PHOTO_READ_MODEL,
      max_tokens: 400,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { format: { type: 'json_schema', schema: photoSchema(kind) } },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: Buffer.from(await file.arrayBuffer()).toString('base64') } },
          { type: 'text', text: photoPrompt(kind, today) },
        ],
      }],
    });
    if (message.stop_reason === 'refusal' || message.stop_reason === 'max_tokens') return NextResponse.json({ ok: true, result: null, source: 'unreadable' });
    let text = '';
    for (const block of message.content) if (block.type === 'text') text += block.text;
    const raw = parseModelJson(text);
    const result = kind === 'odometer' ? sanitizeOdometer(raw) : sanitizeReceipt(raw, today);
    return NextResponse.json({ ok: true, result, source: 'ai' });
  } catch (err) {
    if (err instanceof Anthropic.APIError) console.error('read-photo AI error:', err.status, err.message.slice(0, 300));
    else console.error('read-photo error:', err);
    // The tech types it in; the photo still goes with the reading.
    return NextResponse.json({ ok: true, result: null, source: 'error' });
  }
}
