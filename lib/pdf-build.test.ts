import { describe, expect, it } from 'vitest';
import { PDFDocument, degrees } from 'pdf-lib';
import { buildPdf, canCopy } from './pdf-build';
import type { Mark } from './pdf-marks';

// A 1×1 PNG, standing in for a signature.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

async function sample(): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  d.addPage([612, 792]);
  d.addPage([612, 792]).setRotation(degrees(90));
  d.addPage([300, 300]);
  const form = d.getForm();
  form.createTextField('name').addToPage(d.getPage(0), { x: 50, y: 700, width: 200, height: 20 });
  return d.save();
}

describe('writing the edited PDF', () => {
  it('keeps the chosen pages in order and turn, with every kind of mark drawn in', async () => {
    const src = await sample();
    expect(await canCopy(src)).toBe(true);
    const marks: Mark[] = [
      { id: '1', page: 'b', kind: 'image', what: 'signature', src: PNG, x: 100, y: 100, w: 120, h: 40, angle: 90 },
      { id: '2', page: 'b', kind: 'text', text: 'Fred Johnson\n10/7/2026', size: 12, color: '#1B1C1F', x: 100, y: 200, w: 90, h: 30, angle: 90 },
      { id: '3', page: 'a', kind: 'check', color: '#1F3FAE', x: 60, y: 60, w: 14, h: 14, angle: 0 },
      { id: '4', page: 'a', kind: 'cross', color: '#C62828', x: 80, y: 60, w: 14, h: 14, angle: 0 },
      { id: '5', page: 'a', kind: 'dot', color: '#000000', x: 100, y: 60, w: 14, h: 14, angle: 0 },
      { id: '6', page: 'a', kind: 'whiteout', x: 50, y: 700, w: 200, h: 20, angle: 0 },
      { id: '7', page: 'a', kind: 'ink', points: [{ x: 10, y: 10 }, { x: 50, y: 40 }, { x: 90, y: 10 }], width: 2, color: '#1B1C1F', opacity: 1 },
      { id: '8', page: 'a', kind: 'ink', points: [{ x: 10, y: 300 }], width: 14, color: '#FFD60A', opacity: 0.38 },
    ];
    const bytes = await buildPdf({
      sources: [src],
      // Page 3 dropped; page 2 first and turned another quarter; page 1 after.
      pages: [{ key: 'b', src: 0, index: 1, extra: 90 }, { key: 'a', src: 0, index: 0, extra: 0 }],
      marks,
      title: 'Signed work order',
    });
    const back = await PDFDocument.load(bytes);
    expect(back.getPageCount()).toBe(2);
    expect(back.getPage(0).getRotation().angle).toBe(180);
    expect(back.getPage(1).getRotation().angle).toBe(0);
    expect(back.getTitle()).toBe('Signed work order');
    // The fillable box was flattened, so nothing can sit on top of what was written.
    expect(back.getForm().getFields()).toHaveLength(0);
  });

  it('can stitch pages from two PDFs together', async () => {
    const a = await sample();
    const b = await (async () => { const d = await PDFDocument.create(); d.addPage([200, 200]); return d.save(); })();
    const bytes = await buildPdf({
      sources: [a, b],
      pages: [{ key: 'x', src: 1, index: 0, extra: 0 }, { key: 'y', src: 0, index: 2, extra: 270 }],
      marks: [],
      title: 'Merged',
    });
    const back = await PDFDocument.load(bytes);
    expect(back.getPageCount()).toBe(2);
    expect(back.getPage(0).getSize()).toEqual({ width: 200, height: 200 });
    expect(back.getPage(1).getRotation().angle).toBe(270);
  });

  it('says so when a PDF can’t be copied', async () => {
    expect(await canCopy(new TextEncoder().encode('not a pdf'))).toBe(false);
  });
});
