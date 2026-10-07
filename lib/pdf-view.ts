// Opening and drawing PDF pages in the browser with pdf.js, for the PDF
// editor (Fred, 2026-10-07: "edit and sign pdfs everything from iscanner").
//
// pdf.js normally reads the PDF in a separate worker file. Here its worker
// code is loaded onto the page itself instead — nothing extra to host, and it
// works the same on every phone and with every bundler. Fonts and image
// decoders a few PDFs need are fetched from the pdf.js package on jsDelivr,
// pinned to the installed version, only when such a PDF is opened.
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { Matrix } from './pdf-marks';
import type { RasterPage } from './pdf-build';

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let lib: Promise<PdfJs> | null = null;

export function pdfjs(): Promise<PdfJs> {
  if (!lib) {
    lib = (async () => {
      await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
      return import('pdfjs-dist/legacy/build/pdf.mjs');
    })();
    lib.catch(() => { lib = null; });
  }
  return lib;
}

export type { PDFDocumentProxy, PDFPageProxy };

/** Open a PDF. `askPassword` is asked when it's locked (null = give up). */
export async function openPdf(bytes: Uint8Array, askPassword?: (wrongBefore: boolean) => string | null): Promise<PDFDocumentProxy> {
  const pdf = await pdfjs();
  const cdn = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdf.version}/`;
  const task = pdf.getDocument({
    data: bytes.slice(), // pdf.js takes the bytes over; keep ours for saving
    cMapUrl: `${cdn}cmaps/`, cMapPacked: true,
    standardFontDataUrl: `${cdn}standard_fonts/`,
    wasmUrl: `${cdn}wasm/`,
  });
  task.onPassword = (update: (pw: string) => void, reason: number) => {
    const pw = askPassword?.(reason === pdf.PasswordResponses.INCORRECT_PASSWORD) ?? null;
    if (pw === null) void task.destroy();
    else update(pw);
  };
  return task.promise;
}

const toBlob = (c: HTMLCanvasElement, type: string, q: number) =>
  new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't draw the page."))), type, q));

/** Draw one page, turned `rotation`, `width` pixels wide, as a JPEG. */
export async function renderPage(page: PDFPageProxy, rotation: number, width: number, quality = 0.85): Promise<{ blob: Blob; width: number; height: number }> {
  const one = page.getViewport({ scale: 1, rotation });
  // Phones refuse very large canvases; stay under ~16 million pixels.
  const scale = Math.min(width / one.width, Math.sqrt(16e6 / (one.width * one.height)));
  const vp = page.getViewport({ scale, rotation });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(vp.width));
  canvas.height = Math.max(1, Math.floor(vp.height));
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, viewport: vp }).promise;
  const blob = await toBlob(canvas, 'image/jpeg', quality);
  const out = { blob, width: canvas.width, height: canvas.height };
  canvas.width = 0; canvas.height = 0; // let iPhones have the memory back
  return out;
}

/** Page space → screen (points, y down) for a page turned `rotation`. */
export const viewMatrix = (page: PDFPageProxy, rotation: number): Matrix => page.getViewport({ scale: 1, rotation }).transform as Matrix;
/** The page's size on screen at 100%, turned `rotation` (points). */
export function viewSize(page: PDFPageProxy, rotation: number): { width: number; height: number } {
  const v = page.getViewport({ scale: 1, rotation });
  return { width: v.width, height: v.height };
}

/** A page as a picture, for a locked PDF or a smaller file (see pdf-build.ts). */
export async function rasterPage(page: PDFPageProxy, rotation: number, pxPerPoint: number, quality: number): Promise<RasterPage> {
  const size = viewSize(page, rotation);
  const { blob } = await renderPage(page, rotation, size.width * pxPerPoint, quality);
  return { jpeg: new Uint8Array(await blob.arrayBuffer()), width: size.width, height: size.height, toView: viewMatrix(page, rotation), rotation };
}
