import type { SupabaseClient } from '@supabase/supabase-js';

export type SimplySubSourceDocument = { name?: unknown; url?: unknown; category?: unknown };

const safeDocName = (value: unknown, url: string) => {
  const fromUrl = decodeURIComponent(new URL(url).pathname.split('/').pop() || 'SimplySub document.pdf');
  const supplied = typeof value === 'string' ? value.trim() : '';
  const name = supplied && !/^\*+\s*workorder\s*\*+$/i.test(supplied) ? supplied : fromUrl;
  return name.replace(/[^\w .()&,'-]/g, '').slice(0, 116).replace(/\.pdf$/i, '') + '.pdf';
};

/** Copies supported source PDFs into FAJ's private job library. Source URLs remain as a fallback. */
export async function copySimplySubPdfs(
  supabase: SupabaseClient,
  docs: SimplySubSourceDocument[],
  userId: string,
  woId: string,
) {
  let copied = 0;
  for (const [index, doc] of docs.slice(0, 20).entries()) {
    const rawUrl = typeof doc.url === 'string' ? doc.url : '';
    let url: URL;
    try { url = new URL(rawUrl); } catch { continue; }
    if (url.protocol !== 'https:' || url.hostname !== 'cdn.simplysub.com') continue;
    try {
      const res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
      const length = Number(res.headers.get('content-length') || 0);
      const isPdf = res.headers.get('content-type')?.toLowerCase().includes('application/pdf') || /\.pdf$/i.test(url.pathname);
      if (!res.ok || !isPdf || length > 15_000_000) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length === 0 || bytes.length > 15_000_000 || String.fromCharCode(...bytes.slice(0, 4)) !== '%PDF') continue;
      const name = safeDocName(doc.name, rawUrl);
      const path = `${userId}/${woId}/simplysub-${Date.now()}-${index}.pdf`;
      const { error: uploadError } = await supabase.storage.from('job-docs').upload(path, bytes, {
        contentType: 'application/pdf',
        upsert: false,
      });
      if (uploadError) continue;
      const kind = typeof doc.category === 'string' ? doc.category.slice(0, 40) : 'SimplySub';
      const { error: rowError } = await supabase.from('job_docs').insert({
        user_id: userId, wo_id: woId, path, name, kind, bytes: bytes.length, sent_by: 'SimplySub import',
      });
      if (rowError) {
        await supabase.storage.from('job-docs').remove([path]);
        continue;
      }
      copied += 1;
    } catch {
      // Source files are best-effort. The original URL remains on the work order.
    }
  }
  return copied;
}
