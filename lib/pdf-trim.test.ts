import { describe, expect, it } from 'vitest';
import { inkBox, worthTrimming } from './pdf-trim';

/** A white w×h picture with black pixels at the given points. */
const picture = (w: number, h: number, ink: [number, number][]) => {
  const d = new Uint8ClampedArray(w * h * 4).fill(255);
  for (const [x, y] of ink) d.fill(0, (y * w + x) * 4, (y * w + x) * 4 + 3);
  return d;
};

describe('inkBox', () => {
  it('finds the printed part', () => {
    expect(inkBox(picture(10, 20, [[2, 3], [7, 5]]), 10, 20)).toEqual({ left: 2, top: 3, right: 8, bottom: 6 });
  });
  it('is null on a blank page', () => {
    expect(inkBox(picture(5, 5, []), 5, 5)).toBeNull();
  });
  it('ignores near-white paper tint', () => {
    const d = picture(4, 4, []); d.fill(250, 0, 3);
    expect(inkBox(d, 4, 4)).toBeNull();
  });
});

describe('worthTrimming', () => {
  it('cuts a small table in the corner of a tall page', () => {
    expect(worthTrimming({ left: 40, top: 40, right: 560, bottom: 200 }, 612, 792)).toBe(true);
  });
  it('leaves a full page alone', () => {
    expect(worthTrimming({ left: 30, top: 30, right: 580, bottom: 760 }, 612, 792)).toBe(false);
  });
});
