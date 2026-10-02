'use client';
import { useEffect, useState } from 'react';
import { Download, X, Share } from 'lucide-react';

/**
 * "Add this to your phone" for the tech portal.
 *
 * Android/Chrome fires beforeinstallprompt and we can trigger the real install
 * sheet. iOS Safari never fires it and offers no API at all, so the only honest
 * thing there is to show the two taps: Share → Add to Home Screen.
 *
 * Hidden once installed (display-mode: standalone) or once dismissed, so it is
 * never nagging a tech who already did it.
 */
type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const DISMISS_KEY = 'faj-tech-install-dismissed';

export default function TechInstall() {
  const [deferred, setDeferred] = useState<InstallPrompt | null>(null);
  const [show, setShow] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    // Already installed — nothing to offer.
    const standalone =
      window.matchMedia?.('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) return;

    let dismissed = false;
    try { dismissed = localStorage.getItem(DISMISS_KEY) === '1'; } catch { /* private mode */ }
    if (dismissed) return;

    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    setIsIOS(ios);
    if (ios) { setShow(true); return; }   // no API on iOS; show the instructions

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as InstallPrompt);
      setShow(true);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  const dismiss = () => {
    setShow(false);
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* private mode */ }
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    if (outcome === 'accepted') dismiss();
    setDeferred(null);
  };

  if (!show) return null;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 11, marginBottom: 16,
      background: 'rgba(14,27,46,0.06)', border: '1px solid rgba(14,27,46,0.15)',
      borderRadius: 12, padding: '12px 14px',
    }}>
      <Download size={18} color="var(--teal)" style={{ flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>Put this on your phone</div>
        <div style={{ fontSize: 11.5, color: '#777', marginTop: 2, lineHeight: 1.45 }}>
          {isIOS ? (
            <>Tap <Share size={11} style={{ verticalAlign: -1 }} /> Share, then <strong>Add to Home Screen</strong>.</>
          ) : (
            'Opens like an app — no browser tab, no app store.'
          )}
        </div>
      </div>
      {!isIOS && (
        <button className="btn btn-primary" onClick={install} style={{ flexShrink: 0, fontSize: 12, padding: '8px 14px' }}>
          Install
        </button>
      )}
      <button onClick={dismiss} title="Not now" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#aaa', padding: 4, flexShrink: 0 }}>
        <X size={15} />
      </button>
    </div>
  );
}
