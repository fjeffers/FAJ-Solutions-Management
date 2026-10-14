'use client';

// Alerts inside the live sheet (Fred, 2026-10-14: "I want the alert to be
// within that sheet, not getting an email every time"). Two parts:
//   - with the sheet open: a chime and a pop-up in the corner for each new line
//     or message (LiveToasts + chime);
//   - with it closed: phone alerts, turned on right here with no login
//     (AlertsButton, /sheet/<token>/push, migration 124).
import { useEffect, useState } from 'react';

/** A short two-tone chime. Browsers only allow sound after the page is tapped once. */
export function chime() {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(784, ctx.currentTime);
    o.frequency.setValueAtTime(1046, ctx.currentTime + 0.16);
    g.gain.setValueAtTime(0.12, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.45);
    window.setTimeout(() => { void ctx.close(); }, 800);
  } catch { /* no sound until they tap the page */ }
}

export type Toast = { id: string; text: string; sub?: string };

export function LiveToasts({ toasts, onClose }: { toasts: Toast[]; onClose: (id: string) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="ps-toasts ps-noprint" role="status" aria-live="polite">
      {toasts.slice(-4).map((t) => (
        <div key={t.id} className="ps-toast">
          <div style={{ flex: 1, minWidth: 0 }}>
            <b>{t.text}</b>
            {t.sub && <div style={{ fontSize: 12, opacity: 0.8, marginTop: 2 }}>{t.sub}</div>}
          </div>
          <button className="ps-toast-x" aria-label="Close" onClick={() => onClose(t.id)}>×</button>
        </div>
      ))}
    </div>
  );
}

function bytes(b64: string): Uint8Array {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

type State = 'checking' | 'off' | 'on' | 'iphone' | 'unsupported' | 'blocked';

/** "Alerts on this phone": phone pop-ups from this sheet, no login. */
export function AlertsButton({ token }: { token: string }) {
  const [state, setState] = useState<State>('checking');
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState(false);
  useEffect(() => {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      setState(ios && !standalone ? 'iphone' : 'unsupported');
      return;
    }
    if (Notification.permission === 'denied') { setState('blocked'); return; }
    void navigator.serviceWorker.ready.then((reg) => reg.pushManager.getSubscription()).then((s) => setState(s ? 'on' : 'off'));
  }, []);

  const turnOn = async () => {
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { setState(perm === 'denied' ? 'blocked' : 'off'); return; }
      const reg = await navigator.serviceWorker.ready;
      const { publicKey } = (await fetch(`/sheet/${token}/push`).then((r) => r.json())) as { publicKey: string };
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes(publicKey) as BufferSource });
      const res = await fetch(`/sheet/${token}/push`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub) });
      setState(res.ok ? 'on' : 'off');
    } catch {
      setState('off');
    } finally { setBusy(false); }
  };
  const turnOff = async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch(`/sheet/${token}/push`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) });
        await sub.unsubscribe();
      }
      setState('off');
    } finally { setBusy(false); }
  };

  if (state === 'checking') return null;
  return (
    <span style={{ position: 'relative' }} className="ps-noprint">
      {state === 'on'
        ? <button className="ps-bell on" disabled={busy} onClick={() => void turnOff()} title="Tap to turn alerts off on this phone">🔔 Alerts on</button>
        : state === 'off'
          ? <button className="ps-bell" disabled={busy} onClick={() => void turnOn()}>🔔 Turn on alerts</button>
          : <button className="ps-bell" onClick={() => setHelp((h) => !h)}>🔔 Alerts</button>}
      {help && state !== 'on' && state !== 'off' && (
        <span className="ps-bell-help">
          {state === 'iphone'
            ? 'On an iPhone: tap Share, then Add to Home Screen. Open “Live sheet” from your Home Screen and tap Turn on alerts there.'
            : state === 'blocked'
              ? 'Alerts are blocked for this site. Allow notifications for app.fajsolutions.com in your phone or browser settings, then try again.'
              : 'This browser can’t show alerts. Try Chrome or Safari on your phone.'}
        </span>
      )}
    </span>
  );
}

export const ALERTS_CSS = `
.ps-bell{border:1px solid rgba(255,255,255,.5);background:transparent;color:#fff;border-radius:999px;padding:6px 12px;font:inherit;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap}
.ps-bell.on{background:#34d399;border-color:#34d399;color:#0E1B2E}
.ps-bell:disabled{opacity:.6}
.ps-bell-help{position:absolute;right:0;top:calc(100% + 8px);width:min(280px,80vw);background:#fff;color:#1B1C1F;border-radius:10px;padding:10px 12px;font-size:12.5px;box-shadow:0 8px 24px rgba(0,0,0,.18);z-index:20}
.ps-toasts{position:fixed;top:12px;right:12px;left:12px;display:flex;flex-direction:column;align-items:flex-end;gap:8px;z-index:60;pointer-events:none}
.ps-toast{pointer-events:auto;display:flex;gap:10px;align-items:flex-start;max-width:380px;width:100%;background:#0E1B2E;color:#fff;border-left:4px solid #C9A24B;border-radius:10px;padding:10px 12px;font-size:13.5px;box-shadow:0 8px 24px rgba(0,0,0,.25);animation:pstoast .25s ease-out}
.ps-toast-x{border:none;background:none;color:#fff;font-size:18px;line-height:1;cursor:pointer;opacity:.7}
@keyframes pstoast{from{transform:translateY(-8px);opacity:0}to{transform:none;opacity:1}}
`;
