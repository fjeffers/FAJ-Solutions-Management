'use client';
// Count or measure on a photo, on the tech's phone (Fred, 2026-10-07, sending
// the iScanner app: "all the above for my tech to use").
//
//   Count:   tap each thing (ports, cameras, drops…) — numbered dots and a
//            running total. Tap a dot again to take it off.
//   Measure: tap both ends of something you know the length of, type that
//            length, then tap the ends of whatever you want measured
//            (lib/photo-measure.ts).
//
// "Save to the job" burns the marks and a heading into the picture and sends
// it with the job's photos (the usual date/time/GPS stamp is added on top).
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, Check, Images, Loader2, Undo2, X } from 'lucide-react';
import { feetInches, parseLength, pxLength, scaleFrom, type Pt } from '@/lib/photo-measure';
import { toastError } from '@/lib/toast';

type Mode = 'count' | 'measure';
type Line = { a: Pt; b?: Pt };

async function loadPhoto(file: File): Promise<HTMLCanvasElement> {
  const MAX = 2400;
  let bmp: ImageBitmap | HTMLImageElement;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch {
    bmp = await new Promise<HTMLImageElement>((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error("That photo couldn't be opened.")); im.src = URL.createObjectURL(file); });
  }
  const w0 = 'naturalWidth' in bmp ? bmp.naturalWidth : bmp.width, h0 = 'naturalHeight' in bmp ? bmp.naturalHeight : bmp.height;
  const k = Math.min(1, MAX / Math.max(w0, h0));
  const c = document.createElement('canvas');
  c.width = Math.round(w0 * k); c.height = Math.round(h0 * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return c;
}

export default function PhotoMarkup({ mode, onClose, onSave }: {
  mode: Mode;
  onClose: () => void;
  /** The marked-up picture, ready for the job's photos. */
  onSave: (file: File, source: 'camera' | 'library', note: string) => Promise<void> | void;
}) {
  const [photo, setPhoto] = useState<{ canvas: HTMLCanvasElement; url: string; source: 'camera' | 'library' } | null>(null);
  const [dots, setDots] = useState<Pt[]>([]);
  const [what, setWhat] = useState('');
  const [ref, setRef] = useState<Line | null>(null);
  const [refText, setRefText] = useState("2'");
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const downAt = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => { setMounted(true); }, []);

  const W = photo?.canvas.width ?? 1, H = photo?.canvas.height ?? 1;
  const s = Math.max(W, H) / 60; // mark size in image pixels
  const refFeet = parseLength(refText);
  const scale = ref?.b && refFeet ? scaleFrom(ref.a, ref.b, refFeet) : null;

  const open = async (file: File | undefined, source: 'camera' | 'library') => {
    if (!file) return;
    setBusy('Opening the photo…');
    try {
      const canvas = await loadPhoto(file);
      setPhoto({ canvas, url: canvas.toDataURL('image/jpeg', 0.85), source });
      setDots([]); setRef(null); setLines([]);
    } catch (e) { toastError(e instanceof Error ? e.message : "That photo couldn't be opened."); }
    finally { setBusy(null); }
  };

  const toImg = (clientX: number, clientY: number): Pt | null => {
    const m = svgRef.current?.getScreenCTM();
    if (!m) return null;
    const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    return { x: Math.min(Math.max(p.x, 0), W), y: Math.min(Math.max(p.y, 0), H) };
  };
  const tap = (p: Pt) => {
    if (mode === 'count') {
      const hit = dots.findIndex((d) => pxLength(d, p) < s * 1.2);
      setDots((ds) => (hit >= 0 ? ds.filter((_, i) => i !== hit) : [...ds, p]));
      return;
    }
    if (!ref?.b) { setRef((r) => (!r ? { a: p } : { a: r.a, b: p })); return; }
    setLines((ls) => {
      const last = ls[ls.length - 1];
      if (last && !last.b) return [...ls.slice(0, -1), { a: last.a, b: p }];
      return [...ls, { a: p }];
    });
  };
  const undo = () => {
    if (mode === 'count') { setDots((d) => d.slice(0, -1)); return; }
    if (lines.length) { setLines((ls) => { const last = ls[ls.length - 1]; return last.b ? [...ls.slice(0, -1), { a: last.a }] : ls.slice(0, -1); }); return; }
    setRef((r) => (r?.b ? { a: r.a } : null));
  };

  const label = (l: Line) => (l.b && scale ? feetInches(pxLength(l.a, l.b) * scale) : '');
  const heading = mode === 'count'
    ? `${dots.length} ${what.trim() || (dots.length === 1 ? 'item' : 'items')} counted`
    : `Measured: ${lines.filter((l) => l.b).map(label).join(', ') || '—'}${refFeet ? ` (reference ${feetInches(refFeet)})` : ''}`;
  const hint = mode === 'count'
    ? 'Tap each one to count it. Tap a number again to take it off.'
    : !ref ? 'Tap one end of something you know the length of (a ceiling tile, a door, a tape measure).'
      : !ref.b ? 'Now tap its other end.'
        : !scale ? 'Type how long that is (like 2\' or 30in).'
          : 'Now tap both ends of what you want to measure. Keep it on the same flat surface.';

  const save = async () => {
    if (!photo) return;
    setBusy('Saving…');
    try {
      const c = document.createElement('canvas');
      const band = Math.round(s * 2.4);
      c.width = W; c.height = H + band;
      const g = c.getContext('2d')!;
      g.fillStyle = '#0E1B2E'; g.fillRect(0, 0, W, band);
      g.fillStyle = '#E3C987'; g.font = `700 ${Math.round(s * 1.1)}px Inter, Arial, sans-serif`; g.textBaseline = 'middle';
      g.fillText(heading, s * 0.8, band / 2, W - s * 1.6);
      g.drawImage(photo.canvas, 0, band);
      const at = (p: Pt) => ({ x: p.x, y: p.y + band });
      const text = (t: string, p: Pt, color: string) => {
        g.font = `800 ${Math.round(s * 0.9)}px Inter, Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.lineWidth = s * 0.35; g.strokeStyle = '#fff'; g.strokeText(t, p.x, p.y); g.fillStyle = color; g.fillText(t, p.x, p.y);
      };
      if (mode === 'count') {
        dots.forEach((d, i) => {
          const p = at(d);
          g.beginPath(); g.arc(p.x, p.y, s * 0.9, 0, Math.PI * 2); g.fillStyle = '#C62828'; g.fill();
          g.lineWidth = s * 0.15; g.strokeStyle = '#fff'; g.stroke();
          g.fillStyle = '#fff'; g.font = `800 ${Math.round(s * 0.9)}px Inter, Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillText(String(i + 1), p.x, p.y);
        });
      } else {
        const drawLine = (l: Line, color: string, t: string, dash: boolean) => {
          if (!l.b) return;
          const a = at(l.a), b = at(l.b);
          g.setLineDash(dash ? [s * 0.6, s * 0.4] : []); g.lineWidth = s * 0.3; g.strokeStyle = color;
          g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); g.setLineDash([]);
          for (const p of [a, b]) { g.beginPath(); g.arc(p.x, p.y, s * 0.35, 0, Math.PI * 2); g.fillStyle = color; g.fill(); }
          text(t, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - s * 0.9 }, color);
        };
        if (ref?.b && refFeet) drawLine(ref, '#C9A24B', `${feetInches(refFeet)} (reference)`, true);
        lines.forEach((l) => drawLine(l, '#1565C0', label(l), false));
      }
      const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't save the picture."))), 'image/jpeg', 0.88));
      await onSave(new File([blob], `${mode}.jpg`, { type: 'image/jpeg' }), photo.source, heading);
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Couldn't save the picture.");
    } finally { setBusy(null); }
  };

  const pick = (label: string, icon: React.ReactNode, camera: boolean, primary: boolean) => (
    <label className={`wf-btn ${primary ? 'wf-btn-gold' : 'wf-btn-outline'}`} style={{ flex: '1 1 150px', justifyContent: 'center' }}>
      {icon} {label}
      <input type="file" accept="image/*" {...(camera ? { capture: 'environment' as const } : {})} style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void open(f, camera ? 'camera' : 'library'); }} />
    </label>
  );
  const canSave = mode === 'count' ? dots.length > 0 : lines.some((l) => l.b) && !!scale;

  if (!mounted) return null;
  return createPortal(
    <div className="wf" role="dialog" aria-modal="true" aria-label={mode === 'count' ? 'Count on a photo' : 'Measure on a photo'}
      style={{ position: 'fixed', inset: 0, zIndex: 400, background: photo ? '#0E1B2E' : 'var(--wf-surface, #F6F4EF)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: '#0E1B2E', color: '#fff' }}>
        <button type="button" className="wf-btn wf-btn-sm" onClick={onClose} aria-label="Close" style={{ background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.3)' }}><X size={16} /></button>
        <div style={{ flex: 1, minWidth: 0, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{photo ? heading : mode === 'count' ? 'Count on a photo' : 'Measure on a photo'}</div>
        {busy && <span style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}><Loader2 size={14} className="spin" /> {busy}</span>}
      </div>

      {!photo ? (
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ color: 'var(--wf-subtle)', fontSize: 14 }}>
            {mode === 'count'
              ? 'Take a photo of what you need to count — ports on a switch, cameras on a wall, drops in a ceiling — then tap each one.'
              : 'Take a photo straight-on. You’ll tap something you know the length of first, then measure anything else on the same surface.'}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {pick('Take a photo', <Camera size={17} />, true, true)}
            {pick('From photos', <Images size={17} />, false, false)}
          </div>
        </div>
      ) : (
        <>
          <div style={{ flex: 1, minHeight: 0, padding: 8 }}>
            <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%', touchAction: 'none' }}
              onPointerDown={(e) => { downAt.current = { x: e.clientX, y: e.clientY }; }}
              onPointerUp={(e) => {
                const d = downAt.current; downAt.current = null;
                if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10) return;
                const p = toImg(e.clientX, e.clientY);
                if (p) tap(p);
              }}>
              <image href={photo.url} x={0} y={0} width={W} height={H} />
              {mode === 'count' && dots.map((d, i) => (
                <g key={i}>
                  <circle cx={d.x} cy={d.y} r={s * 0.9} fill="#C62828" stroke="#fff" strokeWidth={s * 0.15} />
                  <text x={d.x} y={d.y} fontSize={s * 0.9} fontWeight={800} fill="#fff" textAnchor="middle" dominantBaseline="central" fontFamily="Inter, Arial, sans-serif">{i + 1}</text>
                </g>
              ))}
              {mode === 'measure' && [
                ...(ref ? [{ l: ref, color: '#C9A24B', t: refFeet ? `${feetInches(refFeet)} (reference)` : 'reference', dash: true }] : []),
                ...lines.map((l) => ({ l, color: '#1565C0', t: label(l), dash: false })),
              ].map(({ l, color, t, dash }, i) => (
                <g key={i}>
                  {l.b && <line x1={l.a.x} y1={l.a.y} x2={l.b.x} y2={l.b.y} stroke={color} strokeWidth={s * 0.3} strokeDasharray={dash ? `${s * 0.6} ${s * 0.4}` : undefined} />}
                  {[l.a, l.b].filter(Boolean).map((p, j) => <circle key={j} cx={p!.x} cy={p!.y} r={s * 0.4} fill={color} stroke="#fff" strokeWidth={s * 0.1} />)}
                  {l.b && t && (
                    <text x={(l.a.x + l.b.x) / 2} y={(l.a.y + l.b.y) / 2 - s * 0.9} fontSize={s * 0.9} fontWeight={800} fill={color} stroke="#fff" strokeWidth={s * 0.3} paintOrder="stroke" textAnchor="middle" fontFamily="Inter, Arial, sans-serif">{t}</text>
                  )}
                </g>
              ))}
            </svg>
          </div>
          <div style={{ padding: '8px 12px', background: '#13284A', color: '#fff', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 13 }}>{hint}</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {mode === 'count' ? (
                <input className="wf-input" value={what} onChange={(e) => setWhat(e.target.value)} maxLength={40} placeholder="What are you counting? (ports, cameras…)"
                  style={{ flex: '1 1 200px', fontSize: 16 }} aria-label="What you're counting" />
              ) : ref?.b ? (
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>Reference is
                  <input className="wf-input" value={refText} onChange={(e) => setRefText(e.target.value)} style={{ width: 90, fontSize: 16 }} aria-label="Reference length" />
                </label>
              ) : null}
              <button type="button" className="wf-btn wf-btn-sm" onClick={undo} style={{ background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.3)' }}><Undo2 size={15} /> Undo</button>
              <span style={{ flex: 1 }} />
              <button type="button" className="wf-btn wf-btn-gold" disabled={!canSave || !!busy} onClick={() => void save()}><Check size={16} /> Save to the job</button>
            </div>
          </div>
        </>
      )}
    </div>,
    document.body,
  );
}
