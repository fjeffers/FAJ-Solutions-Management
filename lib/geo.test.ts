import { afterEach, describe, expect, it, vi } from 'vitest';
import { fmtCoords, mapLink, fmtStampTime, stampLines, milesBetween, getPosition, gpsMessage, noGpsMessage, androidBrowser } from './geo';

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

describe('what to do when Location is blocked, on the phone in hand', () => {
  const host = 'app.fajsolutions.com';

  it('the installed app on an Android phone has no web address to tap: Settings, then Chrome\'s menu (Fred, 2026-10-26)', () => {
    const m = gpsMessage('blocked', 'android', host, 'Chrome');
    expect(m).not.toMatch(/web address/);
    expect(m).toMatch(/Settings → Apps → Chrome → Permissions → Location → Allow only while using the app/);
    expect(m).toMatch(/⋮ → Settings → Site settings → Location, tap app\.fajsolutions\.com and set it to Allow/);
  });

  it('Samsung Internet, iPhone, inside another app and a computer each get their own steps', () => {
    expect(gpsMessage('blocked', 'samsung', host)).toMatch(/Apps → Samsung Internet → Permissions → Location.*allow app\.fajsolutions\.com/);
    expect(gpsMessage('blocked', 'ios', host)).toMatch(/Location Services: turn it on, and set Safari Websites to While Using the App/);
    expect(gpsMessage('blocked', 'ios-inapp', host)).toBe(gpsMessage('blocked', 'ios', host));
    expect(gpsMessage('blocked', 'android-inapp', host)).toMatch(/Open in Chrome/);
    expect(gpsMessage('blocked', 'other', host)).toMatch(/icon left of the web address/);
  });

  it('names the site the phone is on (the test site is another address)', () => {
    expect(gpsMessage('blocked', 'android', 'faj-test.example.app', 'Chrome')).toMatch(/tap faj-test\.example\.app and set it to Allow/);
  });

  it('Firefox or Edge on Android get their own browser named, not Chrome (Greptile on PR #26)', () => {
    const ff = 'Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0';
    const edge = 'Mozilla/5.0 (Linux; Android 14; SM-S918U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 EdgA/130.0.0.0';
    const chrome = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
    expect([ff, edge, chrome].map(androidBrowser)).toEqual(['Firefox', 'Edge', 'Chrome']);
    const m = gpsMessage('blocked', 'android', host, 'Firefox');
    expect(m).not.toMatch(/Chrome/);
    expect(m).toMatch(/Settings → Apps → Firefox → Permissions → Location.*open Firefox, find Site permissions → Location in its settings, and allow app\.fajsolutions\.com/);
    expect(gpsMessage('blocked', 'android', host, null)).toMatch(/Settings → Apps → your web browser → Permissions/);
  });

  it('no fix is the same on every phone', () => {
    expect(gpsMessage('no_fix', 'ios', host)).toBe(gpsMessage('no_fix', 'android', host));
  });
});
