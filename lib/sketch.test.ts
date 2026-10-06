import { describe, expect, it } from 'vitest';
import {
  feet, hitTest, midpoint, moveShape, newSketch, normalizeSketch, pathLength, roomFromCorners, snapPt, sqft, summarize,
  summaryLine, type Shape,
} from './sketch';

const room: Shape = { id: 'r', kind: 'room', x: 0, y: 0, w: 24, h: 18, name: 'Lobby', color: '#0E1B2E' };
const cable: Shape = { id: 'c', kind: 'cable', pts: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 40 }], color: '#1565C0', label: '' };

describe('site sketches', () => {
  it('measures in feet: lengths, inches, areas', () => {
    expect(feet(12.5)).toBe(`12' 6"`);
    expect(feet(3)).toBe(`3'`);
    expect(feet(0.25)).toBe(`0' 3"`);
    expect(sqft(432)).toBe('432 sq ft');
    expect(pathLength((cable as Extract<Shape, { kind: 'cable' }>).pts)).toBe(70);
    expect(snapPt({ x: 3.26, y: 7.74 })).toEqual({ x: 3.5, y: 7.5 });
    expect(roomFromCorners({ x: 10, y: 8 }, { x: 2, y: 20 })).toEqual({ x: 2, y: 8, w: 8, h: 12 });
  });

  it('counts what is on the plan — the start of a materials list', () => {
    const s = { ...newSketch(), shapes: [
      room, cable,
      { id: 'c2', kind: 'cable', pts: [{ x: 0, y: 0 }, { x: 0, y: 10.4 }], color: '#1565C0', label: '' },
      { id: 'a', kind: 'symbol', sym: 'camera', at: { x: 1, y: 1 }, label: '', rot: 0 },
      { id: 'b', kind: 'symbol', sym: 'camera', at: { x: 2, y: 1 }, label: '', rot: 0 },
      { id: 'd', kind: 'symbol', sym: 'ap', at: { x: 3, y: 1 }, label: '', rot: 0 },
      { id: 'p', kind: 'photo', at: { x: 3, y: 3 }, path: 'x.jpg', note: '' },
    ] as Shape[] };
    const sum = summarize(s);
    expect(sum.symbols).toEqual([{ kind: 'camera', label: 'Cameras', count: 2 }, { kind: 'ap', label: 'Wi-Fi AP', count: 1 }]);
    expect(sum.cableFeet).toBe(80);
    expect(sum.cableRuns).toBe(2);
    expect(sum.totalArea).toBe(432);
    expect(summaryLine(sum)).toBe('2 Cameras · 1 Wi-Fi AP · 80 ft cable · 1 room (432 sq ft) · 1 photo');
    expect(summaryLine(summarize(newSketch()))).toBe('Empty');
  });

  it('a damaged or old saved value draws safely', () => {
    expect(normalizeSketch(null)).toEqual(newSketch());
    const s = normalizeSketch({ width: 9999, height: 'x', shapes: [
      { kind: 'room', x: 1, y: 1, w: 0.1, h: 5 },           // too thin: dropped
      { kind: 'symbol', sym: 'laser', at: { x: 1, y: 1 } },   // unknown symbol: dropped
      { kind: 'symbol', sym: 'camera', at: { x: 1, y: 1 } },
      { kind: 'cable', pts: [{ x: 1, y: 1 }] },               // one point: dropped
      { kind: 'text', at: { x: 0, y: 0 }, text: '   ' },      // blank: dropped
      { kind: 'wall', a: { x: 0, y: 0 }, b: { x: 5, y: 0 }, color: 'red' }, // bad colour: default
      'junk',
    ] });
    expect(s.width).toBe(400);
    expect(s.height).toBe(50);
    expect(s.shapes.map((x) => x.kind)).toEqual(['symbol', 'wall']);
    expect((s.shapes[1] as Extract<Shape, { kind: 'wall' }>).color).toBe('#0E1B2E');
  });

  it('tapping picks the right thing: symbols over the room they sit in', () => {
    const sym: Shape = { id: 's', kind: 'symbol', sym: 'camera', at: { x: 5, y: 5 }, label: '', rot: 0 };
    expect(hitTest([room, sym], { x: 5.3, y: 5.2 })?.id).toBe('s');
    expect(hitTest([room, sym], { x: 12, y: 0.2 })?.id).toBe('r');   // on the room's edge
    expect(hitTest([room, sym], { x: 3, y: 14 })).toBeNull();         // empty floor inside the room
    expect(hitTest([cable], { x: 30.4, y: 20 })?.id).toBe('c');
  });

  it('moving and labelling', () => {
    expect(moveShape(room, 2, 3)).toMatchObject({ x: 2, y: 3, w: 24 });
    expect((moveShape(cable, 1, 1) as Extract<Shape, { kind: 'cable' }>).pts[0]).toEqual({ x: 1, y: 1 });
    expect(midpoint([{ x: 0, y: 0 }, { x: 10, y: 0 }])).toEqual({ x: 5, y: 0 });
  });
});

describe('free drawing (sketch.io-style)', () => {
  it('lines, arrows, boxes, circles and marker strokes are kept, and can be picked and moved', () => {
    const s = normalizeSketch({ shapes: [
      { id: 'l', kind: 'line', a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, color: '#C62828', width: 0.2, arrow: true },
      { id: 'b', kind: 'box', x: 20, y: 20, w: 4, h: 4, color: '#1565C0', width: 0.1, fill: true },
      { id: 'e', kind: 'ellipse', x: 40, y: 0, w: 10, h: 6, color: '#2E7D32', width: 0.1, fill: false },
      { id: 'm', kind: 'pen', pts: [{ x: 0, y: 30 }, { x: 5, y: 31 }], color: '#C9A24B', width: 1, marker: true },
    ] });
    expect(s.shapes.map((x) => x.kind)).toEqual(['line', 'box', 'ellipse', 'pen']);
    expect(s.shapes[0]).toMatchObject({ arrow: true });
    expect(s.shapes[3]).toMatchObject({ marker: true, width: 1 });
    expect(hitTest(s.shapes, { x: 5, y: 0.2 })?.id).toBe('l');
    expect(hitTest(s.shapes, { x: 22, y: 22 })?.id).toBe('b');        // inside a filled box
    expect(hitTest(s.shapes, { x: 45, y: 3 })).toBeNull();            // inside an empty circle
    expect(hitTest(s.shapes, { x: 40.1, y: 3 })?.id).toBe('e');       // on its edge
    expect(moveShape(s.shapes[1], 1, 1)).toMatchObject({ x: 21, y: 21 });
  });
});
