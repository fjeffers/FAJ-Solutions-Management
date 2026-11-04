// A work order sent to Generate with AI as a file — a PDF, or a picture of one
// (Fred, 2026-10-24: "If you look at the PDF ... these are some of the things
// that it should basically pull from it"). Checked here before it goes to the model.

export type JobFile = { kind: 'pdf'; data: string } | { kind: 'image'; media: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'; data: string };
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
/** About 3 MB of file, as base64. */
const FILE_MAX = 4_200_000;

/** A work order sent as a file: { type, data } with data in base64 (no data: prefix). Null when it isn't one we can read. */
export function jobFile(raw: unknown): JobFile | null {
  if (!raw || typeof raw !== 'object') return null;
  const { type, data } = raw as { type?: unknown; data?: unknown };
  if (typeof data !== 'string' || !data || data.length > FILE_MAX || !/^[A-Za-z0-9+/=]+$/.test(data)) return null;
  if (type === 'application/pdf') return { kind: 'pdf', data };
  const media = IMAGE_TYPES.find((t) => t === type);
  return media ? { kind: 'image', media, data } : null;
}


/** Most files one Generate with AI can read at once. */
export const FILES_MAX = 5;

// More than one file per job (Fred, 2026-11-02: "i can only upload ond file not two"):
// e.g. the work order PDF plus a photo of the SOW. All of them together stay under the 3 MB limit.
/** The files sent with a job: a list, or one file the old way. Null when any of them can't be read. */
export function jobFiles(raw: unknown): JobFile[] | null {
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  if (list.length > FILES_MAX) return null;
  const files = list.map(jobFile);
  if (files.some((f) => !f)) return null;
  const ok = files as JobFile[];
  return ok.reduce((n, f) => n + f.data.length, 0) > FILE_MAX ? null : ok;
}
