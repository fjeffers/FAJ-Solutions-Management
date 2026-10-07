// Marks on a PDF: signatures, initials, text, dates, check marks, pen,
// highlighter, white-out and pictures (Fred, 2026-10-07: "go ahead with the
// edit and sign pdfs everything from iscanner").
//
// Every mark lives in the PDF's own page space (points, y up), so it stays put
// on the page whatever zoom or turn it is viewed at, and lands in the saved PDF
// exactly where it was seen. A boxed mark is anchored at its bottom-left
// corner and turned `angle` degrees counter-clockwise — the turn the page had
// on screen when it was placed, so it reads upright there.
//
// Pure and unit-tested. components/tools/PdfEditor.tsx draws and moves them;
// lib/pdf-build.ts writes them into the PDF.

export type Pt = { x: number; y: number };
/** A 2-D matrix [a, b, c, d, e, f] as PDF and pdf.js use it: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Matrix = [number, number, number, number, number, number];

type Box = { id: string; page: string; x: number; y: number; w: number; h: number; angle: number };
export type ImageMark = Box & { kind: 'image'; src: string; what: 'signature' | 'initials' | 'picture' };
export type TextMark = Box & { kind: 'text'; text: string; size: number; color: string };
export type SymbolMark = Box & { kind: 'check' | 'cross' | 'dot'; color: string };
export type WhiteoutMark = Box & { kind: 'whiteout' };
export type InkMark = { id: string; page: string; kind: 'ink'; points: Pt[]; width: number; color: string; opacity: number };
export type BoxMark = ImageMark | TextMark | SymbolMark | WhiteoutMark;
export type Mark = BoxMark | InkMark;

export const isBox = (m: Mark): m is BoxMark => m.kind !== 'ink';

// ── Matrices ────────────────────────────────────────────────────────────────

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
/** m after n: apply n first, then m. */
export function mul(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}
export function invert(m: Matrix): Matrix {
  const det = m[0] * m[3] - m[1] * m[2];
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}
export const apply = (m: Matrix, p: Pt): Pt => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });
export const translate = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y];
/** Counter-clockwise, y up. */
export function rotation(deg: number): Matrix {
  const r = (deg * Math.PI) / 180;
  const c = Math.round(Math.cos(r) * 1e12) / 1e12, s = Math.round(Math.sin(r) * 1e12) / 1e12;
  return [c, s, -s, c, 0, 0];
}
export const normDeg = (d: number) => ((Math.round(d) % 360) + 360) % 360;

/** A boxed mark's own frame (0,0)–(w,h) → page space. */
export const boxMatrix = (m: BoxMark): Matrix => mul(translate(m.x, m.y), rotation(m.angle));
/** A page point in a boxed mark's own frame. */
export const toLocal = (m: BoxMark, p: Pt): Pt => apply(invert(boxMatrix(m)), p);

// ── Placing, moving, sizing ─────────────────────────────────────────────────

/** A box of w×h centred on a page point, upright for a page shown at `angle`. */
export function centredAt(p: Pt, w: number, h: number, angle: number): { x: number; y: number; w: number; h: number; angle: number } {
  const off = apply(rotation(angle), { x: w / 2, y: h / 2 });
  return { x: p.x - off.x, y: p.y - off.y, w, h, angle };
}

/** The box dragged out between two page points, upright for a page shown at `angle`. */
export function boxFromDrag(a: Pt, b: Pt, angle: number): { x: number; y: number; w: number; h: number; angle: number } {
  const back = rotation(-angle);
  const la = apply(back, a), lb = apply(back, b);
  const corner = apply(rotation(angle), { x: Math.min(la.x, lb.x), y: Math.min(la.y, lb.y) });
  return { x: corner.x, y: corner.y, w: Math.abs(la.x - lb.x), h: Math.abs(la.y - lb.y), angle };
}

export function moveBy<M extends Mark>(m: M, dx: number, dy: number): M {
  if (m.kind === 'ink') return { ...m, points: m.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
  return { ...m, x: m.x + dx, y: m.y + dy };
}

/**
 * Drag the top-right handle to `local` (the mark's own frame). White-out
 * stretches freely; everything else keeps its shape (text grows its letters).
 */
export function resizeTo<M extends BoxMark>(m: M, local: Pt): M {
  if (m.kind === 'whiteout') return { ...m, w: Math.max(4, local.x), h: Math.max(4, local.y) };
  const k = Math.max(local.x / m.w, local.y / m.h, 6 / Math.min(m.w, m.h));
  const out = { ...m, w: m.w * k, h: m.h * k };
  if (m.kind === 'text') (out as TextMark).size = m.size * k;
  return out;
}

/** Fit w×h inside maxW×maxH, keeping its shape. */
export function fitInside(w: number, h: number, maxW: number, maxH: number): { w: number; h: number } {
  const k = Math.min(maxW / w, maxH / h, 1);
  return { w: w * k, h: h * k };
}

// ── Finding what was tapped ─────────────────────────────────────────────────

export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** The top-most mark on `page` under page point p (within `tol` points), or null. */
export function hitTest(marks: Mark[], page: string, p: Pt, tol: number): Mark | null {
  for (let i = marks.length - 1; i >= 0; i--) {
    const m = marks[i];
    if (m.page !== page) continue;
    if (m.kind === 'ink') {
      const reach = m.width / 2 + tol;
      if (m.points.length === 1 ? Math.hypot(p.x - m.points[0].x, p.y - m.points[0].y) <= reach
        : m.points.some((q, j) => j > 0 && distToSegment(p, m.points[j - 1], q) <= reach)) return m;
      continue;
    }
    const l = toLocal(m, p);
    if (l.x >= -tol && l.x <= m.w + tol && l.y >= -tol && l.y <= m.h + tol) return m;
  }
  return null;
}

// ── Text ────────────────────────────────────────────────────────────────────

/** Line height and where the first baseline sits, as multiples of the letter size. */
export const LINE = 1.25;
export const FIRST_BASELINE = 0.95;

export const textLines = (t: string): string[] => t.replace(/\r/g, '').split('\n').map((l) => l.replace(/\s+$/, ''));
/** Line i's baseline, measured down from the top of the box. */
export const baselineFromTop = (i: number, size: number) => i * size * LINE + FIRST_BASELINE * size;

/** The box a block of text needs. `widthOf` measures one line at a size. */
export function textBox(text: string, size: number, widthOf: (line: string, size: number) => number): { w: number; h: number } {
  const lines = textLines(text);
  return { w: Math.max(size * 0.6, ...lines.map((l) => widthOf(l, size))), h: lines.length * size * LINE };
}

// The PDF's built-in Helvetica writes the Windows-1252 letters and nothing else.
const WIN_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
/** Text the built-in PDF font can write: anything else becomes "?" (so the screen shows what the PDF will). */
export function pdfSafeText(s: string): string {
  return Array.from(s.normalize('NFC').replace(/\t/g, '    ').replace(/[   ]/g, ' ').replace(/−/g, '-'))
    .map((ch) => {
      const c = ch.codePointAt(0)!;
      if (c === 10 || (c >= 0x20 && c <= 0x7e) || (c >= 0xa1 && c <= 0xff) || WIN_EXTRA.includes(ch)) return ch;
      return c === 0x2713 || c === 0x2714 ? 'X' : '?';
    })
    .join('');
}

/** Today as a form date: 10/7/2026. */
export const dateText = (d = new Date()) => d.toLocaleDateString('en-US');

// ── Symbols ─────────────────────────────────────────────────────────────────

/** Check and cross as strokes in a 1×1 box (y up); stroke width is a share of the box. */
export const SYMBOL_STROKES: Record<'check' | 'cross', Pt[][]> = {
  check: [[{ x: 0.1, y: 0.52 }, { x: 0.38, y: 0.18 }, { x: 0.92, y: 0.86 }]],
  cross: [[{ x: 0.15, y: 0.15 }, { x: 0.85, y: 0.85 }], [{ x: 0.15, y: 0.85 }, { x: 0.85, y: 0.15 }]],
};
export const SYMBOL_WIDTH = 0.14;
export const DOT_RADIUS = 0.32;

// ── Colours ─────────────────────────────────────────────────────────────────

export const INK = { black: '#1B1C1F', blue: '#1F3FAE', red: '#C62828' } as const;
export const HIGHLIGHT = { color: '#FFD60A', opacity: 0.38, width: 14 } as const;
export const PEN_WIDTH = 2;

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0').slice(0, 6);
  const n = parseInt(v, 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

