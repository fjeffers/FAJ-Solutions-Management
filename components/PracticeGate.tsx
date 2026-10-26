'use client';
// The test site says so before anything else (2026-10-26). The slim orange
// strip wasn't enough: a tech's phone had the test site installed, so the
// morning's GPS fix and a newly assigned job never showed, and its taps went
// into the test copy where Fred couldn't see them. Now the test site opens on
// a full screen that sends people to the real app. Someone testing on purpose
// taps "Keep testing here", and this phone isn't asked again for 12 hours.
import { useEffect, useState } from 'react';
import { LIVE_APP_URL } from '@/lib/practice';

const KEY = 'faj-practice-ok-until';

export default function PracticeGate() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let until = 0;
    try { until = Number(localStorage.getItem(KEY)) || 0; } catch { /* private window: ask every time */ }
    setShow(until < Date.now());
  }, []);
  if (!show) return null;
  const keep = () => {
    try { localStorage.setItem(KEY, String(Date.now() + 12 * 3_600_000)); } catch { /* still let them in */ }
    setShow(false);
  };
  const real = typeof window === 'undefined' ? LIVE_APP_URL : `${LIVE_APP_URL}${window.location.pathname}`;
  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="practice-gate-title" style={{
      position: 'fixed', inset: 0, zIndex: 2000, background: '#B45309', color: '#fff', overflowY: 'auto',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      <div style={{ maxWidth: 440, width: '100%', textAlign: 'center' }}>
        <div style={{ fontSize: 44, lineHeight: 1 }} aria-hidden>⚠</div>
        <h1 id="practice-gate-title" style={{ font: '800 26px/1.2 Inter, system-ui, sans-serif', margin: '14px 0 10px' }}>
          This is the test site
        </h1>
        <p style={{ fontSize: 16, lineHeight: 1.45, margin: '0 0 22px' }}>
          Nothing you do here reaches FAJ: check-ins, mileage and photos stay on the test copy, and new jobs don&apos;t show up here.
          For work, use the real app.
        </p>
        <a href={real} style={{
          display: 'block', background: '#fff', color: '#0E1B2E', borderRadius: 12, padding: '15px 18px',
          font: '800 17px Inter, system-ui, sans-serif', textDecoration: 'none',
        }}>Open the real app</a>
        <p style={{ fontSize: 13.5, lineHeight: 1.4, margin: '12px 0 26px', opacity: 0.95 }}>
          app.fajsolutions.com · if this site is on your home screen, delete that icon and add the real app instead.
        </p>
        <button type="button" onClick={keep} style={{
          background: 'transparent', color: '#fff', border: '1.5px solid rgba(255,255,255,0.7)', borderRadius: 10,
          padding: '10px 16px', font: '600 14px Inter, system-ui, sans-serif', cursor: 'pointer',
        }}>Keep testing here</button>
      </div>
    </div>
  );
}
