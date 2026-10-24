// A PDF whose pages are mostly blank paper, cut down to what's printed on them
// (Fred, 2026-10-23: a Google Sheet saved as a PDF came out as a small table in
// the corner of a tall page, too small to read or fill in on a phone).
// Each page is drawn once to find where the ink is, then copied as it is onto
// a page that size — the text stays sharp. Forms and turned pages are left alone.
// inkBox is pure and unit-tested (lib/pdf-trim.test.ts).

export type Box = { left: number; top: number; right: number; bottom: number };

/** Where anything darker than paper is, in pixels of an RGBA image. Null: blank. */
export function inkBox(data: Uint8ClampedArray, w: number, h: number, paper = 245): Box | null {
  let left = w, top = h, right = -1, bottom = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      const i = row + x * 4;
      if (data[i + 3] > 0 && (data[i] < paper || data[i + 1] < paper || data[i + 2] < paper)) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  return right < 0 ? null : { left, top, right: right + 1, bottom: bottom + 1 };
}

/** Worth cutting: the printed part covers under 60% of the page. */
export const worthTrimming = (ink: Box, w: number, h: number) =>
  ((ink.right - ink.left) * (ink.bottom - ink.top)) / (w * h) < 0.6;

/** The PDF with blank paper cut away, or null when there's nothing to gain. */
export async function trimPdf(bytes: Uint8Array): Promise<Uint8Array | null> {
  const { PDFDocument } = await import('pdf-lib');
  const src = await PDFDocument.load(bytes);
  if (src.getForm().getFields().length > 0) return null; // its boxes would be lost
  const { openPdf } = await import('./pdf-view');
  const pdf = await openPdf(bytes);
  const boxes: (Box | null)[] = [];
  let any = false;
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    if (page.rotate % 360 !== 0) { boxes.push(null); continue; }
    const one = page.getViewport({ scale: 1 });
    const scale = 700 / Math.max(one.width, one.height);
    const vp = page.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    await page.render({ canvas: c, viewport: vp }).promise;
    const ink = inkBox(g.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
    if (!ink || !worthTrimming(ink, c.width, c.height)) { boxes.push(null); continue; }
    // Pixels → the page's own points (pdf.js y runs down, PDF y runs up), with a margin.
    const [x0, , , y1] = page.view;
    const m = 14;
    boxes.push({
      left: Math.max(page.view[0], x0 + ink.left / scale - m),
      right: Math.min(page.view[2], x0 + ink.right / scale + m),
      top: Math.min(page.view[3], y1 - ink.top / scale + m),
      bottom: Math.max(page.view[1], y1 - ink.bottom / scale - m),
    });
    any = true;
  }
  void pdf.loadingTask.destroy();
  if (!any) return null;
  const out = await PDFDocument.create();
  out.setTitle(src.getTitle() ?? ''); out.setProducer('FAJ Solutions');
  const srcPages = src.getPages();
  for (let i = 0; i < srcPages.length; i++) {
    const b = boxes[i];
    if (!b) { const [p] = await out.copyPages(src, [i]); out.addPage(p); continue; }
    const emb = await out.embedPage(srcPages[i], b);
    out.addPage([b.right - b.left, b.top - b.bottom]).drawPage(emb, { x: 0, y: 0 });
  }
  return out.save();
}
