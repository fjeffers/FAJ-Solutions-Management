import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Photo, screenshot or PDF of a product, barcode or shelf label → { code, name }.
//
// The browser tries first: where BarcodeDetector exists it reads the barcode
// on-device, instantly and for free, and this route is never called. This is
// the fallback for the phones that do not have it (and for a label with no
// readable barcode at all, where the printed part number is the only clue).
const MODEL = 'claude-haiku-4-5';

const PROMPT = `Look at this image or document of a product, its barcode, or a shelf label. Return ONLY valid JSON (no markdown fences):
{
  "code": string | null (the barcode digits, UPC/EAN, or the printed SKU/part number — digits and dashes only),
  "name": string | null (the product name as printed, cleaned up, max 80 chars),
  "unit_cost": number | null (the shelf price in dollars, if one is visible)
}
Read only what is actually printed. If you cannot read a field, return null for it rather than guessing.`;

export async function POST(req: NextRequest) {
  const supabase = await createClient('admin');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      error: "Reading a photo needs the AI key, which isn't set up on this site yet. Use \"Scan barcode\" to read it with the camera instead — that runs on your phone and needs no key — or type the number in.",
    }, { status: 422 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file received.' }, { status: 400 });
  if (file.size > 15 * 1024 * 1024) return NextResponse.json({ error: 'That file is over 15MB — try a smaller one.' }, { status: 413 });

  // A photo, a screenshot and a PDF spec sheet are all the same job to us.
  const isPdf = file.type === 'application/pdf';
  const media = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type) ? file.type : 'image/jpeg';
  const b64 = Buffer.from(await file.arrayBuffer()).toString('base64');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: [
          isPdf
            ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
            : { type: 'image', source: { type: 'base64', media_type: media, data: b64 } },
          { type: 'text', text: PROMPT },
        ],
      }],
    }),
  });
  if (!res.ok) {
    console.error('[scan-item] Anthropic error:', res.status, await res.text());
    return NextResponse.json({ error: 'The scan failed — try again, or type the code in.' }, { status: 502 });
  }

  const data = await res.json();
  const text: string = data.content?.[0]?.text ?? '{}';
  let parsed: { code?: unknown; name?: unknown; unit_cost?: unknown } = {};
  try {
    parsed = JSON.parse(text.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim());
  } catch { /* fall through to empty */ }

  // Sanitize: a code is digits, letters and dashes, nothing else.
  const rawCode = typeof parsed.code === 'string' ? parsed.code : '';
  const code = rawCode.replace(/[^A-Za-z0-9-]/g, '').slice(0, 40) || null;
  const name = typeof parsed.name === 'string' ? parsed.name.trim().slice(0, 80) || null : null;
  const cost = Number(parsed.unit_cost);
  const unit_cost = isFinite(cost) && cost > 0 ? cost : null;

  if (!code && !name) {
    return NextResponse.json({ error: "Couldn't read a code or a name off that photo — try a closer shot, or type the code in." }, { status: 422 });
  }
  return NextResponse.json({ code, name, unit_cost });
}
