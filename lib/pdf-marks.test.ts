import { describe, expect, it } from 'vitest';
import {
  apply, boxFromDrag, centredAt, hitTest, invert, mul, moveBy, pdfSafeText, resizeTo, rotation, textBox, toLocal,
  baselineFromTop, type BoxMark, type InkMark, type Matrix, type TextMark,
} from './pdf-marks';

const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe('page-space matrices', () => {
  it('inverts and composes', () => {
    const m: Matrix = [0, 1, 1, 0, 10, -5];
    const p = { x: 3, y: 7 };
    const back = apply(invert(m), apply(m, p));
    near(back.x, 3); near(back.y, 7);
    const r = mul(rotation(90), rotation(90));
    const q = apply(r, { x: 1, y: 0 });
    near(q.x, -1); near(q.y, 0);
  });

  it('a mark placed on a page shown turned 90° reads upright on screen', () => {
    // pdf.js shows a page turned 90° with this transform (page space → screen, y down).
    const view: Matrix = [0, 1, 1, 0, 0, 0];
    const m: BoxMark = { id: 'a', page: 'p', kind: 'whiteout', ...centredAt({ x: 100, y: 200 }, 40, 10, 90) };
    const toScreen = (lx: number, ly: number) => apply(view, apply(mul([1, 0, 0, 1, m.x, m.y], rotation(m.angle)), { x: lx, y: ly }));
    const o = toScreen(0, 0), right = toScreen(40, 0), up = toScreen(0, 10);
    near(right.x - o.x, 40); near(right.y - o.y, 0); // its width runs left→right on screen
    near(up.x - o.x, 0); near(up.y - o.y, -10); // its height runs up the screen
    const c = toLocal(m, { x: 100, y: 200 });
    near(c.x, 20); near(c.y, 5); // centred where it was tapped
  });
});

describe('placing and changing marks', () => {
  it('drags out a white-out box either way round', () => {
    const b = boxFromDrag({ x: 50, y: 80 }, { x: 10, y: 20 }, 0);
    expect(b).toMatchObject({ x: 10, y: 20, w: 40, h: 60, angle: 0 });
    const t = boxFromDrag({ x: 0, y: 0 }, { x: 10, y: 30 }, 90);
    near(t.w, 30); near(t.h, 10);
  });

  it('keeps a signature’s shape but lets white-out stretch', () => {
    const sig: BoxMark = { id: 's', page: 'p', kind: 'image', src: '', what: 'signature', x: 0, y: 0, w: 100, h: 40, angle: 0 };
    const big = resizeTo(sig, { x: 200, y: 10 });
    expect(big.w).toBe(200); expect(big.h).toBe(80);
    const tiny = resizeTo(sig, { x: 0, y: 0 });
    expect(Math.min(tiny.w, tiny.h)).toBeCloseTo(6);
    const wo: BoxMark = { id: 'w', page: 'p', kind: 'whiteout', x: 0, y: 0, w: 10, h: 10, angle: 0 };
    expect(resizeTo(wo, { x: 50, y: 5 })).toMatchObject({ w: 50, h: 5 });
    const txt: TextMark = { id: 't', page: 'p', kind: 'text', text: 'Hi', size: 12, color: '#000', x: 0, y: 0, w: 20, h: 15, angle: 0 };
    expect(resizeTo(txt, { x: 40, y: 30 }).size).toBe(24);
  });

  it('moves pen strokes and boxes alike', () => {
    const ink: InkMark = { id: 'i', page: 'p', kind: 'ink', points: [{ x: 1, y: 1 }, { x: 2, y: 3 }], width: 2, color: '#000', opacity: 1 };
    expect(moveBy(ink, 10, -1).points).toEqual([{ x: 11, y: 0 }, { x: 12, y: 2 }]);
  });

  it('finds the top-most mark under a tap', () => {
    const under: BoxMark = { id: 'under', page: 'p', kind: 'whiteout', x: 0, y: 0, w: 100, h: 100, angle: 0 };
    const over: BoxMark = { id: 'over', page: 'p', kind: 'dot', color: '#000', x: 40, y: 40, w: 20, h: 20, angle: 0 };
    const ink: InkMark = { id: 'ink', page: 'p', kind: 'ink', points: [{ x: 200, y: 0 }, { x: 200, y: 100 }], width: 2, color: '#000', opacity: 1 };
    const marks = [under, over, ink];
    expect(hitTest(marks, 'p', { x: 50, y: 50 }, 2)?.id).toBe('over');
    expect(hitTest(marks, 'p', { x: 5, y: 5 }, 2)?.id).toBe('under');
    expect(hitTest(marks, 'p', { x: 202, y: 50 }, 2)?.id).toBe('ink');
    expect(hitTest(marks, 'p', { x: 150, y: 50 }, 2)).toBeNull();
    expect(hitTest(marks, 'other page', { x: 50, y: 50 }, 2)).toBeNull();
  });
});

describe('text', () => {
  it('sizes the box to the longest line', () => {
    const b = textBox('Fred\nFAJ Solutions', 10, (l, s) => l.length * s * 0.5);
    expect(b.w).toBe(65); expect(b.h).toBe(25);
    expect(baselineFromTop(1, 10)).toBeCloseTo(22);
  });

  it('only keeps letters the PDF font can write', () => {
    expect(pdfSafeText('Café – “OK” €5')).toBe('Café – “OK” €5');
    expect(pdfSafeText('Done ✓ 👍')).toBe('Done X ?');
    expect(pdfSafeText('a\tb')).toBe('a    b');
  });
});
