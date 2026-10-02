'use client';
import { useState } from 'react';
import { Sparkles, Check, X, Loader2 } from 'lucide-react';
import { toastError } from '@/lib/toast';

/**
 * "Read the photo" — the assistant suggests, the surveyor decides.
 *
 * Nothing is written until a suggestion is tapped. Each field is accepted one
 * at a time, so a right answer about the ceiling can be kept while a wrong
 * guess about the room is left behind. That is deliberate: a survey is the
 * document a job is priced from, and a quiet auto-fill would put a model's
 * guess into a client's quote without anyone reading it.
 *
 * It never proposes a price or a cable length — a photo cannot know either.
 */
const LABELS: Record<string, string> = {
  location: 'Location',
  camera_type: 'Type',
  mount: 'Mount',
  placement: 'Indoor / outdoor',
  pathway_notes: 'Pathway',
  materials_needed: 'Materials',
  notes: 'Notes',
};

export default function SurveyPhotoRead({
  photoUrl, position, noun, onAccept,
}: {
  photoUrl: string | undefined;
  position: number;
  noun: 'camera' | 'drop';
  onAccept: (patch: Record<string, string>) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<Record<string, string> | null>(null);
  const [used, setUsed] = useState<Set<string>>(new Set());

  if (!photoUrl) return null;

  const read = async () => {
    setBusy(true);
    setSuggestions(null);
    setUsed(new Set());
    try {
      const res = await fetch('/api/survey-vision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: photoUrl, position, noun }),
      });
      const data = await res.json();
      const result = (data?.result ?? {}) as Record<string, string>;
      if (Object.keys(result).length === 0) {
        toastError(
          data?.source === 'no-key'
            ? 'No AI key set up — fill the row in yourself.'
            : "Couldn't read anything useful from that photo.",
        );
      } else {
        setSuggestions(result);
      }
    } catch {
      toastError("Couldn't reach the assistant. Fill the row in yourself.");
    }
    setBusy(false);
  };

  const take = (key: string, value: string) => {
    onAccept({ [key]: value });
    setUsed((prev) => new Set(prev).add(key));
  };

  const takeAll = () => {
    const remaining = Object.entries(suggestions ?? {}).filter(([k]) => !used.has(k));
    if (remaining.length === 0) return;
    onAccept(Object.fromEntries(remaining));
    setUsed(new Set(Object.keys(suggestions ?? {})));
  };

  const entries = Object.entries(suggestions ?? {});
  const left = entries.filter(([k]) => !used.has(k)).length;

  return (
    <div style={{ marginTop: 10 }}>
      <button
        onClick={read}
        disabled={busy}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer',
          padding: '9px 14px', borderRadius: 999,
          border: '1px solid rgba(14,27,46,0.3)', background: 'rgba(14,27,46,0.06)',
          color: 'var(--teal)', fontSize: 12.5, fontWeight: 700,
        }}
      >
        {busy ? <Loader2 size={14} /> : <Sparkles size={14} />}
        {busy ? 'Reading the photo…' : suggestions ? 'Read again' : 'Read the photo'}
      </button>

      {entries.length > 0 && (
        <div style={{
          marginTop: 10, padding: '12px 13px', borderRadius: 12,
          background: 'rgba(14,27,46,0.04)', border: '1px solid rgba(14,27,46,0.15)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 9 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.8, color: 'var(--teal)', textTransform: 'uppercase' }}>
              Suggestions — tap to use
            </div>
            {left > 1 && (
              <button
                onClick={takeAll}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--teal)', fontSize: 11.5, fontWeight: 700 }}
              >Use all {left}</button>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {entries.map(([key, value]) => {
              const taken = used.has(key);
              return (
                <button
                  key={key}
                  onClick={() => !taken && take(key, value)}
                  disabled={taken}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 9, textAlign: 'left',
                    padding: '8px 10px', borderRadius: 9, cursor: taken ? 'default' : 'pointer',
                    background: taken ? 'rgba(16,185,129,0.08)' : 'white',
                    border: `1px solid ${taken ? 'rgba(16,185,129,0.3)' : '#e8e5dd'}`,
                  }}
                >
                  {taken
                    ? <Check size={14} color="#047857" style={{ flexShrink: 0, marginTop: 2 }} />
                    : <span style={{ width: 14, flexShrink: 0 }} />}
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 10, fontWeight: 700, letterSpacing: 0.5, color: '#a8a294', textTransform: 'uppercase' }}>
                      {LABELS[key] ?? key}
                    </span>
                    <span style={{ display: 'block', fontSize: 13, color: taken ? '#047857' : '#333', lineHeight: 1.4, marginTop: 1 }}>
                      {value}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, fontSize: 10.5, color: '#a8a294', lineHeight: 1.45 }}>
            <X size={11} style={{ flexShrink: 0 }} />
            <span>Suggestions only — nothing is saved until you tap it. Never a price or a cable length.</span>
          </div>
        </div>
      )}
    </div>
  );
}
