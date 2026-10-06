import { describe, expect, it } from 'vitest';
import {
  dragHandle, feet, handlesOf, hitTest, midpoint, moveShape, newSketch, normalizeSketch, pathLength, roomFromCorners, setLength, setSize,
  snapPt, sqft, summarize, summaryLine, type Shape,
} from './sketch';

const room: Shape = { id: 'r', kind: 'room', x: 0, y: 0, w: 24, h: 18, name: 'Lobby', color: '#0E1B2E' };
const cable: Shape = { id: 'c', kind: 'cable', pts: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 40 }], color: '#1565C0', label: '', cable: 'cat6' };

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
      { id: 'c2', kind: 'cable', pts: [{ x: 0, y: 0 }, { x: 0, y: 10.4 }], color: '#1565C0', label: '', cable: 'cat6' },
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
    expect(summaryLine(sum)).toBe('2 Cameras · 1 Wi-Fi AP · 80 ft Cat6 · 1 room (432 sq ft) · 1 photo');
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

describe('network gear and cable types', () => {
  it('footage is kept per cable type; old runs count as Cat6', () => {
    const s = normalizeSketch({ shapes: [
      { kind: 'cable', pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }], cable: 'cat6' },
      { kind: 'cable', pts: [{ x: 0, y: 0 }, { x: 40, y: 0 }], cable: 'fiber' },
      { kind: 'cable', pts: [{ x: 0, y: 0 }, { x: 20, y: 0 }] },                   // saved before cable types
      { kind: 'cable', pts: [{ x: 0, y: 0 }, { x: 5, y: 0 }], cable: 'garden hose' }, // unknown -> Cat6
    ] });
    const sum = summarize(s);
    expect(sum.cables).toEqual([
      { type: 'cat6', label: 'Cat6', feet: 125, runs: 3 },
      { type: 'fiber', label: 'Fiber', feet: 40, runs: 1 },
    ]);
    expect(sum.cableFeet).toBe(165);
    expect(summaryLine(sum)).toBe('Cat6 125 ft, Fiber 40 ft');
  });

  it('switches, firewalls, tablets and outlets are counted like any symbol', () => {
    const s = normalizeSketch({ shapes: ['switch', 'switch', 'firewall', 'tablet', 'drop', 'outlet', 'starlink'].map((sym, i) => ({ kind: 'symbol', sym, at: { x: i, y: 0 } })) });
    expect(summarize(s).symbols.map((x) => `${x.count} ${x.label}`)).toEqual([
      '2 Network switches', '1 Firewall', '1 Starlink dish', '1 Data outlet', '1 Power outlet', '1 Tablet / kiosk',
    ]);
  });
});

describe('changing sizes: rooms, walls and cable bends', () => {
  it('a room has eight grab points; dragging a side or corner resizes it', () => {
    expect(handlesOf(room).map((h) => h.id)).toEqual(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']);
    expect(dragHandle(room, 'e', { x: 30, y: 99 })).toMatchObject({ x: 0, y: 0, w: 30, h: 18 }); // only the right side moves
    expect(dragHandle(room, 'nw', { x: 4, y: 2 })).toMatchObject({ x: 4, y: 2, w: 20, h: 16 }); // the far corner stays put
    expect(dragHandle(room, 's', { x: 5, y: -10 })).toMatchObject({ y: 0, h: 0.5 }); // stops at half a foot, never flips
  });

  it('a wall end can be dragged; typing a length keeps its start and direction', () => {
    const wall: Shape = { id: 'w', kind: 'wall', a: { x: 0, y: 0 }, b: { x: 3, y: 4 }, color: '#000' };
    expect(handlesOf(wall).map((h) => h.id)).toEqual(['a', 'b']);
    expect(dragHandle(wall, 'b', { x: 10, y: 0 })).toMatchObject({ a: { x: 0, y: 0 }, b: { x: 10, y: 0 } });
    const longer = setLength(wall, 10) as Extract<Shape, { kind: 'wall' }>;
    expect(longer.a).toEqual({ x: 0, y: 0 });
    expect(longer.b.x).toBeCloseTo(6);
    expect(longer.b.y).toBeCloseTo(8);
  });

  it('typed sizes are kept sensible', () => {
    expect(setSize(room, 30, 12)).toMatchObject({ x: 0, y: 0, w: 30, h: 12 });
    expect(setSize(room, -5, Number.NaN)).toMatchObject({ w: 0.5, h: 0.5 });
    expect(setSize(cable, 5, 5)).toBe(cable); // a cable has no width
  });

  it('each bend of a cable run can be moved, and the footage follows', () => {
    expect(handlesOf(cable).map((h) => h.id)).toEqual(['p0', 'p1', 'p2']);
    const moved = dragHandle(cable, 'p2', { x: 30, y: 10 }) as Extract<Shape, { kind: 'cable' }>;
    expect(pathLength(moved.pts)).toBe(40);
    expect(dragHandle(cable, 'p9', { x: 1, y: 1 })).toBe(cable);
    expect(dragHandle(cable, 'nope', { x: 1, y: 1 })).toBe(cable);
  });
});
