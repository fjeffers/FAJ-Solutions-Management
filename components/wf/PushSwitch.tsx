'use client';

import { useEffect, useState } from 'react';
import { toastError, toastSuccess } from '@/lib/toast';

function base64ToBytes(b64: string): Uint8Array {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/**
 * "Phone pop-ups on this device": sign this phone or computer up. The office
 * gets project alerts (migration 119); a tech gets the project sheet's
 * questions and replies (migration 121), with their own words.
 */
export function PushSwitch({ onText = 'On. Project alerts pop up here the moment they happen.', offText = 'Off. Turn on to get project alerts on this phone or computer.' }: {
  onText?: string; offText?: string;
} = {}) {
  const [state, setState] = useState<'checking' | 'off' | 'on' | 'unsupported' | 'blocked'>('checking');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      setState('unsupported'); return;
    }
    if (Notification.permission === 'denied') { setState('blocked'); return; }
    void navigator.serviceWorker.ready.then((reg) => reg.pushManager.getSubscription()).then((s) => setState(s ? 'on' : 'off'));
  }, []);
  const turnOn = async () => {
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { setState(perm === 'denied' ? 'blocked' : 'off'); toastError('Pop-ups were not allowed on this device.'); return; }
      const reg = await navigator.serviceWorker.ready;
      const { publicKey } = (await fetch('/api/alerts/push').then((r) => r.json())) as { publicKey: string };
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64ToBytes(publicKey) as BufferSource });
      const res = await fetch('/api/alerts/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub) });
      if (!res.ok) { toastError('Could not turn on pop-ups. Try again.'); return; }
      setState('on');
      toastSuccess('Pop-ups are on for this device.');
    } catch {
      toastError('Could not turn on pop-ups on this device.');
    } finally {
      setBusy(false);
    }
  };
  const turnOff = async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch('/api/alerts/push', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) });
        await sub.unsubscribe();
      }
      setState('off');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="wf-card" style={{ padding: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 220px' }}>
        <div style={{ fontWeight: 700 }}>Phone pop-ups on this device</div>
        <div className="wf-subtle" style={{ fontSize: 12.5 }}>
          {state === 'on' ? onText
            : state === 'unsupported' ? 'This browser cannot show pop-ups. On an iPhone, add the app to your Home Screen (Share, then Add to Home Screen), open it from there, then turn this on.'
              : state === 'blocked' ? 'Pop-ups are blocked for this site. Allow notifications for app.fajsolutions.com in your phone or browser settings.'
                : offText}
        </div>
      </div>
      {state === 'off' && <button className="wf-btn wf-btn-gold wf-btn-sm" disabled={busy} onClick={() => void turnOn()}>Turn on pop-ups</button>}
      {state === 'on' && <button className="wf-btn wf-btn-ghost wf-btn-sm" disabled={busy} onClick={() => void turnOff()}>Turn off</button>}
    </div>
  );
}
