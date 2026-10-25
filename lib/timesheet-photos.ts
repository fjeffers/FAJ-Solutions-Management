// The pictures that go in the timesheet PDF (lib/timesheet.ts): each day's
// odometer photos, the approved receipts and the site photos, shrunk in the
// browser to small JPEGs so a week of pictures still makes a PDF that can be
// emailed or attached to a QuickBooks invoice.
import type { SupabaseClient } from '@supabase/supabase-js';
import { dayOf } from './project-day';
import { expenseCategoryLabel } from './expenses';
import type { TimesheetPhoto } from './timesheet';

const TZ = 'America/New_York';
/** Enough for a few weeks of a crew's pictures; past this the PDF gets too big to email. */
export const PHOTO_MAX = 80;

export type PhotoSource = { day: string; tech: string; caption: string; url: string; order: number };

const time = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
const inDates = (d: string, from: string, to: string) => d >= from && d <= to;

/**
 * Where each picture is and what it says, oldest first: odometer, then receipts,
 * then the site photos when `site` (Fred, 2026-10-25: "Don't delete it. Just
 * don't include it in the time report" — the photos stay on the job either way).
 */
export async function photoSources(db: SupabaseClient, woId: string, from: string, to: string, { site = true }: { site?: boolean } = {}): Promise<PhotoSource[]> {
  const [od, ex, ph] = await Promise.all([
    db.from('job_odometer').select('contractor_name, at, moment, reading, photo_path').eq('wo_id', woId).order('at'),
    db.from('job_expenses').select('contractor_name, category, vendor, amount, expense_date, status, receipt_path').eq('wo_id', woId),
    site ? db.from('wo_photos').select('url, taken_at, contractor_name').eq('wo_id', woId).order('taken_at') : { data: [] },
  ]);
  const odo = ((od.data ?? []) as { contractor_name: string; at: string; moment: string; reading: number; photo_path: string | null }[])
    .filter((o) => o.photo_path && inDates(dayOf(o.at, TZ), from, to));
  const receipts = ((ex.data ?? []) as { contractor_name: string | null; category: string; vendor: string | null; amount: number; expense_date: string; status: string; receipt_path: string | null }[])
    .filter((e) => e.status === 'approved' && e.receipt_path && inDates(e.expense_date, from, to));
  const paths = [...odo.map((o) => o.photo_path!), ...receipts.map((e) => e.receipt_path!)];
  const signed = new Map<string, string>();
  if (paths.length) {
    const { data } = await db.storage.from('job-receipts').createSignedUrls(paths, 60 * 10);
    for (const x of data ?? []) if (x.path && x.signedUrl) signed.set(x.path, x.signedUrl);
  }
  const out: PhotoSource[] = [];
  for (const o of odo) {
    const url = signed.get(o.photo_path!);
    if (url) out.push({ day: dayOf(o.at, TZ), tech: o.contractor_name, url, order: 0,
      caption: `Odometer ${o.moment === 'end' ? 'end' : 'start'} of drive: ${Number(o.reading).toLocaleString('en-US')} · ${time(o.at)}` });
  }
  for (const e of receipts) {
    const url = signed.get(e.receipt_path!);
    if (url) out.push({ day: e.expense_date, tech: e.contractor_name ?? '', url, order: 1,
      caption: `Receipt · ${expenseCategoryLabel(e.category)}${e.vendor ? `, ${e.vendor}` : ''}: $${Number(e.amount).toFixed(2)}` });
  }
  for (const p of (ph.data ?? []) as { url: string; taken_at: string; contractor_name: string | null }[]) {
    const day = dayOf(p.taken_at, TZ);
    if (inDates(day, from, to)) out.push({ day, tech: p.contractor_name ?? '', url: p.url, order: 2, caption: `Site photo · ${time(p.taken_at)}` });
  }
  return out.sort((a, b) => a.day.localeCompare(b.day) || a.tech.localeCompare(b.tech) || a.order - b.order);
}

/** A picture made small: at most `max` pixels on its long side, as a JPEG. Null when it isn't a picture (a PDF receipt) or won't load. */
export async function smallJpeg(url: string, max = 1100): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const bmp = await createImageBitmap(await res.blob(), { imageOrientation: 'from-image' });
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', 0.72));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

/** The pictures for the PDF, shrunk; onProgress counts them as they're done. */
export async function timesheetPhotos(sources: PhotoSource[], onProgress?: (done: number, of: number) => void): Promise<{ photos: TimesheetPhoto[]; skipped: number }> {
  const list = sources.slice(0, PHOTO_MAX);
  const photos: TimesheetPhoto[] = [];
  let skipped = sources.length - list.length;
  for (const [i, s] of list.entries()) {
    const jpeg = await smallJpeg(s.url);
    if (jpeg) photos.push({ day: s.day, tech: s.tech, caption: s.caption, jpeg }); else skipped++;
    onProgress?.(i + 1, list.length);
  }
  return { photos, skipped };
}
