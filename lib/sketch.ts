// Site sketches (Fred, 2026-10-06: "I want to be able to sketch my own
// layout" — modelled on magicplan and sketch.io's sketchpad): a floor plan
// drawn to scale in feet — rooms, walls, cable runs, low-voltage symbols,
// photo pins — plus free drawing: pen, marker, lines, arrows, boxes, circles
// and text. Every measurement here is in FEET; the editor only draws it.
//
// Saved as JSON on a `sketches` row (migration 112) — normalizeSketch checks it
// on every load, so a damaged value can't break the editor — plus a PNG of the
// plan for reports and quotes.

export type Pt = { x: number; y: number };

export type SymbolKind =
  // network gear
  | 'rack' | 'switch' | 'router' | 'firewall' | 'modem' | 'patch' | 'server' | 'nvr' | 'ups' | 'starlink'
  // devices
  | 'camera' | 'ap' | 'drop' | 'outlet' | 'tablet' | 'tv' | 'pos' | 'pc' | 'printer' | 'phone' | 'speaker' | 'reader'
  // building
  | 'door' | 'window';

export type SymbolGroup = 'network' | 'devices' | 'building';

// Fred, 2026-10-06: "data cables, network equipment, tablet, power outlet,
// data outlet, any network equipment". The key ('drop' etc.) is what's saved;
// labels can change freely.
export const SYMBOLS: { kind: SymbolKind; label: string; plural: string; code: string; color: string; group: SymbolGroup }[] = [
  { kind: 'rack', label: 'Rack / IDF', plural: 'Racks / IDFs', code: 'R', color: '#0E1B2E', group: 'network' },
  { kind: 'switch', label: 'Network switch', plural: 'Network switches', code: 'SW', color: '#1565C0', group: 'network' },
  { kind: 'router', label: 'Router', plural: 'Routers', code: 'RT', color: '#283593', group: 'network' },
  { kind: 'firewall', label: 'Firewall', plural: 'Firewalls', code: 'FW', color: '#B71C1C', group: 'network' },
  { kind: 'modem', label: 'Modem / ONT', plural: 'Modems / ONTs', code: 'M', color: '#4E342E', group: 'network' },
  { kind: 'patch', label: 'Patch panel', plural: 'Patch panels', code: 'PP', color: '#37474F', group: 'network' },
  { kind: 'server', label: 'Server', plural: 'Servers', code: 'SV', color: '#263238', group: 'network' },
  { kind: 'nvr', label: 'NVR / DVR', plural: 'NVRs / DVRs', code: 'NV', color: '#880E4F', group: 'network' },
  { kind: 'ups', label: 'UPS / battery', plural: 'UPS units', code: 'U', color: '#F57F17', group: 'network' },
  { kind: 'starlink', label: 'Starlink dish', plural: 'Starlink dishes', code: 'SL', color: '#424242', group: 'network' },
  { kind: 'camera', label: 'Camera', plural: 'Cameras', code: 'C', color: '#C62828', group: 'devices' },
  { kind: 'ap', label: 'Wi-Fi AP', plural: 'Wi-Fi APs', code: 'W', color: '#1565C0', group: 'devices' },
  { kind: 'drop', label: 'Data outlet', plural: 'Data outlets', code: 'D', color: '#2E7D32', group: 'devices' },
  { kind: 'outlet', label: 'Power outlet', plural: 'Power outlets', code: 'P', color: '#5D4037', group: 'devices' },
  { kind: 'tablet', label: 'Tablet / kiosk', plural: 'Tablets / kiosks', code: 'T', color: '#00695C', group: 'devices' },
  { kind: 'tv', label: 'TV / display', plural: 'TVs / displays', code: 'TV', color: '#6A1B9A', group: 'devices' },
  { kind: 'pos', label: 'POS terminal', plural: 'POS terminals', code: 'POS', color: '#AD1457', group: 'devices' },
  { kind: 'pc', label: 'Computer', plural: 'Computers', code: 'PC', color: '#455A64', group: 'devices' },
  { kind: 'printer', label: 'Printer', plural: 'Printers', code: 'PR', color: '#6D4C41', group: 'devices' },
  { kind: 'phone', label: 'Phone', plural: 'Phones', code: 'PH', color: '#00838F', group: 'devices' },
  { kind: 'speaker', label: 'Speaker', plural: 'Speakers', code: 'S', color: '#EF6C00', group: 'devices' },
  { kind: 'reader', label: 'Card reader', plural: 'Card readers', code: 'A', color: '#00838F', group: 'devices' },
  { kind: 'door', label: 'Door', plural: 'Doors', code: '', color: '#455A64', group: 'building' },
  { kind: 'window', label: 'Window', plural: 'Windows', code: '', color: '#78909C', group: 'building' },
];
export const SYMBOL_GROUPS: { group: SymbolGroup; label: string }[] = [
  { group: 'network', label: 'Network gear' },
  { group: 'devices', label: 'Devices' },
  { group: 'building', label: 'Building' },
];

/** Data cable types, each with its own colour on the plan and its own footage. */
export type CableType = 'cat6' | 'cat6a' | 'cat5e' | 'fiber' | 'coax' | 'power' | 'other';
export const CABLE_TYPES: { type: CableType; label: string; color: string }[] = [
  { type: 'cat6', label: 'Cat6', color: '#1565C0' },
  { type: 'cat6a', label: 'Cat6A', color: '#2E7D32' },
  { type: 'cat5e', label: 'Cat5e', color: '#5E35B1' },
  { type: 'fiber', label: 'Fiber', color: '#EF6C00' },
  { type: 'coax', label: 'Coax', color: '#212121' },
  { type: 'power', label: 'Power', color: '#C62828' },
  { type: 'other', label: 'Other cable', color: '#78909C' },
];
const CABLE_KEYS = new Set<string>(CABLE_TYPES.map((c) => c.type));
export const cableInfo = (t: CableType) => CABLE_TYPES.find((c) => c.type === t) ?? CABLE_TYPES[CABLE_TYPES.length - 1];
const SYMBOL_KINDS = new Set<string>(SYMBOLS.map((s) => s.kind));
export const symbolInfo = (k: SymbolKind) => SYMBOLS.find((s) => s.kind === k)!;

export const COLORS = ['#0E1B2E', '#C62828', '#1565C0', '#2E7D32', '#EF6C00', '#6A1B9A', '#C9A24B'];

export type Shape =
  | { id: string; kind: 'room'; x: number; y: number; w: number; h: number; name: string; color: string }
  | { id: string; kind: 'wall'; a: Pt; b: Pt; color: string }
  | { id: string; kind: 'cable'; pts: Pt[]; color: string; label: string; cable: CableType }
  | { id: string; kind: 'pen'; pts: Pt[]; color: string; width: number; marker: boolean }
  | { id: string; kind: 'line'; a: Pt; b: Pt; color: string; width: number; arrow: boolean }
  | { id: string; kind: 'box'; x: number; y: number; w: number; h: number; color: string; width: number; fill: boolean }
  | { id: string; kind: 'ellipse'; x: number; y: number; w: number; h: number; color: string; width: number; fill: boolean }
  | { id: string; kind: 'text'; at: Pt; text: string; color: string; size: number }
  | { id: string; kind: 'symbol'; sym: SymbolKind; at: Pt; label: string; rot: number }
  | { id: string; kind: 'photo'; at: Pt; path: string; note: string };

export type Sketch = {
  v: 1;
  /** The plan area in feet. */
  width: number;
  height: number;
  shapes: Shape[];
  /** A floor-plan photo under the drawing, stretched to the plan area. */
  bg: { path: string; opacity: number } | null;
};

export const DEFAULT_SIZE = { width: 80, height: 50 };
export const MAX_SIZE = 400;

export const newSketch = (): Sketch => ({ v: 1, ...DEFAULT_SIZE, shapes: [], bg: null });
export const newId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

const num = (v: unknown, fallback = 0, min = -MAX_SIZE * 2, max = MAX_SIZE * 2) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
const color = (v: unknown) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : COLORS[0]);
const pt = (v: unknown): Pt | null => {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  return { x: num(o.x), y: num(o.y) };
};
const pts = (v: unknown, cap = 2000): Pt[] => (Array.isArray(v) ? v.map(pt).filter((p): p is Pt => !!p).slice(0, cap) : []);

/** A saved value (or anything else) made safe to draw. */
export function normalizeSketch(raw: unknown): Sketch {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const shapes: Shape[] = [];
  const ids = new Set<string>();
  for (const r of Array.isArray(src.shapes) ? src.shapes.slice(0, 3000) : []) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    let id = str(o.id, 40) || newId();
    if (ids.has(id)) id = newId();
    ids.add(id);
    switch (o.kind) {
      case 'room': {
        const w = num(o.w, 0, 0), h = num(o.h, 0, 0);
        if (w < 0.5 || h < 0.5) continue;
        shapes.push({ id, kind: 'room', x: num(o.x), y: num(o.y), w, h, name: str(o.name, 60), color: color(o.color) });
        break;
      }
      case 'wall': {
        const a = pt(o.a), b = pt(o.b);
        if (a && b) shapes.push({ id, kind: 'wall', a, b, color: color(o.color) });
        break;
      }
      case 'cable': {
        const p = pts(o.pts);
        // Runs saved before cable types existed count as Cat6.
        if (p.length >= 2) shapes.push({ id, kind: 'cable', pts: p, color: color(o.color), label: str(o.label, 60), cable: CABLE_KEYS.has(String(o.cable)) ? (o.cable as CableType) : 'cat6' });
        break;
      }
      case 'pen': {
        const p = pts(o.pts, 5000);
        if (p.length >= 2) shapes.push({ id, kind: 'pen', pts: p, color: color(o.color), width: num(o.width, 0.15, 0.03, 3), marker: o.marker === true });
        break;
      }
      case 'line': {
        const a = pt(o.a), b = pt(o.b);
        if (a && b) shapes.push({ id, kind: 'line', a, b, color: color(o.color), width: num(o.width, 0.15, 0.03, 3), arrow: o.arrow === true });
        break;
      }
      case 'box': case 'ellipse': {
        const w = num(o.w, 0, 0), h = num(o.h, 0, 0);
        if (w < 0.2 || h < 0.2) continue;
        shapes.push({ id, kind: o.kind, x: num(o.x), y: num(o.y), w, h, color: color(o.color), width: num(o.width, 0.15, 0.03, 3), fill: o.fill === true });
        break;
      }
      case 'text': {
        const at = pt(o.at), text = str(o.text, 300);
        if (at && text.trim()) shapes.push({ id, kind: 'text', at, text, color: color(o.color), size: num(o.size, 1.2, 0.4, 10) });
        break;
      }
      case 'symbol': {
        const at = pt(o.at);
        if (at && SYMBOL_KINDS.has(String(o.sym))) shapes.push({ id, kind: 'symbol', sym: o.sym as SymbolKind, at, label: str(o.label, 60), rot: num(o.rot, 0, 0, 359) });
        break;
      }
      case 'photo': {
        const at = pt(o.at), path = str(o.path, 300);
        if (at && path) shapes.push({ id, kind: 'photo', at, path, note: str(o.note, 300) });
        break;
      }
    }
  }
  const bgRaw = src.bg && typeof src.bg === 'object' ? (src.bg as Record<string, unknown>) : null;
  return {
    v: 1,
    width: num(src.width, DEFAULT_SIZE.width, 10, MAX_SIZE),
    height: num(src.height, DEFAULT_SIZE.height, 10, MAX_SIZE),
    shapes,
    bg: bgRaw && str(bgRaw.path, 300) ? { path: str(bgRaw.path, 300), opacity: num(bgRaw.opacity, 0.5, 0.1, 1) } : null,
  };
}

// ── Measuring ───────────────────────────────────────────────────────────────

export const snap = (v: number, step = 0.5) => Math.round(v / step) * step;
export const snapPt = (p: Pt, step = 0.5): Pt => ({ x: snap(p.x, step), y: snap(p.y, step) });
export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
export const pathLength = (p: Pt[]) => p.slice(1).reduce((s, q, i) => s + dist(p[i], q), 0);

/** 12.5 → `12' 6"`; 3 → `3'`. */
export function feet(v: number): string {
  const totalIn = Math.round(Math.abs(v) * 12);
  const ft = Math.floor(totalIn / 12), inch = totalIn % 12;
  return inch ? `${ft}' ${inch}"` : `${ft}'`;
}
export const sqft = (n: number) => `${Math.round(n).toLocaleString('en-US')} sq ft`;

/** A room drawn from one corner to the other, either direction. */
export function roomFromCorners(a: Pt, b: Pt): { x: number; y: number; w: number; h: number } {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

export type SketchSummary = {
  symbols: { kind: SymbolKind; label: string; count: number }[];
  cableFeet: number;
  cableRuns: number;
  /** Footage per cable type, in the CABLE_TYPES order. */
  cables: { type: CableType; label: string; feet: number; runs: number }[];
  rooms: { name: string; area: number }[];
  totalArea: number;
  photos: number;
};

/** What's on the plan, counted — the start of a materials list. */
export function summarize(s: Sketch): SketchSummary {
  const counts = new Map<SymbolKind, number>();
  const byType = new Map<CableType, { feet: number; runs: number }>();
  let cableFeet = 0, cableRuns = 0, photos = 0;
  const rooms: { name: string; area: number }[] = [];
  for (const sh of s.shapes) {
    if (sh.kind === 'symbol') counts.set(sh.sym, (counts.get(sh.sym) ?? 0) + 1);
    else if (sh.kind === 'cable') {
      const len = pathLength(sh.pts);
      cableFeet += len; cableRuns += 1;
      const t = byType.get(sh.cable) ?? { feet: 0, runs: 0 };
      byType.set(sh.cable, { feet: t.feet + len, runs: t.runs + 1 });
    }
    else if (sh.kind === 'room') rooms.push({ name: sh.name || `Room ${rooms.length + 1}`, area: sh.w * sh.h });
    else if (sh.kind === 'photo') photos += 1;
  }
  return {
    symbols: SYMBOLS.filter((x) => counts.has(x.kind)).map((x) => ({ kind: x.kind, label: counts.get(x.kind) === 1 ? x.label : x.plural, count: counts.get(x.kind)! })),
    cableFeet: Math.round(cableFeet),
    cableRuns,
    cables: CABLE_TYPES.filter((c) => byType.has(c.type)).map((c) => ({ type: c.type, label: c.label, feet: Math.round(byType.get(c.type)!.feet), runs: byType.get(c.type)!.runs })),
    rooms,
    totalArea: rooms.reduce((a, r) => a + r.area, 0),
    photos,
  };
}

/** One line for a list: "6 Cameras · 4 Wi-Fi APs · 340 ft cable · 2 rooms". */
export function summaryLine(s: SketchSummary): string {
  const parts = s.symbols.map((x) => `${x.count} ${x.label}`);
  if (s.cables.length === 1) parts.push(`${s.cables[0].feet.toLocaleString('en-US')} ft ${s.cables[0].label}`);
  else if (s.cables.length > 1) parts.push(s.cables.map((c) => `${c.label} ${c.feet.toLocaleString('en-US')} ft`).join(', '));
  if (s.rooms.length) parts.push(`${s.rooms.length} room${s.rooms.length === 1 ? '' : 's'} (${sqft(s.totalArea)})`);
  if (s.photos) parts.push(`${s.photos} photo${s.photos === 1 ? '' : 's'}`);
  return parts.join(' · ') || 'Empty';
}

// ── Picking and moving ──────────────────────────────────────────────────────

function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}

/** The top-most shape under a point (tol in feet), or null. */
export function hitTest(shapes: Shape[], p: Pt, tol = 0.8): Shape | null {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i];
    switch (s.kind) {
      case 'symbol': case 'photo':
        if (dist(p, s.at) <= tol * 1.4) return s;
        break;
      case 'text':
        if (p.x >= s.at.x - tol && p.x <= s.at.x + s.text.length * s.size * 0.6 + tol && Math.abs(p.y - s.at.y + s.size * 0.35) <= s.size * 0.7 + tol) return s;
        break;
      case 'wall': case 'line':
        if (segDist(p, s.a, s.b) <= tol) return s;
        break;
      case 'box': {
        const inside = p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h;
        const edges = [
          [{ x: s.x, y: s.y }, { x: s.x + s.w, y: s.y }], [{ x: s.x + s.w, y: s.y }, { x: s.x + s.w, y: s.y + s.h }],
          [{ x: s.x + s.w, y: s.y + s.h }, { x: s.x, y: s.y + s.h }], [{ x: s.x, y: s.y + s.h }, { x: s.x, y: s.y }],
        ];
        if ((s.fill && inside) || edges.some(([a, b]) => segDist(p, a, b) <= tol)) return s;
        break;
      }
      case 'ellipse': {
        const rx = s.w / 2, ry = s.h / 2, cx = s.x + rx, cy = s.y + ry;
        const d = Math.hypot((p.x - cx) / rx, (p.y - cy) / ry);
        if ((s.fill && d <= 1) || Math.abs(d - 1) * Math.min(rx, ry) <= tol) return s;
        break;
      }
      case 'cable': case 'pen':
        for (let j = 1; j < s.pts.length; j++) if (segDist(p, s.pts[j - 1], s.pts[j]) <= tol) return s;
        break;
      case 'room': {
        // The room's edge, or its middle (where its name sits) — not anywhere
        // inside, so symbols placed in a room stay easy to pick.
        const onEdge = [
          [{ x: s.x, y: s.y }, { x: s.x + s.w, y: s.y }], [{ x: s.x + s.w, y: s.y }, { x: s.x + s.w, y: s.y + s.h }],
          [{ x: s.x + s.w, y: s.y + s.h }, { x: s.x, y: s.y + s.h }], [{ x: s.x, y: s.y + s.h }, { x: s.x, y: s.y }],
        ].some(([a, b]) => segDist(p, a, b) <= tol);
        const nearMiddle = dist(p, { x: s.x + s.w / 2, y: s.y + s.h / 2 }) <= Math.max(tol * 2, Math.min(s.w, s.h) / 4);
        if (onEdge || nearMiddle) return s;
        break;
      }
    }
  }
  return null;
}

const mv = (p: Pt, dx: number, dy: number): Pt => ({ x: p.x + dx, y: p.y + dy });

export function moveShape(s: Shape, dx: number, dy: number): Shape {
  switch (s.kind) {
    case 'room': case 'box': case 'ellipse': return { ...s, x: s.x + dx, y: s.y + dy };
    case 'wall': case 'line': return { ...s, a: mv(s.a, dx, dy), b: mv(s.b, dx, dy) };
    case 'cable': case 'pen': return { ...s, pts: s.pts.map((p) => mv(p, dx, dy)) };
    default: return { ...s, at: mv(s.at, dx, dy) };
  }
}

/** Where a shape's label sits — for the length/area tags. */
export function midpoint(p: Pt[]): Pt {
  const total = pathLength(p);
  if (p.length < 2 || total === 0) return p[0] ?? { x: 0, y: 0 };
  let walked = 0;
  for (let i = 1; i < p.length; i++) {
    const seg = dist(p[i - 1], p[i]);
    if (walked + seg >= total / 2) {
      const t = (total / 2 - walked) / seg;
      return { x: p[i - 1].x + t * (p[i].x - p[i - 1].x), y: p[i - 1].y + t * (p[i].y - p[i - 1].y) };
    }
    walked += seg;
  }
  return p[p.length - 1];
}
