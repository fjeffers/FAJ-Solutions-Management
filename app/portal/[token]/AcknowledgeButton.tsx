'use client';
import { useState } from 'react';

interface Props {
  woId: string;
  woNumber: string;
  onAcknowledge: (woId: string) => Promise<void>;
}

export default function AcknowledgeButton({ woId, woNumber, onAcknowledge }: Props) {
  const [loading, setLoading] = useState(false);
  const [done, setDone]       = useState(false);

  const handle = async () => {
    if (loading || done) return;
    setLoading(true);
    try {
      await onAcknowledge(woId);
      setDone(true);
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px',
        background: 'rgba(4,120,87,0.08)', borderRadius: 10,
        border: '1px solid rgba(4,120,87,0.15)', color: '#047857',
        fontSize: 14, fontWeight: 700,
      }}>
        ✓ You accepted WO #{woNumber}
      </div>
    );
  }

  return (
    <button
      onClick={handle}
      disabled={loading}
      style={{
        width: '100%',
        padding: '14px 24px',
        background: loading ? '#e0f2f1' : 'linear-gradient(135deg, #0E1B2E 0%, #13284A 100%)',
        color: loading ? '#0E1B2E' : 'white',
        border: 'none',
        borderRadius: 10,
        fontSize: 15,
        fontWeight: 700,
        cursor: loading ? 'wait' : 'pointer',
        letterSpacing: 0.3,
        boxShadow: loading ? 'none' : '0 4px 14px rgba(14,27,46,0.3)',
        transition: 'all 0.15s',
      }}
    >
      {loading ? '⏳ Submitting…' : '✓ I Accept — WO #' + woNumber}
    </button>
  );
}
