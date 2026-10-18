'use client';
// "A new version is ready" (Fred, 2026-10-18: his phone kept the tech app open
// from the morning and showed the old job screen all afternoon, so what he set
// in the office and what the tech saw didn't match). Checks every minute and
// whenever the app comes back to the front; one tap reloads it. Never reloads
// by itself, so nothing a tech is typing is lost.
import { useEffect, useState } from 'react';
import { BUILD_VERSION, needsUpdate } from '@/lib/app-version';

export default function UpdateBar() {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    if (BUILD_VERSION === 'dev') return;
    let live = true;
    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const res = await fetch(`/api/version?t=${Date.now()}`, { cache: 'no-store' });
        const j = (await res.json()) as { version?: unknown };
        if (live && needsUpdate(BUILD_VERSION, j.version)) setStale(true);
      } catch { /* no signal: try again later */ }
    };
    void check();
    const timer = setInterval(() => void check(), 60_000);
    const onShow = () => void check();
    document.addEventListener('visibilitychange', onShow);
    return () => { live = false; clearInterval(timer); document.removeEventListener('visibilitychange', onShow); };
  }, []);
  if (!stale) return null;
  return (
    <div role="status" style={{
      position: 'fixed', left: 12, right: 12, bottom: 'calc(12px + env(safe-area-inset-bottom))', zIndex: 1000,
      display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 14,
      background: '#0E1B2E', color: '#fff', boxShadow: '0 10px 30px rgba(14,27,46,0.35)', maxWidth: 560, margin: '0 auto',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>A new version of the app is ready.</span>
      <button type="button" onClick={() => window.location.reload()} style={{
        background: '#C9A227', color: '#0E1B2E', border: 'none', borderRadius: 10, padding: '9px 16px',
        font: '700 14px Inter, system-ui, sans-serif', cursor: 'pointer',
      }}>Update</button>
    </div>
  );
}
