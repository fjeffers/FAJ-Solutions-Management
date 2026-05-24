'use client';
import { useState, useRef } from 'react';
import type { CustomQAItem } from '@/lib/types';

interface Props {
  woId: string;
  token: string;
  qa: CustomQAItem[];
}

// ─── Signature Pad ────────────────────────────────────────────────────────────

function SignaturePad({
  existingUrl,
  isUploading,
  onSave,
  uploadError,
}: {
  existingUrl: string | null;
  isUploading: boolean;
  onSave: (blob: Blob) => void;
  uploadError?: string;
}) {
  const canvasRef               = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing]   = useState(false);
  const [hasStrokes, setHasStrokes] = useState(false);
  const [resigning, setResigning]   = useState(false);

  function getPos(
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>,
    canvas: HTMLCanvasElement,
  ) {
    const rect   = canvas.getBoundingClientRect();
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;
    if ('touches' in e) {
      const t = e.touches[0];
      return { x: (t.clientX - rect.left) * scaleX, y: (t.clientY - rect.top) * scaleY };
    }
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  function startDraw(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx    = canvas.getContext('2d'); if (!ctx) return;
    const pos    = getPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    setDrawing(true);
    setHasStrokes(true);
  }

  function draw(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    e.preventDefault();
    if (!drawing) return;
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx    = canvas.getContext('2d'); if (!ctx) return;
    const pos    = getPos(e, canvas);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth   = 2.5;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.stroke();
  }

  function endDraw(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    e.preventDefault();
    setDrawing(false);
  }

  function clearCanvas() {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx    = canvas.getContext('2d'); if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasStrokes(false);
  }

  function saveSignature() {
    const canvas = canvasRef.current;
    if (!canvas || !hasStrokes) return;
    canvas.toBlob((blob) => { if (blob) onSave(blob); }, 'image/png');
  }

  // Show existing signature with option to re-sign
  if (existingUrl && !resigning) {
    return (
      <div>
        <img
          src={existingUrl}
          alt="Signature"
          style={{
            maxWidth: '100%', maxHeight: 100,
            border: '1px solid #e5e7eb', borderRadius: 8,
            background: 'white', display: 'block',
          }}
        />
        <button
          onClick={() => setResigning(true)}
          style={{
            marginTop: 6, fontSize: 12, color: 'var(--teal)',
            background: 'none', border: 'none', cursor: 'pointer',
            fontWeight: 600, padding: 0,
          }}
        >
          🖊️ Re-sign
        </button>
        {uploadError && <div style={{ fontSize: 12, color: '#dc2626', marginTop: 4 }}>{uploadError}</div>}
      </div>
    );
  }

  return (
    <div>
      <div style={{ position: 'relative' }}>
        <canvas
          ref={canvasRef}
          width={600}
          height={160}
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={endDraw}
          onMouseLeave={endDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={endDraw}
          style={{
            width: '100%', height: 110,
            border: '1.5px solid #d1d5db',
            borderRadius: 8,
            background: 'white',
            cursor: 'crosshair',
            touchAction: 'none',
            display: 'block',
          }}
        />
        {!hasStrokes && (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none', fontSize: 13, color: '#c4c9d4', fontStyle: 'italic',
          }}>
            Sign here
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <button
          onClick={clearCanvas}
          disabled={!hasStrokes}
          style={{
            fontSize: 12, padding: '6px 12px',
            border: '1px solid #e5e7eb', borderRadius: 6,
            background: 'white', color: '#6b7280',
            cursor: hasStrokes ? 'pointer' : 'not-allowed',
          }}
        >
          Clear
        </button>
        <button
          onClick={saveSignature}
          disabled={!hasStrokes || isUploading}
          style={{
            fontSize: 12, padding: '6px 16px',
            border: 'none', borderRadius: 6,
            background: hasStrokes && !isUploading ? 'var(--teal)' : '#9ca3af',
            color: 'white',
            cursor: hasStrokes && !isUploading ? 'pointer' : 'not-allowed',
            fontWeight: 600,
          }}
        >
          {isUploading ? '⏳ Saving…' : '✓ Save Signature'}
        </button>
      </div>
      {uploadError && <div style={{ fontSize: 12, color: '#dc2626', marginTop: 4 }}>{uploadError}</div>}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function PortalQA({ woId, token, qa: initialQA }: Props) {
  const [qa, setQA]             = useState<CustomQAItem[]>(initialQA);
  const [saving, setSaving]     = useState<string | null>(null);
  const [saved, setSaved]       = useState<string | null>(null);
  const [error, setError]       = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<Record<string, string>>({});
  const timers      = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const photoInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const docInputs   = useRef<Record<string, HTMLInputElement | null>>({});

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

  async function handleFileUpload(itemId: string, file: File) {
    setIsUploading(itemId);
    setUploadError((prev) => { const n = { ...prev }; delete n[itemId]; return n; });

    try {
      const fd = new FormData();
      fd.append('token', token);
      fd.append('wo_id', woId);
      fd.append('file', file);

      const res  = await fetch('/api/portal/upload', { method: 'POST', body: fd });
      const data = await res.json();

      if (!res.ok || !data.url) throw new Error(data.error ?? 'Upload failed');

      // Save the returned URL as this Q&A item's answer
      await saveAnswer(itemId, data.url);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Upload failed. Please try again.';
      setUploadError((prev) => ({ ...prev, [itemId]: msg }));
    } finally {
      setIsUploading(null);
    }
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
          const isSaving = saving    === item.id;
          const isSaved  = saved     === item.id;
          const isUpload = isUploading === item.id;
          const fileErr  = uploadError[item.id];

          return (
            <div key={item.id}>
              {/* Label */}
              <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 5, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{item.label}</span>
                {isSaving  && <span style={{ fontSize: 11, color: '#9ca3af' }}>saving…</span>}
                {isSaved   && <span style={{ fontSize: 11, color: '#047857' }}>✓ saved</span>}
                {isUpload  && <span style={{ fontSize: 11, color: '#9ca3af' }}>uploading…</span>}
              </div>

              {/* ── yes_no ── */}
              {item.type === 'yes_no' ? (
                <div style={{ display: 'flex', gap: 8 }}>
                  {(['Yes', 'No'] as const).map((opt) => (
                    <button
                      key={opt}
                      onClick={() => saveAnswer(item.id, opt)}
                      style={{
                        flex: 1, padding: '9px 0', fontSize: 13, fontWeight: 600, borderRadius: 8,
                        border: `1.5px solid ${item.answer === opt ? (opt === 'Yes' ? '#047857' : '#dc2626') : '#e5e7eb'}`,
                        background: item.answer === opt
                          ? (opt === 'Yes' ? 'rgba(4,120,87,0.08)' : 'rgba(220,38,38,0.07)')
                          : 'white',
                        color: item.answer === opt
                          ? (opt === 'Yes' ? '#047857' : '#dc2626')
                          : '#6b7280',
                        cursor: 'pointer', transition: 'all 0.15s',
                      }}
                    >
                      {opt === 'Yes' ? '✓ Yes' : '✗ No'}
                    </button>
                  ))}
                </div>

              /* ── textarea ── */
              ) : item.type === 'textarea' ? (
                <textarea
                  value={item.answer ?? ''}
                  onChange={(e) => saveAnswer(item.id, e.target.value)}
                  rows={3}
                  placeholder="Enter your answer…"
                  style={{ ...inputBase, resize: 'vertical', fontFamily: 'inherit' }}
                />

              /* ── number ── */
              ) : item.type === 'number' ? (
                <input
                  type="number"
                  value={item.answer ?? ''}
                  onChange={(e) => saveAnswer(item.id, e.target.value)}
                  placeholder="Enter number…"
                  style={inputBase}
                />

              /* ── photo ── */
              ) : item.type === 'photo' ? (
                <div>
                  {/* Hidden file input — capture="environment" opens back camera on mobile */}
                  <input
                    ref={(el) => { photoInputs.current[item.id] = el; }}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFileUpload(item.id, file);
                      e.target.value = '';
                    }}
                  />

                  {item.answer ? (
                    <div>
                      <img
                        src={item.answer}
                        alt={item.label}
                        style={{ width: '100%', maxWidth: 320, borderRadius: 8, border: '1px solid #e5e7eb', display: 'block', objectFit: 'cover' }}
                      />
                      <button
                        onClick={() => photoInputs.current[item.id]?.click()}
                        disabled={isUpload}
                        style={{ marginTop: 6, fontSize: 12, color: 'var(--teal)', background: 'none', border: 'none', cursor: isUpload ? 'wait' : 'pointer', padding: 0, fontWeight: 600 }}
                      >
                        {isUpload ? '⏳ Uploading…' : '🔄 Replace photo'}
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => photoInputs.current[item.id]?.click()}
                      disabled={isUpload}
                      style={{
                        width: '100%', padding: '16px 12px',
                        border: `2px dashed ${isUpload ? '#9ca3af' : '#d1d5db'}`,
                        borderRadius: 8, background: isUpload ? '#f3f4f6' : 'white',
                        cursor: isUpload ? 'wait' : 'pointer', fontSize: 14,
                        color: isUpload ? '#9ca3af' : '#6b7280',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        gap: 8, transition: 'all 0.15s', fontWeight: 500,
                      }}
                      onMouseEnter={(e) => { if (!isUpload) (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--teal)'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#d1d5db'; }}
                    >
                      {isUpload
                        ? '⏳ Uploading…'
                        : <><span style={{ fontSize: 20 }}>📷</span> Tap to take photo or choose from library</>
                      }
                    </button>
                  )}
                  {fileErr && <div style={{ fontSize: 12, color: '#dc2626', marginTop: 4 }}>{fileErr}</div>}
                </div>

              /* ── document ── */
              ) : item.type === 'document' ? (
                <div>
                  {/* Hidden file input — no camera capture, accepts docs + images */}
                  <input
                    ref={(el) => { docInputs.current[item.id] = el; }}
                    type="file"
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,image/*"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFileUpload(item.id, file);
                      e.target.value = '';
                    }}
                  />

                  {item.answer ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <a
                        href={item.answer}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '9px 12px', borderRadius: 8,
                          background: '#f9fafb', border: '1px solid #e5e7eb',
                          textDecoration: 'none', color: '#374151', fontSize: 13,
                        }}
                      >
                        <span>📄</span>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                          {decodeURIComponent(item.answer.split('/').pop() ?? 'View document')}
                        </span>
                        <span style={{ fontSize: 11, color: '#9ca3af', flexShrink: 0 }}>View ↗</span>
                      </a>
                      <button
                        onClick={() => docInputs.current[item.id]?.click()}
                        disabled={isUpload}
                        style={{ fontSize: 12, color: 'var(--teal)', background: 'none', border: 'none', cursor: isUpload ? 'wait' : 'pointer', padding: 0, fontWeight: 600, alignSelf: 'flex-start' }}
                      >
                        {isUpload ? '⏳ Uploading…' : '🔄 Replace document'}
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => docInputs.current[item.id]?.click()}
                      disabled={isUpload}
                      style={{
                        width: '100%', padding: '16px 12px',
                        border: `2px dashed ${isUpload ? '#9ca3af' : '#d1d5db'}`,
                        borderRadius: 8, background: isUpload ? '#f3f4f6' : 'white',
                        cursor: isUpload ? 'wait' : 'pointer', fontSize: 14,
                        color: isUpload ? '#9ca3af' : '#6b7280',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        gap: 8, transition: 'all 0.15s', fontWeight: 500,
                      }}
                      onMouseEnter={(e) => { if (!isUpload) (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--teal)'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#d1d5db'; }}
                    >
                      {isUpload
                        ? '⏳ Uploading…'
                        : <><span style={{ fontSize: 20 }}>📎</span> Tap to upload document (PDF, Word, Excel…)</>
                      }
                    </button>
                  )}
                  {fileErr && <div style={{ fontSize: 12, color: '#dc2626', marginTop: 4 }}>{fileErr}</div>}
                </div>

              /* ── signature ── */
              ) : item.type === 'signature' ? (
                <SignaturePad
                  key={item.answer ?? `sig-${item.id}`}
                  existingUrl={item.answer ?? null}
                  isUploading={isUpload}
                  onSave={(blob) =>
                    handleFileUpload(item.id, new File([blob], 'signature.png', { type: 'image/png' }))
                  }
                  uploadError={fileErr}
                />

              /* ── text (default) ── */
              ) : (
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
