// Writes the finished PDF from the editor (Fred, 2026-10-07: "edit and sign
// pdfs everything from iscanner"): the pages in their new order and turn,
// every mark drawn in (lib/pdf-marks.ts), with pdf-lib.
//
// Pages are copied as they are — text stays text — and fillable forms are
// flattened first so their boxes can't cover what was written on top. A page
// whose PDF pdf-lib can't open (a locked PDF), or every page when the file is
// being made smaller, comes in as a picture of the page instead (`raster`),
// and its marks are moved onto the picture.
import type { PDFDocument, PDFFont, PDFImage, PDFPage } from 'pdf-lib';
import {
  SYMBOL_STROKES, SYMBOL_WIDTH, DOT_RADIUS, apply, baselineFromTop, boxMatrix, hexToRgb, normDeg, textLines,
  type Mark, type Matrix, type Pt,
} from './pdf-marks';

/** One page of the finished PDF. */
export type OutPage = {
  key: string;
  /** Which source PDF, and which page in it (0-based). */
  src: number;
  index: number;
  /** Extra quarter-turns clockwise, on top of the page's own. */
  extra: number;
  raster?: RasterPage;
};

/** A page as a picture: the JPEG, its size on paper (points), and how page space maps onto it. */
export type RasterPage = {
  jpeg: Uint8Array;
  width: number;
  height: number;
  /** Page space → the picture, y down (pdf.js viewport.transform at scale 1). */
  toView: Matrix;
  /** The turn the picture was taken at. */
  rotation: number;
};

/** Can pdf-lib open this PDF to copy its pages? (No for locked PDFs.) */
export async function canCopy(bytes: Uint8Array): Promise<boolean> {
  const { PDFDocument } = await import('pdf-lib');
  try { await PDFDocument.load(bytes, { updateMetadata: false }); return true; } catch { return false; }
}

function dataUrlBytes(src: string): { bytes: Uint8Array; png: boolean } {
  const [head, b64] = src.split(',', 2);
  const bin = atob(b64 ?? '');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, png: /image\/png/i.test(head) };
}

export async function buildPdf({ sources, pages, marks, title }: {
  sources: Uint8Array[];
  pages: OutPage[];
  marks: Mark[];
  title: string;
}): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb, degrees, LineCapStyle, BlendMode } = await import('pdf-lib');
  const out = await PDFDocument.create();
  out.setTitle(title);
  out.setProducer('FAJ Solutions');
  out.setCreator('FAJ Solutions');

  const loaded = new Map<number, PDFDocument>();
  const source = async (i: number) => {
    let d = loaded.get(i);
    if (!d) {
      d = await PDFDocument.load(sources[i], { updateMetadata: false });
      try { const form = d.getForm(); if (form.getFields().length) form.flatten(); } catch { /* not a form */ }
      loaded.set(i, d);
    }
    return d;
  };

  let font: PDFFont | null = null;
  const images = new Map<string, PDFImage>();
  const image = async (src: string) => {
    let im = images.get(src);
    if (!im) {
      const { bytes, png } = dataUrlBytes(src);
      im = png ? await out.embedPng(bytes) : await out.embedJpg(bytes);
      images.set(src, im);
    }
    return im;
  };

  for (const p of pages) {
    let page: PDFPage;
    // Page space → the finished page, and the extra turn that adds to every mark.
    let map: (q: Pt) => Pt = (q) => q;
    let turn = 0;
    if (p.raster) {
      const r = p.raster;
      page = out.addPage([r.width, r.height]);
      page.drawImage(await out.embedJpg(r.jpeg), { x: 0, y: 0, width: r.width, height: r.height });
      map = (q) => { const v = apply(r.toView, q); return { x: v.x, y: r.height - v.y }; };
      turn = -r.rotation;
    } else {
      const [copied] = await out.copyPages(await source(p.src), [p.index]);
      page = out.addPage(copied);
      if (p.extra) page.setRotation(degrees(normDeg(page.getRotation().angle + p.extra)));
    }

    for (const m of marks) {
      if (m.page !== p.key) continue;
      if (m.kind === 'ink') {
        if (m.points.length === 0) continue;
        const pts = m.points.map(map);
        const path = pts.map((q, i) => `${i ? 'L' : 'M'} ${q.x.toFixed(2)} ${(-q.y).toFixed(2)}`).join(' ') + (pts.length === 1 ? ` L ${pts[0].x.toFixed(2)} ${(-pts[0].y).toFixed(2)}` : '');
        const c = hexToRgb(m.color);
        page.drawSvgPath(path, {
          x: 0, y: 0, borderColor: rgb(c.r, c.g, c.b), borderWidth: m.width, borderOpacity: m.opacity, borderLineCap: LineCapStyle.Round,
          ...(m.opacity < 1 ? { blendMode: BlendMode.Multiply } : {}),
        });
        continue;
      }
      const frame = boxMatrix(m);
      const at = (lx: number, ly: number) => map(apply(frame, { x: lx, y: ly }));
      const rotate = degrees(normDeg(m.angle + turn));
      const corner = at(0, 0);
      if (m.kind === 'whiteout') {
        page.drawRectangle({ x: corner.x, y: corner.y, width: m.w, height: m.h, rotate, color: rgb(1, 1, 1) });
      } else if (m.kind === 'image') {
        page.drawImage(await image(m.src), { x: corner.x, y: corner.y, width: m.w, height: m.h, rotate });
      } else if (m.kind === 'text') {
        font ??= await out.embedFont(StandardFonts.Helvetica);
        const c = hexToRgb(m.color);
        textLines(m.text).forEach((line, i) => {
          if (!line) return;
          const base = at(0, m.h - baselineFromTop(i, m.size));
          page.drawText(line, { x: base.x, y: base.y, size: m.size, font: font!, color: rgb(c.r, c.g, c.b), rotate });
        });
      } else if (m.kind === 'dot') {
        const c = hexToRgb(m.color);
        const centre = at(m.w / 2, m.h / 2);
        page.drawCircle({ x: centre.x, y: centre.y, size: DOT_RADIUS * Math.min(m.w, m.h), color: rgb(c.r, c.g, c.b) });
      } else {
        const c = hexToRgb(m.color);
        const thickness = SYMBOL_WIDTH * Math.min(m.w, m.h);
        for (const stroke of SYMBOL_STROKES[m.kind]) {
          for (let i = 1; i < stroke.length; i++) {
            page.drawLine({
              start: at(stroke[i - 1].x * m.w, stroke[i - 1].y * m.h), end: at(stroke[i].x * m.w, stroke[i].y * m.h),
              thickness, color: rgb(c.r, c.g, c.b), lineCap: LineCapStyle.Round,
            });
          }
        }
      }
    }
  }
  return out.save();
}
