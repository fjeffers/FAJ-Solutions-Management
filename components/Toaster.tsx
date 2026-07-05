'use client';

import { useEffect, useState } from 'react';
import { subscribeToasts, dismissToast, type ToastItem } from '@/lib/toast';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

const KIND_STYLES = {
  error:   { border: '#DC2626', icon: <AlertCircle size={16} color="#DC2626" /> },
  success: { border: '#059669', icon: <CheckCircle2 size={16} color="#059669" /> },
  info:    { border: 'var(--teal)', icon: <Info size={16} color="var(--teal)" /> },
} as const;

export default function Toaster() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  useEffect(() => subscribeToasts(setToasts), []);

  if (toasts.length === 0) return null;

  return (
    <div
      className="no-print"
      style={{
        position: 'fixed', bottom: 20, right: 20, zIndex: 9999,
        display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 360,
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === 'error' ? 'alert' : 'status'}
          style={{
            display: 'flex', alignItems: 'flex-start', gap: 10,
            padding: '12px 14px', borderRadius: 10,
            background: 'var(--card-bg, white)', color: 'var(--text, #1F2937)',
            borderLeft: `4px solid ${KIND_STYLES[t.kind].border}`,
            boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
            fontSize: 13, fontWeight: 500, lineHeight: 1.4,
          }}
        >
          <span style={{ flexShrink: 0, marginTop: 1 }}>{KIND_STYLES[t.kind].icon}</span>
          <span style={{ flex: 1 }}>{t.message}</span>
          <button
            onClick={() => dismissToast(t.id)}
            aria-label="Dismiss"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', opacity: 0.5, padding: 0 }}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
