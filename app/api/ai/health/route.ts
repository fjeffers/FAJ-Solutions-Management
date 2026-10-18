import { NextResponse } from 'next/server';
import { WO_AI_MODEL, aiFailureReason, aiFailureText } from '@/lib/wo-ai';

// GET /api/ai/health — does the live site's Claude key work? (Fred,
// 2026-10-17: "Generate with AI needs fixing".) One tiny request with the same
// model Generate with AI uses; the answer is only "ok" or the reason code —
// never the key or Anthropic's raw reply.
export const dynamic = 'force-dynamic';

export async function GET() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ ok: false, why: 'no_key', says: aiFailureText('no_key') });
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: WO_AI_MODEL, max_tokens: 1, messages: [{ role: 'user', content: 'Say OK' }] }),
    });
    if (r.ok) return NextResponse.json({ ok: true, model: WO_AI_MODEL });
    const why = aiFailureReason(r.status, (await r.text()).slice(0, 500));
    return NextResponse.json({ ok: false, status: r.status, why, says: aiFailureText(why) });
  } catch {
    return NextResponse.json({ ok: false, why: 'unreachable' });
  }
}
