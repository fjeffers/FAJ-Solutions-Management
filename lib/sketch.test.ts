import { describe, expect, it } from 'vitest';
import {
  OPENING_SYMBOLS, ROT_HANDLE, addBendAt, roomCorners, dragHandle, splitAt, feet, gapAt, gapOnWall, handlesOf, openingsOf, seatInWall, snapToWall, wallPieces, wallRuns, hitTest, midpoint, moveShape, newSketch, normalizeSketch, pathLength, roomFromCorners, setLength, setSize,
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
  it('a room has eight grab points and a turning handle; dragging a side or corner resizes it', () => {
    expect(handlesOf(room).map((h) => h.id)).toEqual(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w', 'rot']); // plus the turning handle
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

describe('doors, windows and openings in walls', () => {
  const box: Shape = { id: 'r', kind: 'room', x: 0, y: 0, w: 20, h: 10, name: '', color: '#0E1B2E' };
  const kinds = (pieces: ReturnType<typeof wallPieces>) => pieces.map((p) => `${p.kind} ${Math.round(Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y) * 10) / 10}`);

  it('a room has four wall runs', () => {
    expect(wallRuns([box]).map((r) => [r.a, r.b])).toEqual([
      [{ x: 0, y: 0 }, { x: 20, y: 0 }], [{ x: 20, y: 0 }, { x: 20, y: 10 }], [{ x: 20, y: 10 }, { x: 0, y: 10 }], [{ x: 0, y: 10 }, { x: 0, y: 0 }],
    ]);
  });

  it('a door tapped near a wall sits in it, turned to match', () => {
    const door = seatInWall({ id: 'd', kind: 'symbol', sym: 'door', at: { x: 8, y: 0.9 }, label: '', rot: 0 }, [box]);
    expect(door).toMatchObject({ at: { x: 8, y: 0 }, rot: 0 });
    const side = seatInWall({ id: 'd2', kind: 'symbol', sym: 'door', at: { x: 19.2, y: 5 }, label: '', rot: 0 }, [box]);
    expect(side).toMatchObject({ at: { x: 20, y: 5 }, rot: 90 });
    // Far from any wall, or not a door/window: left as it is.
    const far: Shape = { id: 'd3', kind: 'symbol', sym: 'door', at: { x: 10, y: 5 }, label: '', rot: 0 };
    expect(seatInWall(far, [box])).toBe(far);
    const cam: Shape = { id: 'c', kind: 'symbol', sym: 'camera', at: { x: 8, y: 0.5 }, label: '', rot: 0 };
    expect(seatInWall(cam, [box])).toBe(cam);
  });

  it('a wall is cut around a door and a window; an opening leaves nothing', () => {
    const top = wallRuns([box])[0];
    const door: Shape = { id: 'd', kind: 'symbol', sym: 'door', at: { x: 5, y: 0 }, label: '', rot: 0 };
    const win: Shape = { id: 'w', kind: 'symbol', sym: 'window', at: { x: 12, y: 0 }, label: '', rot: 180 };
    const gap: Shape = { id: 'g', kind: 'gap', a: { x: 16, y: 0 }, b: { x: 19, y: 0 } };
    expect(kinds(wallPieces(top, openingsOf([door, win, gap])))).toEqual(['solid 3.5', 'door 3', 'solid 3.9', 'window 3.2', 'solid 2.4', 'solid 1']);
    // A door standing across the wall (wrong way round) doesn't cut it.
    const across: Shape = { ...door, rot: 90 };
    expect(kinds(wallPieces(top, openingsOf([across])))).toEqual(['solid 20']);
  });

  it('an opening dragged roughly along a wall lands exactly on it', () => {
    expect(gapOnWall([box], { x: 4, y: 0.6 }, { x: 9.5, y: -0.4 })).toEqual({ a: { x: 4, y: 0 }, b: { x: 9.5, y: 0 } });
    expect(gapOnWall([box], { x: 8, y: 5 }, { x: 12, y: 5 })).toBeNull(); // the middle of the room: no wall there
    expect(gapOnWall([box], { x: 4, y: 0 }, { x: 4.2, y: 0 })).toBeNull(); // too short
    const g = gapAt([box], { x: 20.3, y: 4 })!;
    expect(g.a.x).toBeCloseTo(20); expect(g.a.y).toBeCloseTo(2.5);
    expect(g.b.x).toBeCloseTo(20); expect(g.b.y).toBeCloseTo(5.5);
  });

  it('openings are kept when saved, and can be picked, moved and resized', () => {
    const gap = { id: 'g', kind: 'gap', a: { x: 1, y: 0 }, b: { x: 4, y: 0 } };
    const s = normalizeSketch({ shapes: [box, gap, { id: 'tiny', kind: 'gap', a: { x: 1, y: 1 }, b: { x: 1.1, y: 1 } }] });
    expect(s.shapes.map((x) => x.id)).toEqual(['r', 'g']);
    expect(hitTest(s.shapes, { x: 2, y: 0.1 })?.id).toBe('g');
    expect(moveShape(s.shapes[1], 1, 0)).toMatchObject({ a: { x: 2, y: 0 }, b: { x: 5, y: 0 } });
    expect(handlesOf(s.shapes[1]).map((h) => h.id)).toEqual(['a', 'b']);
    expect(snapToWall([box], { x: 50, y: 50 })).toBeNull();
  });
});

describe('double doors, sliding glass doors, wide windows and glass walls', () => {
  const box: Shape = { id: 'r', kind: 'room', x: 0, y: 0, w: 20, h: 10, name: '', color: '#0E1B2E' };
  const top = wallRuns([box])[0];
  const len = (p: { a: { x: number; y: number }; b: { x: number; y: number } }) => Math.round(Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y) * 10) / 10;

  it('each sits in a wall at its own width; sliders and double doors are doorways', () => {
    const at = (sym: 'door2' | 'slider' | 'window2'): Shape => seatInWall({ id: sym, kind: 'symbol', sym, at: { x: 10, y: 0.6 }, label: '', rot: 0 }, [box]);
    for (const sym of ['door2', 'slider'] as const) {
      expect(wallPieces(top, openingsOf([at(sym)])).map((p) => `${p.kind} ${len(p)}`)).toEqual(['solid 7', 'door 6', 'solid 7']);
    }
    expect(wallPieces(top, openingsOf([at('window2')])).map((p) => `${p.kind} ${len(p)}`)).toEqual(['solid 7', 'window 6', 'solid 7']);
    expect(OPENING_SYMBOLS).toEqual(['door', 'door2', 'slider', 'window', 'window2']);
  });

  it('a wide door can be picked anywhere along it', () => {
    const d: Shape = { id: 'd', kind: 'symbol', sym: 'door2', at: { x: 10, y: 0 }, label: '', rot: 0 };
    expect(hitTest([d], { x: 12.6, y: 0.2 })?.id).toBe('d');
  });

  it('a glass wall is kept when saved (old glass: true too), and is a wall run doors can sit in', () => {
    const s = normalizeSketch({ shapes: [{ id: 'g', kind: 'wall', a: { x: 0, y: 0 }, b: { x: 12, y: 0 }, glass: true }, { id: 'w', kind: 'wall', a: { x: 0, y: 5 }, b: { x: 12, y: 5 }, glass: 'yes' }] });
    expect(s.shapes[0]).toMatchObject({ kind: 'wall', wtype: 'glass' });
    expect(s.shapes[1]).not.toHaveProperty('wtype');
    expect(wallRuns(s.shapes).map((r) => r.wtype)).toEqual(['glass', 'drywall']);
    expect(seatInWall({ id: 'd', kind: 'symbol', sym: 'slider', at: { x: 6, y: 0.5 }, label: '', rot: 0 }, s.shapes)).toMatchObject({ at: { x: 6, y: 0 }, rot: 0 });
  });
});

describe('furniture', () => {
  it('is picked anywhere on its footprint, turned or not, and counted', () => {
    const table: Shape = { id: 't', kind: 'symbol', sym: 'conftable', at: { x: 10, y: 10 }, label: '', rot: 0 };
    expect(hitTest([table], { x: 14.5, y: 11.5 })?.id).toBe('t'); // 10 x 4 ft: reaches x 15, y 12
    expect(hitTest([table], { x: 10, y: 14.5 })).toBeNull();
    const turned: Shape = { ...table, rot: 90 };
    expect(hitTest([turned], { x: 10, y: 14.5 })?.id).toBe('t');
    const chairs: Shape[] = [1, 2, 3].map((i) => ({ id: `c${i}`, kind: 'symbol', sym: 'chair', at: { x: i * 3, y: 2 }, label: '', rot: 0 }));
    expect(summarize({ ...newSketch(), shapes: [table, ...chairs] }).symbols.map((x) => `${x.count} ${x.label}`)).toEqual(['3 Chairs', '1 Conference table']);
  });
});

describe('wall types', () => {
  it('each wall and room keeps its type; unknown types are drywall; footage is counted by type', () => {
    const s = normalizeSketch({ shapes: [
      { id: 'b', kind: 'wall', a: { x: 0, y: 0 }, b: { x: 20, y: 0 }, wtype: 'block' },
      { id: 'x', kind: 'wall', a: { x: 0, y: 5 }, b: { x: 10, y: 5 }, wtype: 'marble' },
      { id: 'r', kind: 'room', x: 0, y: 10, w: 10, h: 5, wtype: 'exterior' },
    ] });
    expect(s.shapes.map((x) => (x as { wtype?: string }).wtype)).toEqual(['block', undefined, 'exterior']);
    expect(summarize(s).walls).toEqual([{ type: 'exterior', label: 'Exterior wall', feet: 30 }, { type: 'block', label: 'Block (CMU)', feet: 20 }]);
  });
});

describe('double-click changes', () => {
  it('a wall splits in two where it was double-clicked, keeping its type', () => {
    const wall: Shape = { id: 'w', kind: 'wall', a: { x: 0, y: 0 }, b: { x: 20, y: 0 }, color: '#000', wtype: 'block' };
    const parts = splitAt(wall, { x: 8, y: 0.4 }, () => 'w2')!;
    expect(parts).toEqual([
      { id: 'w', kind: 'wall', a: { x: 0, y: 0 }, b: { x: 8, y: 0 }, color: '#000', wtype: 'block' },
      { id: 'w2', kind: 'wall', a: { x: 8, y: 0 }, b: { x: 20, y: 0 }, color: '#000', wtype: 'block' },
    ]);
    expect(splitAt(wall, { x: 0.2, y: 0 })).toBeNull(); // right at an end
    expect(splitAt(room, { x: 5, y: 0 })).toBeNull(); // rooms don't split
  });

  it('a cable run gets a bend on the segment that was double-clicked', () => {
    const bent = addBendAt(cable, { x: 30.5, y: 20 }) as Extract<Shape, { kind: 'cable' }>;
    expect(bent.pts).toEqual([{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 20 }, { x: 30, y: 40 }]);
    expect(pathLength(bent.pts)).toBe(70); // same footage until the bend is dragged
    expect(addBendAt(room, { x: 1, y: 1 })).toBeNull();
  });
});

describe('turning rooms and furniture', () => {
  const sq: Shape = { id: 'r', kind: 'room', x: 0, y: 0, w: 10, h: 4, name: '', color: '#000' };
  const close = (pts: { x: number; y: number }[]) => pts.map((q) => [Math.round(q.x * 100) / 100, Math.round(q.y * 100) / 100]);

  it('a turned room keeps its centre; its walls and corners turn with it', () => {
    const turned = { ...sq, rot: 90 } as Extract<Shape, { kind: 'room' }>;
    expect(close(roomCorners(turned))).toEqual([[7, -3], [7, 7], [3, 7], [3, -3]]);
    expect(wallRuns([turned]).map((r) => Math.round(Math.hypot(r.b.x - r.a.x, r.b.y - r.a.y)))).toEqual([10, 4, 10, 4]);
    expect(normalizeSketch({ shapes: [turned] }).shapes[0]).toMatchObject({ rot: 90 });
    expect(normalizeSketch({ shapes: [sq] }).shapes[0]).not.toHaveProperty('rot');
  });

  it('is picked on its turned edge, and turned by its handle', () => {
    const turned = { ...sq, rot: 90 } as Shape;
    expect(hitTest([turned], { x: 7, y: 6 })?.id).toBe('r'); // the turned side
    expect(hitTest([turned], { x: 9.5, y: 1 })).toBeNull(); // where the unturned corner was
    const h = handlesOf(sq).find((x) => x.id === ROT_HANDLE)!;
    expect(h.at.x).toBeCloseTo(5);
    // Drag the handle out to the right of the centre: a quarter turn.
    expect(dragHandle(sq, ROT_HANDLE, { x: 20, y: 2 })).toMatchObject({ rot: 90 });
  });

  it('resizing a turned room keeps its far side in place', () => {
    const turned = { ...sq, rot: 90 } as Extract<Shape, { kind: 'room' }>;
    const before = roomCorners(turned);
    const wider = dragHandle(turned, 'e', { x: 7, y: 9 }) as Extract<Shape, { kind: 'room' }>; // the right side, now facing down
    expect(Math.round(wider.w * 100) / 100).toBe(12);
    const after = roomCorners(wider);
    expect(close([after[0], after[3]])).toEqual(close([before[0], before[3]])); // the left side didn't move
  });

  it('furniture turns by its handle too', () => {
    const desk: Shape = { id: 'd', kind: 'symbol', sym: 'desk', at: { x: 0, y: 0 }, label: '', rot: 0 };
    expect(handlesOf(desk).map((x) => x.id)).toEqual([ROT_HANDLE]);
    expect(dragHandle(desk, ROT_HANDLE, { x: -5, y: 0 })).toMatchObject({ rot: 270 });
    const door: Shape = { id: 'o', kind: 'symbol', sym: 'door', at: { x: 0, y: 0 }, label: '', rot: 0 };
    expect(handlesOf(door)).toEqual([]); // doors sit in their wall
  });
});
