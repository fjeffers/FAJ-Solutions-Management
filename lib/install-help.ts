// Putting the tech app on a phone (Fred, 2026-10-19: "tech are unable to
// install the tech app"). A link tapped inside Yahoo Mail, Gmail or Facebook
// opens in that app's own browser, which can't install anything; an iPhone has
// no Install button at all (Share, then Add to Home Screen, in Safari). So the
// help says what to do on the phone in hand. Pure, tested (lib/install-help.test.ts).

export type PhoneKind = 'ios' | 'ios-inapp' | 'android' | 'android-inapp' | 'samsung' | 'desktop' | 'desktop-safari' | 'desktop-firefox' | 'other';

export const TECH_APP_URL = 'https://app.fajsolutions.com/tech';
export const OFFICE_APP_URL = 'https://app.fajsolutions.com/admin';

/**
 * Which phone, tablet or computer and browser, from the browser's own
 * description of itself. An iPad says it is a Mac, so the number of touch
 * points (navigator.maxTouchPoints) tells the two apart.
 */
export function phoneKind(ua: string, touchPoints = 0): PhoneKind {
  const inApp = /FBAN|FBAV|Instagram|Line\/|GSA\/|YahooMobile|YJApp|\bYahoo\b|GmailApp|\bGmail\b|Snapchat|LinkedInApp/i.test(ua);
  const iPad = /Macintosh/.test(ua) && touchPoints > 1;
  if (/iphone|ipad|ipod/i.test(ua) || iPad) {
    // An app's own browser on an iPhone leaves "Safari/" out of its description.
    return inApp || !/Safari\//.test(ua) ? 'ios-inapp' : 'ios';
  }
  if (/android/i.test(ua)) {
    if (inApp || /;\s*wv\)/.test(ua)) return 'android-inapp';
    if (/SamsungBrowser/i.test(ua)) return 'samsung';
    return 'android';
  }
  if (/Windows|Macintosh|CrOS|Linux/.test(ua)) {
    if (/Firefox\//.test(ua)) return 'desktop-firefox';
    if (/Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome|Chromium|Edg\//.test(ua)) return 'desktop-safari';
    return 'desktop';
  }
  return 'other';
}

/** The steps for this phone, tablet or computer, in plain words. */
export function installSteps(kind: PhoneKind, canPrompt: boolean): string {
  switch (kind) {
    case 'ios':
      return 'Tap Share (the square with the arrow), then Add to Home Screen, then Add.';
    case 'ios-inapp':
      return "This opened inside another app (like Yahoo Mail or Gmail), which can't add it to your phone. Copy the link, open Safari, paste it, then tap Share, then Add to Home Screen.";
    case 'android':
      return canPrompt ? 'Tap Install. It opens like an app, with no app store.' : 'Tap ⋮ (top right), then Install app or Add to Home screen.';
    case 'samsung':
      return canPrompt ? 'Tap Install. It opens like an app, with no app store.' : 'Tap the menu (≡ at the bottom), then Add page to, then Home screen.';
    case 'android-inapp':
      return "This opened inside another app (like Yahoo Mail or Gmail), which can't install it. Tap ⋮ and choose Open in Chrome, or copy the link into Chrome. Then tap ⋮, then Install app.";
    case 'desktop':
      return canPrompt
        ? 'Click Install. It opens in its own window, like any other program.'
        : 'In Chrome or Edge, click the install icon at the right end of the address bar, or open the ⋮ menu and choose Install.';
    case 'desktop-safari':
      return 'In Safari, click File, then Add to Dock.';
    case 'desktop-firefox':
      return "Firefox can't install apps. Open this page in Chrome, Edge or Safari and install it from there.";
    default:
      return canPrompt ? 'Tap Install to keep it like an app.' : '';
  }
}
