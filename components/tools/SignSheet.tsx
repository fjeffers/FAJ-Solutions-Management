'use client';
// Sign with a finger (or a mouse) for the PDF editor (Fred, 2026-10-07: "edit
// and sign pdfs everything from iscanner"). Signature or initials; black or
// blue ink. The tech's own signature can be kept on their phone so the next
// document takes one tap — a customer's never is unless they tick the box.
//
// Hands back a trimmed PNG with a see-through background, so it sits on the
// signature line without a white block over the page.
import { useEffect, useRef, useState } from 'react';
import { Eraser } from 'lucide-react';
import { backdropClose } from '@/lib/backdrop';
import { INK } from '@/lib/pdf-marks';

export type SignWhat = 'signature' | 'initials';
type Stroke = { x: number; y: number }[];

const KEY: Record<SignWhat, string> = { signature: 'faj.sign.signature', initials: 'faj.sign.initials' };
export function savedSign(what: SignWhat): string | null {
  try { return localStorage.getItem(KEY[what]); } catch { return null; }
}
function keepSign(what: SignWhat, png: string | null) {
  try { if (png) localStorage.setItem(KEY[what], png); else localStorage.removeItem(KEY[what]); } catch { /* private window */ }
}

/** Strokes → a trimmed, see-through PNG, three times sharper than drawn. */
function toPng(strokes: Stroke[], color: string, width: number): { src: string; w: number; h: number } | null {
  const pts = strokes.flat();
  if (pts.length < 2) return null;
  const pad = width * 2;
  const minX = Math.min(...pts.map((p) => p.x)) - pad, maxX = Math.max(...pts.map((p) => p.x)) + pad;
  const minY = Math.min(...pts.map((p) => p.y)) - pad, maxY = Math.max(...pts.map((p) => p.y)) + pad;
  const k = 3;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil((maxX - minX) * k)); c.height = Math.max(1, Math.ceil((maxY - minY) * k));
  const g = c.getContext('2d')!;
  g.scale(k, k); g.translate(-minX, -minY);
  drawStrokes(g, strokes, color, width);
  return { src: c.toDataURL('image/png'), w: maxX - minX, h: maxY - minY };
}

function drawStrokes(g: CanvasRenderingContext2D, strokes: Stroke[], color: string, width: number) {
  g.strokeStyle = color; g.fillStyle = color; g.lineWidth = width; g.lineCap = 'round'; g.lineJoin = 'round';
  for (const s of strokes) {
    if (s.length === 1) { g.beginPath(); g.arc(s[0].x, s[0].y, width / 2, 0, Math.PI * 2); g.fill(); continue; }
    g.beginPath(); g.moveTo(s[0].x, s[0].y);
    // Smooth: curve through the midpoints.
    for (let i = 1; i < s.length - 1; i++) {
      const mx = (s[i].x + s[i + 1].x) / 2, my = (s[i].y + s[i + 1].y) / 2;
      g.quadraticCurveTo(s[i].x, s[i].y, mx, my);
    }
    const last = s[s.length - 1];
    g.lineTo(last.x, last.y);
    g.stroke();
  }
}

export default function SignSheet({ onClose, onUse }: {
  onClose: () => void;
  /** The finished signature: a PNG data URL and its shape (width ÷ height). */
  onUse: (src: string, aspect: number, what: SignWhat) => void;
}) {
  const [what, setWhat] = useState<SignWhat>('signature');
  const [saved, setSaved] = useState<Record<SignWhat, string | null>>({ signature: null, initials: null });
  const [drawNew, setDrawNew] = useState(false);
  const [color, setColor] = useState<string>(INK.black);
  const [keep, setKeep] = useState(false);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef<Stroke | null>(null);

  useEffect(() => { setSaved({ signature: savedSign('signature'), initials: savedSign('initials') }); }, []);
  const mine = saved[what];
  const padOpen = drawNew || !mine;
  const LINE_W = what === 'initials' ? 3.2 : 2.6;

  // Redraw the pad whenever the strokes, ink or size change.
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const r = c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(r.width * dpr)) { c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr); }
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, r.width, r.height);
    drawStrokes(g, strokes, color, LINE_W);
  }, [strokes, color, padOpen, LINE_W]);

  const at = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const use = () => {
    if (!padOpen && mine) {
      const im = new Image();
      im.onload = () => onUse(mine, im.naturalWidth / Math.max(1, im.naturalHeight), what);
      im.src = mine;
      return;
    }
    const png = toPng(strokes, color, LINE_W);
    if (!png) return;
    if (keep) keepSign(what, png.src);
    onUse(png.src, png.w / Math.max(1, png.h), what);
  };
  const switchTo = (w: SignWhat) => { setWhat(w); setStrokes([]); setDrawNew(false); };

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 20, background: 'rgba(14,27,46,0.55)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} {...backdropClose(onClose)}>
      <div className="wf-card" style={{ width: '100%', maxWidth: 640, borderRadius: '16px 16px 0 0', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['signature', 'initials'] as const).map((w) => (
            <button key={w} type="button" className={`wf-btn wf-btn-sm ${what === w ? 'wf-btn-navy' : 'wf-btn-outline'}`} onClick={() => switchTo(w)} aria-pressed={what === w}>
              {w === 'signature' ? 'Signature' : 'Initials'}
            </button>
          ))}
          <span style={{ flex: 1 }} />
          <button type="button" className="wf-btn wf-btn-ghost wf-btn-sm" onClick={onClose}>Cancel</button>
        </div>

        {!padOpen && mine ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="wf-label">Your saved {what}</div>
            <div style={{ border: '1px solid var(--wf-line)', borderRadius: 10, background: '#fff', padding: 10, display: 'flex', justifyContent: 'center' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={mine} alt={`Saved ${what}`} style={{ maxHeight: 90, maxWidth: '100%' }} />
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="wf-btn wf-btn-gold" style={{ flex: '2 1 160px' }} onClick={use}>Use my {what}</button>
              <button type="button" className="wf-btn wf-btn-outline" style={{ flex: '1 1 140px' }} onClick={() => setDrawNew(true)}>Someone else signs</button>
              <button type="button" className="wf-btn wf-btn-ghost wf-btn-sm" onClick={() => { keepSign(what, null); setSaved((s) => ({ ...s, [what]: null })); }}>Forget it</button>
            </div>
          </div>
        ) : (
          <>
            <div style={{ position: 'relative' }}>
              <canvas ref={canvas} aria-label={`Sign here: ${what}`}
                style={{ width: '100%', height: what === 'initials' ? 150 : 190, display: 'block', background: '#fff', border: '1.5px solid var(--wf-line)', borderRadius: 12, touchAction: 'none', cursor: 'crosshair' }}
                onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); live.current = [at(e)]; setStrokes((s) => [...s, live.current!]); }}
                onPointerMove={(e) => {
                  if (!live.current) return;
                  const p = at(e), last = live.current[live.current.length - 1];
                  if (Math.hypot(p.x - last.x, p.y - last.y) < 1.2) return;
                  live.current = [...live.current, p];
                  const cur = live.current;
                  setStrokes((s) => [...s.slice(0, -1), cur]);
                }}
                onPointerUp={() => { live.current = null; }}
                onPointerCancel={() => { live.current = null; }} />
              <div style={{ position: 'absolute', left: 16, right: 16, bottom: 34, borderBottom: '1px dashed #B9B3A5', pointerEvents: 'none' }} />
              <span style={{ position: 'absolute', left: 16, bottom: 12, fontSize: 12, color: '#8A8475', pointerEvents: 'none' }}>
                {strokes.length ? '' : what === 'signature' ? 'Sign above the line' : 'Initials above the line'}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {([['Black', INK.black], ['Blue', INK.blue]] as const).map(([label, c]) => (
                <button key={c} type="button" onClick={() => setColor(c)} aria-label={`${label} ink`} aria-pressed={color === c}
                  style={{ width: 30, height: 30, borderRadius: 999, background: c, border: color === c ? '3px solid #C9A24B' : '2px solid #fff', boxShadow: '0 0 0 1px var(--wf-line)', cursor: 'pointer' }} />
              ))}
              <button type="button" className="wf-btn wf-btn-ghost wf-btn-sm" onClick={() => setStrokes([])} disabled={!strokes.length}><Eraser size={15} /> Clear</button>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13.5, flex: '1 1 220px' }}>
                <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} style={{ width: 18, height: 18 }} />
                This is my {what} — keep it on this device
              </label>
            </div>
            <button type="button" className="wf-btn wf-btn-gold" disabled={!strokes.length} onClick={use}>Use this {what}</button>
          </>
        )}
      </div>
    </div>
  );
}
