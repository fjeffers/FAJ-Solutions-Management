'use client';
// Scan a document to PDF, on the tech's phone (Fred, 2026-10-07, sending the
// iScanner app: "all the above for my tech to use").
//
//   1. Take a photo of a page (or pick one from the phone).
//   2. Drag the four corners onto the page's corners; pick Color / Gray / B&W.
//   3. Add more pages, reorder, retake.
//   4. Name it, pick what it is, and send it to the job — or save / share it.
//
// The math (flattening and clean-up) is lib/doc-scan.ts. The PDF is made on
// the phone with pdf-lib and sent to /api/tech/doc, which files it privately
// on the job. Nothing about money is shown here.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, Check, ChevronLeft, ChevronRight, Download, Images, Loader2, RotateCw, Send, Share2, Trash2, X } from 'lucide-react';
import { defaultCorners, enhance, pdfName, warpPage, type Pt, type ScanFilter } from '@/lib/doc-scan';
import { toastError, toastSuccess } from '@/lib/toast';

type Page = {
  id: string;
  /** The photo, upright and at most 2400 px, ready to flatten. */
  source: HTMLCanvasElement;
  sourceUrl: string;
  corners: Pt[];
  filter: ScanFilter;
  /** The finished page. */
  out?: { blob: Blob; url: string; width: number; height: number };
};

export const DOC_KINDS = ['Signed work order', 'Receipt', 'Site sheet', 'Permit', 'Drawing', 'Other'];
const FILTERS: { key: ScanFilter; label: string }[] = [{ key: 'bw', label: 'Black & white' }, { key: 'gray', label: 'Gray' }, { key: 'color', label: 'Color' }];
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function loadPhoto(file: File): Promise<HTMLCanvasElement> {
  const MAX = 2400;
  let bmp: ImageBitmap | HTMLImageElement;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    bmp = await new Promise<HTMLImageElement>((res, rej) => {
      const im = new Image();
      im.onload = () => res(im); im.onerror = () => rej(new Error("That photo couldn't be opened."));
      im.src = URL.createObjectURL(file);
    });
  }
  const w0 = 'naturalWidth' in bmp ? bmp.naturalWidth : bmp.width, h0 = 'naturalHeight' in bmp ? bmp.naturalHeight : bmp.height;
  const k = Math.min(1, MAX / Math.max(w0, h0));
  const c = document.createElement('canvas');
  c.width = Math.round(w0 * k); c.height = Math.round(h0 * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return c;
}

function rotate90(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.height; c.height = src.width;
  const g = c.getContext('2d')!;
  g.translate(c.width, 0); g.rotate(Math.PI / 2); g.drawImage(src, 0, 0);
  return c;
}

const toUrl = (c: HTMLCanvasElement) => new Promise<string>((res) => c.toBlob((b) => res(b ? URL.createObjectURL(b) : c.toDataURL('image/jpeg', 0.8)), 'image/jpeg', 0.8));

/** Flatten and clean one page into a JPEG. */
async function finishPage(p: Page): Promise<NonNullable<Page['out']>> {
  const g = p.source.getContext('2d')!;
  const px = g.getImageData(0, 0, p.source.width, p.source.height);
  const flat = enhance(warpPage({ width: px.width, height: px.height, data: px.data }, p.corners), p.filter);
  const c = document.createElement('canvas');
  c.width = flat.width; c.height = flat.height;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(flat.data), flat.width, flat.height), 0, 0);
  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't finish the page."))), 'image/jpeg', p.filter === 'bw' ? 0.8 : 0.86));
  return { blob, url: URL.createObjectURL(blob), width: flat.width, height: flat.height };
}

/** All finished pages as one PDF, each page letter-width with its own height. */
async function makePdf(pages: Page[], title: string): Promise<Blob> {
  const { PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setProducer('FAJ Solutions');
  for (const p of pages) {
    if (!p.out) continue;
    const img = await pdf.embedJpg(new Uint8Array(await p.out.blob.arrayBuffer()));
    const w = 612, h = (612 * p.out.height) / p.out.width;
    const page = pdf.addPage([w, h]);
    page.drawImage(img, { x: 0, y: 0, width: w, height: h });
  }
  const bytes = await pdf.save();
  return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}

export default function DocScanner({ woNumber, jobLabel, onClose, onSent }: {
  woNumber: string;
  /** Shown at the top, e.g. "WO 19101393 · Wendy's Chester". */
  jobLabel?: string;
  onClose: () => void;
  onSent?: () => void;
}) {
  const [pages, setPages] = useState<Page[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState(DOC_KINDS[0]);
  const [busy, setBusy] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy('Opening the photo…');
    try {
      const added: Page[] = [];
      for (const f of Array.from(files)) {
        const source = await loadPhoto(f);
        added.push({ id: newId(), source, sourceUrl: await toUrl(source), corners: defaultCorners(source.width, source.height), filter: 'bw' });
      }
      setPages((ps) => [...ps, ...added]);
      setEditing(added[0].id);
    } catch (e) {
      toastError(e instanceof Error ? e.message : "That photo couldn't be opened.");
    } finally { setBusy(null); }
  };

  const page = pages.find((p) => p.id === editing) ?? null;
  const update = (id: string, patch: Partial<Page>) => setPages((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const usePage = async () => {
    if (!page) return;
    setBusy('Straightening the page…');
    try {
      const out = await finishPage(page);
      update(page.id, { out });
      setEditing(null);
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Couldn't finish the page.");
    } finally { setBusy(null); }
  };
  const turn = async () => {
    if (!page) return;
    const source = rotate90(page.source);
    update(page.id, { source, sourceUrl: await toUrl(source), corners: defaultCorners(source.width, source.height), out: undefined });
  };
  const move = (i: number, by: -1 | 1) => setPages((ps) => {
    const j = i + by;
    if (j < 0 || j >= ps.length) return ps;
    const out = [...ps]; [out[i], out[j]] = [out[j], out[i]]; return out;
  });
  const done = pages.filter((p) => p.out);
  const title = name.trim() || kind;

  const pdf = async () => { setBusy('Making the PDF…'); try { return await makePdf(done, title); } finally { setBusy(null); } };
  const send = async () => {
    if (done.length === 0) return;
    const file = await pdf();
    setBusy('Sending…');
    const fd = new FormData();
    fd.append('wo_number', woNumber);
    fd.append('file', new File([file], pdfName(title), { type: 'application/pdf' }));
    fd.append('name', title);
    fd.append('kind', kind);
    fd.append('pages', String(done.length));
    try {
      const res = await fetch('/api/tech/doc', { method: 'POST', body: fd });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) { toastError(json.error ?? "Couldn't send the document."); return; }
      toastSuccess(`${title} sent (${done.length} page${done.length === 1 ? '' : 's'}).`);
      onSent?.();
      onClose();
    } catch {
      toastError('No signal. Try again when you have signal, or tap Save to keep it on your phone.');
    } finally { setBusy(null); }
  };
  const save = async () => {
    const file = await pdf();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file); a.download = pdfName(title);
    document.body.appendChild(a); a.click(); a.remove();
  };
  const share = async () => {
    const file = new File([await pdf()], pdfName(title), { type: 'application/pdf' });
    const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
    if (nav.canShare?.({ files: [file] })) await navigator.share({ files: [file], title }).catch(() => {});
    else toastError('Sharing isn’t available on this phone — use Save instead.');
  };

  const pick = (label: string, icon: React.ReactNode, camera: boolean, primary: boolean) => (
    <label className={`wf-btn ${primary ? 'wf-btn-gold' : 'wf-btn-outline'}`} style={{ flex: '1 1 150px', justifyContent: 'center', opacity: busy ? 0.6 : 1, pointerEvents: busy ? 'none' : 'auto' }}>
      {icon} {label}
      <input type="file" accept="image/*" multiple={!camera} {...(camera ? { capture: 'environment' as const } : {})} style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files; void add(f).finally(() => { e.target.value = ''; }); }} />
    </label>
  );

  if (!mounted) return null;
  return createPortal(
    <div className="wf" role="dialog" aria-modal="true" aria-label="Scan a document"
      style={{ position: 'fixed', inset: 0, zIndex: 400, background: page ? '#0E1B2E' : 'var(--wf-surface, #F6F4EF)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: '#0E1B2E', color: '#fff' }}>
        <button type="button" className="wf-btn wf-btn-sm" onClick={page ? () => setEditing(null) : onClose} aria-label={page ? 'Back to the pages' : 'Close'}
          style={{ background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.3)' }}>{page ? <ChevronLeft size={16} /> : <X size={16} />}</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700 }}>{page ? `Page ${pages.indexOf(page) + 1}: drag the corners` : 'Scan a document'}</div>
          {jobLabel && !page && <div style={{ fontSize: 12, opacity: 0.75, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{jobLabel}</div>}
        </div>
        {busy && <span style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}><Loader2 size={14} className="spin" /> {busy}</span>}
      </div>

      {page ? (
        <>
          <CornerEditor key={page.id + page.sourceUrl} page={page} onCorners={(corners) => update(page.id, { corners, out: undefined })} />
          <div style={{ display: 'flex', gap: 6, padding: 10, background: '#13284A', flexWrap: 'wrap', alignItems: 'center' }}>
            {FILTERS.map((f) => (
              <button key={f.key} type="button" onClick={() => update(page.id, { filter: f.key, out: undefined })} aria-pressed={page.filter === f.key}
                className="wf-btn wf-btn-sm" style={{ background: page.filter === f.key ? '#C9A24B' : 'transparent', color: page.filter === f.key ? '#0E1B2E' : '#fff', border: '1px solid rgba(255,255,255,0.3)' }}>
                {f.label}
              </button>
            ))}
            <button type="button" className="wf-btn wf-btn-sm" onClick={() => void turn()} style={{ background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.3)' }}><RotateCw size={15} /> Turn</button>
            <span style={{ flex: 1 }} />
            <button type="button" className="wf-btn wf-btn-gold" disabled={!!busy} onClick={() => void usePage()}><Check size={16} /> Use this page</button>
          </div>
        </>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {pages.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--wf-subtle)', padding: '24px 8px', fontSize: 14 }}>
              Lay the page flat in good light and take a photo from above. You&apos;ll line up the corners next.
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {pick(pages.length ? 'Add a page' : 'Take a photo', <Camera size={17} />, true, true)}
            {pick('From photos', <Images size={17} />, false, false)}
          </div>
          {pages.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
              {pages.map((p, i) => (
                <div key={p.id} className="wf-card" style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <button type="button" onClick={() => setEditing(p.id)} style={{ border: 'none', padding: 0, background: '#eee', borderRadius: 8, overflow: 'hidden', aspectRatio: '3 / 4', cursor: 'pointer' }} aria-label={`Edit page ${i + 1}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.out?.url ?? p.sourceUrl} alt={`Page ${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#fff' }} />
                  </button>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12.5, fontWeight: 700 }}>
                    <span style={{ flex: 1 }}>Page {i + 1}{p.out ? '' : ' · tap to finish'}</span>
                    <button type="button" className="wf-btn wf-btn-ghost wf-btn-sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move earlier"><ChevronLeft size={14} /></button>
                    <button type="button" className="wf-btn wf-btn-ghost wf-btn-sm" onClick={() => move(i, 1)} disabled={i === pages.length - 1} aria-label="Move later"><ChevronRight size={14} /></button>
                    <button type="button" className="wf-btn wf-btn-ghost wf-btn-sm" onClick={() => setPages((ps) => ps.filter((x) => x.id !== p.id))} aria-label="Remove page"><Trash2 size={14} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {done.length > 0 && (
            <div className="wf-card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label style={{ display: 'block' }}>
                <span className="wf-label" style={{ display: 'block', marginBottom: 4 }}>What is it?</span>
                <select className="wf-input" value={kind} onChange={(e) => setKind(e.target.value)} style={{ fontSize: 16 }}>
                  {DOC_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              </label>
              <label style={{ display: 'block' }}>
                <span className="wf-label" style={{ display: 'block', marginBottom: 4 }}>Name (optional)</span>
                <input className="wf-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder={kind} style={{ fontSize: 16 }} />
              </label>
              {pages.length > done.length && <div style={{ fontSize: 12.5, color: 'var(--wf-warning)' }}>{pages.length - done.length} page{pages.length - done.length === 1 ? ' isn’t' : 's aren’t'} finished yet and won&apos;t be included.</div>}
              <div className="save-bar" style={{ justifyContent: 'stretch' }}>
                <button type="button" className="wf-btn wf-btn-navy" style={{ flex: '2 1 160px' }} disabled={!!busy} onClick={() => void send()}><Send size={16} /> Send to the job</button>
                <button type="button" className="wf-btn wf-btn-outline" style={{ flex: '1 1 100px' }} disabled={!!busy} onClick={() => void save()}><Download size={16} /> Save</button>
                <button type="button" className="wf-btn wf-btn-outline" style={{ flex: '1 1 100px' }} disabled={!!busy} onClick={() => void share()}><Share2 size={16} /> Share</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>,
    document.body,
  );
}

/** The photo with the page outline; drag each corner onto the page's corner. */
function CornerEditor({ page, onCorners }: { page: Page; onCorners: (c: Pt[]) => void }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [corners, setCorners] = useState<Pt[]>(page.corners);
  const drag = useRef<number | null>(null);
  const W = page.source.width, H = page.source.height;
  const r = Math.max(W, H) / 28;
  const toImg = (e: React.PointerEvent): Pt => {
    const svg = svgRef.current!;
    const m = svg.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: Math.min(Math.max(p.x, 0), W), y: Math.min(Math.max(p.y, 0), H) };
  };
  const down = (e: React.PointerEvent) => {
    const p = toImg(e);
    let best = -1, bd = Infinity;
    corners.forEach((c, i) => { const d = Math.hypot(c.x - p.x, c.y - p.y); if (d < bd) { bd = d; best = i; } });
    if (best >= 0 && bd < r * 3) { drag.current = best; (e.target as Element).setPointerCapture?.(e.pointerId); }
  };
  const moveTo = (e: React.PointerEvent) => {
    if (drag.current === null) return;
    const p = toImg(e);
    setCorners((cs) => cs.map((c, i) => (i === drag.current ? p : c)));
  };
  const up = () => { if (drag.current !== null) { drag.current = null; onCorners(corners); } };
  return (
    <div style={{ flex: 1, minHeight: 0, padding: 10, display: 'flex' }}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%', touchAction: 'none' }}
        onPointerDown={down} onPointerMove={moveTo} onPointerUp={up} onPointerCancel={up}>
        <image href={page.sourceUrl} x={0} y={0} width={W} height={H} />
        <path d={`M 0 0 H ${W} V ${H} H 0 Z M ${corners.map((c) => `${c.x} ${c.y}`).join(' L ')} Z`} fill="rgba(0,0,0,0.45)" fillRule="evenodd" />
        <polygon points={corners.map((c) => `${c.x},${c.y}`).join(' ')} fill="none" stroke="#C9A24B" strokeWidth={r / 5} />
        {corners.map((c, i) => (
          <g key={i}>
            <circle cx={c.x} cy={c.y} r={r} fill="rgba(201,162,75,0.25)" stroke="#C9A24B" strokeWidth={r / 6} />
            <circle cx={c.x} cy={c.y} r={r / 5} fill="#fff" />
          </g>
        ))}
      </svg>
    </div>
  );
}
