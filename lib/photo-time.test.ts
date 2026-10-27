import { describe, it, expect } from 'vitest';
import { readExif, photoTime, photoTakenAt, pictureGps } from './photo-time';

/** A JPEG's first bytes with an EXIF block: IFD0 → Exif IFD (times) and GPS IFD, in either byte order. */
function jpegWithExif(o: { le?: boolean; date?: string; offset?: string; gps?: { lat: [number, number, number]; latRef: string; lng: [number, number, number]; lngRef: string } }): ArrayBuffer {
  const le = o.le ?? true;
  const t: number[] = [];
  const u16 = (n: number) => (le ? [n & 0xff, n >> 8] : [n >> 8, n & 0xff]);
  const u32 = (n: number) => (le ? [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, n >>> 24] : [n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);
  const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0)).concat(0);
  // Layout: header(8) IFD0 at 8 with 2 entries (2+24+4=30) → Exif IFD at 38, GPS IFD after, then data.
  const exifEntries: [number, number[]][] = [];
  if (o.date) exifEntries.push([0x9003, ascii(o.date)]);
  if (o.offset) exifEntries.push([0x9011, ascii(o.offset)]);
  const exifAt = 38;
  const exifSize = 2 + exifEntries.length * 12 + 4;
  const gpsAt = exifAt + exifSize;
  const gpsCount = o.gps ? 4 : 0;
  const gpsSize = 2 + gpsCount * 12 + 4;
  let data = gpsAt + gpsSize;
  const blobs: number[] = [];
  const entry = (tag: number, type: number, count: number, bytes: number[]) => {
    if (bytes.length <= 4) return [...u16(tag), ...u16(type), ...u32(count), ...bytes, ...Array(4 - bytes.length).fill(0)];
    const at = data;
    data += bytes.length;
    blobs.push(...bytes);
    return [...u16(tag), ...u16(type), ...u32(count), ...u32(at)];
  };
  t.push(...(le ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8));
  t.push(...u16(2), ...entry(0x8769, 4, 1, u32(exifAt)), ...entry(0x8825, 4, 1, u32(gpsAt)), ...u32(0));
  t.push(...u16(exifEntries.length));
  for (const [tag, bytes] of exifEntries) t.push(...entry(tag, 2, bytes.length, bytes));
  t.push(...u32(0));
  t.push(...u16(gpsCount));
  if (o.gps) {
    const rat = (d: [number, number, number]) => d.flatMap((x) => [...u32(Math.round(x * 100)), ...u32(100)]);
    t.push(...entry(0x0001, 2, 2, ascii(o.gps.latRef)), ...entry(0x0002, 5, 3, rat(o.gps.lat)),
      ...entry(0x0003, 2, 2, ascii(o.gps.lngRef)), ...entry(0x0004, 5, 3, rat(o.gps.lng)));
  }
  t.push(...u32(0), ...blobs);
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...t];
  const bytes = [0xff, 0xd8, 0xff, 0xe1, ...[(app1.length + 2) >> 8, (app1.length + 2) & 0xff], ...app1, 0xff, 0xda, 0, 2];
  return new Uint8Array(bytes).buffer;
}

const NOW = Date.parse('2026-10-26T23:00:00Z');
const TZ = 'America/New_York';

describe('when and where a photo was taken', () => {
  it("reads the camera's time and GPS, in either byte order", () => {
    for (const le of [true, false]) {
      const e = readExif(jpegWithExif({ le, date: '2026:10:26 07:31:05', gps: { lat: [40, 41, 18.24], latRef: 'N', lng: [75, 13, 14.52], lngRef: 'W' } }));
      expect(e.wall).toBe('2026-10-26T07:31:05');
      expect(e.offset).toBeNull();
      expect(e.gps!.lat).toBeCloseTo(40.6884, 4);
      expect(e.gps!.lng).toBeCloseTo(-75.2207, 4);
    }
  });

  it("a camera time with no zone is the business's clock; with one, that zone", () => {
    const local = photoTime(readExif(jpegWithExif({ date: '2026:10:26 07:31:05' })), null, NOW, TZ);
    expect(local).toEqual({ at: '2026-10-26T11:31:05.000Z', from: 'camera', gps: null });
    const zoned = photoTime(readExif(jpegWithExif({ date: '2026:10:26 07:31:05', offset: '-05:00' })), null, NOW, TZ);
    expect(zoned.at).toBe('2026-10-26T12:31:05.000Z');
  });

  it("with no camera time, the file's date when it is clearly earlier; an iPhone's pick time says nothing", () => {
    const none = readExif(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]).buffer);
    expect(photoTime(none, Date.parse('2026-10-26T11:00:00Z'), NOW, TZ)).toEqual({ at: '2026-10-26T11:00:00.000Z', from: 'file', gps: null });
    expect(photoTime(none, NOW - 30_000, NOW, TZ).at).toBeNull();
    expect(photoTime(none, null, NOW, TZ).at).toBeNull();
  });

  it('never a time in the future, or over a year back', () => {
    expect(photoTime(readExif(jpegWithExif({ date: '2026:10:28 07:31:05' })), null, NOW, TZ).at).toBeNull();
    expect(photoTime(readExif(jpegWithExif({ date: '2024:10:26 07:31:05' })), null, NOW, TZ).at).toBeNull();
    expect(photoTime(readExif(jpegWithExif({ date: '0000:00:00 00:00:00' })), null, NOW, TZ).at).toBeNull();
  });

  it('anything that is not a JPEG with EXIF gives nothing', () => {
    expect(readExif(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer)).toEqual({ wall: null, offset: null, gps: null });
    expect(readExif(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 8, 0x45, 0x78, 0x69, 0x66, 0, 0]).buffer)).toEqual({ wall: null, offset: null, gps: null });
  });

  it("every picture's GPS: a phone photo's own, else where the phone is as it's added, else none (Fred, 2026-10-27)", async () => {
    const withGps = new File([jpegWithExif({ date: '2026:10:26 07:31:05', gps: { lat: [40, 41, 18.24], latRef: 'N', lng: [75, 13, 14.52], lngRef: 'W' } })], 'a.jpg', { type: 'image/jpeg' });
    const without = new File([jpegWithExif({ date: '2026:10:26 07:31:05' })], 'b.jpg', { type: 'image/jpeg' });
    const phone = { lat: 40.7, lng: -75.3, accuracy: 12 };
    const own = await pictureGps(withGps, true, async () => phone);
    expect(own!.whenAdded).toBe(false);
    expect(own!.pos.lat).toBeCloseTo(40.6884, 4);
    expect(await pictureGps(without, true, async () => phone)).toEqual({ pos: phone, whenAdded: true });
    // A photo just taken goes by where the phone is, whatever the file says.
    expect(await pictureGps(withGps, false, async () => phone)).toEqual({ pos: phone, whenAdded: false });
    expect(await pictureGps(without, true, async () => null)).toBeNull();
    expect(await pictureGps(without, false, async () => null)).toBeNull();
  });

  it("a Count or Measure copy keeps the original photo's GPS, read before the marks (Greptile on PR #28)", async () => {
    const copy = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2])], 'count.jpg', { type: 'image/jpeg' });
    const original = { lat: 40.6884, lng: -75.2207, accuracy: null };
    expect(await pictureGps(copy, true, async () => null, original)).toEqual({ pos: original, whenAdded: false });
    // The original had none: where the phone is now, said so.
    const phone = { lat: 40.7, lng: -75.3, accuracy: 12 };
    expect(await pictureGps(copy, true, async () => phone, null)).toEqual({ pos: phone, whenAdded: true });
  });

  it('reads the picked file itself', async () => {
    const file = new File([jpegWithExif({ date: '2026:10:26 07:31:05' })], 'odo.jpg', { type: 'image/jpeg', lastModified: NOW });
    expect(await photoTakenAt(file, TZ, NOW)).toEqual({ at: '2026-10-26T11:31:05.000Z', from: 'camera', gps: null });
  });
});
