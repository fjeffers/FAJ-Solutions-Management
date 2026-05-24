'use client';
import { useState, useRef } from 'react';

interface Props {
  woId: string;
  token: string;
  initialNotes: string;
}

export default function PortalCloseout({ woId, token, initialNotes }: Props) {
  const [notes, setNotes]   = useState(initialNotes ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const timer               = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleChange(value: string) {
    setNotes(value);
    setSaved(false);
    setError(null);

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setSaving(true);
      try {
        const res = await fetch('/api/portal/update', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, wo_id: woId, field: 'closeout_notes', value: { notes: value } }),
        });
        if (!res.ok) throw new Error('Failed to save');
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
      } catch {
        setError('Could not save notes. Please try again.');
      } finally {
        setSaving(false);
      }
    }, 700);
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#aaa', letterSpacing: 0.5, textTransform: 'uppercase' }}>
          📋 Closeout Notes
        </div>
        {saving && <span style={{ fontSize: 11, color: '#9ca3af' }}>saving…</span>}
        {saved  && <span style={{ fontSize: 11, color: '#047857' }}>✓ saved</span>}
      </div>

      <textarea
        value={notes}
        onChange={(e) => handleChange(e.target.value)}
        rows={4}
        placeholder="Add closeout notes, issues encountered, or anything the team should know…"
        style={{
          width: '100%',
          padding: '10px 12px',
          fontSize: 13,
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          background: 'white',
          color: '#1a1a1a',
          outline: 'none',
          resize: 'vertical',
          fontFamily: 'inherit',
          boxSizing: 'border-box',
          lineHeight: 1.5,
          transition: 'border-color 0.15s',
        }}
      />

      {error && (
        <div style={{ fontSize: 12, color: '#dc2626', marginTop: 4 }}>{error}</div>
      )}
    </div>
  );
}
