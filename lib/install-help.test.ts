import { describe, it, expect } from 'vitest';
import { installSteps, oldIconSteps, phoneKind, IOS_LINKS_NOTE } from './install-help';

const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IOS_YAHOO = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 YahooMobile/1.0 (mail; 7.40.0)';
const IOS_WEBVIEW = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const CHROME = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
const ANDROID_WV = 'Mozilla/5.0 (Linux; Android 14; SM-S918U; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.0.0 Mobile Safari/537.36';
const SAMSUNG = 'Mozilla/5.0 (Linux; Android 14; SM-S918U) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

describe('putting the tech app on a phone (Fred, 2026-10-19)', () => {
  it('knows the phone and whether the link opened inside another app', () => {
    expect(phoneKind(SAFARI)).toBe('ios');
    expect(phoneKind(IOS_YAHOO)).toBe('ios-inapp');
    expect(phoneKind(IOS_WEBVIEW)).toBe('ios-inapp');
    expect(phoneKind(CHROME)).toBe('android');
    expect(phoneKind(ANDROID_WV)).toBe('android-inapp');
    expect(phoneKind(SAMSUNG)).toBe('samsung');
    expect(phoneKind(DESKTOP)).toBe('other');
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

  it('says links open Safari on an iPhone, and how to replace the old icon', () => {
    expect(IOS_LINKS_NOTE).toContain('links in emails and texts always open in Safari');
    expect(oldIconSteps('ios')).toContain('Add to Home Screen');
    expect(oldIconSteps('android')).toContain('Install app');
    expect(oldIconSteps('ios')).toContain('old FAJ app');
  });
});
