import { describe, it, expect } from 'vitest';
import { installSteps, phoneKind } from './install-help';

const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IOS_YAHOO = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 YahooMobile/1.0 (mail; 7.40.0)';
const IOS_WEBVIEW = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const CHROME = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
const ANDROID_WV = 'Mozilla/5.0 (Linux; Android 14; SM-S918U; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.0.0 Mobile Safari/537.36';
const SAMSUNG = 'Mozilla/5.0 (Linux; Android 14; SM-S918U) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36';
const MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const MAC_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
const EDGE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0';
const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

describe('putting the tech app on a phone (Fred, 2026-10-19)', () => {
  it('knows the phone and whether the link opened inside another app', () => {
    expect(phoneKind(SAFARI)).toBe('ios');
    expect(phoneKind(IOS_YAHOO)).toBe('ios-inapp');
    expect(phoneKind(IOS_WEBVIEW)).toBe('ios-inapp');
    expect(phoneKind(CHROME)).toBe('android');
    expect(phoneKind(ANDROID_WV)).toBe('android-inapp');
    expect(phoneKind(SAMSUNG)).toBe('samsung');
    expect(phoneKind(DESKTOP)).toBe('desktop');
  });

  it('knows tablets and computers too (Fred, 2026-10-31: "app on the phones tablet and computer")', () => {
    // An iPad on iPadOS says it is a Mac; only the touch screen gives it away.
    expect(phoneKind(MAC_SAFARI, 5)).toBe('ios');
    expect(phoneKind(MAC_SAFARI)).toBe('desktop-safari');
    expect(phoneKind(MAC_CHROME)).toBe('desktop');
    expect(phoneKind(EDGE)).toBe('desktop');
    expect(phoneKind(FIREFOX)).toBe('desktop-firefox');
    expect(installSteps('desktop', true)).toContain('Click Install');
    expect(installSteps('desktop', false)).toContain('address bar');
    expect(installSteps('desktop-safari', false)).toContain('Add to Dock');
    expect(installSteps('desktop-firefox', false)).toContain('Chrome, Edge or Safari');
  });

  it('gives the steps for that phone', () => {
    expect(installSteps('ios', false)).toContain('Add to Home Screen');
    expect(installSteps('ios-inapp', false)).toContain('open Safari');
    expect(installSteps('android', true)).toContain('Tap Install');
    expect(installSteps('android', false)).toContain('Install app');
    expect(installSteps('android-inapp', false)).toContain('Open in Chrome');
    expect(installSteps('samsung', false)).toContain('Home screen');
    expect(installSteps('other', false)).toBe('');
  });
});
