'use client';
import { useState } from 'react';

interface Props {
  woId: string;
  woNumber: string;
  currentStatus: string;
  onStatusUpdate: (woId: string, status: string) => Promise<void>;
}

// Note: 'In Progress' → 'Work Done' is handled by PortalWorkDoneGate (requires requirement validation)
const NEXT_STATUSES: Record<string, { label: string; next: string; emoji: string; color: string }[]> = {
  Assigned: [
    { label: 'Start Work', next: 'In Progress', emoji: '▶', color: '#B45309' },
  ],
};

export default function PortalStatusButton({ woId, woNumber, currentStatus, onStatusUpdate }: Props) {
  const [loading, setLoading] = useState<string | null>(null);
  const [done, setDone]       = useState<string | null>(null);

  const actions = NEXT_STATUSES[currentStatus] ?? [];
  if (actions.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
      {actions.map(({ label, next, emoji, color }) => {
        const isLoading = loading === next;
        const isDone    = done === next;

        if (isDone) {
          return (
            <div key={next} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px',
              background: 'rgba(4,120,87,0.08)', borderRadius: 10,
              border: '1px solid rgba(4,120,87,0.15)', color: '#047857',
              fontSize: 13, fontWeight: 700,
            }}>
              ✓ Marked as {next} — WO #{woNumber}
            </div>
          );
        }

        return (
          <button
            key={next}
            disabled={!!loading}
            onClick={async () => {
              if (loading) return;
              setLoading(next);
              try {
                await onStatusUpdate(woId, next);
                setDone(next);
              } finally {
                setLoading(null);
              }
            }}
            style={{
              width: '100%',
              padding: '12px 20px',
              background: isLoading ? '#f3f4f6' : color === '#B45309'
                ? 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)'
                : 'linear-gradient(135deg, #059669 0%, #047857 100%)',
              color: isLoading ? color : 'white',
              border: 'none',
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 700,
              cursor: isLoading ? 'wait' : 'pointer',
              letterSpacing: 0.3,
              boxShadow: isLoading ? 'none' : '0 4px 14px rgba(0,0,0,0.18)',
              transition: 'all 0.15s',
            }}
          >
            {isLoading ? '⏳ Updating…' : `${emoji} ${label}`}
          </button>
        );
      })}
    </div>
  );
}
