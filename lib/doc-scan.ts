// Document scanning math (Fred, 2026-10-07, sending the iScanner app: "all the
// above for my tech to use"). A tech photographs a page, drags its four
// corners into place, and the page is straightened ("warped" flat, as if shot
// from straight above) and cleaned up. Pure functions on plain pixel arrays, so
// they're unit-tested without a browser; components/tools/DocScanner.tsx runs
// them on canvas pixels.

export type Pt = { x: number; y: number };
/** RGBA pixels, like a canvas ImageData. */
export type Pixels = { width: number; height: number; data: Uint8ClampedArray };
export type ScanFilter = 'color' | 'gray' | 'bw';

/**
 * The 3×3 perspective transform taking src[i] to dst[i] (four points each),
 * solved directly (8 equations, 8 unknowns, h33 = 1).
 */
export function homography(src: Pt[], dst: Pt[]): number[] {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i], { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  // Gaussian elimination with partial pivoting.
  const n = 8;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) throw new Error('Those corners don’t make a page — move them apart.');
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / A[c][c];
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const h = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < n; k++) s -= A[r][k] * h[k];
    h[r] = s / A[r][r];
  }
  return [...h, 1];
}

export function applyH(h: number[], x: number, y: number): Pt {
  const w = h[6] * x + h[7] * y + h[8];
  return { x: (h[0] * x + h[1] * y + h[2]) / w, y: (h[3] * x + h[4] * y + h[5]) / w };
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** How big the flattened page comes out: the longer of each pair of opposite sides, capped. */
export function outputSize(corners: Pt[], maxSide = 1800): { width: number; height: number } {
  const [tl, tr, br, bl] = corners;
  let w = Math.max(dist(tl, tr), dist(bl, br));
  let h = Math.max(dist(tl, bl), dist(tr, br));
  const k = Math.min(1, maxSide / Math.max(w, h));
  w = Math.max(1, Math.round(w * k)); h = Math.max(1, Math.round(h * k));
  return { width: w, height: h };
}

/**
 * The page inside corners [top-left, top-right, bottom-right, bottom-left],
 * flattened to a rectangle. Each output pixel looks up where it came from in
 * the photo (bilinear, so edges stay smooth).
 */
export function warpPage(img: Pixels, corners: Pt[], maxSide = 1800): Pixels {
  const { width, height } = outputSize(corners, maxSide);
  const dst = [{ x: 0, y: 0 }, { x: width - 1, y: 0 }, { x: width - 1, y: height - 1 }, { x: 0, y: height - 1 }];
  const back = homography(dst, corners); // output → photo
  const out = new Uint8ClampedArray(width * height * 4);
  const W = img.width, H = img.height, d = img.data;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = applyH(back, x, y);
      const sx = Math.min(Math.max(p.x, 0), W - 1.001), sy = Math.min(Math.max(p.y, 0), H - 1.001);
      const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
      const i00 = (y0 * W + x0) * 4, i10 = i00 + 4, i01 = i00 + W * 4, i11 = i01 + 4;
      const o = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const top = d[i00 + c] * (1 - fx) + d[i10 + c] * fx;
        const bot = d[i01 + c] * (1 - fx) + d[i11 + c] * fx;
        out[o + c] = top * (1 - fy) + bot * fy;
      }
      out[o + 3] = 255;
    }
  }
  return { width, height, data: out };
}

/** Brightness of each pixel (0–255). */
function luminance(img: Pixels): Uint8ClampedArray {
  const n = img.width * img.height, L = new Uint8ClampedArray(n), d = img.data;
  for (let i = 0; i < n; i++) L[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  return L;
}

/** The brightness below which `pct` of the pixels fall. */
function percentile(L: Uint8ClampedArray, pct: number): number {
  const hist = new Array<number>(256).fill(0);
  for (let i = 0; i < L.length; i++) hist[L[i]]++;
  const target = L.length * pct;
  let run = 0;
  for (let v = 0; v < 256; v++) { run += hist[v]; if (run >= target) return v; }
  return 255;
}

/**
 * Clean a flattened page: 'color' evens out light and contrast, 'gray' the same
 * in greys, 'bw' turns it into crisp black-on-white like a photocopy (each
 * pixel compared with its neighbourhood, so shadows across the page don't turn
 * whole areas black).
 */
export function enhance(img: Pixels, filter: ScanFilter): Pixels {
  const { width, height } = img;
  const n = width * height;
  const out = new Uint8ClampedArray(img.data);
  const L = luminance(img);
  if (filter === 'bw') {
    // Integral image for fast local averages.
    const I = new Float64Array((width + 1) * (height + 1));
    for (let y = 1; y <= height; y++) {
      let row = 0;
      for (let x = 1; x <= width; x++) {
        row += L[(y - 1) * width + (x - 1)];
        I[y * (width + 1) + x] = I[(y - 1) * (width + 1) + x] + row;
      }
    }
    const r = Math.max(4, Math.round(Math.min(width, height) / 24));
    for (let y = 0; y < height; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(height, y + r + 1);
      for (let x = 0; x < width; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(width, x + r + 1);
        const sum = I[y1 * (width + 1) + x1] - I[y0 * (width + 1) + x1] - I[y1 * (width + 1) + x0] + I[y0 * (width + 1) + x0];
        const mean = sum / ((x1 - x0) * (y1 - y0));
        const v = L[y * width + x] < mean * 0.9 ? 0 : 255;
        const o = (y * width + x) * 4;
        out[o] = out[o + 1] = out[o + 2] = v;
      }
    }
    return { width, height, data: out };
  }
  // Stretch so the darkest 1% is black and the brightest 2% is white.
  const lo = percentile(L, 0.01), hi = Math.max(lo + 1, percentile(L, 0.98));
  const k = 255 / (hi - lo);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (filter === 'gray') {
      out[o] = out[o + 1] = out[o + 2] = (L[i] - lo) * k;
    } else {
      out[o] = (img.data[o] - lo) * k; out[o + 1] = (img.data[o + 1] - lo) * k; out[o + 2] = (img.data[o + 2] - lo) * k;
    }
  }
  return { width, height, data: out };
}

/** The starting corners: a little inside the photo's edges. */
export function defaultCorners(width: number, height: number, inset = 0.04): Pt[] {
  const ix = width * inset, iy = height * inset;
  return [{ x: ix, y: iy }, { x: width - ix, y: iy }, { x: width - ix, y: height - iy }, { x: ix, y: height - iy }];
}

/** A file name from a document's name: "Signed work order" → "Signed_work_order.pdf". */
export const pdfName = (name: string) => `${name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'Scan'}.pdf`;
