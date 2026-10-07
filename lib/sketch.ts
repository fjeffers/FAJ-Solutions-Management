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
  // building — doors and windows sit in walls (OPENING_WIDTH)
  | 'door' | 'door2' | 'slider' | 'window' | 'window2'
  // building extras
  | 'stairs' | 'elevator' | 'column'
  // furniture — drawn to size (FURNITURE_SIZE)
  | 'table' | 'conftable' | 'desk' | 'ldesk' | 'reception' | 'cubicle' | 'chair' | 'sofa' | 'coffee' | 'cabinet' | 'filecab'
  | 'shelf' | 'lockers' | 'whiteboard' | 'counter' | 'bench' | 'plant' | 'trash' | 'bed' | 'twinbed' | 'nightstand' | 'dresser'
  // bath & kitchen
  | 'toilet' | 'sink' | 'urinal' | 'shower' | 'tub' | 'fridge' | 'stove' | 'watercooler';

export type SymbolGroup = 'network' | 'devices' | 'building' | 'furniture' | 'bath';

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
  { kind: 'door2', label: 'Double door', plural: 'Double doors', code: '', color: '#455A64', group: 'building' },
  { kind: 'slider', label: 'Sliding glass door', plural: 'Sliding glass doors', code: '', color: '#1E88E5', group: 'building' },
  { kind: 'window', label: 'Window', plural: 'Windows', code: '', color: '#78909C', group: 'building' },
  { kind: 'window2', label: 'Wide window', plural: 'Wide windows', code: '', color: '#78909C', group: 'building' },
  { kind: 'stairs', label: 'Stairs', plural: 'Stairs', code: '', color: '#616161', group: 'building' },
  { kind: 'elevator', label: 'Elevator', plural: 'Elevators', code: '', color: '#455A64', group: 'building' },
  { kind: 'column', label: 'Column', plural: 'Columns', code: '', color: '#757575', group: 'building' },
  // Fred, 2026-10-06: "under symbol should be the accessories for the room — table, chairs etc." and
  // "add a bed, toilet, sink … I need the accessories to build an office".
  { kind: 'desk', label: 'Desk', plural: 'Desks', code: '', color: '#795548', group: 'furniture' },
  { kind: 'ldesk', label: 'L-shaped desk', plural: 'L-shaped desks', code: '', color: '#795548', group: 'furniture' },
  { kind: 'reception', label: 'Reception desk', plural: 'Reception desks', code: '', color: '#6D4C41', group: 'furniture' },
  { kind: 'cubicle', label: 'Cubicle', plural: 'Cubicles', code: '', color: '#78909C', group: 'furniture' },
  { kind: 'chair', label: 'Chair', plural: 'Chairs', code: '', color: '#5D4037', group: 'furniture' },
  { kind: 'table', label: 'Table', plural: 'Tables', code: '', color: '#8D6E63', group: 'furniture' },
  { kind: 'conftable', label: 'Conference table', plural: 'Conference tables', code: '', color: '#6D4C41', group: 'furniture' },
  { kind: 'coffee', label: 'Coffee table', plural: 'Coffee tables', code: '', color: '#8D6E63', group: 'furniture' },
  { kind: 'sofa', label: 'Sofa', plural: 'Sofas', code: '', color: '#7E57C2', group: 'furniture' },
  { kind: 'filecab', label: 'File cabinet', plural: 'File cabinets', code: '', color: '#607D8B', group: 'furniture' },
  { kind: 'cabinet', label: 'Cabinet', plural: 'Cabinets', code: '', color: '#607D8B', group: 'furniture' },
  { kind: 'shelf', label: 'Bookcase / shelving', plural: 'Bookcases / shelving', code: '', color: '#546E7A', group: 'furniture' },
  { kind: 'lockers', label: 'Lockers', plural: 'Lockers', code: '', color: '#546E7A', group: 'furniture' },
  { kind: 'whiteboard', label: 'Whiteboard', plural: 'Whiteboards', code: '', color: '#90A4AE', group: 'furniture' },
  { kind: 'counter', label: 'Counter', plural: 'Counters', code: '', color: '#8D6E63', group: 'furniture' },
  { kind: 'bench', label: 'Bench / pew', plural: 'Benches / pews', code: '', color: '#A1887F', group: 'furniture' },
  { kind: 'plant', label: 'Plant', plural: 'Plants', code: '', color: '#43A047', group: 'furniture' },
  { kind: 'trash', label: 'Trash can', plural: 'Trash cans', code: '', color: '#757575', group: 'furniture' },
  { kind: 'bed', label: 'Bed', plural: 'Beds', code: '', color: '#5C6BC0', group: 'furniture' },
  { kind: 'twinbed', label: 'Twin bed', plural: 'Twin beds', code: '', color: '#5C6BC0', group: 'furniture' },
  { kind: 'nightstand', label: 'Nightstand', plural: 'Nightstands', code: '', color: '#8D6E63', group: 'furniture' },
  { kind: 'dresser', label: 'Dresser', plural: 'Dressers', code: '', color: '#8D6E63', group: 'furniture' },
  { kind: 'toilet', label: 'Toilet', plural: 'Toilets', code: '', color: '#0288D1', group: 'bath' },
  { kind: 'sink', label: 'Sink', plural: 'Sinks', code: '', color: '#0288D1', group: 'bath' },
  { kind: 'urinal', label: 'Urinal', plural: 'Urinals', code: '', color: '#0288D1', group: 'bath' },
  { kind: 'shower', label: 'Shower', plural: 'Showers', code: '', color: '#0288D1', group: 'bath' },
  { kind: 'tub', label: 'Bathtub', plural: 'Bathtubs', code: '', color: '#0288D1', group: 'bath' },
  { kind: 'fridge', label: 'Refrigerator', plural: 'Refrigerators', code: '', color: '#607D8B', group: 'bath' },
  { kind: 'stove', label: 'Stove / range', plural: 'Stoves / ranges', code: '', color: '#424242', group: 'bath' },
  { kind: 'watercooler', label: 'Water cooler', plural: 'Water coolers', code: '', color: '#0288D1', group: 'bath' },
];
export const SYMBOL_GROUPS: { group: SymbolGroup; label: string }[] = [
  { group: 'network', label: 'Network gear' },
  { group: 'devices', label: 'Devices' },
  { group: 'building', label: 'Doors, windows & stairs' },
  { group: 'furniture', label: 'Furniture' },
  { group: 'bath', label: 'Bath & kitchen' },
];

/**
 * Standard sizes in feet: w along the item, d front to back (both turn with
 * it), h how tall it stands in 3D. Any piece can be given its own width and
 * depth (Shape.size).
 */
export const FURNITURE_SIZE: Partial<Record<SymbolKind, { w: number; d: number; h: number }>> = {
  desk: { w: 5, d: 2.5, h: 2.5 }, ldesk: { w: 6, d: 6, h: 2.5 }, reception: { w: 8, d: 3, h: 3.5 }, cubicle: { w: 6, d: 6, h: 4.5 },
  chair: { w: 2, d: 2, h: 3 }, table: { w: 6, d: 3, h: 2.5 }, conftable: { w: 10, d: 4, h: 2.5 }, coffee: { w: 4, d: 2, h: 1.4 },
  sofa: { w: 7, d: 3, h: 2.8 }, filecab: { w: 1.5, d: 2.5, h: 4.3 }, cabinet: { w: 3, d: 2, h: 3 }, shelf: { w: 4, d: 1.5, h: 6 },
  lockers: { w: 6, d: 1.5, h: 6 }, whiteboard: { w: 6, d: 0.3, h: 4 }, counter: { w: 8, d: 2, h: 3 }, bench: { w: 10, d: 2, h: 3 },
  plant: { w: 1.5, d: 1.5, h: 4 }, trash: { w: 1.2, d: 1.2, h: 2.2 }, bed: { w: 5, d: 6.7, h: 2 }, twinbed: { w: 3.2, d: 6.3, h: 2 },
  nightstand: { w: 2, d: 1.5, h: 2.2 }, dresser: { w: 5, d: 1.7, h: 3 },
  toilet: { w: 1.7, d: 2.4, h: 2.5 }, sink: { w: 2, d: 1.7, h: 2.8 }, urinal: { w: 1.5, d: 1.2, h: 2 }, shower: { w: 3, d: 3, h: 7 },
  tub: { w: 5, d: 2.5, h: 1.7 }, fridge: { w: 3, d: 2.5, h: 6 }, stove: { w: 2.5, d: 2.2, h: 3 }, watercooler: { w: 1.2, d: 1.2, h: 3.5 },
  stairs: { w: 4, d: 10, h: 9 }, elevator: { w: 6, d: 6, h: 9 }, column: { w: 1.5, d: 1.5, h: 9 },
};
export const isFurniture = (k: SymbolKind): boolean => FURNITURE_SIZE[k] !== undefined;

/** A piece's size on the plan: its own, or the standard one. */
export function footprint(s: { sym: SymbolKind; size?: { w: number; d: number } }): { w: number; d: number; h: number } | null {
  const std = FURNITURE_SIZE[s.sym];
  if (!std) return null;
  return s.size ? { ...std, w: s.size.w, d: s.size.d } : std;
}

/** Whether p is on a piece of furniture (its turned footprint, plus tol). */
function onFurniture(s: { sym: SymbolKind; at: Pt; rot: number; size?: { w: number; d: number } }, p: Pt, tol: number): boolean {
  const size = footprint(s);
  if (!size) return false;
  const r = (-s.rot * Math.PI) / 180, dx = p.x - s.at.x, dy = p.y - s.at.y;
  const lx = dx * Math.cos(r) - dy * Math.sin(r), ly = dx * Math.sin(r) + dy * Math.cos(r);
  return Math.abs(lx) <= size.w / 2 + tol && Math.abs(ly) <= size.d / 2 + tol;
}

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
  /** rot: turned this many degrees about its centre (Fred, 2026-10-06: "still can't rotate the rooms"). */
  | { id: string; kind: 'room'; x: number; y: number; w: number; h: number; name: string; color: string; wtype?: WallType; rot?: number }
  /** wtype: what the wall is made of (WALL_TYPES); drywall when absent. */
  | { id: string; kind: 'wall'; a: Pt; b: Pt; color: string; wtype?: WallType }
  /** A stretch of wall taken out (a doorway, a pass-through) — of a drawn wall or a room's side. */
  | { id: string; kind: 'gap'; a: Pt; b: Pt }
  | { id: string; kind: 'cable'; pts: Pt[]; color: string; label: string; cable: CableType }
  | { id: string; kind: 'pen'; pts: Pt[]; color: string; width: number; marker: boolean }
  | { id: string; kind: 'line'; a: Pt; b: Pt; color: string; width: number; arrow: boolean }
  | { id: string; kind: 'box'; x: number; y: number; w: number; h: number; color: string; width: number; fill: boolean }
  | { id: string; kind: 'ellipse'; x: number; y: number; w: number; h: number; color: string; width: number; fill: boolean }
  | { id: string; kind: 'text'; at: Pt; text: string; color: string; size: number }
  /** size: furniture only, its own width and depth in feet (the standard size when absent). */
  | { id: string; kind: 'symbol'; sym: SymbolKind; at: Pt; label: string; rot: number; size?: { w: number; d: number } }
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

// ── Wall types (Fred, 2026-10-06: "I need the various types of wall") ─────
// What a wall is made of matters to FAJ: block, brick and concrete need a core
// drill to get cable through and eat Wi-Fi; glass and drywall don't. The Wi-Fi
// figure is a typical loss through one wall at 5 GHz — a guide for AP
// placement, not a survey.

export type WallType = 'drywall' | 'exterior' | 'block' | 'brick' | 'concrete' | 'glass' | 'half' | 'partition' | 'fire';
export const WALL_TYPES: {
  type: WallType; label: string; hint: string;
  /** On the plan: the wall line's colour and width (feet); dashed for low walls. */
  color: string; width: number; dash?: string;
  /** In 3D: colour, see-through-ness, and height when not floor-to-ceiling. */
  color3d: string; opacity: number; height: number | null;
  /** Typical Wi-Fi loss through it, dB. */
  wifiDb: number;
}[] = [
  { type: 'drywall', label: 'Drywall', hint: 'Interior stud wall', color: '', width: 0.45, color3d: '#d9d2c4', opacity: 1, height: null, wifiDb: 3 },
  { type: 'exterior', label: 'Exterior wall', hint: 'Outside wall of the building', color: '#263238', width: 0.8, color3d: '#a59d8f', opacity: 1, height: null, wifiDb: 15 },
  { type: 'block', label: 'Block (CMU)', hint: 'Concrete block — core drill for cable', color: '#78909C', width: 0.7, color3d: '#b8bec3', opacity: 1, height: null, wifiDb: 12 },
  { type: 'brick', label: 'Brick', hint: 'Core drill for cable', color: '#B5533C', width: 0.6, color3d: '#b5533c', opacity: 1, height: null, wifiDb: 10 },
  { type: 'concrete', label: 'Concrete', hint: 'Poured concrete — hardest for Wi-Fi', color: '#424242', width: 0.75, color3d: '#9e9e9e', opacity: 1, height: null, wifiDb: 18 },
  { type: 'glass', label: 'Glass', hint: 'Storefront or glass partition', color: '#5FA8D3', width: 0.3, color3d: '#9fc6ea', opacity: 0.38, height: null, wifiDb: 4 },
  { type: 'half', label: 'Half wall', hint: 'Knee wall, about 3½ ft high', color: '#90A4AE', width: 0.35, dash: '0.6 0.3', color3d: '#d9d2c4', opacity: 1, height: 3.5, wifiDb: 1 },
  { type: 'partition', label: 'Cubicle partition', hint: 'Office panel, about 5 ft high', color: '#B0BEC5', width: 0.25, dash: '0.3 0.15', color3d: '#cfd8dc', opacity: 1, height: 5, wifiDb: 2 },
  { type: 'fire', label: 'Fire-rated wall', hint: 'Double drywall — firestop every penetration', color: '#C62828', width: 0.5, color3d: '#e9b4ab', opacity: 1, height: null, wifiDb: 6 },
];
const WALL_TYPE_KEYS = new Set<string>(WALL_TYPES.map((w) => w.type));
export const wallTypeInfo = (t: WallType | undefined) => WALL_TYPES.find((w) => w.type === (t ?? 'drywall')) ?? WALL_TYPES[0];
/** A saved wall's type; glass walls saved before wall types (glass: true) stay glass. */
function wallTypeOf(o: Record<string, unknown>): WallType {
  if (typeof o.wtype === 'string' && WALL_TYPE_KEYS.has(o.wtype)) return o.wtype as WallType;
  return o.glass === true ? 'glass' : 'drywall';
}

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
        const rt = wallTypeOf(o);
        const rr = Math.round(num(o.rot, 0, 0, 359.99) * 10) / 10;
        shapes.push({ id, kind: 'room', x: num(o.x), y: num(o.y), w, h, name: str(o.name, 60), color: color(o.color), ...(rt !== 'drywall' && { wtype: rt }), ...(rr && { rot: rr }) });
        break;
      }
      case 'wall': {
        const a = pt(o.a), b = pt(o.b);
        const wt = wallTypeOf(o);
        if (a && b) shapes.push({ id, kind: 'wall', a, b, color: color(o.color), ...(wt !== 'drywall' && { wtype: wt }) });
        break;
      }
      case 'gap': {
        const a = pt(o.a), b = pt(o.b);
        if (a && b && dist(a, b) >= 0.2) shapes.push({ id, kind: 'gap', a, b });
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
        if (!at || !SYMBOL_KINDS.has(String(o.sym))) break;
        const sz = o.size && typeof o.size === 'object' ? (o.size as Record<string, unknown>) : null;
        const w = sz ? num(sz.w, 0, 0, 60) : 0, d = sz ? num(sz.d, 0, 0, 60) : 0;
        shapes.push({
          id, kind: 'symbol', sym: o.sym as SymbolKind, at, label: str(o.label, 60), rot: num(o.rot, 0, 0, 359),
          ...(FURNITURE_SIZE[o.sym as SymbolKind] && w >= 0.3 && d >= 0.3 && { size: { w, d } }),
        });
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
  /** Feet of each kind of wall other than drywall (block, brick, glass…), for cabling and Wi-Fi. */
  walls: { type: WallType; label: string; feet: number }[];
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
    walls: (() => {
      const byType = new Map<WallType, number>();
      for (const r of wallRuns(s.shapes)) if (r.wtype !== 'drywall') byType.set(r.wtype, (byType.get(r.wtype) ?? 0) + dist(r.a, r.b));
      return WALL_TYPES.filter((w) => byType.has(w.type)).map((w) => ({ type: w.type, label: w.label, feet: Math.round(byType.get(w.type)!) }));
    })(),
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
export function hitTest(shapes: Shape[], at: Pt, tol = 0.8): Shape | null {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i];
    let p = at;
    switch (s.kind) {
      case 'symbol': case 'photo':
        if (dist(p, s.at) <= tol * 1.4) return s;
        if (s.kind === 'symbol' && isOpeningSymbol(s.sym)) { const o = openingSegment(s); if (segDist(p, o.a, o.b) <= tol) return s; }
        if (s.kind === 'symbol' && onFurniture(s, p, tol * 0.3)) return s;
        break;
      case 'text':
        if (p.x >= s.at.x - tol && p.x <= s.at.x + s.text.length * s.size * 0.6 + tol && Math.abs(p.y - s.at.y + s.size * 0.35) <= s.size * 0.7 + tol) return s;
        break;
      case 'wall': case 'line': case 'gap':
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
        // inside, so symbols placed in a room stay easy to pick. A turned room
        // is checked in its own (unturned) frame.
        if (s.rot) p = rotatePt(p, roomCenter(s), -s.rot);
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
    case 'wall': case 'line': case 'gap': return { ...s, a: mv(s.a, dx, dy), b: mv(s.b, dx, dy) };
    case 'cable': case 'pen': return { ...s, pts: s.pts.map((p) => mv(p, dx, dy)) };
    default: return { ...s, at: mv(s.at, dx, dy) };
  }
}

// ── Changing a shape's size (Fred, 2026-10-06: "am I able to edit the walls
// or rooms or sides, anything?") ───────────────────────────────────────────

/** The smallest a room or box side can be dragged to, in feet. */
export const MIN_SIDE = 0.5;
/** The turning handle (rooms and furniture), and how far beyond the shape it sits. */
export const ROT_HANDLE = 'rot';
const ROT_REACH = 1.8;
export const normDeg = (d: number) => Math.round((((d % 360) + 360) % 360) * 10) / 10;

/** p turned deg degrees about c (y down, so positive turns clockwise on screen). */
export function rotatePt(p: Pt, c: Pt, deg: number): Pt {
  const r = (deg * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r), dx = p.x - c.x, dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}
export const roomCenter = (s: { x: number; y: number; w: number; h: number }): Pt => ({ x: s.x + s.w / 2, y: s.y + s.h / 2 });
/** A room's corners, turned: top-left, top-right, bottom-right, bottom-left. */
export function roomCorners(s: { x: number; y: number; w: number; h: number; rot?: number }): Pt[] {
  const c = roomCenter(s), rot = s.rot ?? 0;
  const pts = [{ x: s.x, y: s.y }, { x: s.x + s.w, y: s.y }, { x: s.x + s.w, y: s.y + s.h }, { x: s.x, y: s.y + s.h }];
  return rot ? pts.map((p) => rotatePt(p, c, rot)) : pts;
}

/**
 * The grab points of a selected shape: the corners and sides of a room, box
 * or circle; both ends of a wall, line or arrow; every bend of a cable run.
 */
export function handlesOf(s: Shape): { id: string; at: Pt }[] {
  switch (s.kind) {
    case 'room': case 'box': case 'ellipse': {
      const { x, y, w, h } = s;
      const list = [
        { id: 'nw', at: { x, y } }, { id: 'n', at: { x: x + w / 2, y } }, { id: 'ne', at: { x: x + w, y } },
        { id: 'e', at: { x: x + w, y: y + h / 2 } }, { id: 'se', at: { x: x + w, y: y + h } },
        { id: 's', at: { x: x + w / 2, y: y + h } }, { id: 'sw', at: { x, y: y + h } }, { id: 'w', at: { x, y: y + h / 2 } },
      ];
      if (s.kind !== 'room') return list;
      // A room also has a turning handle, above its top side.
      const c = roomCenter(s), rot = s.rot ?? 0;
      return [...list, { id: ROT_HANDLE, at: { x: x + w / 2, y: y - ROT_REACH } }].map((hd) => ({ id: hd.id, at: rot ? rotatePt(hd.at, c, rot) : hd.at }));
    }
    case 'symbol': {
      // Furniture turns with a handle beyond its back.
      const f = footprint(s);
      if (!f) return [];
      return [{ id: ROT_HANDLE, at: rotatePt({ x: s.at.x, y: s.at.y - f.d / 2 - ROT_REACH }, s.at, s.rot) }];
    }
    case 'wall': case 'line': case 'gap': return [{ id: 'a', at: s.a }, { id: 'b', at: s.b }];
    case 'cable': return s.pts.map((p, i) => ({ id: `p${i}`, at: p }));
    default: return [];
  }
}

/** Drag one grab point to p. A side stops at MIN_SIDE rather than flipping over. */
export function dragHandle(s: Shape, id: string, p: Pt): Shape {
  if (id === ROT_HANDLE) {
    // Turning: the handle points the way the room's (or piece's) top now faces.
    if (s.kind !== 'room' && s.kind !== 'symbol') return s;
    const c = s.kind === 'room' ? roomCenter(s) : s.at;
    const deg = normDeg((Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI + 90);
    return { ...s, rot: deg };
  }
  switch (s.kind) {
    case 'room': {
      // Resize in the room's own frame, keeping the far side where it is.
      const rot = s.rot ?? 0, c = roomCenter(s);
      const q = rot ? rotatePt(p, c, -rot) : p;
      let l = s.x, r = s.x + s.w, t = s.y, b = s.y + s.h;
      if (id === 'nw' || id === 'w' || id === 'sw') l = Math.min(q.x, r - MIN_SIDE);
      if (id === 'ne' || id === 'e' || id === 'se') r = Math.max(q.x, l + MIN_SIDE);
      if (id === 'nw' || id === 'n' || id === 'ne') t = Math.min(q.y, b - MIN_SIDE);
      if (id === 'sw' || id === 's' || id === 'se') b = Math.max(q.y, t + MIN_SIDE);
      const nc = rot ? rotatePt({ x: (l + r) / 2, y: (t + b) / 2 }, c, rot) : { x: (l + r) / 2, y: (t + b) / 2 };
      return { ...s, x: nc.x - (r - l) / 2, y: nc.y - (b - t) / 2, w: r - l, h: b - t };
    }
    case 'box': case 'ellipse': {
      let l = s.x, r = s.x + s.w, t = s.y, b = s.y + s.h;
      if (id === 'nw' || id === 'w' || id === 'sw') l = Math.min(p.x, r - MIN_SIDE);
      if (id === 'ne' || id === 'e' || id === 'se') r = Math.max(p.x, l + MIN_SIDE);
      if (id === 'nw' || id === 'n' || id === 'ne') t = Math.min(p.y, b - MIN_SIDE);
      if (id === 'sw' || id === 's' || id === 'se') b = Math.max(p.y, t + MIN_SIDE);
      return { ...s, x: l, y: t, w: r - l, h: b - t };
    }
    case 'wall': case 'line': case 'gap':
      return id === 'a' ? { ...s, a: p } : id === 'b' ? { ...s, b: p } : s;
    case 'cable': {
      const i = Number(id.slice(1));
      if (!/^p\d+$/.test(id) || i >= s.pts.length) return s;
      return { ...s, pts: s.pts.map((q, j) => (j === i ? p : q)) };
    }
    default: return s;
  }
}

const clampSide = (v: number) => (Number.isFinite(v) ? Math.min(Math.max(v, MIN_SIDE), MAX_SIZE) : MIN_SIDE);

/** Type a room's or box's size in feet; its top-left corner stays put. */
export function setSize(s: Shape, w: number, h: number): Shape {
  if (s.kind !== 'room' && s.kind !== 'box' && s.kind !== 'ellipse') return s;
  return { ...s, w: clampSide(w), h: clampSide(h) };
}

/** Type a wall's or line's length in feet; its start and direction stay put. */
export function setLength(s: Shape, len: number): Shape {
  if (s.kind !== 'wall' && s.kind !== 'line' && s.kind !== 'gap') return s;
  const L = clampSide(len);
  const d = dist(s.a, s.b);
  const ux = d > 0 ? (s.b.x - s.a.x) / d : 1, uy = d > 0 ? (s.b.y - s.a.y) / d : 0;
  return { ...s, b: { x: s.a.x + ux * L, y: s.a.y + uy * L } };
}

// ── Doors, windows and openings in walls (Fred, 2026-10-06: "can I draw a
// door on a wall in the 3D … delete a portion of the wall or room") ────────

/** How wide each door and window is, in feet (as drawn on the plan). */
export const OPENING_WIDTH: Partial<Record<SymbolKind, number>> = { door: 3, door2: 6, slider: 6, window: 3.2, window2: 6 };
export const DOOR_WIDTH = 3;
export const WINDOW_WIDTH = 3.2;
/** Doors and windows: the symbols that sit in a wall and cut it. */
export const isOpeningSymbol = (k: SymbolKind): boolean => OPENING_WIDTH[k] !== undefined;
/** A doorway (wall above it) or a window (wall below and above it). */
export const openingKindOf = (k: SymbolKind): 'door' | 'window' => (k === 'window' || k === 'window2' ? 'window' : 'door');
/** The doors and windows offered together (Doors & windows in the sketch pad, and in 3D). */
export const OPENING_SYMBOLS: SymbolKind[] = ['door', 'door2', 'slider', 'window', 'window2'];
/** How close (feet) a door, window or opening must be to a wall to sit in it. */
export const WALL_SNAP = 1.5;

export type WallRun = { a: Pt; b: Pt; color: string; shapeId: string; room: boolean; wtype: WallType };

/** Every wall on the plan: the walls drawn on their own, and the four sides of each room. */
export function wallRuns(shapes: Shape[]): WallRun[] {
  const out: WallRun[] = [];
  for (const s of shapes) {
    if (s.kind === 'wall') out.push({ a: s.a, b: s.b, color: s.color, shapeId: s.id, room: false, wtype: s.wtype ?? 'drywall' });
    else if (s.kind === 'room') {
      const c = roomCorners(s);
      c.forEach((a, i) => out.push({ a, b: c[(i + 1) % 4], color: s.color, shapeId: s.id, room: true, wtype: s.wtype ?? 'drywall' }));
    }
  }
  return out;
}

export type OpeningKind = 'door' | 'window' | 'gap';
export type Opening = { a: Pt; b: Pt; kind: OpeningKind; shapeId: string };

/** Each door, window and opening as the stretch of wall it takes up. */
export function openingsOf(shapes: Shape[]): Opening[] {
  const out: Opening[] = [];
  for (const s of shapes) {
    if (s.kind === 'gap') out.push({ a: s.a, b: s.b, kind: 'gap', shapeId: s.id });
    else if (s.kind === 'symbol' && isOpeningSymbol(s.sym)) {
      const { a, b } = openingSegment(s);
      out.push({ a, b, kind: openingKindOf(s.sym), shapeId: s.id });
    }
  }
  return out;
}

export type WallPiece = { a: Pt; b: Pt; kind: 'solid' | 'door' | 'window' };

/**
 * A wall cut up by what sits in it: solid stretches, door and window
 * stretches, and nothing at all where an opening was cut. Only openings lying
 * along the wall count (a door standing across it doesn't cut it).
 */
export function wallPieces(run: { a: Pt; b: Pt }, openings: Opening[], tol = 0.4): WallPiece[] {
  const { a, b } = run;
  const L = dist(a, b);
  if (L < 1e-6) return [];
  const ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
  const along = (p: Pt) => (p.x - a.x) * ux + (p.y - a.y) * uy;
  const off = (p: Pt) => Math.abs((p.x - a.x) * uy - (p.y - a.y) * ux);
  const cuts: { t0: number; t1: number; kind: OpeningKind }[] = [];
  for (const o of openings) {
    if (off(o.a) > tol || off(o.b) > tol) continue;
    const t0 = Math.max(0, Math.min(along(o.a), along(o.b))), t1 = Math.min(L, Math.max(along(o.a), along(o.b)));
    if (t1 - t0 >= 0.05) cuts.push({ t0, t1, kind: o.kind });
  }
  if (cuts.length === 0) return [{ a, b, kind: 'solid' }];
  // Where openings overlap, a cut-out beats a door, and a door beats a window.
  const rank: Record<OpeningKind, number> = { gap: 3, door: 2, window: 1 };
  const stops = [...new Set([0, L, ...cuts.flatMap((c) => [c.t0, c.t1])])].sort((x, y) => x - y);
  const at = (t: number): Pt => ({ x: a.x + ux * t, y: a.y + uy * t });
  const pieces: { t0: number; t1: number; kind: 'solid' | OpeningKind }[] = [];
  for (let i = 1; i < stops.length; i++) {
    const t0 = stops[i - 1], t1 = stops[i];
    if (t1 - t0 < 1e-6) continue;
    const mid = (t0 + t1) / 2;
    const top = cuts.filter((c) => c.t0 <= mid && mid <= c.t1).sort((x, y) => rank[y.kind] - rank[x.kind])[0];
    const kind = top ? top.kind : 'solid';
    const last = pieces[pieces.length - 1];
    if (last && last.kind === kind && Math.abs(last.t1 - t0) < 1e-6) last.t1 = t1;
    else pieces.push({ t0, t1, kind });
  }
  return pieces.filter((p) => p.kind !== 'gap').map((p) => ({ a: at(p.t0), b: at(p.t1), kind: p.kind as WallPiece['kind'] }));
}

/** The nearest wall to p (within maxDist): the point on it and its direction in degrees. */
export function snapToWall(shapes: Shape[], p: Pt, maxDist = WALL_SNAP): { at: Pt; rot: number; run: WallRun } | null {
  let best: { at: Pt; rot: number; run: WallRun; d: number } | null = null;
  for (const run of wallRuns(shapes)) {
    const L = dist(run.a, run.b);
    if (L < 1e-6) continue;
    const ux = (run.b.x - run.a.x) / L, uy = (run.b.y - run.a.y) / L;
    const t = Math.max(0, Math.min(L, (p.x - run.a.x) * ux + (p.y - run.a.y) * uy));
    const at = { x: run.a.x + ux * t, y: run.a.y + uy * t };
    const d = dist(p, at);
    if (d <= maxDist && (!best || d < best.d)) {
      const deg = Math.round((Math.atan2(uy, ux) * 180) / Math.PI);
      best = { at, rot: ((deg % 360) + 360) % 360, run, d };
    }
  }
  return best && { at: best.at, rot: best.rot, run: best.run };
}

/** The stretch of wall a door or window takes up. */
export function openingSegment(s: Extract<Shape, { kind: 'symbol' }>): { a: Pt; b: Pt } {
  const half = (OPENING_WIDTH[s.sym] ?? 0) / 2;
  const r = (s.rot * Math.PI) / 180, ux = Math.cos(r), uy = Math.sin(r);
  return { a: { x: s.at.x - ux * half, y: s.at.y - uy * half }, b: { x: s.at.x + ux * half, y: s.at.y + uy * half } };
}

/** A door or window moved near a wall sits in it, turned to match. */
export function seatInWall(s: Shape, shapes: Shape[]): Shape {
  if (s.kind !== 'symbol' || !isOpeningSymbol(s.sym)) return s;
  const w = snapToWall(shapes, s.at);
  return w ? { ...s, at: w.at, rot: w.rot } : s;
}

/** An opening dragged roughly along a wall, laid exactly on it (or null when no wall is near). */
export function gapOnWall(shapes: Shape[], a: Pt, b: Pt, maxDist = WALL_SNAP): { a: Pt; b: Pt } | null {
  const w = snapToWall(shapes, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, maxDist);
  if (!w) return null;
  const { run } = w;
  const L = dist(run.a, run.b);
  const ux = (run.b.x - run.a.x) / L, uy = (run.b.y - run.a.y) / L;
  const t = (p: Pt) => Math.max(0, Math.min(L, (p.x - run.a.x) * ux + (p.y - run.a.y) * uy));
  const t0 = Math.min(t(a), t(b)), t1 = Math.max(t(a), t(b));
  if (t1 - t0 < 0.5) return null;
  return { a: { x: run.a.x + ux * t0, y: run.a.y + uy * t0 }, b: { x: run.a.x + ux * t1, y: run.a.y + uy * t1 } };
}

/** An opening of a set width, centred on a point of a wall (used when tapping a wall in 3D). */
export function gapAt(shapes: Shape[], p: Pt, width = DOOR_WIDTH): { a: Pt; b: Pt } | null {
  const w = snapToWall(shapes, p);
  if (!w) return null;
  const r = (w.rot * Math.PI) / 180, half = width / 2;
  return { a: { x: w.at.x - Math.cos(r) * half, y: w.at.y - Math.sin(r) * half }, b: { x: w.at.x + Math.cos(r) * half, y: w.at.y + Math.sin(r) * half } };
}

// ── Double-click changes (Fred, 2026-10-06: "I want to double click on the
// line and make alterations") ─────────────────────────────────────────────

/** Split a wall, line or opening in two at the point nearest p (null when p is at an end). */
export function splitAt(s: Shape, p: Pt, newIdFn: () => string = newId): [Shape, Shape] | null {
  if (s.kind !== 'wall' && s.kind !== 'line' && s.kind !== 'gap') return null;
  const L = dist(s.a, s.b);
  if (L < 1) return null;
  const t = ((p.x - s.a.x) * (s.b.x - s.a.x) + (p.y - s.a.y) * (s.b.y - s.a.y)) / (L * L);
  if (t * L < 0.5 || (1 - t) * L < 0.5) return null; // too near an end to make two pieces
  const m = { x: s.a.x + t * (s.b.x - s.a.x), y: s.a.y + t * (s.b.y - s.a.y) };
  return [{ ...s, b: m }, { ...s, id: newIdFn(), a: m }];
}

/** Add a bend to a cable run (or a drawn stroke) at the point nearest p, on its nearest segment. */
export function addBendAt(s: Shape, p: Pt): Shape | null {
  if (s.kind !== 'cable' || s.pts.length < 2) return null;
  let best = { i: 1, d: Infinity, at: s.pts[0] };
  for (let i = 1; i < s.pts.length; i++) {
    const a = s.pts[i - 1], b = s.pts[i];
    const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    const at = { x: a.x + t * dx, y: a.y + t * dy };
    const d = dist(p, at);
    if (d < best.d && t > 0.02 && t < 0.98) best = { i, d, at };
  }
  if (!Number.isFinite(best.d)) return null;
  return { ...s, pts: [...s.pts.slice(0, best.i), best.at, ...s.pts.slice(best.i)] };
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
