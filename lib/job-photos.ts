// Saving a job's pictures to the device, and the day the office's pictures go
// on (Fred, 2026-10-26: "still unable to download photo or add them"). Pure and
// unit-tested; components/AddJobPhotos.tsx, the job's Photos and the job log
// use it.

/**
 * A link that saves the picture instead of opening it. A link's `download`
 * name only works on the app's own address, and the pictures are in Supabase
 * Storage, which sends a file as a download when its link has
 * ?download=<name> (public and signed links alike). Any other link is left as
 * it is.
 */
export function downloadHref(url: string, name: string): string {
  if (!/\/storage\/v1\/object\//.test(url)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}download=${encodeURIComponent(name)}`;
}

/**
 * "WO 19101401 Materials Lowe's $104.17 Paul Gibbs 10-21-2026.jpg": the parts
 * given, without what a file name can't have (a comma would also split the name
 * in the download's header).
 */
export function photoFileName(parts: (string | null | undefined)[], ext = 'jpg'): string {
  const name = parts.map((p) => (p ?? '').trim()).filter(Boolean).join(' ')
    .replace(/(\d),(\d)/g, '$1$2').replace(/[,:]\s/g, ' ')
    .replace(/[\\/:*?"<>|,]+/g, '-').replace(/\s+/g, ' ').trim();
  return `${name || 'photo'}.${ext}`;
}

/** A picture's own kind of file, from its link (a receipt can be a PNG or a PDF): "png". */
export function fileExt(url: string, fallback = 'jpg'): string {
  const ext = url.split('?')[0].match(/\.([a-z0-9]{2,5})$/i)?.[1].toLowerCase();
  return ext && /^(jpe?g|png|gif|webp|heic|pdf)$/.test(ext) ? ext : fallback;
}

/**
 * The day a picture the office adds goes on, to start with: today while the
 * job is on, else its first day (a job already done, or one not started yet).
 */
export function photoDay(start: string | null | undefined, end: string | null | undefined, today: string): string {
  const first = (start ?? '').slice(0, 10);
  const last = (end ?? '').slice(0, 10) || first;
  if (!first) return today;
  return today >= first && today <= last ? today : first;
}
