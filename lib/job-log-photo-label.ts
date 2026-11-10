export type JobLogPhotoKind = 'photo' | 'odometer' | 'receipt' | 'hotel' | 'rental' | 'fuel';
export type JobLogPhotoLabel = { kind: JobLogPhotoKind; vendor: string | null };

const decoded = (value: string) => {
  try { return decodeURIComponent(value); } catch { return value; }
};

export function jobLogPhotoLabel(labels: Iterable<string>, id: string): JobLogPhotoLabel {
  const values = new Set(labels);
  if (values.has(id)) return { kind: 'receipt', vendor: null };
  if (values.has(`odo:${id}`)) return { kind: 'odometer', vendor: null };
  for (const kind of ['hotel', 'rental', 'fuel'] as const) {
    const legacy = `${kind}:${id}`;
    if (values.has(legacy)) return { kind, vendor: null };
    const suffix = `:${id}`;
    const prefix = `${kind}:`;
    const found = [...values].find((value) => value.startsWith(prefix) && value.endsWith(suffix));
    if (found) return { kind, vendor: decoded(found.slice(prefix.length, -suffix.length)) || null };
  }
  return { kind: 'photo', vendor: null };
}

export function jobLogPhotoLabelKey(kind: Exclude<JobLogPhotoKind, 'photo'>, id: string, vendor?: string | null) {
  if (kind === 'receipt') return id;
  if (kind === 'odometer') return `odo:${id}`;
  return vendor?.trim() ? `${kind}:${encodeURIComponent(vendor.trim())}:${id}` : `${kind}:${id}`;
}

export function isJobLogPhotoLabel(value: string, id: string) {
  return value === id || value === `odo:${id}` || value === `hotel:${id}` || value === `rental:${id}` || value === `fuel:${id}`
    || ((value.startsWith('hotel:') || value.startsWith('rental:') || value.startsWith('fuel:')) && value.endsWith(`:${id}`));
}
