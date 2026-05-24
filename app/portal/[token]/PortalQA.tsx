'use client';
import { useState, useRef } from 'react';
import type { CustomQAItem } from '@/lib/types';

interface Props {
  woId: string;
  token: string;
  qa: CustomQAItem[];
}

export default function PortalQA({ woId, token, qa: initialQA }: Props) {
  const [qa, setQA]         = useState<CustomQAItem[]>(initialQA);
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved]   = useState<string | null>(null);
  const [error, setError]   = useState<string | null>(null);
  const timers              = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  if (!qa || qa.length === 0) return null;

  async function saveAnswer(id: string, answer: string) {
    const updated = qa.map((q) => q.id === id ? { ...q, answer } : q);
    setQA(updated);
    setError(null);

    // Debounce saves — wait 600ms after last keystroke
    clearTimeout(timers.current[id]);
    timers.current[id] = setTimeout(async () => {
      setSaving(id);
      try {
        const res = await fetch('/api/portal/update', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, wo_id: woId, field: 'custom_qa', value: updated }),
        });
        if (!res.ok) throw new Error('Failed to save');
        setSaved(id);
        setTimeout(() => setSaved((s) => (s === id ? null : s)), 2000);
      } catch {
        setError('Could not save answer. Please try again.');
      } finally {
        setSaving((s) => (s === id ? null : s));
      }
    }, 600);
  }

  const inputBase: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    fontSize: 13,
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    background: 'white',
    color: '#1a1a1a',
    outline: 'none',
    boxSizing: 'border-box',
    transition: 'border-color 0.15s',
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#aaa', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 10 }}>
        📝 Required Info
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {qa.map((item) => {
          const isSaving = saving === item.id;
          const isSaved  = saved  === item.id;

          return (
            <div key={item.id}>
              {/* Label */}
              <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 5, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{item.label}</span>
                {isSaving && <span style={{ fontSize: 11, color: '#9ca3af' }}>saving…</span>}
                {isSaved  && <span style={{ fontSize: 11, color: '#047857' }}>✓ saved</span>}
              </div>

              {/* Input based on type */}
              {item.type === 'yes_no' ? (
                <div style={{ display: 'flex', gap: 8 }}>
                  {(['Yes', 'No'] as const).map((opt) => (
                    <button
                      key={opt}
                      onClick={() => saveAnswer(item.id, opt)}
                      style={{
                        flex: 1,
                        padding: '9px 0',
                        fontSize: 13,
                        fontWeight: 600,
                        borderRadius: 8,
                        border: `1.5px solid ${item.answer === opt ? (opt === 'Yes' ? '#047857' : '#dc2626') : '#e5e7eb'}`,
                        background: item.answer === opt
                          ? (opt === 'Yes' ? 'rgba(4,120,87,0.08)' : 'rgba(220,38,38,0.07)')
                          : 'white',
                        color: item.answer === opt
                          ? (opt === 'Yes' ? '#047857' : '#dc2626')
                          : '#6b7280',
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                      }}
                    >
                      {opt === 'Yes' ? '✓ Yes' : '✗ No'}
                    </button>
                  ))}
                </div>
              ) : item.type === 'textarea' ? (
                <textarea
                  value={item.answer ?? ''}
                  onChange={(e) => saveAnswer(item.id, e.target.value)}
                  rows={3}
                  placeholder="Enter your answer…"
                  style={{ ...inputBase, resize: 'vertical', fontFamily: 'inherit' }}
                />
              ) : item.type === 'number' ? (
                <input
                  type="number"
                  value={item.answer ?? ''}
                  onChange={(e) => saveAnswer(item.id, e.target.value)}
                  placeholder="Enter number…"
                  style={inputBase}
                />
              ) : item.type === 'photo' ? (
                <div style={{
                  padding: '10px 12px',
                  fontSize: 12,
                  color: '#6b7280',
                  border: '1px dashed #d1d5db',
                  borderRadius: 8,
                  background: '#f9fafb',
                }}>
                  📷 Use the photo upload section below to attach photos for this item.
                </div>
              ) : (
                /* text (default) */
                <input
                  type="text"
                  value={item.answer ?? ''}
                  onChange={(e) => saveAnswer(item.id, e.target.value)}
                  placeholder="Enter your answer…"
                  style={inputBase}
                />
              )}
            </div>
          );
        })}
      </div>

      {error && (
        <div style={{ fontSize: 12, color: '#dc2626', marginTop: 8 }}>{error}</div>
      )}
    </div>
  );
}
