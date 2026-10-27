// The AI call behind reading a photo (lib/photo-read.ts), shared by the tech's
// /api/tech/read-photo and the office's /api/jobs/read-photo. Server only.
// With no key, or when the AI can't read it, the result is empty and the
// person types it in (or the office reads the photo).
import Anthropic from '@anthropic-ai/sdk';
import { workspaceHeader } from './anthropic-headers';
import { PHOTO_READ_MODEL, photoPrompt, photoSchema, sanitizeOdometer, sanitizeReceipt, sanitizeSort, type PhotoKind } from './photo-read';
import { parseModelJson } from './wo-ai';

export type AiPhotoRead = { result: unknown; source: 'ai' | 'unreadable' | 'no-key' | 'error' };

export async function aiReadPhoto(kind: PhotoKind, jpeg: Blob, today: string): Promise<AiPhotoRead> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { result: null, source: 'no-key' };
  try {
    const client = new Anthropic({ apiKey, defaultHeaders: workspaceHeader() });
    const message = await client.beta.messages.create({
      model: PHOTO_READ_MODEL,
      max_tokens: 400,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { format: { type: 'json_schema', schema: photoSchema(kind) } },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: Buffer.from(await jpeg.arrayBuffer()).toString('base64') } },
          { type: 'text', text: photoPrompt(kind, today) },
        ],
      }],
    });
    if (message.stop_reason === 'refusal' || message.stop_reason === 'max_tokens') return { result: null, source: 'unreadable' };
    let text = '';
    for (const block of message.content) if (block.type === 'text') text += block.text;
    const raw = parseModelJson(text);
    const result = kind === 'odometer' ? sanitizeOdometer(raw) : kind === 'sort' ? sanitizeSort(raw) : sanitizeReceipt(raw, today);
    return { result, source: 'ai' };
  } catch (err) {
    if (err instanceof Anthropic.APIError) console.error('read-photo AI error:', err.status, err.message.slice(0, 300));
    else console.error('read-photo error:', err);
    return { result: null, source: 'error' };
  }
}
