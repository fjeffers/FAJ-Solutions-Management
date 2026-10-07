// Reading words and codes off a photo or a page — iScanner's "text
// recognition" and QR/barcode reader (Fred, 2026-10-07: "everything from
// iscanner"). For techs: serial numbers and MAC addresses off equipment
// labels, a part number, the text of a sheet.
//
// Words: tesseract.js, on the phone. Its engine and the English letter shapes
// (a few MB, the first time only; the browser keeps them) come from jsDelivr.
// Codes: the phone's own barcode reader where it has one (Android Chrome),
// otherwise ZXing, which is bundled with the app.

export async function readText(image: HTMLCanvasElement | Blob, onProgress?: (share: number) => void): Promise<string> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng', 1, {
    logger: (m: { status: string; progress: number }) => { if (m.status === 'recognizing text') onProgress?.(m.progress); },
  });
  try {
    const { data } = await worker.recognize(image);
    return tidyText(data.text);
  } finally {
    await worker.terminate();
  }
}

/** Drop the blank lines and stray spaces OCR leaves behind. */
export function tidyText(raw: string): string {
  return raw.replace(/\r/g, '').split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n');
}

export type FoundCode = { text: string; kind: string };

/** "qr_code" / QR_CODE → "QR code"; "code_128" → "Code 128 barcode". */
export function codeKind(format: string): string {
  const f = format.toLowerCase().replace(/_/g, ' ').trim();
  if (f === 'qr code') return 'QR code';
  if (f === 'data matrix') return 'Data Matrix code';
  if (f === 'aztec' || f === 'pdf 417' || f === 'pdf417') return `${f.toUpperCase()} code`;
  return `${f.replace(/\b\w/g, (c) => c.toUpperCase())} barcode`;
}

type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string; format: string }[]> };

/** Every QR code / barcode in the picture (usually one). */
export async function readCodes(canvas: HTMLCanvasElement): Promise<FoundCode[]> {
  const seen = new Set<string>();
  const out: FoundCode[] = [];
  const add = (text: string, format: string) => { if (text && !seen.has(text)) { seen.add(text); out.push({ text, kind: codeKind(format) }); } };

  const Native = (globalThis as { BarcodeDetector?: new () => Detector }).BarcodeDetector;
  if (Native) {
    try { for (const c of await new Native().detect(canvas)) add(c.rawValue, c.format); } catch { /* fall through to ZXing */ }
    if (out.length) return out;
  }

  const zx = await import('@zxing/library');
  const reader = new zx.MultiFormatReader();
  const hints = new Map<import('@zxing/library').DecodeHintType, unknown>([[zx.DecodeHintType.TRY_HARDER, true]]);
  reader.setHints(hints);
  // ZXing reads best at a moderate size; try a couple, and sideways.
  for (const side of [1200, 800, 1800]) {
    for (const turn of [0, 90] as const) {
      const lum = luminance(canvas, side, turn);
      try {
        const r = reader.decode(new zx.BinaryBitmap(new zx.HybridBinarizer(new zx.RGBLuminanceSource(lum.data, lum.width, lum.height))));
        add(r.getText(), zx.BarcodeFormat[r.getBarcodeFormat()] ?? 'code');
        return out;
      } catch { /* not found at this size/turn */ }
    }
  }
  return out;
}

function luminance(src: HTMLCanvasElement, longSide: number, turn: 0 | 90): { data: Uint8ClampedArray; width: number; height: number } {
  const k = Math.min(1, longSide / Math.max(src.width, src.height));
  const w = Math.max(1, Math.round(src.width * k)), h = Math.max(1, Math.round(src.height * k));
  const c = document.createElement('canvas');
  c.width = turn ? h : w; c.height = turn ? w : h;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  if (turn) { g.translate(c.width, 0); g.rotate(Math.PI / 2); }
  g.drawImage(src, 0, 0, w, h);
  const px = g.getImageData(0, 0, c.width, c.height).data;
  const data = new Uint8ClampedArray(c.width * c.height);
  for (let i = 0, j = 0; j < data.length; i += 4, j++) data[j] = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
  return { data, width: c.width, height: c.height };
}
