'use client';
import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { installSteps, IOS_LINKS_NOTE, OLD_ICON_MARK, oldIconSteps, phoneKind, TECH_APP_URL, type PhoneKind } from '@/lib/install-help';

/**
 * "Put this on your phone" for the tech portal.
 *
 * Android/Chrome fires beforeinstallprompt and we can trigger the real install
 * sheet. iOS Safari never fires it and offers no API at all, so there it shows
 * the taps: Share, then Add to Home Screen. A link opened inside Yahoo Mail,
 * Gmail or Facebook can't install anything, so it says to open the link in
 * Safari or Chrome, with a button to copy it (Fred, 2026-10-19: "tech are
 * unable to install the tech app"). The steps are lib/install-help.ts.
 *
 * Hidden once installed (display-mode: standalone) or once dismissed, so it is
 * never nagging a tech who already did it. Two things show anyway on an iPhone
 * (Fred, 2026-10-19: "it's not staying as an app for some people"): the old
 * app's icon, which now opens like a website, and that a link in an email or
 * text always opens Safari rather than the app.
 */
type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

// A new key: techs who closed the old, vaguer help see this one once.
const DISMISS_KEY = 'faj-tech-install-dismissed-2';

export default function TechInstall() {
  const [deferred, setDeferred] = useState<InstallPrompt | null>(null);
  // The phone, and whether it came from the old app's icon (next.config.ts).
  const [found, setFound] = useState<{ phone: PhoneKind; oldIcon: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Opened from the old app's icon: replace it, whatever else.
    const oldIcon = new URLSearchParams(window.location.search).get('from') === OLD_ICON_MARK;
    // Already installed — nothing to offer.
    const standalone =
      window.matchMedia?.('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone && !oldIcon) return;

    let dismissed = false;
    try { dismissed = localStorage.getItem(DISMISS_KEY) === '1'; } catch { /* private mode */ }
    if (dismissed && !oldIcon) return;

    setFound({ phone: phoneKind(navigator.userAgent), oldIcon });
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as InstallPrompt);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  const dismiss = () => {
    setFound(null);
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* private mode */ }
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    if (outcome === 'accepted') dismiss();
    setDeferred(null);
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(TECH_APP_URL); setCopied(true); } catch { /* the address is shown to copy by hand */ }
  };

  if (found?.oldIcon) {
    return (
      <div role="alert" style={{
        display: 'flex', alignItems: 'flex-start', gap: 11, marginBottom: 16,
        background: 'rgba(180,83,9,0.08)', border: '1px solid rgba(180,83,9,0.35)',
        borderRadius: 12, padding: '12px 14px',
      }}>
        <Download size={18} color="#B45309" style={{ flexShrink: 0, marginTop: 2 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>Replace the icon on your phone</div>
          <div style={{ fontSize: 12.5, color: '#555', marginTop: 3, lineHeight: 1.5 }}>{oldIconSteps(found.phone)}</div>
        </div>
      </div>
    );
  }

  const kind = found?.phone ?? null;
  const steps = kind ? installSteps(kind, !!deferred) : '';
  if (!kind || !steps) return null;
  const inApp = kind === 'ios-inapp' || kind === 'android-inapp';

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 11, marginBottom: 16,
      background: 'rgba(14,27,46,0.06)', border: '1px solid rgba(14,27,46,0.15)',
      borderRadius: 12, padding: '12px 14px',
    }}>
      <Download size={18} color="var(--teal)" style={{ flexShrink: 0, marginTop: 2 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>Put this on your phone</div>
        <div style={{ fontSize: 12.5, color: '#555', marginTop: 3, lineHeight: 1.5 }}>{steps}</div>
        {kind === 'ios' && <div style={{ fontSize: 12.5, color: '#555', marginTop: 6, lineHeight: 1.5 }}>{IOS_LINKS_NOTE}</div>}
        {inApp && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <code style={{ fontSize: 12.5, background: 'white', border: '1px solid #ddd', borderRadius: 6, padding: '3px 8px' }}>{TECH_APP_URL.replace('https://', '')}</code>
            <button className="btn btn-primary" onClick={() => void copy()} style={{ fontSize: 12, padding: '6px 12px' }}>
              {copied ? 'Copied' : 'Copy the link'}
            </button>
          </div>
        )}
        <div style={{ fontSize: 11.5, color: '#777', marginTop: 6, lineHeight: 1.45 }}>
          You don&apos;t have to install it: you can sign in and use it right here. Installing only puts an icon on your phone.
        </div>
      </div>
      {deferred && (
        <button className="btn btn-primary" onClick={() => void install()} style={{ flexShrink: 0, fontSize: 12, padding: '8px 14px' }}>
          Install
        </button>
      )}
      <button onClick={dismiss} title="Not now" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#aaa', padding: 4, flexShrink: 0 }}>
        <X size={15} />
      </button>
    </div>
  );
}
