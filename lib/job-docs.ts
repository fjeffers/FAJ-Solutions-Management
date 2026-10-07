// Documents on a job (migrations 115–116): scans and PDFs techs send from the
// field, and PDFs added in the office — some shared with the job's techs to
// sign or fill in. Shared by the tech app, the office job page and
// /api/tech/doc.
import { pdfName } from './doc-scan';

/** What a document can be. /api/tech/doc only files these. */
export const DOC_KINDS = [
  'Signed work order', 'Signed document', 'Work order', 'Receipt', 'Site sheet', 'Permit', 'Drawing', 'Card', 'Other',
] as const;

export const isDocKind = (k: string) => (DOC_KINDS as readonly string[]).includes(k);

/** "Work order" → "Work order (edited)", for a copy changed in the office. */
export const editedName = (name: string) => (/\((signed|edited)\)$/i.test(name.trim()) ? name.trim() : `${name.trim()} (edited)`).slice(0, 120);

/** "Work order" → "Work order (signed)"; doesn't stack "(signed) (signed)". */
export const signedName = (name: string) => (/\((signed|edited)\)$/i.test(name.trim()) ? name.trim() : `${name.trim()} (signed)`).slice(0, 120);

/** Bigger than this goes straight to storage (a server request carries ~4.5 MB at most). */
const DIRECT_MAX = 4 * 1024 * 1024;
const NO_SIGNAL = 'No signal. Try again when you have signal, or tap Save to keep it on your phone.';

async function postJson(body: Record<string, unknown>): Promise<{ ok?: boolean; error?: string; path?: string; token?: string }> {
  const res = await fetch('/api/tech/doc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; path?: string; token?: string };
  return res.ok ? json : { ok: false, error: json.error ?? "Couldn't send the document." };
}

/**
 * A tech sends a finished PDF to their job. Resolves ok when it's filed;
 * otherwise says why (no signal → keep it on the phone).
 */
export async function sendTechDoc(woNumber: string, pdf: Blob, name: string, kind: string, pages: number): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (pdf.size > DIRECT_MAX) {
      const start = await postJson({ step: 'start', wo_number: woNumber });
      if (!start.ok || !start.path || !start.token) return { ok: false, error: start.error ?? "Couldn't send the document." };
      const { createClient } = await import('./supabase/client');
      const { error } = await createClient().storage.from('job-docs').uploadToSignedUrl(start.path, start.token, pdf, { contentType: 'application/pdf' });
      if (error) return { ok: false, error: "Couldn't send the document. Try again." };
      const done = await postJson({ step: 'finish', wo_number: woNumber, path: start.path, name, kind, pages });
      return done.ok ? { ok: true } : { ok: false, error: done.error ?? "Couldn't send the document." };
    }
    const fd = new FormData();
    fd.append('wo_number', woNumber);
    fd.append('file', new File([pdf], pdfName(name), { type: 'application/pdf' }));
    fd.append('name', name);
    fd.append('kind', kind);
    fd.append('pages', String(pages));
    const res = await fetch('/api/tech/doc', { method: 'POST', body: fd });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !json.ok) return { ok: false, error: json.error ?? "Couldn't send the document." };
    return { ok: true };
  } catch {
    return { ok: false, error: NO_SIGNAL };
  }
}
