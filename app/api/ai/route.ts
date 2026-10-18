import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { extractWorkOrderFields } from '@/lib/wo-extract';
import { WO_AI_MODEL, buildWoPrompt, parseModelJson, sanitizeWoAi, filledCount, woAiSchema, aiFailureReason, type AiCustomField } from '@/lib/wo-ai';
import { normalizeFields } from '@/lib/custom-fields';
import { todayISO } from '@/lib/utils';
import type { WorkOrder } from '@/lib/types';
import { workspaceHeader } from '@/lib/anthropic-headers';

// POST /api/ai — "Generate with AI" on a new work order. Admin-only tool, not
// portal-token gated.
//
// Fixed 2026-10-02 (Fred: "it needs to look and fill in everything
// necessary"): it asked for a model that does not exist ('claude-sonnet-5'),
// so every request failed quietly and only the text parser's few fields came
// back. The prompt and the cleanup now live in lib/wo-ai.ts, tested, and cover
// every field on the form plus the tech's checklist.
//
// 2026-10-18 (Fred: "fill in every field on the work order"): the official SDK,
// the answer held to woAiSchema() (structured outputs) so it always parses, the
// contacts, questions and Fred's own fields included, and a refusal retried on
// the fallback model the API picks.
export async function POST(req: Request) {
  try {
    const supabase = await createClient('admin');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const jobDescription: string = String(body?.job_description || '').slice(0, 30_000);
    if (!jobDescription.trim()) return NextResponse.json({ error: 'Paste or describe the job first.' }, { status: 400 });
    // Fred's own job fields shown on the form (Settings -> Custom fields).
    const custom: AiCustomField[] = normalizeFields({ jobs: body?.custom_fields }).jobs
      .filter((d) => !d.hidden).slice(0, 30)
      .map(({ id, label, kind, options }) => ({ id, label, kind, options }));

    // The text parser always runs — it's the floor. With a working key the
    // model's answer is laid on top.
    const regexFields = extractWorkOrderFields(jobDescription);
    const floor = (why: string) =>
      NextResponse.json({ result: regexFields, source: 'text-parser', why, filled: filledCount(regexFields) });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return floor('no_key');

    let text = '';
    try {
      // An organization-wide key names its workspace (lib/anthropic-headers.ts).
      const client = new Anthropic({ apiKey, defaultHeaders: workspaceHeader() });
      const message = await client.beta.messages.create({
        model: WO_AI_MODEL,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { format: { type: 'json_schema', schema: woAiSchema(custom) } },
        messages: [{ role: 'user', content: buildWoPrompt(jobDescription, todayISO(), custom) }],
      });
      if (message.stop_reason === 'refusal') return floor('ai_refused');
      if (message.stop_reason === 'max_tokens') return floor('ai_cut_off');
      for (const block of message.content) if (block.type === 'text') text += block.text;
    } catch (err) {
      if (err instanceof Anthropic.APIError) {
        console.error('Anthropic error:', err.status, err.message.slice(0, 500));
        return floor(aiFailureReason(err.status ?? 0, err.message));
      }
      throw err;
    }

    const aiFields: Partial<WorkOrder> = sanitizeWoAi(parseModelJson(text), custom);
    if (Object.keys(aiFields).length === 0) return floor('ai_unreadable');

    // The model wins where it answered; the parser fills whatever it left out.
    const result = { ...regexFields, ...aiFields };
    return NextResponse.json({ result, source: 'ai', filled: filledCount(result), tasks: aiFields.wo_tasks?.length ?? 0 });
  } catch (err) {
    console.error('AI route error:', err);
    return NextResponse.json({ result: {}, source: 'error', filled: 0 });
  }
}
