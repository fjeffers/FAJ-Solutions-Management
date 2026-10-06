import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { extractWorkOrderFields } from '@/lib/wo-extract';
import { WO_AI_MODEL, buildWoPrompt, parseModelJson, sanitizeWoAi, filledCount } from '@/lib/wo-ai';
import { todayISO } from '@/lib/utils';
import type { WorkOrder } from '@/lib/types';

// POST /api/ai — "Generate with AI" on a new work order. Admin-only tool, not
// portal-token gated.
//
// Fixed 2026-10-02 (Fred: "it needs to look and fill in everything
// necessary"): it asked for a model that does not exist ('claude-sonnet-5'),
// so every request failed quietly and only the text parser's few fields came
// back. The prompt and the cleanup now live in lib/wo-ai.ts, tested, and cover
// every field on the form plus the tech's checklist.
export async function POST(req: Request) {
  try {
    const supabase = await createClient('admin');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const jobDescription: string = String(body?.job_description || '').slice(0, 30_000);
    if (!jobDescription.trim()) return NextResponse.json({ error: 'Paste or describe the job first.' }, { status: 400 });

    // The text parser always runs — it's the floor. With a working key the
    // model's answer is laid on top.
    const regexFields = extractWorkOrderFields(jobDescription);
    const floor = (why: string) =>
      NextResponse.json({ result: regexFields, source: 'text-parser', why, filled: filledCount(regexFields) });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return floor('no_key');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: WO_AI_MODEL,
        max_tokens: 4000,
        messages: [{ role: 'user', content: buildWoPrompt(jobDescription, todayISO()) }],
      }),
    });
    if (!response.ok) {
      console.error('Anthropic error:', response.status, (await response.text()).slice(0, 500));
      return floor(`ai_${response.status}`);
    }

    const data = await response.json();
    const text: string = (data.content ?? []).map((c: { type?: string; text?: string }) => (c.type === 'text' ? c.text ?? '' : '')).join('');
    const aiFields: Partial<WorkOrder> = sanitizeWoAi(parseModelJson(text));
    if (Object.keys(aiFields).length === 0) return floor('ai_unreadable');

    // The model wins where it answered; the parser fills whatever it left out.
    const result = { ...regexFields, ...aiFields };
    return NextResponse.json({ result, source: 'ai', filled: filledCount(result), tasks: aiFields.wo_tasks?.length ?? 0 });
  } catch (err) {
    console.error('AI route error:', err);
    return NextResponse.json({ result: {}, source: 'error', filled: 0 });
  }
}
