'use client';
// Edit and sign a PDF, iScanner-style (Fred, 2026-10-07: "go ahead with the
// edit and sign pdfs everything from iscanner").
//
//   Sign      a signature or initials (the tech's own can be kept on the phone)
//   Text      type anywhere — fill in a form that has no boxes to type in
//   Date      today's date in one tap
//   ✓ ✗ ●     tick boxes; tap again to take one off
//   Pen       draw or write by hand;  Highlight  mark lines in yellow
//   White-out cover something up;     Picture    put a photo or logo on a page
//   Pages     turn, reorder or delete pages, add another PDF or photos, and
//             copy the words off a page
//
// Marks are kept in the page's own space (lib/pdf-marks.ts) and written into
// the PDF on Save/Send by lib/pdf-build.ts — the original pages are kept as
// they are, so the text stays sharp. The parent decides where "Send" goes
// (the tech's job, or the job's Documents in the office app).
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CalendarDays, Check, ChevronDown, ChevronUp, Circle, Copy, Download, Eraser, FilePlus2, Files, Hand, Highlighter, ImagePlus,
  Images, Loader2, Minus, Pencil, Plus, RotateCw, ScanText, Send, Share2, Signature, Trash2, Type, Undo2, X,
} from 'lucide-react';
import { backdropClose } from '@/lib/backdrop';
import { pdfName } from '@/lib/doc-scan';
import { buildPdf, canCopy, type OutPage } from '@/lib/pdf-build';
import {
  DOT_RADIUS, HIGHLIGHT, INK, PEN_WIDTH, SYMBOL_STROKES, SYMBOL_WIDTH, apply, baselineFromTop, boxFromDrag, boxMatrix, centredAt,
  dateText, fitInside, hitTest, invert, isBox, moveBy, normDeg, pdfSafeText, resizeTo, rotation, textBox, textLines, toLocal,
  type BoxMark, type InkMark, type Mark, type Matrix, type Pt,
} from '@/lib/pdf-marks';
import { openPdf, rasterPage, renderPage, type PDFDocumentProxy, type PDFPageProxy } from '@/lib/pdf-view';
import { readText } from '@/lib/read-text';
import { toastError, toastSuccess } from '@/lib/toast';
import SignSheet from './SignSheet';

type View = { T: Matrix; w: number; h: number };
type Src = { bytes: Uint8Array; doc: PDFDocumentProxy; copyable: boolean };
type EdPage = {
  key: string; src: number; index: number;
  /** The page's own turn, and quarter-turns added here. */
  base: number; extra: number;
  /** How the page looks at each turn (page space → screen points, and its size). */
  views: Record<number, View>;
};
type Tool = 'move' | 'sign' | 'text' | 'date' | 'check' | 'cross' | 'dot' | 'pen' | 'highlight' | 'whiteout' | 'picture';
type Stamp = { src: string; aspect: number; what: 'signature' | 'initials' | 'picture' };
type Drag =
  | { kind: 'tap'; page: string; x: number; y: number; p: Pt }
  | { kind: 'ink'; id: string }
  | { kind: 'whiteout'; page: string; a: Pt; angle: number }
  | { kind: 'move'; id: string; start: Pt; orig: Mark; moved: boolean; x: number; y: number }
  | { kind: 'resize'; id: string; orig: BoxMark; moved: boolean };

export type SendOptions = {
  /** "Send to the job" / "Save to the job". */
  label: string;
  /** What-is-it choices, when the destination files documents by kind. */
  kinds?: string[];
  defaultKind?: string;
  /** Office side: offer "Techs on the job can open this". */
  techToggle?: boolean;
};
export type SendResult = { blob: Blob; name: string; kind: string; pages: number; forTech: boolean };

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const rot = (p: EdPage) => normDeg(p.base + p.extra);
const viewOf = (p: EdPage) => p.views[rot(p)];
const isPdfBytes = (b: Uint8Array) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;

let measurer: CanvasRenderingContext2D | null = null;
/** Width of a line of Helvetica at `size` points. */
function widthOf(line: string, size: number): number {
  measurer ??= document.createElement('canvas').getContext('2d');
  if (!measurer) return line.length * size * 0.55;
  measurer.font = '100px Helvetica, Arial, sans-serif';
  return (measurer.measureText(line).width * size) / 100;
}

async function loadImage(file: Blob, maxSide: number): Promise<HTMLCanvasElement> {
  let bmp: ImageBitmap | HTMLImageElement;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch {
    bmp = await new Promise<HTMLImageElement>((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error("That picture couldn't be opened.")); im.src = URL.createObjectURL(file); });
  }
  const w0 = 'naturalWidth' in bmp ? bmp.naturalWidth : bmp.width, h0 = 'naturalHeight' in bmp ? bmp.naturalHeight : bmp.height;
  const k = Math.min(1, maxSide / Math.max(w0, h0));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w0 * k)); c.height = Math.max(1, Math.round(h0 * k));
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return c;
}

/** Photos as a PDF, one letter-width page each. */
async function photosToPdf(files: File[]): Promise<Blob> {
  const { PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  for (const f of files) {
    const c = await loadImage(f, 2200);
    const jpg = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't use that photo."))), 'image/jpeg', 0.85));
    const img = await pdf.embedJpg(new Uint8Array(await jpg.arrayBuffer()));
    const w = 612, h = (612 * c.height) / c.width;
    pdf.addPage([w, h]).drawImage(img, { x: 0, y: 0, width: w, height: h });
  }
  return new Blob([(await pdf.save()) as BlobPart], { type: 'application/pdf' });
}

const TOOLS: { key: Tool; label: string; icon: React.ReactNode }[] = [
  { key: 'move', label: 'Move', icon: <Hand size={19} /> },
  { key: 'sign', label: 'Sign', icon: <Signature size={19} /> },
  { key: 'text', label: 'Text', icon: <Type size={19} /> },
  { key: 'date', label: 'Date', icon: <CalendarDays size={19} /> },
  { key: 'check', label: 'Check', icon: <Check size={19} /> },
  { key: 'cross', label: 'X', icon: <X size={19} /> },
  { key: 'dot', label: 'Dot', icon: <Circle size={17} fill="currentColor" /> },
  { key: 'pen', label: 'Pen', icon: <Pencil size={19} /> },
  { key: 'highlight', label: 'Highlight', icon: <Highlighter size={19} /> },
  { key: 'whiteout', label: 'White-out', icon: <Eraser size={19} /> },
  { key: 'picture', label: 'Picture', icon: <ImagePlus size={19} /> },
];
const HINTS: Record<Tool, string> = {
  move: 'Tap a mark to move it, resize it from the gold dot, or delete it.',
  sign: 'Tap where the signature goes.',
  text: 'Tap where the text goes.',
  date: 'Tap where today’s date goes.',
  check: 'Tap each box to check it. Tap a check again to take it off.',
  cross: 'Tap each box to mark it. Tap again to take it off.',
  dot: 'Tap each circle to fill it in. Tap again to take it off.',
  pen: 'Write or draw with your finger. Pick Move to scroll.',
  highlight: 'Drag across the lines to highlight them. Pick Move to scroll.',
  whiteout: 'Drag a box over what you want to cover up. Pick Move to scroll.',
  picture: 'Tap where the picture goes.',
};
const TEXT_SIZES = [{ label: 'Small', size: 9 }, { label: 'Normal', size: 11 }, { label: 'Large', size: 15 }, { label: 'Huge', size: 22 }];

export default function PdfEditor({ file, name: firstName = '', heading, send, onSend, onClose }: {
  /** The PDF to open. Without one, the screen starts with "Open a PDF". */
  file?: Blob | null;
  name?: string;
  /** Shown under the title, e.g. "WO 19101393 · Wendy's Chester". */
  heading?: string;
  send?: SendOptions;
  /** File the finished PDF; resolve true when it's done (the editor closes). */
  onSend?: (r: SendResult) => Promise<boolean>;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const srcs = useRef<Src[]>([]);
  const proxies = useRef(new Map<string, PDFPageProxy>());
  const started = useRef(false);
  const [pages, setPages] = useState<EdPage[]>([]);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [history, setHistory] = useState<{ pages: EdPage[]; marks: Mark[] }[]>([]);
  const [imgs, setImgs] = useState<Record<string, { url: string; rot: number; w: number }>>({});
  const [tool, setTool] = useState<Tool>('move');
  const [stamp, setStamp] = useState<Stamp | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [color, setColor] = useState<string>(INK.black);
  const [zoom, setZoom] = useState(1);
  const [sheet, setSheet] = useState<null | 'sign' | 'pages' | 'save'>(null);
  const [textAsk, setTextAsk] = useState<{ id?: string; page?: string; at?: Pt; angle?: number; value: string; size: number } | null>(null);
  const [ocr, setOcr] = useState<{ title: string; text: string | null; progress: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [draft, setDraft] = useState<BoxMark | null>(null);
  const [width, setWidth] = useState(360);
  const [name, setName] = useState(firstName.replace(/\.pdf$/i, ''));
  const [kind, setKind] = useState(send?.defaultKind ?? send?.kinds?.[0] ?? 'Other');
  const [forTech, setForTech] = useState(false);
  const [smaller, setSmaller] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const pictureInput = useRef<HTMLInputElement>(null);
  useEffect(() => { setMounted(true); }, []);

  // ── Opening PDFs ──────────────────────────────────────────────────────────
  const loadPdf = useCallback(async (blob: Blob): Promise<EdPage[] | null> => {
    setBusy('Opening the PDF…');
    try {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (!isPdfBytes(bytes)) { toastError('That file isn’t a PDF.'); return null; }
      const doc = await openPdf(bytes, (wrong) => window.prompt(wrong ? 'That password didn’t work. Try again:' : 'This PDF is locked with a password. Type it to open it:'));
      const copyable = await canCopy(bytes);
      const src = srcs.current.push({ bytes, doc, copyable }) - 1;
      const added: EdPage[] = [];
      for (let i = 0; i < doc.numPages; i++) {
        const pg = await doc.getPage(i + 1);
        const key = newId();
        proxies.current.set(key, pg);
        const views: Record<number, View> = {};
        for (const r of [0, 90, 180, 270]) {
          const v = pg.getViewport({ scale: 1, rotation: r });
          views[r] = { T: v.transform as Matrix, w: v.width, h: v.height };
        }
        added.push({ key, src, index: i, base: normDeg(pg.rotate), extra: 0, views });
      }
      if (!copyable) toastSuccess('This PDF is locked, so the saved copy will be a picture of each page.');
      return added;
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      toastError(/password/i.test(msg) ? 'That PDF needs its password to open.' : 'That PDF couldn’t be opened — it may be damaged.');
      return null;
    } finally { setBusy(null); }
  }, []);

  useEffect(() => {
    if (!file || started.current) return;
    started.current = true;
    void loadPdf(file).then((added) => { if (added) setPages(added); });
  }, [file, loadPdf]);

  const addPages = async (blob: Blob, fresh = false) => {
    const added = await loadPdf(blob);
    if (!added) return;
    if (pages.length) setHistory((h) => [...h.slice(-49), { pages, marks }]);
    setPages((ps) => [...ps, ...added]);
    if (pages.length || fresh) setDirty(true);
  };
  const addPhotos = async (files: File[]) => {
    if (!files.length) return;
    setBusy('Making pages from the photos…');
    try { const pdf = await photosToPdf(files); setBusy(null); await addPages(pdf, true); }
    catch (e) { toastError(e instanceof Error ? e.message : 'Couldn’t use those photos.'); }
    finally { setBusy(null); }
  };

  // ── Drawing the pages ─────────────────────────────────────────────────────
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [mounted, pages.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const pagePx = Math.max(220, Math.min(width - 24, 860)) * zoom;
  const dpr = mounted ? Math.min(window.devicePixelRatio || 1, 3) : 1;
  const needW = Math.min(2400, Math.max(800, Math.ceil((pagePx * dpr) / 400) * 400));

  useEffect(() => {
    let stop = false;
    void (async () => {
      for (const p of pages) {
        const have = imgs[p.key];
        if (have && have.rot === rot(p) && have.w >= needW * 0.9) continue;
        const proxy = proxies.current.get(p.key);
        if (!proxy) continue;
        try {
          const r = await renderPage(proxy, rot(p), needW);
          if (stop) return;
          const url = URL.createObjectURL(r.blob);
          setImgs((m) => ({ ...m, [p.key]: { url, rot: rot(p), w: r.width } }));
          return; // one page at a time; the update runs this again for the next
        } catch { if (stop) return; }
      }
    })();
    return () => { stop = true; };
  }, [pages, imgs, needW]);

  // ── Changing marks ────────────────────────────────────────────────────────
  const snapshot = () => { setHistory((h) => [...h.slice(-49), { pages, marks }]); setDirty(true); };
  const commit = (next: (ms: Mark[]) => Mark[]) => { snapshot(); setMarks(next); };
  const undo = () => {
    const last = history[history.length - 1];
    if (!last) return;
    setHistory(history.slice(0, -1));
    setPages(last.pages); setMarks(last.marks); setSelected(null);
  };
  const remove = (id: string) => { commit((ms) => ms.filter((m) => m.id !== id)); setSelected(null); };
  const duplicate = (id: string) => {
    const m = marks.find((x) => x.id === id);
    if (!m) return;
    const copy = { ...moveBy(m, 12, -12), id: newId() } as Mark;
    commit((ms) => [...ms, copy]);
    setSelected(copy.id);
  };
  const recolor = (id: string, c: string) => commit((ms) => ms.map((m) => {
    if (m.id !== id) return m;
    if (m.kind === 'text' || m.kind === 'check' || m.kind === 'cross' || m.kind === 'dot') return { ...m, color: c };
    return m.kind === 'ink' && m.opacity === 1 ? { ...m, color: c } : m; // highlighter stays yellow
  }));

  const addText = (value: string, size: number, page: string, at: Pt, angle: number) => {
    const text = pdfSafeText(value).replace(/\s+$/, '');
    if (!text.trim()) return;
    const box = textBox(text, size, widthOf);
    const id = newId();
    commit((ms) => [...ms, { id, page, kind: 'text', text, size, color, ...centredAt(at, box.w, box.h, angle) }]);
    setSelected(id);
  };
  const saveText = () => {
    const t = textAsk;
    setTextAsk(null);
    if (!t) return;
    if (!t.id) { if (t.page && t.at) { addText(t.value, t.size, t.page, t.at, t.angle ?? 0); setTool('move'); } return; }
    const text = pdfSafeText(t.value).replace(/\s+$/, '');
    if (!text.trim()) { remove(t.id); return; }
    const box = textBox(text, t.size, widthOf);
    commit((ms) => ms.map((m) => {
      if (m.id !== t.id || m.kind !== 'text') return m;
      // Keep the top-left corner where it was; the box grows down.
      const topLeft = apply(boxMatrix(m), { x: 0, y: m.h });
      const down = apply(rotation(m.angle), { x: 0, y: box.h });
      return { ...m, text, size: t.size, w: box.w, h: box.h, x: topLeft.x - down.x, y: topLeft.y - down.y };
    }));
  };

  const pickTool = (t: Tool) => {
    setSelected(null);
    setStamp(null);
    if (t === 'sign') { setTool('sign'); setSheet('sign'); return; }
    if (t === 'picture') { pictureInput.current?.click(); return; }
    setTool(t);
  };

  // ── Taps and drags on a page ──────────────────────────────────────────────
  const pagePoint = (e: { clientX: number; clientY: number }, el: Element, v: View): Pt => {
    const r = el.getBoundingClientRect();
    return apply(invert(v.T), { x: ((e.clientX - r.left) / r.width) * v.w, y: ((e.clientY - r.top) / r.height) * v.h });
  };
  const drawing = tool === 'pen' || tool === 'highlight' || tool === 'whiteout';

  const tapAt = (p: EdPage, at: Pt) => {
    const v = viewOf(p);
    const tol = (14 * v.w) / pagePx;
    if (stamp) {
      const base = stamp.what === 'signature' ? 150 : stamp.what === 'initials' ? 54 : 180;
      const size = fitInside(base, base / stamp.aspect, v.w * 0.9, v.h * 0.9);
      const id = newId();
      const s = stamp;
      commit((ms) => [...ms, { id, page: p.key, kind: 'image', src: s.src, what: s.what, ...centredAt(at, size.w, size.h, rot(p)) }]);
      setStamp(null); setSelected(id); setTool('move');
      return;
    }
    if (tool === 'move') { setSelected(hitTest(marks, p.key, at, tol)?.id ?? null); return; }
    if (tool === 'text') { setTextAsk({ page: p.key, at, angle: rot(p), value: '', size: 11 }); return; }
    if (tool === 'date') { addText(dateText(), 11, p.key, at, rot(p)); setTool('move'); return; }
    if (tool === 'check' || tool === 'cross' || tool === 'dot') {
      const hit = hitTest(marks, p.key, at, tol / 2);
      if (hit && hit.kind === tool) { remove(hit.id); return; }
      const k = tool;
      commit((ms) => [...ms, { id: newId(), page: p.key, kind: k, color, ...centredAt(at, 13, 13, rot(p)) }]);
    }
  };

  const onDown = (e: React.PointerEvent<HTMLDivElement>, p: EdPage) => {
    if (e.button > 0) return;
    const v = viewOf(p);
    const at = pagePoint(e, e.currentTarget, v);
    if (!stamp && (tool === 'pen' || tool === 'highlight')) {
      e.currentTarget.setPointerCapture(e.pointerId);
      const id = newId();
      snapshot();
      const ink: InkMark = tool === 'pen'
        ? { id, page: p.key, kind: 'ink', points: [at], width: PEN_WIDTH, color, opacity: 1 }
        : { id, page: p.key, kind: 'ink', points: [at], width: HIGHLIGHT.width, color: HIGHLIGHT.color, opacity: HIGHLIGHT.opacity };
      setMarks((ms) => [...ms, ink]);
      drag.current = { kind: 'ink', id };
      return;
    }
    if (!stamp && tool === 'whiteout') {
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { kind: 'whiteout', page: p.key, a: at, angle: rot(p) };
      return;
    }
    drag.current = { kind: 'tap', page: p.key, x: e.clientX, y: e.clientY, p: at };
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>, p: EdPage) => {
    const d = drag.current;
    if (!d || (d.kind !== 'ink' && d.kind !== 'whiteout')) return;
    const at = pagePoint(e, e.currentTarget, viewOf(p));
    if (d.kind === 'ink') {
      setMarks((ms) => ms.map((m) => {
        if (m.id !== d.id || m.kind !== 'ink') return m;
        const last = m.points[m.points.length - 1];
        return Math.hypot(at.x - last.x, at.y - last.y) < 0.7 / zoom ? m : { ...m, points: [...m.points, at] };
      }));
    } else {
      setDraft({ id: 'draft', page: d.page, kind: 'whiteout', ...boxFromDrag(d.a, at, d.angle) });
    }
  };
  const onUp = (e: React.PointerEvent<HTMLDivElement>, p: EdPage) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === 'whiteout') {
      setDraft(null);
      const b = boxFromDrag(d.a, pagePoint(e, e.currentTarget, viewOf(p)), d.angle);
      if (b.w > 3 && b.h > 3) commit((ms) => [...ms, { id: newId(), page: d.page, kind: 'whiteout', ...b }]);
      return;
    }
    if (d.kind === 'tap' && Math.hypot(e.clientX - d.x, e.clientY - d.y) <= 10) tapAt(p, d.p);
  };

  // Dragging the selected mark, or its gold resize dot.
  const gripDown = (e: React.PointerEvent<HTMLDivElement>, p: EdPage, m: Mark, resize: boolean) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    if (resize && isBox(m)) drag.current = { kind: 'resize', id: m.id, orig: m, moved: false };
    else drag.current = { kind: 'move', id: m.id, start: pagePoint(e, e.currentTarget.parentElement!, viewOf(p)), orig: m, moved: false, x: e.clientX, y: e.clientY };
  };
  const gripMove = (e: React.PointerEvent<HTMLDivElement>, p: EdPage) => {
    e.stopPropagation();
    const d = drag.current;
    if (!d || (d.kind !== 'move' && d.kind !== 'resize')) return;
    const at = pagePoint(e, e.currentTarget.parentElement!, viewOf(p));
    if (d.kind === 'move' && !d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return;
    if (!d.moved) { snapshot(); d.moved = true; }
    if (d.kind === 'move') {
      const dx = at.x - d.start.x, dy = at.y - d.start.y;
      setMarks((ms) => ms.map((m) => (m.id === d.id ? moveBy(d.orig, dx, dy) : m)));
    } else {
      setMarks((ms) => ms.map((m) => (m.id === d.id ? resizeTo(d.orig, toLocal(d.orig, at)) : m)));
    }
  };
  const gripUp = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const d = drag.current;
    drag.current = null;
    // A tap on selected text opens it for typing.
    if (d?.kind === 'move' && !d.moved && d.orig.kind === 'text') setTextAsk({ id: d.orig.id, value: d.orig.text, size: d.orig.size });
  };

  // Delete and undo from the keyboard (office computers).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected) { e.preventDefault(); remove(selected); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
      if (e.key === 'Escape') { setSelected(null); setStamp(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ── Pages ─────────────────────────────────────────────────────────────────
  const changePages = (next: EdPage[]) => { snapshot(); setPages(next); setSelected(null); };
  const turnPage = (key: string) => changePages(pages.map((p) => (p.key === key ? { ...p, extra: normDeg(p.extra + 90) } : p)));
  const movePage = (i: number, by: -1 | 1) => {
    const j = i + by;
    if (j < 0 || j >= pages.length) return;
    const next = [...pages]; [next[i], next[j]] = [next[j], next[i]];
    changePages(next);
  };
  const deletePage = (key: string) => {
    if (pages.length === 1) { toastError('A PDF needs at least one page.'); return; }
    if (!confirm('Delete this page?')) return;
    changePages(pages.filter((p) => p.key !== key));
  };
  const copyTextOf = async (p: EdPage, n: number) => {
    const proxy = proxies.current.get(p.key);
    if (!proxy) return;
    setOcr({ title: `Text on page ${n}`, text: null, progress: 0 });
    try {
      // A PDF made on a computer carries its words — take them as they are.
      const content = await proxy.getTextContent();
      const typed = content.items.map((it) => ('str' in it ? `${it.str}${it.hasEOL ? '\n' : ''}` : '')).join('').replace(/[ \t]+\n/g, '\n').trim();
      if (typed.replace(/\s/g, '').length >= 20) { setOcr((o) => (o ? { ...o, text: typed } : o)); return; }
      // A scan is a picture of words: read them off it.
      const r = await renderPage(proxy, rot(p), 2000, 0.92);
      const text = await readText(r.blob, (share) => setOcr((o) => (o ? { ...o, progress: share } : o)));
      setOcr((o) => (o ? { ...o, text: text || '(No words found on this page.)' } : o));
    } catch {
      setOcr(null);
      toastError('Couldn’t read the words — check the signal and try again.');
    }
  };

  // ── Saving ────────────────────────────────────────────────────────────────
  const title = name.trim() || kind || 'Document';
  const build = async (): Promise<Blob> => {
    const live = new Set(pages.map((p) => p.key));
    const write = async (pictures: boolean) => {
      const out: OutPage[] = [];
      for (const [i, p] of pages.entries()) {
        let raster;
        if (pictures || !srcs.current[p.src].copyable) {
          setBusy(`Preparing page ${i + 1} of ${pages.length}…`);
          raster = await rasterPage(proxies.current.get(p.key)!, rot(p), pictures ? 1.7 : 2.4, pictures ? 0.62 : 0.85);
        }
        out.push({ key: p.key, src: p.src, index: p.index, extra: p.extra, raster });
      }
      setBusy('Making the PDF…');
      return buildPdf({ sources: srcs.current.map((s) => s.bytes), pages: out, marks: marks.filter((m) => live.has(m.page)), title });
    };
    let bytes = await write(false);
    // Smaller: pages as lighter pictures — kept only if that really is smaller
    // (a typed PDF is often smaller as it is).
    if (smaller) { const pics = await write(true); if (pics.length < bytes.length) bytes = pics; }
    return new Blob([bytes as BlobPart], { type: 'application/pdf' });
  };
  const run = async (what: 'send' | 'save' | 'share') => {
    if (!pages.length) return;
    setSelected(null);
    try {
      const blob = await build();
      if (what === 'send' && onSend) {
        setBusy('Sending…');
        if (await onSend({ blob, name: title, kind, pages: pages.length, forTech })) { setDirty(false); onClose(); }
        return;
      }
      const f = new File([blob], pdfName(title), { type: 'application/pdf' });
      if (what === 'share') {
        const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
        if (nav.canShare?.({ files: [f] })) { await navigator.share({ files: [f], title }).catch(() => {}); return; }
        toastError('Sharing isn’t available here — use Save instead.');
        return;
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(f); a.download = f.name;
      document.body.appendChild(a); a.click(); a.remove();
      setDirty(false);
    } catch (e) {
      toastError(e instanceof Error && e.message ? `Couldn’t make the PDF: ${e.message}` : 'Couldn’t make the PDF.');
    } finally { setBusy(null); }
  };
  const close = () => {
    if (dirty && !confirm('Leave without saving your changes?')) return;
    onClose();
  };

  if (!mounted) return null;
  const sel = marks.find((m) => m.id === selected) ?? null;
  const pp = (v: View) => v.w / pagePx; // page points per screen pixel
  const hint = stamp ? `Tap where the ${stamp.what} goes.` : HINTS[tool];
  const canColor = ['text', 'date', 'check', 'cross', 'dot', 'pen'].includes(tool);
  const onDark = { background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.3)' };

  return createPortal(
    <div className="wf" role="dialog" aria-modal="true" aria-label="Edit and sign a PDF"
      style={{ position: 'fixed', inset: 0, zIndex: 400, background: '#E9E6DF', display: 'flex', flexDirection: 'column' }}>
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: '#0E1B2E', color: '#fff' }}>
        <button type="button" className="wf-btn wf-btn-sm" onClick={close} aria-label="Close" style={onDark}><X size={16} /></button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name.trim() || 'Edit & sign'}</div>
          {heading && <div style={{ fontSize: 12, opacity: 0.75, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{heading}</div>}
        </div>
        {busy && <span style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}><Loader2 size={14} className="spin" /> <span className="pdfed-busy">{busy}</span></span>}
        {pages.length > 0 && (
          <>
            <button type="button" className="wf-btn wf-btn-sm" style={onDark} onClick={() => setZoom((z) => Math.max(1, z / 1.5))} disabled={zoom <= 1} aria-label="Zoom out"><Minus size={15} /></button>
            <button type="button" className="wf-btn wf-btn-sm" style={onDark} onClick={() => setZoom((z) => Math.min(3.375, z * 1.5))} disabled={zoom >= 3.3} aria-label="Zoom in"><Plus size={15} /></button>
            <button type="button" className="wf-btn wf-btn-gold wf-btn-sm" onClick={() => { setSelected(null); setSheet('save'); }} disabled={!!busy}>Done</button>
          </>
        )}
      </div>

      {pages.length === 0 ? (
        <div style={{ flex: 1, padding: 16, display: 'flex', flexDirection: 'column', gap: 14, background: 'var(--wf-surface, #F6F4EF)' }}>
          <div style={{ color: 'var(--wf-subtle)', fontSize: 14 }}>
            {busy ? 'Opening…' : 'Open a PDF to fill in, sign or mark up — or take photos of paper and they become the pages.'}
          </div>
          {!busy && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <label className="wf-btn wf-btn-gold" style={{ flex: '1 1 160px', justifyContent: 'center' }}>
                <FilePlus2 size={17} /> Open a PDF
                <input type="file" accept="application/pdf,.pdf" style={{ display: 'none' }}
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { if (!name) setName(f.name.replace(/\.pdf$/i, '')); void loadPdf(f).then((a) => { if (a) setPages(a); }); } }} />
              </label>
              <label className="wf-btn wf-btn-outline" style={{ flex: '1 1 160px', justifyContent: 'center' }}>
                <Images size={17} /> Photos to PDF
                <input type="file" accept="image/*" multiple style={{ display: 'none' }}
                  onChange={(e) => { const fs = Array.from(e.target.files ?? []); e.target.value = ''; void addPhotos(fs); }} />
              </label>
            </div>
          )}
        </div>
      ) : (
        <>
          <div style={{ padding: '6px 12px', background: '#13284A', color: '#fff', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, minHeight: 36 }}>
            <span style={{ flex: 1 }}>{hint}</span>
            {canColor && !stamp && (
              ([['Black', INK.black], ['Blue', INK.blue], ['Red', INK.red]] as const).map(([label, c]) => (
                <button key={c} type="button" onClick={() => setColor(c)} aria-label={`${label} ink`} aria-pressed={color === c}
                  style={{ width: 24, height: 24, borderRadius: 999, background: c, border: color === c ? '3px solid #C9A24B' : '2px solid #fff', cursor: 'pointer', flex: 'none' }} />
              ))
            )}
            {stamp && <button type="button" className="wf-btn wf-btn-sm" style={onDark} onClick={() => { setStamp(null); setTool('move'); }}>Cancel</button>}
          </div>

          {/* The pages */}
          <div ref={scroller} style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '12px 12px 24px' }}>
            <div style={{ width: pagePx, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {pages.map((p, n) => {
                const v = viewOf(p);
                const img = imgs[p.key];
                const pm = marks.filter((m) => m.page === p.key);
                const mine = sel && sel.page === p.key ? sel : null;
                // Where the selected mark sits on screen (for its drag grip and resize dot).
                let grip: { l: number; t: number; r: number; b: number; hx?: number; hy?: number } | null = null;
                if (mine) {
                  const pts = isBox(mine)
                    ? [[0, 0], [mine.w, 0], [mine.w, mine.h], [0, mine.h]].map(([x, y]) => apply(v.T, apply(boxMatrix(mine), { x, y })))
                    : mine.points.map((q) => apply(v.T, q));
                  const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
                  const pad = 8 * pp(v);
                  grip = { l: Math.min(...xs) - pad, t: Math.min(...ys) - pad, r: Math.max(...xs) + pad, b: Math.max(...ys) + pad };
                  if (isBox(mine)) { const hdl = apply(v.T, apply(boxMatrix(mine), { x: mine.w, y: mine.h })); grip.hx = hdl.x; grip.hy = hdl.y; }
                }
                return (
                  <div key={p.key}>
                    <div style={{ fontSize: 12, color: '#6B6558', marginBottom: 4 }}>Page {n + 1} of {pages.length}</div>
                    <div
                      style={{ position: 'relative', width: pagePx, height: (pagePx * v.h) / v.w, background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.18)', touchAction: drawing ? 'none' : 'pan-x pan-y', cursor: drawing || stamp || tool !== 'move' ? 'crosshair' : 'default', userSelect: 'none', WebkitUserSelect: 'none' }}
                      onPointerDown={(e) => onDown(e, p)} onPointerMove={(e) => onMove(e, p)} onPointerUp={(e) => onUp(e, p)}
                      onPointerCancel={() => { drag.current = null; setDraft(null); }}>
                      {img
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={img.url} alt={`Page ${n + 1}`} draggable={false} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', opacity: img.rot === rot(p) ? 1 : 0.15 }} />
                        : <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9A9486' }}><Loader2 size={22} className="spin" /></div>}
                      <svg viewBox={`0 0 ${v.w} ${v.h}`} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}>
                        <g transform={`matrix(${v.T.join(' ')})`}>
                          {pm.map((m) => <MarkShape key={m.id} m={m} />)}
                          {draft && draft.page === p.key && <MarkShape m={draft} />}
                          {mine && <Selection m={mine} pp={pp(v)} />}
                        </g>
                      </svg>
                      {mine && grip && (
                        <>
                          <div aria-label="Drag to move" role="button"
                            style={{ position: 'absolute', left: `${(grip.l / v.w) * 100}%`, top: `${(grip.t / v.h) * 100}%`, width: `${((grip.r - grip.l) / v.w) * 100}%`, height: `${((grip.b - grip.t) / v.h) * 100}%`, touchAction: 'none', cursor: 'move' }}
                            onPointerDown={(e) => gripDown(e, p, mine, false)} onPointerMove={(e) => gripMove(e, p)} onPointerUp={gripUp} onPointerCancel={gripUp} />
                          {grip.hx !== undefined && grip.hy !== undefined && (
                            <div aria-label="Drag to resize" role="button"
                              style={{ position: 'absolute', left: `calc(${(grip.hx / v.w) * 100}% - 18px)`, top: `calc(${(grip.hy / v.h) * 100}% - 18px)`, width: 36, height: 36, borderRadius: 999, touchAction: 'none', cursor: 'nwse-resize' }}
                              onPointerDown={(e) => gripDown(e, p, mine, true)} onPointerMove={(e) => gripMove(e, p)} onPointerUp={gripUp} onPointerCancel={gripUp} />
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* What can be done to the selected mark */}
          {sel && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '8px 10px', background: '#FFFDF7', borderTop: '1px solid var(--wf-line)', flexWrap: 'wrap' }}>
              {sel.kind === 'text' && (
                <>
                  <button type="button" className="wf-btn wf-btn-outline wf-btn-sm" onClick={() => setTextAsk({ id: sel.id, value: sel.text, size: sel.size })}><Type size={15} /> Edit</button>
                </>
              )}
              {(sel.kind === 'text' || sel.kind === 'check' || sel.kind === 'cross' || sel.kind === 'dot' || (sel.kind === 'ink' && sel.opacity === 1)) && (
                ([['Black', INK.black], ['Blue', INK.blue], ['Red', INK.red]] as const).map(([label, c]) => (
                  <button key={c} type="button" onClick={() => recolor(sel.id, c)} aria-label={`Make it ${label.toLowerCase()}`}
                    style={{ width: 26, height: 26, borderRadius: 999, background: c, border: sel.color === c ? '3px solid #C9A24B' : '2px solid #fff', boxShadow: '0 0 0 1px var(--wf-line)', cursor: 'pointer' }} />
                ))
              )}
              <span style={{ flex: 1 }} />
              <button type="button" className="wf-btn wf-btn-ghost wf-btn-sm" onClick={() => duplicate(sel.id)}><Copy size={15} /> Copy</button>
              <button type="button" className="wf-btn wf-btn-ghost wf-btn-sm" style={{ color: 'var(--wf-danger)' }} onClick={() => remove(sel.id)}><Trash2 size={15} /> Delete</button>
              <button type="button" className="wf-btn wf-btn-outline wf-btn-sm" onClick={() => setSelected(null)}>Done</button>
            </div>
          )}

          {/* Tools */}
          <nav aria-label="Tools" style={{ display: 'flex', gap: 2, overflowX: 'auto', scrollbarWidth: 'thin', padding: '6px 6px calc(6px + env(safe-area-inset-bottom))', background: '#0E1B2E' }}>
            {TOOLS.map((t) => {
              const on = tool === t.key || (t.key === 'sign' && stamp?.what !== 'picture' && !!stamp) || (t.key === 'picture' && stamp?.what === 'picture');
              return (
                <button key={t.key} type="button" onClick={() => pickTool(t.key)} aria-pressed={on}
                  style={{ flex: '0 0 auto', minWidth: 60, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '6px 6px', borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600, background: on ? '#C9A24B' : 'transparent', color: on ? '#0E1B2E' : '#fff' }}>
                  {t.icon}{t.label}
                </button>
              );
            })}
            <span style={{ width: 1, background: 'rgba(255,255,255,0.2)', margin: '4px 4px', flex: 'none' }} />
            <button type="button" onClick={() => { setSelected(null); setSheet('pages'); }}
              style={{ flex: '0 0 auto', minWidth: 60, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '6px', borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600, background: 'transparent', color: '#fff' }}>
              <Files size={19} />Pages
            </button>
            <button type="button" onClick={undo} disabled={!history.length}
              style={{ flex: '0 0 auto', minWidth: 60, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '6px', borderRadius: 10, border: 'none', cursor: history.length ? 'pointer' : 'default', fontSize: 11, fontWeight: 600, background: 'transparent', color: '#fff', opacity: history.length ? 1 : 0.4 }}>
              <Undo2 size={19} />Undo
            </button>
          </nav>
        </>
      )}

      <input ref={pictureInput} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try {
            const c = await loadImage(f, 1600);
            setStamp({ src: c.toDataURL('image/jpeg', 0.88), aspect: c.width / c.height, what: 'picture' });
            setTool('picture');
          } catch { toastError("That picture couldn't be opened."); }
        }} />

      {sheet === 'sign' && (
        <SignSheet onClose={() => { setSheet(null); setTool('move'); }}
          onUse={(src, aspect, what) => { setSheet(null); setStamp({ src, aspect, what }); setTool('sign'); }} />
      )}

      {textAsk && (
        <Sheet title={textAsk.id ? 'Change the text' : 'Add text'} onClose={() => setTextAsk(null)}>
          <textarea className="wf-input" autoFocus rows={3} value={textAsk.value} onChange={(e) => setTextAsk({ ...textAsk, value: e.target.value })}
            placeholder="Type here…" style={{ fontSize: 16, width: '100%' }} />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {TEXT_SIZES.map((s) => (
              <button key={s.size} type="button" className={`wf-btn wf-btn-sm ${Math.round(textAsk.size) === s.size ? 'wf-btn-navy' : 'wf-btn-outline'}`}
                onClick={() => setTextAsk({ ...textAsk, size: s.size })}>{s.label}</button>
            ))}
            <button type="button" className="wf-btn wf-btn-ghost wf-btn-sm" onClick={() => setTextAsk({ ...textAsk, value: `${textAsk.value}${textAsk.value ? ' ' : ''}${dateText()}` })}><CalendarDays size={15} /> Add today</button>
          </div>
          <div className="save-bar">
            <button type="button" className="wf-btn wf-btn-outline" onClick={() => setTextAsk(null)}>Cancel</button>
            <button type="button" className="wf-btn wf-btn-gold" onClick={saveText}>{textAsk.id ? 'Save' : 'Add'}</button>
          </div>
        </Sheet>
      )}

      {sheet === 'pages' && (
        <Sheet title={`Pages (${pages.length})`} onClose={() => setSheet(null)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pages.map((p, i) => {
              const img = imgs[p.key];
              const v = viewOf(p);
              return (
                <div key={p.key} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: 6, border: '1px solid var(--wf-line)', borderRadius: 10 }}>
                  <div style={{ width: 54, height: 70, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F3F1EC', borderRadius: 6, overflow: 'hidden' }}>
                    {img && img.rot === rot(p)
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={img.url} alt="" style={{ maxWidth: 52, maxHeight: 68, boxShadow: '0 0 0 1px #ddd' }} />
                      : <div style={{ width: v.w > v.h ? 50 : 38, height: v.w > v.h ? 38 : 50, background: '#fff', boxShadow: '0 0 0 1px #ddd' }} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0, fontWeight: 600 }}>Page {i + 1}</div>
                  <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <button type="button" className="wf-btn wf-btn-ghost wf-btn-sm" onClick={() => turnPage(p.key)} aria-label={`Turn page ${i + 1}`}><RotateCw size={15} /></button>
                    <button type="button" className="wf-btn wf-btn-ghost wf-btn-sm" onClick={() => movePage(i, -1)} disabled={i === 0} aria-label="Move up"><ChevronUp size={15} /></button>
                    <button type="button" className="wf-btn wf-btn-ghost wf-btn-sm" onClick={() => movePage(i, 1)} disabled={i === pages.length - 1} aria-label="Move down"><ChevronDown size={15} /></button>
                    <button type="button" className="wf-btn wf-btn-ghost wf-btn-sm" onClick={() => void copyTextOf(p, i + 1)} aria-label={`Copy the words on page ${i + 1}`}><ScanText size={15} /></button>
                    <button type="button" className="wf-btn wf-btn-ghost wf-btn-sm" style={{ color: 'var(--wf-danger)' }} onClick={() => deletePage(p.key)} aria-label={`Delete page ${i + 1}`}><Trash2 size={15} /></button>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <label className="wf-btn wf-btn-outline" style={{ flex: '1 1 150px', justifyContent: 'center' }}>
              <FilePlus2 size={16} /> Add a PDF
              <input type="file" accept="application/pdf,.pdf" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void addPages(f); }} />
            </label>
            <label className="wf-btn wf-btn-outline" style={{ flex: '1 1 150px', justifyContent: 'center' }}>
              <Images size={16} /> Add photos
              <input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => { const fs = Array.from(e.target.files ?? []); e.target.value = ''; void addPhotos(fs); }} />
            </label>
          </div>
          <div className="wf-subtle" style={{ fontSize: 12.5 }}><ScanText size={13} style={{ verticalAlign: -2 }} /> copies the words off a page so you can paste them anywhere.</div>
        </Sheet>
      )}

      {ocr && (
        <Sheet title={ocr.title} onClose={() => setOcr(null)}>
          {ocr.text === null ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--wf-subtle)' }}>
              <Loader2 size={16} className="spin" /> Reading the page… {ocr.progress > 0 ? `${Math.round(ocr.progress * 100)}%` : ''}
            </div>
          ) : (
            <>
              <textarea className="wf-input" rows={10} value={ocr.text} onChange={(e) => setOcr({ ...ocr, text: e.target.value })} style={{ fontSize: 16, width: '100%' }} />
              <div className="save-bar">
                <button type="button" className="wf-btn wf-btn-outline" onClick={() => setOcr(null)}>Close</button>
                <button type="button" className="wf-btn wf-btn-gold" onClick={() => { void navigator.clipboard?.writeText(ocr.text ?? '').then(() => toastSuccess('Copied.'), () => toastError('Couldn’t copy — select the text and copy it.')); }}><Copy size={15} /> Copy</button>
              </div>
            </>
          )}
        </Sheet>
      )}

      {sheet === 'save' && (
        <Sheet title="Finish" onClose={() => setSheet(null)}>
          <label style={{ display: 'block' }}>
            <span className="wf-label" style={{ display: 'block', marginBottom: 4 }}>Name</span>
            <input className="wf-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder={kind} style={{ fontSize: 16, width: '100%' }} />
          </label>
          {send?.kinds && (
            <label style={{ display: 'block' }}>
              <span className="wf-label" style={{ display: 'block', marginBottom: 4 }}>What is it?</span>
              <select className="wf-input" value={kind} onChange={(e) => setKind(e.target.value)} style={{ fontSize: 16, width: '100%' }}>
                {send.kinds.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </label>
          )}
          {send?.techToggle && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
              <input type="checkbox" checked={forTech} onChange={(e) => setForTech(e.target.checked)} style={{ width: 18, height: 18 }} />
              Techs on this job can open it (to sign or fill in)
            </label>
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
            <input type="checkbox" checked={smaller} onChange={(e) => setSmaller(e.target.checked)} style={{ width: 18, height: 18 }} />
            Make the file smaller (for email)
          </label>
          <div className="save-bar" style={{ justifyContent: 'stretch' }}>
            {onSend && send && (
              <button type="button" className="wf-btn wf-btn-navy" style={{ flex: '2 1 160px' }} disabled={!!busy} onClick={() => void run('send')}><Send size={16} /> {send.label}</button>
            )}
            <button type="button" className="wf-btn wf-btn-outline" style={{ flex: '1 1 100px' }} disabled={!!busy} onClick={() => void run('save')}><Download size={16} /> Save</button>
            <button type="button" className="wf-btn wf-btn-outline" style={{ flex: '1 1 100px' }} disabled={!!busy} onClick={() => void run('share')}><Share2 size={16} /> Share</button>
          </div>
          {busy && <div style={{ fontSize: 13, color: 'var(--wf-subtle)', display: 'flex', alignItems: 'center', gap: 6 }}><Loader2 size={14} className="spin" /> {busy}</div>}
        </Sheet>
      )}
    </div>,
    document.body,
  );
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 20, background: 'rgba(14,27,46,0.55)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} {...backdropClose(onClose)}>
      <div className="wf-card" style={{ width: '100%', maxWidth: 640, maxHeight: '88%', overflowY: 'auto', borderRadius: '16px 16px 0 0', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <b style={{ flex: 1, fontSize: 16 }}>{title}</b>
          <button type="button" className="wf-btn wf-btn-ghost wf-btn-sm" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** One mark, drawn in page space (the group around it maps page space to the screen). */
function MarkShape({ m }: { m: Mark }) {
  if (m.kind === 'ink') {
    const blend = m.opacity < 1 ? { mixBlendMode: 'multiply' as const } : undefined;
    if (m.points.length === 1) return <circle cx={m.points[0].x} cy={m.points[0].y} r={m.width / 2} fill={m.color} fillOpacity={m.opacity} style={blend} />;
    return <polyline points={m.points.map((q) => `${q.x},${q.y}`).join(' ')} fill="none" stroke={m.color} strokeWidth={m.width} strokeOpacity={m.opacity} strokeLinecap="round" strokeLinejoin="round" style={blend} />;
  }
  const flip = `matrix(1 0 0 -1 0 ${m.h})`; // pictures and letters are drawn top-down
  return (
    <g transform={`matrix(${boxMatrix(m).join(' ')})`}>
      {m.kind === 'whiteout' && <rect width={m.w} height={m.h} fill="#fff" stroke="#A9B2BF" strokeWidth={0.5} strokeDasharray="3 2" />}
      {m.kind === 'image' && <g transform={flip}><image href={m.src} width={m.w} height={m.h} preserveAspectRatio="none" /></g>}
      {m.kind === 'text' && (
        <g transform={flip}>
          {textLines(m.text).map((l, i) => (
            <text key={i} x={0} y={baselineFromTop(i, m.size)} fontSize={m.size} fill={m.color} fontFamily="Helvetica, Arial, sans-serif" xmlSpace="preserve">{l}</text>
          ))}
        </g>
      )}
      {(m.kind === 'check' || m.kind === 'cross') && SYMBOL_STROKES[m.kind].map((s, i) => (
        <polyline key={i} points={s.map((q) => `${q.x * m.w},${q.y * m.h}`).join(' ')} fill="none" stroke={m.color} strokeWidth={SYMBOL_WIDTH * Math.min(m.w, m.h)} strokeLinecap="round" strokeLinejoin="round" />
      ))}
      {m.kind === 'dot' && <circle cx={m.w / 2} cy={m.h / 2} r={DOT_RADIUS * Math.min(m.w, m.h)} fill={m.color} />}
    </g>
  );
}

/** The gold outline round the selected mark, with its resize dot. */
function Selection({ m, pp }: { m: Mark; pp: number }) {
  const line = { fill: 'none', stroke: '#C9A24B', strokeWidth: 1.6 * pp, strokeDasharray: `${5 * pp} ${3 * pp}` };
  if (m.kind === 'ink') {
    const xs = m.points.map((q) => q.x), ys = m.points.map((q) => q.y);
    const pad = m.width / 2 + 3 * pp;
    return <rect x={Math.min(...xs) - pad} y={Math.min(...ys) - pad} width={Math.max(...xs) - Math.min(...xs) + pad * 2} height={Math.max(...ys) - Math.min(...ys) + pad * 2} {...line} />;
  }
  const pad = 3 * pp;
  return (
    <g transform={`matrix(${boxMatrix(m).join(' ')})`}>
      <rect x={-pad} y={-pad} width={m.w + pad * 2} height={m.h + pad * 2} {...line} />
      <circle cx={m.w} cy={m.h} r={8 * pp} fill="#C9A24B" stroke="#fff" strokeWidth={2 * pp} />
    </g>
  );
}
