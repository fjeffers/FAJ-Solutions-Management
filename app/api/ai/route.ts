import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { extractWorkOrderFields } from '@/lib/wo-extract';
import type { WorkOrder } from '@/lib/types';

// Admin-only tool — not portal-token gated.
const MODEL = 'claude-sonnet-5';

// Keys the model may fill. Anything else it returns is dropped before the
// result reaches the browser, so a malformed response can't inject fields.
const ALLOWED_KEYS = [
  'title', 'description', 'deliverable_instructions', 'tools_required',
  'site_name', 'site_address', 'site_city', 'site_state', 'site_zip',
  'customer_name', 'project_name',
  'total_amount', 'pay_type', 'hourly_rate', 'per_device_rate', 'device_count',
  'start_date', 'end_date', 'start_time', 'end_time',
  'priority', 'service_type', 'required_skills',
  'poc_name', 'poc_phone', 'poc_email',
] as const;

function sanitize(raw: unknown): Partial<WorkOrder> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, unknown> = {};
  for (const key of ALLOWED_KEYS) {
    const v = (raw as Record<string, unknown>)[key];
    if (v === null || v === undefined || v === '') continue;
    out[key] = v;
  }
  // Numeric fields sometimes come back as strings — coerce
  for (const nk of ['total_amount', 'hourly_rate', 'per_device_rate', 'device_count'] as const) {
    if (out[nk] !== undefined) {
      const n = Number(out[nk]);
      if (isNaN(n)) delete out[nk]; else out[nk] = n;
    }
  }
  return out as Partial<WorkOrder>;
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const jobDescription: string = body?.job_description || '';
    if (!jobDescription) return NextResponse.json({ error: 'Missing job_description' }, { status: 400 });

    // Regex extraction always runs — it's the floor. With a working API key the
    // model's answer is layered on top; without one this alone fills address,
    // price, dates, and contact info.
    const regexFields = extractWorkOrderFields(jobDescription);

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ result: regexFields, source: 'text-parser' });
    }

    const today = new Date().toISOString().split('T')[0];
    const prompt = `You are a work order intake assistant for a field services company. Extract structured fields from the job request below. Return ONLY a valid JSON object (no markdown fences) with these keys — use null for anything the text does not state; NEVER invent values:

{
  "title": string (short summary, max 60 chars),
  "description": string (scope of work, cleaned up),
  "deliverable_instructions": string | null (photos, sign-offs, closeout requirements),
  "tools_required": string | null,
  "site_name": string | null (business/location name, e.g. "Wendy's #4821"),
  "site_address": string | null (street address only),
  "site_city": string | null,
  "site_state": string | null (2-letter code),
  "site_zip": string | null,
  "customer_name": string | null (the client being billed),
  "project_name": string | null,
  "total_amount": number | null (fixed job price in dollars),
  "pay_type": "Fixed" | "Hourly" | "Per Device" | null,
  "hourly_rate": number | null,
  "per_device_rate": number | null,
  "device_count": number | null,
  "start_date": string | null (YYYY-MM-DD; today is ${today} — resolve relative dates like "next Tuesday"),
  "end_date": string | null (YYYY-MM-DD),
  "start_time": string | null (HH:MM 24-hour),
  "end_time": string | null (HH:MM 24-hour),
  "priority": "Low" | "Normal" | "High" | "Critical" | "Emergency" | null,
  "service_type": string | null (e.g. "Network / IT", "Low Voltage", "Electrical"),
  "required_skills": string | null,
  "poc_name": string | null (on-site point of contact),
  "poc_phone": string | null,
  "poc_email": string | null
}

Job request:
"""
${jobDescription}
"""

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
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      console.error('Anthropic error:', response.status, await response.text());
      return NextResponse.json({ result: regexFields, source: 'text-parser' });
    }

    const data = await response.json();
    const text: string = data.content?.[0]?.text ?? '{}';
    let aiFields: Partial<WorkOrder> = {};
    try {
      aiFields = sanitize(JSON.parse(text.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim()));
    } catch {
      aiFields = {};
    }

    // Model wins where it answered; regex fills whatever it left null.
    return NextResponse.json({ result: { ...regexFields, ...aiFields }, source: 'ai' });
  } catch (err) {
    console.error('AI route error:', err);
    return NextResponse.json({ result: {}, source: 'error' });
  }
}
