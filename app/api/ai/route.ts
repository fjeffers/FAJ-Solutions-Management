import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

// Admin-only tool — not portal-token gated.
const MODEL = 'claude-sonnet-5';

type GeneratedWO = {
  title: string;
  scope_of_work: string;
  description: string;
  special_instructions: string;
  estimated_hours: number;
  tools_required: string;
  site_name: string;
  priority: string;
  source: string;
};

function fallback(jobDescription: string): GeneratedWO {
  const description = jobDescription.slice(0, 400).trim();
  const title = description.split('\n')[0].slice(0, 60) || 'Work Order';
  return {
    title,
    scope_of_work: description,
    description,
    special_instructions: '',
    estimated_hours: 4,
    tools_required: 'Standard tools required',
    site_name: '',
    priority: 'medium',
    source: 'direct_client',
  };
}

function parseModelJSON(text: string, jobDescription: string): GeneratedWO {
  try {
    const clean = text.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
    return JSON.parse(clean);
  } catch {
    return fallback(jobDescription);
  }
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const jobDescription: string = body?.job_description || '';
    if (!jobDescription) return NextResponse.json({ error: 'Missing job_description' }, { status: 400 });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    // Always return 200 with a usable (fallback if needed) result — a missing/misconfigured
    // key must never break work order creation.
    if (!apiKey) {
      return NextResponse.json({ result: fallback(jobDescription) });
    }

    const prompt = `You are a work order expert for a field services company. Given a job request, extract structured fields and return ONLY valid JSON (no markdown fences) matching this exact shape:
{
  "title": string (short, max 60 chars),
  "scope_of_work": string,
  "description": string,
  "special_instructions": string,
  "estimated_hours": number,
  "tools_required": string,
  "site_name": string,
  "priority": "low" | "medium" | "high",
  "source": "direct_client" | "referral" | "repeat_customer" | "other"
}

Job Request: "${jobDescription}"

Return only the JSON object.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      console.error('Anthropic error:', response.status, await response.text());
      return NextResponse.json({ result: fallback(jobDescription) });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text ?? '{}';
    return NextResponse.json({ result: parseModelJSON(text, jobDescription) });
  } catch (err) {
    console.error('AI route error:', err);
    // Still 200 — see fallback() rationale above.
    return NextResponse.json({ result: fallback('') });
  }
}
