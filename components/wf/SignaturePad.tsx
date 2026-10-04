'use client';
// Sign with a finger — the customer's signature on a job, in the tech portal's
// job report questions and the closeout sign-off.
import { useEffect, useRef, useState } from 'react';

/** Sign with a finger. Hands back a JPEG on a white background. */
export default function SignaturePad({ existing, busy, disabled, onSigned }: {
  existing: string | null; busy?: boolean; disabled?: boolean; onSigned: (blob: Blob) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);
  const [redo, setRedo] = useState(!existing);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
  }, [redo]);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = e.currentTarget;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * c.width) / r.width, y: ((e.clientY - r.top) * c.height) / r.height };
  };

  if (existing && !redo) {
    return (
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={existing} alt="Signature" style={{ maxWidth: 240, borderRadius: 8, border: '1px solid var(--wf-line)' }} />
        {!disabled && <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={() => setRedo(true)}>Sign again</button>}
      </div>
    );
  }

  return (
    <div>
      <canvas
        ref={ref} width={700} height={220}
        style={{ width: '100%', height: 140, border: '1.5px solid var(--wf-line)', borderRadius: 10, touchAction: 'none', background: '#fff' }}
        onPointerDown={(e) => {
          if (disabled) return;
          const ctx = e.currentTarget.getContext('2d');
          if (!ctx) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = true;
          const p = pos(e);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = e.currentTarget.getContext('2d');
          if (!ctx) return;
          const p = pos(e);
          ctx.lineTo(p.x, p.y);
          ctx.strokeStyle = '#1B1C1F';
          ctx.lineWidth = 3.5;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.stroke();
          setHasInk(true);
        }}
        onPointerUp={() => { drawing.current = false; }}
        onPointerLeave={() => { drawing.current = false; }}
      />
      {!disabled && (
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={() => {
            const c = ref.current;
            const ctx = c?.getContext('2d');
            if (c && ctx) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
            setHasInk(false);
          }}>Clear</button>
          <button className="wf-btn wf-btn-outline wf-btn-sm" disabled={!hasInk || busy}
            onClick={() => ref.current?.toBlob((b) => { if (b) onSigned(b); }, 'image/jpeg', 0.9)}>
            {busy ? 'Sending…' : 'Use this signature'}
          </button>
        </div>
      )}
    </div>
  );
}
