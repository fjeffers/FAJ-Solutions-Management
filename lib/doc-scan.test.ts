import { describe, expect, it } from 'vitest';
import { applyH, defaultCorners, enhance, homography, outputSize, pdfName, warpPage, type Pixels } from './doc-scan';

const solid = (width: number, height: number, rgb: [number, number, number]): Pixels => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) { data[i * 4] = rgb[0]; data[i * 4 + 1] = rgb[1]; data[i * 4 + 2] = rgb[2]; data[i * 4 + 3] = 255; }
  return { width, height, data };
};

describe('document scanning', () => {
  it('the perspective transform sends each corner where it should go', () => {
    const src = [{ x: 10, y: 20 }, { x: 300, y: 5 }, { x: 320, y: 410 }, { x: 0, y: 400 }];
    const dst = [{ x: 0, y: 0 }, { x: 299, y: 0 }, { x: 299, y: 399 }, { x: 0, y: 399 }];
    const h = homography(src, dst);
    src.forEach((p, i) => {
      const q = applyH(h, p.x, p.y);
      expect(q.x).toBeCloseTo(dst[i].x, 6);
      expect(q.y).toBeCloseTo(dst[i].y, 6);
    });
  });

  it('corners on top of each other are refused, not a crash', () => {
    const p = { x: 5, y: 5 };
    expect(() => homography([p, p, p, p], defaultCorners(10, 10))).toThrow(/move them apart/);
  });

  it('the flattened page is as big as its longer sides, capped', () => {
    expect(outputSize([{ x: 0, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 1000 }, { x: 0, y: 1000 }])).toEqual({ width: 800, height: 1000 });
    expect(outputSize([{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }], 1800)).toEqual({ width: 1800, height: 1350 });
  });

  it('a page inside a photo is cut out and flattened', () => {
    // A 40×40 photo: dark background with a white 20×20 square in the middle.
    const img = solid(40, 40, [30, 30, 30]);
    for (let y = 10; y < 30; y++) for (let x = 10; x < 30; x++) { const o = (y * 40 + x) * 4; img.data[o] = img.data[o + 1] = img.data[o + 2] = 250; }
    const page = warpPage(img, [{ x: 10, y: 10 }, { x: 29, y: 10 }, { x: 29, y: 29 }, { x: 10, y: 29 }]);
    expect(page.width).toBe(19);
    expect(page.height).toBe(19);
    // Every pixel of the result is the white page, none of the dark background.
    for (let i = 0; i < page.width * page.height; i++) expect(page.data[i * 4]).toBeGreaterThan(200);
  });

  it('black & white turns dark writing black and paper white, even in a shadow', () => {
    const img = solid(60, 60, [180, 180, 180]); // greyish paper
    for (let y = 28; y < 32; y++) for (let x = 10; x < 50; x++) { const o = (y * 60 + x) * 4; img.data[o] = img.data[o + 1] = img.data[o + 2] = 40; } // a line of "ink"
    const bw = enhance(img, 'bw');
    expect(bw.data[(30 * 60 + 30) * 4]).toBe(0);   // ink → black
    expect(bw.data[(5 * 60 + 5) * 4]).toBe(255);   // paper → white
    expect(new Set(Array.from(bw.data).filter((_, i) => i % 4 === 0))).toEqual(new Set([0, 255]));
  });

  it('a file name from the document name', () => {
    expect(pdfName('Signed work order #12')).toBe('Signed_work_order_12.pdf');
    expect(pdfName('   ')).toBe('Scan.pdf');
  });
});
