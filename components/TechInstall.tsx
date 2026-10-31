'use client';
import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { installSteps, phoneKind, TECH_APP_URL, type PhoneKind } from '@/lib/install-help';

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
 * never nagging a tech who already did it.
 *
 * The office app uses it too (Fred, 2026-10-31: "i need to make it downloadable"),
 * with its own address and its own Not now.
 */
type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

// A new key: techs who closed the old, vaguer help see this one once.
const DISMISS_KEY = 'faj-tech-install-dismissed-2';

type Props = { appUrl?: string; dismissKey?: string; title?: string; style?: React.CSSProperties };

export default function TechInstall({ appUrl = TECH_APP_URL, dismissKey = DISMISS_KEY, title = 'Put this on your phone', style }: Props = {}) {
  const [deferred, setDeferred] = useState<InstallPrompt | null>(null);
  const [kind, setKind] = useState<PhoneKind | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Already installed — nothing to offer.
    const standalone =
      window.matchMedia?.('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) return;

    let dismissed = false;
    try { dismissed = localStorage.getItem(dismissKey) === '1'; } catch { /* private mode */ }
    if (dismissed) return;

    setKind(phoneKind(navigator.userAgent, navigator.maxTouchPoints));
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as InstallPrompt);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, [dismissKey]);

  const dismiss = () => {
    setKind(null);
    try { localStorage.setItem(dismissKey, '1'); } catch { /* private mode */ }
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    if (outcome === 'accepted') dismiss();
    setDeferred(null);
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(appUrl); setCopied(true); } catch { /* the address is shown to copy by hand */ }
  };

  const steps = kind ? installSteps(kind, !!deferred) : '';
  if (!kind || !steps) return null;
  const inApp = kind === 'ios-inapp' || kind === 'android-inapp';

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 11, marginBottom: 16,
      background: 'rgba(14,27,46,0.06)', border: '1px solid rgba(14,27,46,0.15)',
      borderRadius: 12, padding: '12px 14px', ...style,
    }}>
      <Download size={18} color="var(--teal)" style={{ flexShrink: 0, marginTop: 2 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>{title}</div>
        <div style={{ fontSize: 12.5, color: '#555', marginTop: 3, lineHeight: 1.5 }}>{steps}</div>
        {inApp && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <code style={{ fontSize: 12.5, background: 'white', border: '1px solid #ddd', borderRadius: 6, padding: '3px 8px' }}>{appUrl.replace('https://', '')}</code>
            <button className="btn btn-primary" onClick={() => void copy()} style={{ fontSize: 12, padding: '6px 12px' }}>
              {copied ? 'Copied' : 'Copy the link'}
            </button>
          </div>
        )}
        <div style={{ fontSize: 11.5, color: '#777', marginTop: 6, lineHeight: 1.45 }}>
          You don&apos;t have to install it: you can sign in and use it right here. Installing only puts an icon on your phone, tablet or computer.
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
