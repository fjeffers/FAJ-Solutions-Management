// Putting the tech app on a phone (Fred, 2026-10-19: "tech are unable to
// install the tech app"). A link tapped inside Yahoo Mail, Gmail or Facebook
// opens in that app's own browser, which can't install anything; an iPhone has
// no Install button at all (Share, then Add to Home Screen, in Safari). So the
// help says what to do on the phone in hand. Pure, tested (lib/install-help.test.ts).

export type PhoneKind = 'ios' | 'ios-inapp' | 'android' | 'android-inapp' | 'samsung' | 'other';

export const TECH_APP_URL = 'https://app.fajsolutions.com/tech';

/** Which phone and browser, from the browser's own description of itself. */
export function phoneKind(ua: string): PhoneKind {
  const inApp = /FBAN|FBAV|Instagram|Line\/|GSA\/|YahooMobile|YJApp|\bYahoo\b|GmailApp|\bGmail\b|Snapchat|LinkedInApp/i.test(ua);
  if (/iphone|ipad|ipod/i.test(ua)) {
    // An app's own browser on an iPhone leaves "Safari/" out of its description.
    return inApp || !/Safari\//.test(ua) ? 'ios-inapp' : 'ios';
  }
  if (/android/i.test(ua)) {
    if (inApp || /;\s*wv\)/.test(ua)) return 'android-inapp';
    if (/SamsungBrowser/i.test(ua)) return 'samsung';
    return 'android';
  }
  return 'other';
}

/**
 * On an iPhone a link in an email, a text or another app always opens Safari,
 * never the app on the home screen, and Safari has its own sign-in. So a tech
 * who installed the app and then taps the new-job email ends up in Safari and
 * thinks the app "didn't stay" (Fred, 2026-10-19).
 */
export const IOS_LINKS_NOTE =
  'Already on your home screen? Close Safari and tap the FAJ Tech icon instead. On an iPhone, links in emails and texts always open in Safari, not the app.';

/** The old app's home-screen icon lands here with this mark (next.config.ts). */
export const OLD_ICON_MARK = 'old-app';

export function oldIconSteps(kind: PhoneKind): string {
  const add = kind === 'ios' || kind === 'ios-inapp'
    ? 'Then open app.fajsolutions.com/tech in Safari, tap Share, then Add to Home Screen.'
    : 'Then open app.fajsolutions.com/tech in Chrome, tap ⋮, then Install app.';
  return `This home-screen icon is the old FAJ app, so it opens like a website. Press and hold the icon and remove it. ${add}`;
}

/** The steps for this phone, in plain words. */
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
    default:
      return canPrompt ? 'Tap Install to keep it like an app.' : '';
  }
}
