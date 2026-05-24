'use client';
import { useState, useRef, useEffect } from 'react';

interface Props {
  woId: string;
  woNumber: string;
  token: string;
  currentStatus: string;
  initialNotes: string;
  photoRequired: boolean;
  signatureRequired: boolean;
  onStatusUpdate: (woId: string, status: string) => Promise<void>;
}

// Parse the missing[] array from validate-closeout into per-requirement booleans
function parseMissing(missing: string[]) {
  return {
    notesOk:  !missing.some((m) => m.toLowerCase().includes('closeout notes')),
    photoOk:  !missing.some((m) => m.toLowerCase().includes('photo')),
    sigOk:    !missing.some((m) => m.toLowerCase().includes('signature')),
    qaOk:     !missing.some((m) => m.toLowerCase().includes('fields need to be completed')),
  };
}

export default function PortalWorkDoneGate({
  woId,
  woNumber,
  token,
  currentStatus,
  initialNotes,
  photoRequired,
  signatureRequired,
  onStatusUpdate,
}: Props) {
  const [notes, setNotes]       = useState(initialNotes ?? '');
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);
  const [saveError, setSaveErr] = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);
  const [done, setDone]         = useState(false);
  const [errors, setErrors]     = useState<string[]>([]);

  // Live checklist state (photo, signature, QA — polled from server)
  const [photoOk, setPhotoOk] = useState(false);
  const [sigOk,   setSigOk]   = useState(false);
  const [qaOk,    setQaOk]    = useState(true);

  const saveTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollTimer  = useRef<ReturnType<typeof setInterval> | null>(null);

  const isActive = currentStatus === 'In Progress' && !done;
  const notesOk  = notes.trim().length > 0;

  // ── Server-side poll to keep checklist live ────────────────────────────────
  async function pollChecklist() {
    try {
      const res  = await fetch(
        `/api/portal/validate-closeout?token=${encodeURIComponent(token)}&wo_id=${encodeURIComponent(woId)}`,
      );
      if (!res.ok) return;
      const data = await res.json();
      const parsed = parseMissing(data.missing ?? []);
      setPhotoOk(parsed.photoOk);
      setSigOk(parsed.sigOk);
      setQaOk(parsed.qaOk);
    } catch { /* silent */ }
  }

  useEffect(() => {
    if (!isActive) return;

    // Initial check immediately on mount
    pollChecklist();

    // Then poll every 4 seconds so checklist reflects uploads/signatures in real time
    pollTimer.current = setInterval(pollChecklist, 4000);

    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);

  // ── Auto-save notes ────────────────────────────────────────────────────────
  function handleChange(value: string) {
    setNotes(value);
    setSaved(false);
    setSaveErr(null);
    setErrors([]);

    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
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
        setSaveErr('Could not save notes. Please try again.');
      } finally {
        setSaving(false);
      }
    }, 700);
  }

  // ── Mark Work Done ─────────────────────────────────────────────────────────
  async function handleMarkDone() {
    if (loading || done) return;

    if (!notesOk) {
      setErrors(['Closeout notes are required before marking work done.']);
      return;
    }

    setLoading(true);
    setErrors([]);

    try {
      const res  = await fetch(
        `/api/portal/validate-closeout?token=${encodeURIComponent(token)}&wo_id=${encodeURIComponent(woId)}`,
      );
      const data = await res.json();

      if (!res.ok) throw new Error(data.error ?? 'Validation failed');

      if (data.missing && data.missing.length > 0) {
        const parsed = parseMissing(data.missing);
        setPhotoOk(parsed.photoOk);
        setSigOk(parsed.sigOk);
        setQaOk(parsed.qaOk);
        setErrors(data.missing);
        return;
      }

      await onStatusUpdate(woId, 'Work Done');
      setDone(true);
      if (pollTimer.current) clearInterval(pollTimer.current);
    } catch (err) {
      setErrors([err instanceof Error ? err.message : 'Something went wrong. Please try again.']);
    } finally {
      setLoading(false);
    }
  }

  // Determine if we have requirements to show in the checklist
  const hasRequirements = photoRequired || signatureRequired;

  // Whether all requirements are met (for button hint)
  const allMet = notesOk
    && (!photoRequired    || photoOk)
    && (!signatureRequired || sigOk)
    && qaOk;

  return (
    <>
      {/* ── Closeout Notes ── */}
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
          disabled={!isActive && currentStatus !== 'Assigned'}
          style={{
            width: '100%',
            padding: '10px 12px',
            fontSize: 13,
            border: `1px solid ${errors.some((m) => m.toLowerCase().includes('closeout notes')) ? '#ef4444' : '#e5e7eb'}`,
            borderRadius: 8,
            background: isActive || currentStatus === 'Assigned' ? 'white' : '#f9fafb',
            color: '#1a1a1a',
            outline: 'none',
            resize: isActive ? 'vertical' : 'none',
            fontFamily: 'inherit',
            boxSizing: 'border-box',
            lineHeight: 1.5,
            transition: 'border-color 0.15s',
            cursor: isActive ? 'auto' : 'default',
          }}
        />

        {saveError && (
          <div style={{ fontSize: 12, color: '#dc2626', marginTop: 4 }}>{saveError}</div>
        )}
      </div>

      {/* ── Mark Work Done gate (only while In Progress) ── */}
      {currentStatus === 'In Progress' && (
        <div style={{ marginTop: 4 }}>

          {/* Requirements checklist */}
          {(hasRequirements || !qaOk) && !done && (
            <div style={{
              background: '#f9fafb',
              border: '1px solid #e5e7eb',
              borderRadius: 10,
              padding: '10px 14px',
              marginBottom: 12,
            }}>
              <div style={{ fontWeight: 700, color: '#374151', marginBottom: 8, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Required before completing
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>

                {/* Notes — always shown, live local state */}
                <ChecklistRow label="Closeout notes" ok={notesOk} />

                {/* Photo — shown only if required, refreshed by poll */}
                {photoRequired && (
                  <ChecklistRow label="At least one photo uploaded" ok={photoOk} />
                )}

                {/* Signature — shown only if required, refreshed by poll */}
                {signatureRequired && (
                  <ChecklistRow label="Signature captured" ok={sigOk} />
                )}

                {/* Q&A — shown when there are unanswered items */}
                {!qaOk && (
                  <ChecklistRow label="All required fields answered" ok={false} />
                )}

              </div>
            </div>
          )}

          {/* Validation errors (after failed attempt) */}
          {errors.length > 0 && (
            <div style={{
              background: 'rgba(239,68,68,0.06)',
              border: '1px solid rgba(239,68,68,0.25)',
              borderRadius: 10,
              padding: '10px 14px',
              marginBottom: 12,
            }}>
              {errors.map((msg, i) => (
                <div key={i} style={{ fontSize: 12, color: '#dc2626', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                  <span style={{ flexShrink: 0 }}>⚠</span>
                  <span>{msg}</span>
                </div>
              ))}
            </div>
          )}

          {/* Done confirmation */}
          {done ? (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px',
              background: 'rgba(4,120,87,0.08)', borderRadius: 10,
              border: '1px solid rgba(4,120,87,0.15)', color: '#047857',
              fontSize: 13, fontWeight: 700,
            }}>
              ✓ Marked as Work Done — WO #{woNumber}
            </div>
          ) : (
            <button
              disabled={loading}
              onClick={handleMarkDone}
              style={{
                width: '100%',
                padding: '12px 20px',
                background: loading
                  ? '#f3f4f6'
                  : allMet
                    ? 'linear-gradient(135deg, #059669 0%, #047857 100%)'
                    : 'linear-gradient(135deg, #6b7280 0%, #4b5563 100%)',
                color: loading ? '#047857' : 'white',
                border: 'none',
                borderRadius: 10,
                fontSize: 14,
                fontWeight: 700,
                cursor: loading ? 'wait' : 'pointer',
                letterSpacing: 0.3,
                boxShadow: loading ? 'none' : '0 4px 14px rgba(0,0,0,0.18)',
                transition: 'all 0.2s',
                opacity: loading ? 0.7 : 1,
              }}
            >
              {loading ? '⏳ Checking requirements…' : allMet ? '✓ Mark Work Done' : '⚠ Complete requirements first'}
            </button>
          )}
        </div>
      )}
    </>
  );
}

// ── Checklist row helper ──────────────────────────────────────────────────────
function ChecklistRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{
        width: 18, height: 18, borderRadius: '50%',
        background: ok ? '#047857' : '#e5e7eb',
        border: ok ? 'none' : '2px solid #d1d5db',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, transition: 'all 0.2s',
      }}>
        {ok && <span style={{ color: 'white', fontSize: 10, fontWeight: 700 }}>✓</span>}
      </span>
      <span style={{ fontSize: 12, color: ok ? '#374151' : '#9ca3af', transition: 'color 0.2s' }}>
        {label}
      </span>
    </div>
  );
}
