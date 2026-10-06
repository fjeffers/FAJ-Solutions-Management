import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { parseReceiptText, type ReceiptItem } from '@/lib/receipt';

// Receipt → line items. Two doors:
//   JSON  { text }  — regex parser, works with no AI key (emailed receipts)
//   multipart file  — photo/PDF via Claude vision; needs ANTHROPIC_API_KEY
const MODEL = 'claude-haiku-4-5';

function sanitizeItems(raw: unknown): ReceiptItem[] {
  if (!Array.isArray(raw)) return [];
  const out: ReceiptItem[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const name = String((r as Record<string, unknown>).name ?? '').trim().slice(0, 120);
    const quantity = Number((r as Record<string, unknown>).quantity);
    const unit_cost = Number((r as Record<string, unknown>).unit_cost);
    if (!name || isNaN(quantity) || quantity <= 0 || isNaN(unit_cost) || unit_cost < 0) continue;
    out.push({ name, quantity, unit_cost });
  }
  return out.slice(0, 60);
}

const PROMPT = `Read this store receipt and extract the purchased line items. Return ONLY valid JSON (no markdown fences):
{
  "vendor": string | null (store name),
  "items": [ { "name": string (item description, cleaned up), "quantity": number, "unit_cost": number (price PER UNIT in dollars) } ]
}
Rules: exclude subtotal/tax/total/payment/change lines. If a line shows quantity and extended price, divide to get unit_cost. Never invent items that are not on the receipt.`;

export async function POST(req: NextRequest) {
  const supabase = await createClient('admin');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const contentType = req.headers.get('content-type') ?? '';

  // ── Pasted text: free, instant, no AI needed ────────────────────────────────
  if (contentType.includes('application/json')) {
    const body = await req.json().catch(() => ({}));
    const text: string = body?.text ?? '';
    if (!text.trim()) return NextResponse.json({ error: 'Paste the receipt text first.' }, { status: 400 });
    const { items, vendor } = parseReceiptText(text);
    if (items.length === 0) {
      return NextResponse.json({ error: "Couldn't find priced items in that text — each item needs a price like 3.98 at the end of its line." }, { status: 422 });
    }
    return NextResponse.json({ vendor, items, source: 'text-parser' });
  }

  // ── Photo / PDF: Claude vision ──────────────────────────────────────────────
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      error: "Reading a receipt image or PDF needs the AI key, which isn't set up on this site yet. Paste the receipt TEXT into the box instead — that works right now and needs no key.",
    }, { status: 422 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file received.' }, { status: 400 });
  if (file.size > 15 * 1024 * 1024) return NextResponse.json({ error: 'That file is over 15MB — try a smaller photo.' }, { status: 413 });

  const isPdf = file.type === 'application/pdf';
  const media = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type) ? file.type : (isPdf ? null : 'image/jpeg');
  const b64 = Buffer.from(await file.arrayBuffer()).toString('base64');

  const content = [
    isPdf
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
      : { type: 'image', source: { type: 'base64', media_type: media, data: b64 } },
    { type: 'text', text: PROMPT },
  ];

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 2000, messages: [{ role: 'user', content }] }),
  });
  if (!res.ok) {
    console.error('[from-receipt] Anthropic error:', res.status, await res.text());
    return NextResponse.json({ error: 'The scan failed — try again, or paste the receipt text instead.' }, { status: 502 });
  }
  const data = await res.json();
  const text: string = data.content?.[0]?.text ?? '{}';
  let parsed: { vendor?: unknown; items?: unknown } = {};
  try {
    parsed = JSON.parse(text.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim());
  } catch { /* fall through to empty */ }
  const items = sanitizeItems(parsed.items);
  if (items.length === 0) {
    return NextResponse.json({ error: "Couldn't read any items off that receipt — try a clearer photo, or paste the text." }, { status: 422 });
  }
  const vendor = typeof parsed.vendor === 'string' ? parsed.vendor.slice(0, 60) : null;
  return NextResponse.json({ vendor, items, source: 'ai' });
}
