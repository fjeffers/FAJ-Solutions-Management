'use client';
// A sketch as a report to print, save as PDF or send (Fred, 2026-10-06:
// "downloadable forms"). The plan, what's on it — devices counted, cable
// footage, rooms with their size and square footage — and every pinned photo
// with its note. Printing shows only the report: it borrows the job log's
// print rules (app/wf.css, #job-log-root / body.job-log-open).
//
// The plan is drawn here as SVG by the same code as the sketch pad
// (components/sketch/draw.tsx), framed to what's drawn — Fred, 2026-10-06,
// holding up the PDF: "this is how it should look after it saves to PDF".
// The saved picture used to be printed instead: small, soft, with the counts
// baked in under it a second time. Printed, the plan gets a page of its own,
// sideways, with no browser header or footer.
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Printer, X } from 'lucide-react';
import { cableInfo, contentBounds, feet, openingsOf, sqft, summarize, symbolInfo, wallTypeInfo, type Shape, type Sketch } from '@/lib/sketch';
import { SketchDefs, makeDraw } from './draw';

/** Print rules for this report only: letter, sideways, no margin (so no browser header or footer). */
const PRINT_CSS = `
@media print {
  @page { size: letter landscape; margin: 0; }
  #job-log-root .sr-plan-sheet { break-after: page; }
  #job-log-root .sr-plan-body { padding: 5mm 12mm 0 !important; }
  #job-log-root .sr-plan-frame { border: none !important; margin-top: 3mm !important; }
  #job-log-root svg.sr-plan { max-height: 158mm; }
  #job-log-root .sr-details { padding: 12mm 14mm !important; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
  #job-log-root .sr-details h3 { break-after: avoid; }
  #job-log-root .sr-details tr, #job-log-root .sr-details figure { break-inside: avoid; }
  #job-log-root .sr-details th, #job-log-root .sr-details td { padding-top: 4px !important; padding-bottom: 4px !important; }
  #job-log-root .sr-details h3 { margin-top: 14px !important; }
}`;

export async function downloadFromUrl(url: string, filename: string): Promise<boolean> {
  try {
    const blob = await (await fetch(url)).blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    return true;
  } catch {
    return false;
  }
}

export const fileSafe = (s: string) => s.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'sketch';

export default function SketchReport({ title, sketch, imageUrl, photoUrl, linkLabel, updatedAt, onClose }: {
  title: string;
  sketch: Sketch;
  /** The saved picture of the plan. */
  imageUrl: string | null;
  photoUrl: (path: string) => Promise<string | null>;
  linkLabel?: string | null;
  updatedAt?: string;
  onClose: () => void;
}) {
  const sum = summarize(sketch);
  const photos = sketch.shapes.filter((s): s is Extract<Shape, { kind: 'photo' }> => s.kind === 'photo');
  const rooms = sketch.shapes.filter((s): s is Extract<Shape, { kind: 'room' }> => s.kind === 'room');
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [bgUrl, setBgUrl] = useState<string | null>(null);
  // The plan, drawn (no selection marks; the faint marks for removed stretches of wall aren't printed).
  const draw = useMemo(() => makeDraw({ selectedId: null, openings: openingsOf(sketch.shapes) }), [sketch]);
  const frame = useMemo(() => contentBounds(sketch), [sketch]);
  const arrowColors = useMemo(() => [...new Set(sketch.shapes.filter((s) => s.kind === 'line').map((s) => (s as Extract<Shape, { kind: 'line' }>).color))], [sketch]);
  useEffect(() => {
    if (sketch.bg) void photoUrl(sketch.bg.path).then(setBgUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sketch]);

  useEffect(() => {
    document.body.classList.add('job-log-open');
    return () => document.body.classList.remove('job-log-open');
  }, []);
  useEffect(() => {
    void Promise.all(photos.map(async (p) => [p.path, await photoUrl(p.path)] as const)).then((pairs) =>
      setUrls(Object.fromEntries(pairs.filter(([, u]) => !!u) as [string, string][])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sketch]);

  const H = ({ children }: { children: React.ReactNode }) => (
    <h3 style={{ fontFamily: "'Space Grotesk', Inter, sans-serif", fontSize: 15, fontWeight: 700, color: '#0E1B2E', margin: '22px 0 8px', paddingBottom: 6, borderBottom: '2px solid #C9A24B' }}>{children}</h3>
  );
  const cell: React.CSSProperties = { padding: '6px 8px', borderBottom: '1px solid #ECE8DF', textAlign: 'left', verticalAlign: 'top' };
  const date = new Date(updatedAt ?? Date.now()).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  return createPortal(
    <div id="job-log-root" className="wf" style={{ position: 'fixed', inset: 0, zIndex: 330, background: 'rgba(2,4,9,0.55)', overflowY: 'auto', padding: '16px 12px 40px' }}>
      <div className="no-print" style={{ maxWidth: 850, margin: '0 auto 12px', background: '#F6F4EF', borderRadius: 14, padding: 14, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <div style={{ fontWeight: 700, fontFamily: "'Space Grotesk', Inter, sans-serif", fontSize: 16, flex: '1 1 160px' }}>Sketch report · {title}</div>
        <button className="wf-btn wf-btn-gold wf-btn-sm" onClick={() => window.print()}><Printer size={16} /> Print / Save as PDF</button>
        {imageUrl && (
          <button className="wf-btn wf-btn-outline wf-btn-sm" onClick={() => void downloadFromUrl(imageUrl, `${fileSafe(title)}.png`)}><Download size={16} /> Download picture</button>
        )}
        <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={onClose} aria-label="Close"><X size={18} /></button>
      </div>

      <style>{PRINT_CSS}</style>
      <div className="jl-page" style={{ maxWidth: 1000, margin: '0 auto', background: '#fff', color: '#1B1C1F', borderRadius: 14, overflow: 'hidden', boxShadow: '0 20px 50px rgba(0,0,0,0.3)', fontSize: 13 }}>
        <div className="sr-plan-sheet">
        <div className="jl-band" style={{ background: 'linear-gradient(180deg, #13284A 0%, #0E1B2E 100%)', padding: '18px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/wf/logo-wide.png" alt="FAJ Solutions" style={{ height: 54, width: 'auto' }} />
          <div style={{ textAlign: 'right', color: '#fff' }}>
            <div style={{ fontFamily: "'Space Grotesk', Inter, sans-serif", fontSize: 20, fontWeight: 700, letterSpacing: 1.5, color: '#E3C987' }}>SITE SKETCH</div>
            <div style={{ fontSize: 12, opacity: 0.85 }}>{date}</div>
          </div>
        </div>
        <div className="sr-plan-body" style={{ padding: '18px 24px 22px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ fontFamily: "'Space Grotesk', Inter, sans-serif", fontSize: 20, fontWeight: 700 }}>{title}</div>
            {linkLabel && <div style={{ color: '#5E6470' }}>{linkLabel}</div>}
            <div style={{ marginLeft: 'auto', color: '#90a4ae', fontSize: 11 }}>Each grid square = 1 ft</div>
          </div>

          <div className="jl-avoid sr-plan-frame" style={{ marginTop: 14, border: '1px solid #ECE8DF', borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
            <svg className="sr-plan" viewBox={`${frame.x} ${frame.y} ${frame.w} ${frame.h}`} preserveAspectRatio="xMidYMid meet"
              role="img" aria-label={`Plan: ${title}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
              <SketchDefs arrowColors={arrowColors} />
              <rect x={frame.x} y={frame.y} width={frame.w} height={frame.h} fill="#fff" />
              {sketch.bg && bgUrl && (
                <image href={bgUrl} x={0} y={0} width={sketch.width} height={sketch.height} preserveAspectRatio="xMidYMid meet" opacity={sketch.bg.opacity} />
              )}
              <rect x={0} y={0} width={sketch.width} height={sketch.height} fill="url(#grid5)" />
              {sketch.shapes.filter((s) => s.kind !== 'gap').map((s) => draw.renderShape(s))}
            </svg>
          </div>
          <div style={{ marginTop: 6, fontSize: 10.5, color: '#90a4ae' }}>Each grid square = 1 ft. Plan size {feet(sketch.width)} × {feet(sketch.height)}. FAJ Solutions · Bringing People and Technology Together.</div>
        </div>
        </div>

        <div className="sr-details" style={{ padding: '4px 24px 26px' }}>
          <H>What&apos;s on the plan</H>
          {sum.symbols.length === 0 && !sum.cableFeet && sum.walls.length === 0 ? <div style={{ color: '#5E6470' }}>No devices or cable runs drawn.</div> : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={cell}>Item</th><th style={{ ...cell, textAlign: 'right' }}>Quantity</th></tr></thead>
              <tbody>
                {sum.symbols.map((x) => {
                  const info = symbolInfo(x.kind);
                  return <tr key={x.kind}><td style={cell}><b style={{ color: info.color }}>{info.code ? `${info.code} · ` : ''}</b>{x.label}</td><td style={{ ...cell, textAlign: 'right', fontWeight: 700 }}>{x.count}</td></tr>;
                })}
                {sum.walls.map((w) => (
                  <tr key={`wall-${w.type}`}><td style={cell}><b style={{ color: wallTypeInfo(w.type).color }}>{w.label}</b> walls <span style={{ color: '#8a8f99' }}>(Wi-Fi about −{wallTypeInfo(w.type).wifiDb} dB each)</span></td><td style={{ ...cell, textAlign: 'right', fontWeight: 700 }}>{w.feet.toLocaleString('en-US')} ft</td></tr>
                ))}
                {sum.cables.map((c) => (
                  <tr key={c.type}><td style={cell}><b style={{ color: cableInfo(c.type).color }}>{c.label}</b> cable ({c.runs} run{c.runs === 1 ? '' : 's'})</td><td style={{ ...cell, textAlign: 'right', fontWeight: 700 }}>{c.feet.toLocaleString('en-US')} ft</td></tr>
                ))}
              </tbody>
            </table>
          )}

          {rooms.length > 0 && (
            <>
              <H>Rooms</H>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={cell}>Room</th><th style={cell}>Size</th><th style={{ ...cell, textAlign: 'right' }}>Area</th></tr></thead>
                <tbody>
                  {rooms.map((r, i) => <tr key={r.id}><td style={cell}>{r.name || `Room ${i + 1}`}</td><td style={cell}>{feet(r.w)} × {feet(r.h)}</td><td style={{ ...cell, textAlign: 'right' }}>{sqft(r.w * r.h)}</td></tr>)}
                  {rooms.length > 1 && <tr><td style={{ ...cell, fontWeight: 700 }} colSpan={2}>All rooms</td><td style={{ ...cell, textAlign: 'right', fontWeight: 700 }}>{sqft(sum.totalArea)}</td></tr>}
                </tbody>
              </table>
            </>
          )}

          {photos.length > 0 && (
            <>
              <H>Photos</H>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
                {photos.map((p, i) => (
                  <figure key={p.id} className="jl-avoid" style={{ margin: 0, border: '1px solid #ECE8DF', borderRadius: 8, overflow: 'hidden' }}>
                    {urls[p.path]
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={urls[p.path]} alt={p.note || `Photo ${i + 1}`} style={{ width: '100%', display: 'block' }} />
                      : <div style={{ padding: 20, color: '#90a4ae', textAlign: 'center' }}>Loading…</div>}
                    <figcaption style={{ padding: '6px 8px', fontSize: 12 }}>{p.note || `Photo ${i + 1}`}</figcaption>
                  </figure>
                ))}
              </div>
            </>
          )}

        </div>
      </div>
    </div>,
    document.body,
  );
}
