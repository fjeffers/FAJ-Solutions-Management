import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { sanitizeVision } from '@/lib/survey-vision';
import { CAMERA_TYPES, CAMERA_MOUNTS } from '@/lib/types';
import { anthropicHeaders } from '@/lib/anthropic-headers';
import { ownerOnly } from '@/lib/security';

// POST /api/survey-vision — read a walk-through photo and SUGGEST the row.
//
// This is the assistant half of the survey. It looks at the picture a surveyor
// just took of a mounting spot and proposes what it can see: the kind of space,
// how the ceiling is built, a sensible mount, the pathway. The surveyor keeps
// or changes every field before anything is saved.
//
// Two rules it must not break:
//
//   1. NEVER a price. Money is the owner's judgement, not a guess from a photo.
//      unit_price is not in the allowlist and never will be.
//   2. NEVER invent. A photo of a ceiling does not say how far the closet is,
//      so cable_run stays null unless something in the frame actually shows it.
//
// Admin-only: session-gated like /api/ai, not reachable with a portal token.
const MODEL = 'claude-sonnet-5';

export async function POST(req: Request) {
  try {
    const supabase = await createClient('admin');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const denied = await ownerOnly(supabase);
    if (denied) return denied;

    const body = await req.json();
    const imageUrl: string = body?.image_url ?? '';
    const position: number = Number(body?.position) || 1;
    const noun: string = body?.noun === 'drop' ? 'drop' : 'camera';

    if (!imageUrl) return NextResponse.json({ error: 'Missing image_url' }, { status: 400 });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    // No key is not an error — the surveyor simply fills the row themselves.
    if (!apiKey) return NextResponse.json({ result: {}, source: 'no-key' });

    // Fetch the image server-side. The bucket is public, but going through the
    // server keeps the key here and lets a dead URL fail quietly.
    const img = await fetch(imageUrl);
    if (!img.ok) return NextResponse.json({ result: {}, source: 'image-unreadable' });

    const contentType = img.headers.get('content-type') ?? 'image/jpeg';
    if (!/^image\/(jpeg|png|webp|gif)$/.test(contentType)) {
      return NextResponse.json({ result: {}, source: 'unsupported-type' });
    }
    const bytes = Buffer.from(await img.arrayBuffer());
    // Anthropic caps images at 5MB base64; skip rather than fail loudly.
    if (bytes.byteLength > 3_500_000) {
      return NextResponse.json({ result: {}, source: 'image-too-large' });
    }

    const prompt = `You are helping a low-voltage field technician record a site survey. This photo was taken standing at the spot where ${noun} ${position} will be installed.

Describe ONLY what you can actually see. Return a JSON object (no markdown fences) with these keys, using null for anything the photo does not show:

{
  "location": string | null (what this space is, in a technician's words — e.g. "Lobby", "Office hallway", "Rear entry", "Network room". Short.),
  "camera_type": ${JSON.stringify([...CAMERA_TYPES])} | null (what would suit this space; a wide open lobby suits a Dome, a long corridor a Turret, a car park a PTZ),
  "mount": ${JSON.stringify([...CAMERA_MOUNTS])} | null (how it would physically go up HERE, based on the surfaces you can see),
  "placement": "Indoor" | "Outdoor" | null,
  "pathway_notes": string | null (how cable would get here, ONLY if visible — e.g. "Drop ceiling, accessible plenum", "Exposed deck, J-hooks needed", "Solid drywall ceiling, no access"),
  "materials_needed": string | null (mounting hardware this spot would need, only if the surfaces make it clear),
  "notes": string | null (one short line about anything that affects the install: obstructions, sightlines, ceiling height, glass, lighting)
}

Rules:
- Do NOT state a distance or cable length. A photo cannot tell you where the closet is.
- Do NOT guess a price, a model number, or a resolution.
- If the photo is unclear or is not of a building interior/exterior, return all nulls.
- Prefer null over a guess. A wrong answer costs the technician more than a blank.

Return only the JSON object.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: anthropicHeaders(apiKey),
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 700,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: contentType, data: bytes.toString('base64') },
            },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    });

    if (!response.ok) {
      console.error('Anthropic vision error:', response.status, await response.text());
      return NextResponse.json({ result: {}, source: 'error' });
    }

    const data = await response.json();
    const text: string = data.content?.[0]?.text ?? '{}';
    let result = {};
    try {
      result = sanitizeVision(JSON.parse(text.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim()));
    } catch {
      result = {};
    }

    return NextResponse.json({ result, source: 'ai' });
  } catch (err) {
    console.error('survey-vision route error:', err);
    return NextResponse.json({ result: {}, source: 'error' });
  }
}
