// Safety boundary for /api/survey-vision (the photo reader).
//
// A model looking at a photo may return anything. Everything it says passes
// through here before it can reach a survey row, so:
//
//   * only fields on the allowlist survive — unit_price is NOT on it and never
//     will be, because money is the owner's judgement, not a guess from a photo
//   * only values from the real vocabularies survive, so a made-up camera type
//     cannot land in a dropdown that has no such option
//   * anything else is dropped silently rather than shown as a bad suggestion
import { CAMERA_TYPES, CAMERA_MOUNTS } from './types';

export const VISION_KEYS = [
  'location', 'camera_type', 'mount', 'placement',
  'pathway_notes', 'materials_needed', 'notes',
] as const;

export type VisionKey = (typeof VISION_KEYS)[number];
export type VisionSuggestion = Partial<Record<VisionKey, string>>;

export function sanitizeVision(raw: unknown): VisionSuggestion {
  if (!raw || typeof raw !== 'object') return {};
  const out: VisionSuggestion = {};

  for (const key of VISION_KEYS) {
    const v = (raw as Record<string, unknown>)[key];
    if (typeof v !== 'string') continue;
    const trimmed = v.trim();
    if (!trimmed || trimmed.toLowerCase() === 'null') continue;

    if (key === 'camera_type' && !(CAMERA_TYPES as readonly string[]).includes(trimmed)) continue;
    if (key === 'mount' && !(CAMERA_MOUNTS as readonly string[]).includes(trimmed)) continue;
    if (key === 'placement' && trimmed !== 'Indoor' && trimmed !== 'Outdoor') continue;

    out[key] = trimmed.slice(0, 400);
  }
  return out;
}
