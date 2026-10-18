import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { workspaceHeader } from '@/lib/anthropic-headers';
import { aiFailureReason } from '@/lib/wo-ai';
import { SUMMARY_MODEL, summaryPrompt, type summaryFacts } from '@/lib/weekly-bill';

// POST /api/ai/weekly-summary — the AI writes the short summary at the top of
// the weekly bill (Fred, 2026-10-18: "Write the weekly summary"), from the
// numbers and the flags the bill already worked out (lib/weekly-bill.ts,
// summaryFacts). Fred reads and edits it before he sends anything.
// Office only, session-gated like /api/ai.
export async function POST(req: Request) {
  const supabase = await createClient('admin');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let facts: ReturnType<typeof summaryFacts>;
  try { facts = (await req.json())?.facts; } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }); }
  if (!facts || !Array.isArray(facts.sites) || JSON.stringify(facts).length > 60_000) return NextResponse.json({ error: 'Bad request' }, { status: 400 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ text: '', why: 'no_key' });
  try {
    const client = new Anthropic({ apiKey, defaultHeaders: workspaceHeader() });
    const message = await client.beta.messages.create({
      model: SUMMARY_MODEL,
      max_tokens: 900,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      messages: [{ role: 'user', content: summaryPrompt(facts) }],
    });
    if (message.stop_reason === 'refusal') return NextResponse.json({ text: '', why: 'ai_refused' });
    let text = '';
    for (const block of message.content) if (block.type === 'text') text += block.text;
    return NextResponse.json({ text: text.trim().slice(0, 4000) });
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      console.error('weekly-summary AI error:', err.status, err.message.slice(0, 300));
      return NextResponse.json({ text: '', why: aiFailureReason(err.status ?? 0, err.message) });
    }
    console.error('weekly-summary error:', err);
    return NextResponse.json({ text: '', why: 'error' });
  }
}
