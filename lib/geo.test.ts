import { afterEach, describe, expect, it, vi } from 'vitest';
import { fmtCoords, mapLink, fmtStampTime, stampLines, milesBetween, getPosition, gpsMessage, noGpsMessage } from './geo';

describe('where and when on a job photo', () => {
  const at = new Date('2026-10-03T00:31:07Z'); // 8:31:07 PM in Easton

  it('reads the time the way people do, in the local zone', () => {
    expect(fmtStampTime(at, 'America/New_York')).toBe('Fri, Oct 2, 2026 · 8:31:07 PM EDT');
  });

  it('prints the job, the date and time, and the GPS', () => {
    expect(stampLines({
      woNumber: '19101390', title: "Wendy's Easton", at, timeZone: 'America/New_York',
      pos: { lat: 40.6884, lng: -75.2207, accuracy: 11.6 },
    })).toEqual([
      "FAJ Solutions · WO 19101390 · Wendy's Easton",
      'Fri, Oct 2, 2026 · 8:31:07 PM EDT',
      'GPS 40.68840, -75.22070 (±12 m)',
    ]);
  });

  it('says so when there was no GPS, and when a photo came from the library', () => {
    const lines = stampLines({ woNumber: '1', at, pos: null, fromLibrary: true, timeZone: 'America/New_York' });
    expect(lines[0]).toBe('FAJ Solutions · WO 1');
    expect(lines[1]).toMatch(/^Added Fri, Oct 2, 2026/);
    expect(lines[2]).toBe('GPS: location not available');
  });

  it('keeps a long title to one line', () => {
    const [head] = stampLines({ woNumber: '1', title: 'x'.repeat(200), at, pos: null });
    expect(head.length).toBeLessThanOrEqual(68);
  });

  it('coordinates and map links', () => {
    expect(fmtCoords(40.68841234, -75.22069876)).toBe('40.68841, -75.22070');
    expect(mapLink(40.6884, -75.2207)).toBe('https://www.google.com/maps/search/?api=1&query=40.688400,-75.220700');
  });
});

describe('milesBetween', () => {
  it('Easton to Allentown is about 15 miles; same point is 0', () => {
    const m = milesBetween(40.6884, -75.2207, 40.6084, -75.4902);
    expect(m).toBeGreaterThan(14);
    expect(m).toBeLessThan(16.5);
    expect(milesBetween(40.6884, -75.2207, 40.6884, -75.2207)).toBe(0);
  });
});

describe('getting a fix for a check-in', () => {
  const fix = { coords: { latitude: 40.6884, longitude: -75.2207, accuracy: 30 } };
  const phone = (answers: Array<'ok' | 'timeout' | 'denied'>) => {
    const calls: PositionOptions[] = [];
    vi.stubGlobal('navigator', { geolocation: {
      getCurrentPosition: (ok: (p: unknown) => void, fail: (e: { code: number }) => void, o: PositionOptions) => {
        calls.push(o);
        const a = answers.shift();
        if (a === 'ok') ok(fix); else fail({ code: a === 'denied' ? 1 : 3 });
      },
    } });
    return calls;
  };
  afterEach(() => vi.unstubAllGlobals());

  it('falls back to the quicker location when GPS has no fix in time', async () => {
    const calls = phone(['timeout', 'ok']);
    expect(await getPosition(100)).toEqual({ lat: 40.6884, lng: -75.2207, accuracy: 30 });
    expect(calls.map((c) => c.enableHighAccuracy)).toEqual([true, false]);
  });

  it('says to allow Location when the phone refused, and does not ask twice', async () => {
    const calls = phone(['denied']);
    expect(await getPosition(100)).toBeNull();
    expect(calls).toHaveLength(1);
    expect(noGpsMessage()).toMatch(/blocked/);
  });

  it('says to turn Location on or step outside when there is no fix at all', async () => {
    phone(['timeout', 'timeout']);
    expect(await getPosition(100)).toBeNull();
    expect(noGpsMessage()).toBe(gpsMessage('no_fix'));
    expect(noGpsMessage()).toMatch(/couldn't find where you are/);
  });
});
