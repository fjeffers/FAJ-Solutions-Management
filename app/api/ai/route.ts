import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { extractWorkOrderFields } from '@/lib/wo-extract';
import { WO_AI_MODEL, buildWoPrompt, parseModelJson, sanitizeWoAi, filledCount, aiFailureReason, type AiCustomField, type AiTemplate } from '@/lib/wo-ai';
import { linksInText, mergeLinks } from '@/lib/client-links';
import { normalizeFields } from '@/lib/custom-fields';
import { todayISO } from '@/lib/utils';
import type { WorkOrder } from '@/lib/types';
import { workspaceHeader } from '@/lib/anthropic-headers';
import { jobFile } from '@/lib/job-file';

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
// the contacts, questions and Fred's own fields included, and a refusal retried
// on the fallback model the API picks.
//
// Later the same day: no strict answer layout (structured outputs). The service
// refused it, first for too many "may be empty" fields, then with "the compiled
// grammar is too large", so every Generate with AI fell back to the text parser.
// The prompt lists every key; parseModelJson finds the JSON and sanitizeWoAi
// keeps only what the form understands, as before.
//
// 2026-10-24 (Fred: "If you look at the PDF ... these are some of the things
// that it should basically pull from it"): the work order can come as a file
// too — a PDF, or a picture of one — sent to the model with the text.
export async function POST(req: Request) {
  try {
    const supabase = await createClient('admin');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const jobDescription: string = String(body?.job_description || '').slice(0, 30_000);
    const file = jobFile(body?.file);
    if (body?.file && !file) return NextResponse.json({ error: 'That file can’t be read. Send a PDF or a photo (JPG, PNG) under 3 MB.' }, { status: 400 });
    if (!jobDescription.trim() && !file) return NextResponse.json({ error: 'Paste or describe the job first.' }, { status: 400 });
    // Fred's own job fields shown on the form (Settings -> Custom fields).
    const custom: AiCustomField[] = normalizeFields({ jobs: body?.custom_fields }).jobs
      .filter((d) => !d.hidden).slice(0, 30)
      .map(({ id, label, kind, options }) => ({ id, label, kind, options }));
    // Fred's job templates (Settings -> Job templates): the AI picks the one that fits.
    const templates: AiTemplate[] = (Array.isArray(body?.templates) ? body.templates : [])
      .filter((t: unknown): t is AiTemplate => !!t && typeof (t as AiTemplate).id === 'string' && typeof (t as AiTemplate).name === 'string')
      .slice(0, 20).map((t: AiTemplate) => ({ id: t.id.slice(0, 40), name: t.name.slice(0, 60) }));

    // The text parser always runs — it's the floor. With a working key the
    // model's answer is laid on top.
    // Every link in the paste goes to Client links, with or without the AI (Fred, 2026-10-18).
    const pastedLinks = linksInText(jobDescription);
    const regexFields = { ...extractWorkOrderFields(jobDescription), ...(pastedLinks.length ? { client_links: pastedLinks } : {}) };
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
        messages: [{
          role: 'user',
          content: [
            ...(file ? [file.kind === 'pdf'
              ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: file.data } }
              : { type: 'image' as const, source: { type: 'base64' as const, media_type: file.media, data: file.data } }] : []),
            { type: 'text' as const, text: buildWoPrompt(file ? `${jobDescription}\n\n(The work order is in the attached ${file.kind === 'pdf' ? 'PDF' : 'picture'}: read every page of it.)`.trim() : jobDescription, todayISO(), custom, templates) },
          ],
        }],
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

    const aiFields: Partial<WorkOrder> & { template?: string } = sanitizeWoAi(parseModelJson(text), custom, templates);
    if (Object.keys(aiFields).length === 0) return floor('ai_unreadable');

    // The model wins where it answered; the parser fills whatever it left out.
    const result = { ...regexFields, ...aiFields, client_links: mergeLinks(aiFields.client_links ?? [], pastedLinks) };
    return NextResponse.json({ result, source: 'ai', filled: filledCount(result), tasks: aiFields.wo_tasks?.length ?? 0 });
  } catch (err) {
    console.error('AI route error:', err);
    return NextResponse.json({ result: {}, source: 'error', filled: 0 });
  }
}
