// When and where a photo was taken, from the photo itself (Fred, 2026-10-26:
// "if I take a picture on my phone and then upload later on"). The camera
// writes the time it was taken (EXIF DateTimeOriginal) into the JPEG, and often
// the GPS too; a photo picked from the phone later keeps them, so a mileage
// photo taken while the app was down is saved at the time it was taken, not
// when it was added. Read before the photo is stamped: stamping redraws it
// and drops the EXIF. Pure and unit-tested (lib/photo-time.test.ts).
import { zonedIso } from './clock-fix';
import type { Position } from './geo';

export type Exif = {
  /** "2026-10-26T07:31:05", the camera's clock, no zone. */
  wall: string | null;
  /** "-04:00" when the camera wrote its zone (OffsetTimeOriginal). */
  offset: string | null;
  gps: Position | null;
};

const NONE: Exif = { wall: null, offset: null, gps: null };

/** The time and GPS written in a JPEG, from its first bytes. Anything else (HEIC, a PNG, a broken file) gives nothing. */
export function readExif(buf: ArrayBuffer): Exif {
  const v = new DataView(buf);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return NONE;
  let p = 2;
  while (p + 4 <= v.byteLength) {
    if (v.getUint8(p) !== 0xff) return NONE;
    const marker = v.getUint8(p + 1);
    const size = v.getUint16(p + 2);
    // APP1 with "Exif\0\0"; the picture data (SOS) means there is none.
    if (marker === 0xe1 && p + 10 <= v.byteLength && v.getUint32(p + 4) === 0x45786966 && v.getUint16(p + 8) === 0) {
      try { return readTiff(v, p + 10, Math.min(v.byteLength, p + 2 + size)); } catch { return NONE; }
    }
    if (marker === 0xda || size < 2) return NONE;
    p += 2 + size;
  }
  return NONE;
}

function readTiff(v: DataView, start: number, end: number): Exif {
  const order = v.getUint16(start);
  if (order !== 0x4949 && order !== 0x4d4d) return NONE;
  const le = order === 0x4949;
  const u16 = (o: number) => v.getUint16(start + o, le);
  const u32 = (o: number) => v.getUint32(start + o, le);
  const within = (o: number, n: number) => o >= 0 && start + o + n <= end;
  if (!within(0, 8) || u16(2) !== 42) return NONE;

  /** An IFD's entries by tag: where each value is (inline or at an offset), its type and count. */
  const ifd = (o: number) => {
    const tags = new Map<number, { type: number; count: number; at: number }>();
    if (!within(o, 2)) return tags;
    const n = u16(o);
    for (let i = 0; i < n && within(o + 2 + i * 12, 12); i++) {
      const e = o + 2 + i * 12;
      const type = u16(e + 2);
      const count = u32(e + 4);
      const bytes = count * ({ 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 } as Record<number, number>)[type] || 0;
      tags.set(u16(e), { type, count, at: bytes <= 4 ? e + 8 : u32(e + 8) });
    }
    return tags;
  };
  const text = (t?: { type: number; count: number; at: number }) => {
    if (!t || t.type !== 2 || !within(t.at, t.count)) return null;
    let s = '';
    for (let i = 0; i < t.count; i++) { const c = v.getUint8(start + t.at + i); if (c === 0) break; s += String.fromCharCode(c); }
    return s.trim() || null;
  };
  const ptr = (t?: { type: number; at: number }) => (t && (t.type === 4 || t.type === 3) ? (t.type === 4 ? u32(t.at) : u16(t.at)) : null);
  const rationals = (t?: { type: number; count: number; at: number }) => {
    if (!t || t.type !== 5 || t.count < 3 || !within(t.at, 24)) return null;
    const out: number[] = [];
    for (let i = 0; i < 3; i++) { const d = u32(t.at + i * 8 + 4); out.push(d ? u32(t.at + i * 8) / d : NaN); }
    return out.every(Number.isFinite) ? out : null;
  };

  const ifd0 = ifd(u32(4));
  const exifAt = ptr(ifd0.get(0x8769));
  const sub = exifAt != null ? ifd(exifAt) : new Map();
  // DateTimeOriginal, else DateTimeDigitized, else the file's DateTime.
  const raw = text(sub.get(0x9003)) ?? text(sub.get(0x9004)) ?? text(ifd0.get(0x0132));
  const m = raw ? /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(raw) : null;
  const wall = m && m[1] !== '0000' ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}` : null;
  const off = text(sub.get(0x9011)) ?? text(sub.get(0x9012));
  const offset = off && /^[+-]\d{2}:\d{2}$/.test(off) ? off : null;

  let gps: Position | null = null;
  const gpsAt = ptr(ifd0.get(0x8825));
  if (gpsAt != null) {
    const g = ifd(gpsAt);
    const lat = rationals(g.get(0x0002));
    const lng = rationals(g.get(0x0004));
    const latRef = text(g.get(0x0001));
    const lngRef = text(g.get(0x0003));
    if (lat && lng) {
      const deg = (d: number[]) => d[0] + d[1] / 60 + d[2] / 3600;
      const la = deg(lat) * (latRef === 'S' ? -1 : 1);
      const ln = deg(lng) * (lngRef === 'W' ? -1 : 1);
      if (Math.abs(la) <= 90 && Math.abs(ln) <= 180 && (la !== 0 || ln !== 0)) gps = { lat: la, lng: ln, accuracy: null };
    }
  }
  return { wall, offset, gps };
}

export type PhotoTime = {
  /** When the photo was taken, as an ISO time; null when the photo doesn't say. */
  at: string | null;
  /** 'camera': written by the camera; 'file': the file's own date (Android keeps it). */
  from: 'camera' | 'file' | null;
  gps: Position | null;
};

/**
 * When a photo was taken: the camera's time (in its own zone when it wrote one,
 * else the business's), else the file's date when that is clearly earlier than
 * now (an iPhone gives the time it was picked, which says nothing). Never in the
 * future, never over a year back.
 */
export function photoTime(exif: Exif, lastModified: number | null, now: number, timeZone: string): PhotoTime {
  const ok = (ms: number) => Number.isFinite(ms) && ms <= now + 5 * 60_000 && ms >= now - 366 * 86_400_000;
  let at: number | null = null;
  if (exif.wall) {
    const ms = exif.offset
      ? Date.parse(`${exif.wall}${exif.offset}`)
      : Date.parse(zonedIso(exif.wall.slice(0, 10), exif.wall.slice(11, 16), timeZone) ?? '') + Number(exif.wall.slice(17, 19)) * 1000;
    if (ok(ms)) at = ms;
  }
  if (at != null) return { at: new Date(at).toISOString(), from: 'camera', gps: exif.gps };
  if (lastModified != null && ok(lastModified) && lastModified < now - 2 * 60_000) {
    return { at: new Date(lastModified).toISOString(), from: 'file', gps: exif.gps };
  }
  return { at: null, from: null, gps: exif.gps };
}

/** When and where the photo in hand was taken (the browser's File; only its first bytes are read). */
export async function photoTakenAt(file: Blob, timeZone = 'America/New_York', now = Date.now()): Promise<PhotoTime> {
  let exif = NONE;
  try { exif = readExif(await file.slice(0, 256 * 1024).arrayBuffer()); } catch { /* no EXIF */ }
  const lm = typeof (file as File).lastModified === 'number' ? (file as File).lastModified : null;
  return photoTime(exif, lm, now, timeZone);
}

/** Mileage older than this is added by the office: the app keeps a tap's own time only for two days (wf_trusted_time). */
export const PHOTO_MILEAGE_MAX_AGE_MS = 47 * 3600_000;
