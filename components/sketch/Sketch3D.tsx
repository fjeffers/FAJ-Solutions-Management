'use client';
// The 3D model of a sketch (Fred, 2026-10-06: "also 3d model", like
// magicplan's 3D view). Rooms and walls stand up to ceiling height, each
// symbol sits where it really goes — cameras, APs and speakers up high, drops
// and outlets near the floor, the TV on the wall, the rack standing on the
// floor — and cable runs follow the ceiling. One finger (or the mouse) turns
// it, two fingers or the wheel zoom, right-drag pans. Loaded only when opened
// (three.js needs the browser).
//
// Fred, 2026-10-06: "can I draw a door on a wall in the 3D … delete a portion
// of the wall or room". Doors, windows and openings cut real gaps in the walls
// (lib/sketch.ts wallPieces), and the bar under the title lets you tap a wall
// to add a door or window, cut an opening, or remove a stretch of wall.
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { X, Scissors, Box as BoxIcon, RotateCcw, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Plus, Minus, DoorOpen, AppWindow, Eraser, Rotate3d, SquareDashed, Undo2 } from 'lucide-react';
import { OPENING_SYMBOLS, dist, footprint, wallTypeInfo, feet, gapAt, newId, openingsOf, snapToWall, symbolInfo, wallPieces, wallRuns, type Pt, type Shape, type Sketch, type SymbolKind } from '@/lib/sketch';

const CEILING = 9; // ft
const DOOR_TOP = 7; // ft — the wall continues above a doorway
const SILL = 3, WINDOW_TOP = 7; // ft — wall below and above a window

type Mode = 'look' | 'gap' | 'remove' | 'door' | 'door2' | 'slider' | 'window' | 'window2';
const isPlace = (m: Mode): m is 'door' | 'door2' | 'slider' | 'window' | 'window2' => (OPENING_SYMBOLS as string[]).includes(m);
const MODE_HINT: Record<Mode, string> = {
  look: 'Drag to turn · pinch or scroll to zoom · right-drag or two fingers to slide. Walls are 9 ft; cameras, APs and speakers sit at the ceiling.',
  door: 'Tap a wall to put a door there.',
  door2: 'Tap a wall to put a double door there.',
  slider: 'Tap a wall to put a sliding glass door there.',
  window: 'Tap a wall to put a window there.',
  window2: 'Tap a wall to put a wide window there.',
  gap: 'Tap a wall to cut a 3 ft opening there. Make it wider in 2D (drag its ends).',
  remove: 'Tap a door, window, opening or item to remove it. Tap a stretch of wall to take that stretch out.',
};

/** How high each symbol sits, in feet. */
const MOUNT: Partial<Record<SymbolKind, number>> = {
  camera: 8.5, ap: 8.85, speaker: 8.85, drop: 1.5, outlet: 1.25, tv: 5, reader: 4, rack: 0, door: 0, window: 3,
  door2: 0, slider: 0, window2: 3,
  // furniture, bath and kitchen stand on the floor (0, the default)
  // Network gear on its own (not drawn inside a rack) is shown wall-mounted.
  switch: 5, router: 4.5, firewall: 4.5, modem: 4, patch: 5.5, server: 0, nvr: 4, ups: 0, starlink: 11,
  tablet: 4, pos: 3.5, pc: 2.5, printer: 3, phone: 3,
};

function labelSprite(text: string, color = '#0E1B2E'): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const font = 'bold 30px Inter, Arial, sans-serif';
  ctx.font = font;
  const w = Math.min(520, Math.max(80, ctx.measureText(text).width + 28));
  canvas.width = w; canvas.height = 48;
  ctx.font = font;
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.beginPath(); ctx.roundRect(0, 0, w, 48, 12); ctx.fill();
  ctx.fillStyle = color;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, 26, w - 20);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sprite.scale.set(w / 48 * 1.1, 1.1, 1);
  sprite.renderOrder = 10;
  return sprite;
}

/** A wall from a to b (plan feet), from `bottom` up `height` feet. Plan y → 3D z. */
function wallMesh(a: { x: number; y: number }, b: { x: number; y: number }, height: number, color: string, opacity: number, bottom = 0): THREE.Mesh {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const geo = new THREE.BoxGeometry(Math.max(len, 0.01), height, 0.35);
  const mat = new THREE.MeshStandardMaterial({ color, transparent: opacity < 1, opacity, roughness: 0.85 });
  const m = new THREE.Mesh(geo, mat);
  m.position.set((a.x + b.x) / 2, bottom + height / 2, (a.y + b.y) / 2);
  m.rotation.y = -Math.atan2(b.y - a.y, b.x - a.x);
  return m;
}

/** Furniture to size: simple boxes, the right height (table tops at 2.5 ft, seats at 1.5 ft). */
function furnitureObject(s: Extract<Shape, { kind: 'symbol' }>): THREE.Object3D | null {
  const size = footprint(s);
  if (!size) return null;
  const { w, d, h } = size;
  const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x9fc6ea, transparent: true, opacity: 0.3, roughness: 0.1 });
  const cyl = (r: number, ch: number, x: number, y: number, z: number, mat: THREE.Material) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, ch, 20), mat);
    m.position.set(x, y, z);
    g.add(m);
  };
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: new THREE.Color(symbolInfo(s.sym).color), roughness: 0.7 });
  const light = new THREE.MeshStandardMaterial({ color: 0xe8e0d4, roughness: 0.8 });
  const box = (bw: number, bh: number, bd: number, x: number, y: number, z: number, mat: THREE.Material) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), mat);
    m.position.set(x, y, z);
    g.add(m);
  };
  switch (s.sym) {
    case 'table': case 'conftable': case 'desk': {
      box(w, 0.15, d, 0, 2.45, 0, wood);
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(0.15, 2.4, 0.15, x * (w / 2 - 0.2), 1.2, z * (d / 2 - 0.2), wood);
      if (s.sym === 'desk') box(w - 0.4, 1.6, 0.08, 0, 1.4, -d / 2 + 0.2, wood); // modesty panel
      break;
    }
    case 'chair':
      box(w, 0.2, d, 0, 1.5, 0, wood);
      box(w, 1.6, 0.15, 0, 2.3, -d / 2 + 0.08, wood);
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(0.12, 1.4, 0.12, x * (w / 2 - 0.15), 0.7, z * (d / 2 - 0.15), wood);
      break;
    case 'sofa': case 'bench':
      box(w, s.sym === 'sofa' ? 1.4 : 0.25, d, 0, s.sym === 'sofa' ? 0.7 : 1.5, 0, s.sym === 'sofa' ? wood : light);
      box(w, s.sym === 'sofa' ? 1.4 : 1.4, 0.4, 0, s.sym === 'sofa' ? 2.1 : 2.2, -d / 2 + 0.2, wood);
      if (s.sym === 'sofa') { box(0.5, 2, d, -w / 2 + 0.25, 1, 0, wood); box(0.5, 2, d, w / 2 - 0.25, 1, 0, wood); }
      else for (const x of [-1, 1]) box(0.2, 1.4, d * 0.8, x * (w / 2 - 0.3), 0.7, 0, wood);
      break;
    case 'cabinet': box(w, 3, d, 0, 1.5, 0, light); break;
    case 'counter': box(w, 0.15, d, 0, 3.05, 0, wood); box(w, 3, d - 0.2, 0, 1.5, 0.1, light); break;
    case 'shelf': {
      for (const x of [-1, 1]) box(0.08, 6, d, x * (w / 2 - 0.04), 3, 0, light);
      for (let y = 0.3; y <= 6; y += 1.4) box(w, 0.08, d, 0, y, 0, wood);
      break;
    }
    case 'coffee': box(w, 0.12, d, 0, h - 0.06, 0, wood); box(w - 0.3, h - 0.12, d - 0.3, 0, (h - 0.12) / 2, 0, light); break;
    case 'ldesk': box(w, 0.15, 2.5, 0, 2.45, -d / 2 + 1.25, wood); box(2.5, 0.15, d - 2.5, -w / 2 + 1.25, 2.45, 1.25, wood);
      box(0.15, 2.4, 2.3, w / 2 - 0.1, 1.2, -d / 2 + 1.25, wood); box(2.3, 2.4, 0.15, -w / 2 + 1.25, 1.2, d / 2 - 0.1, wood); break;
    case 'cubicle': for (const [bw, bd, x, z] of [[w, 0.2, 0, -d / 2], [0.2, d, -w / 2, 0], [0.2, d, w / 2, 0]] as const) box(bw, h, bd, x, h / 2, z, light);
      box(w - 0.4, 0.12, 2.3, 0, 2.45, -d / 2 + 1.3, wood); break;
    case 'bed': case 'twinbed': box(w, 1.2, d, 0, 0.9, 0, white); box(w, 0.6, d, 0, 0.3, 0, wood); box(w, 3.5, 0.25, 0, 1.75, -d / 2, wood); break;
    case 'toilet': box(w, 1.3, 0.6, 0, 2.2, -d / 2 + 0.3, white); cyl(Math.min(w, d) * 0.38, 1.4, 0, 0.7, 0.2, white); break;
    case 'sink': box(w, 2.6, d, 0, 1.3, 0, light); box(w, 0.15, d, 0, 2.7, 0, white); break;
    case 'urinal': box(w, 2, d, 0, 2.5, 0, white); break;
    case 'tub': box(w, h, d, 0, h / 2, 0, white); break;
    case 'shower': box(w, 0.25, d, 0, 0.12, 0, white); box(w, h, d, 0, h / 2, 0, glass); break;
    case 'stairs': {
      const n = Math.max(2, Math.round(h / 0.6));
      for (let i = 0; i < n; i++) box(w, (h / n) * (i + 1), d / n, 0, ((h / n) * (i + 1)) / 2, d / 2 - (d / n) * (i + 0.5), light);
      break;
    }
    case 'plant': cyl(w * 0.3, 1.2, 0, 0.6, 0, wood); { const leaf = new THREE.Mesh(new THREE.SphereGeometry(w * 0.55, 16, 12), new THREE.MeshStandardMaterial({ color: 0x43a047, roughness: 0.9 })); leaf.position.y = 2.4; g.add(leaf); } break;
    case 'trash': cyl(w / 2, h, 0, h / 2, 0, light); break;
    case 'watercooler': box(w, h - 1, d, 0, (h - 1) / 2, 0, white); cyl(0.45, 1, 0, h - 0.5, 0, glass); break;
    case 'whiteboard': box(w, h, d, 0, 3 + h / 2, 0, white); break;
    default:
      // Reception desk, file cabinet, lockers, dresser, nightstand, fridge, stove, elevator, column: a box its size.
      box(w, h, d, 0, h / 2, 0, s.sym === 'fridge' || s.sym === 'stove' ? white : s.sym === 'column' || s.sym === 'elevator' ? light : wood);
  }
  g.position.set(s.at.x, 0, s.at.y);
  g.rotation.y = -(s.rot * Math.PI) / 180;
  return g;
}

function symbolObject(s: Extract<Shape, { kind: 'symbol' }>): THREE.Object3D {
  const piece = furnitureObject(s);
  if (piece) return piece;
  const info = symbolInfo(s.sym);
  const color = new THREE.Color(info.color);
  const group = new THREE.Group();
  const y = MOUNT[s.sym] ?? 0;
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5 });
  let body: THREE.Mesh;
  switch (s.sym) {
    case 'rack':
      body = new THREE.Mesh(new THREE.BoxGeometry(2, 6.5, 2.5), mat);
      body.position.y = 3.25;
      break;
    case 'camera':
      body = new THREE.Mesh(new THREE.SphereGeometry(0.45, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat);
      body.rotation.x = Math.PI;
      body.position.y = y;
      break;
    case 'ap': case 'speaker':
      body = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.15, 24), s.sym === 'ap' ? new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }) : mat);
      body.position.y = y;
      if (s.sym === 'ap') {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.06, 8, 24), mat);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = y - 0.08;
        group.add(ring);
      }
      break;
    case 'tv':
      body = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.9, 0.15), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3 }));
      body.position.y = y;
      break;
    case 'switch': case 'patch': case 'router': case 'firewall': case 'nvr':
      // Rack-unit-style box with a front face in the item's colour.
      body = new THREE.Mesh(new THREE.BoxGeometry(1.6, s.sym === 'switch' || s.sym === 'patch' ? 0.3 : 0.45, 1.1), mat);
      body.position.y = y;
      break;
    case 'server': case 'ups':
      body = new THREE.Mesh(new THREE.BoxGeometry(1.8, s.sym === 'server' ? 5.5 : 2.2, 2.2), mat);
      body.position.y = s.sym === 'server' ? 2.75 : 1.1;
      break;
    case 'modem':
      body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.9, 0.3), mat);
      body.position.y = y;
      break;
    case 'starlink': {
      body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.12, 1.3), new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.4 }));
      body.position.y = y;
      body.rotation.x = -0.35;
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, y - CEILING + 0.3, 8), mat);
      mast.position.y = (y + CEILING) / 2 - 0.4;
      group.add(mast);
      break;
    }
    case 'tablet':
      body = new THREE.Mesh(new THREE.BoxGeometry(0.85, 1.2, 0.08), new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.3 }));
      body.position.y = y;
      break;
    case 'pos': case 'printer': case 'phone': case 'pc':
      body = new THREE.Mesh(new THREE.BoxGeometry(s.sym === 'pc' ? 0.7 : 1, s.sym === 'pc' ? 1.4 : 0.5, s.sym === 'pc' ? 1.4 : 0.8), mat);
      body.position.y = y;
      break;
    case 'door':
      body = new THREE.Mesh(new THREE.BoxGeometry(3, 7, 0.15), new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.45 }));
      body.position.y = 3.5;
      break;
    case 'door2': {
      // Two leaves, a hair apart.
      body = new THREE.Mesh(new THREE.BoxGeometry(2.95, 7, 0.15), new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.45 }));
      body.position.set(-1.5, 3.5, 0);
      const other = new THREE.Mesh(new THREE.BoxGeometry(2.95, 7, 0.15), new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.45 }));
      other.position.set(1.5, 3.5, 0);
      group.add(other);
      break;
    }
    case 'slider': {
      // Glass in a thin dark frame.
      body = new THREE.Mesh(new THREE.BoxGeometry(6, 7, 0.1), new THREE.MeshStandardMaterial({ color: 0x9fc6ea, transparent: true, opacity: 0.38, roughness: 0.1 }));
      body.position.y = 3.5;
      const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(6, 7, 0.12)), new THREE.LineBasicMaterial({ color: 0x37474f }));
      frame.position.y = 3.5;
      const mullion = new THREE.Mesh(new THREE.BoxGeometry(0.08, 7, 0.14), new THREE.MeshStandardMaterial({ color: 0x37474f }));
      mullion.position.y = 3.5;
      group.add(frame, mullion);
      break;
    }
    case 'window': case 'window2':
      // Glass from the sill (3 ft) to the head (7 ft), where the wall picks up again.
      body = new THREE.Mesh(new THREE.BoxGeometry(s.sym === 'window2' ? 6 : 3.2, 4, 0.12), new THREE.MeshStandardMaterial({ color: 0x9fc6ea, transparent: true, opacity: 0.5 }));
      body.position.y = y + 2;
      break;
    default:
      body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.25), mat);
      body.position.y = y;
  }
  group.add(body);
  // A thin drop line from ceiling items, so it's clear where on the floor they are.
  if (y > 6) {
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, y, 0), new THREE.Vector3(0, 0.02, 0)]),
      new THREE.LineDashedMaterial({ color, dashSize: 0.3, gapSize: 0.25, transparent: true, opacity: 0.5 }));
    line.computeLineDistances();
    group.add(line);
  }
  const tag = labelSprite(`${info.code ? `${info.code} ` : ''}${s.label || info.label}`, info.color);
  tag.position.y = (s.sym === 'rack' ? 7.3 : y) + 1;
  group.add(tag);
  group.position.set(s.at.x, 0, s.at.y);
  group.rotation.y = -(s.rot * Math.PI) / 180;
  return group;
}

export default function Sketch3D({ sketch, title, onClose, onAdd, onRemove, onUndo, canUndo }: {
  sketch: Sketch; title: string; onClose: () => void;
  /** Editing from 3D (the drawing's own add / remove / undo). Without them the model is look-only. */
  onAdd?: (s: Shape) => void; onRemove?: (id: string) => void; onUndo?: () => void; canUndo?: boolean;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [cutaway, setCutaway] = useState(false);
  const [mode, setMode] = useState<Mode>('look');
  const modeRef = useRef<Mode>('look');
  modeRef.current = mode;
  const actions = useRef({ onAdd, onRemove });
  actions.current = { onAdd, onRemove };
  // Each change rebuilds the model; keep looking from the same spot.
  const camSaved = useRef<{ pos: THREE.Vector3; target: THREE.Vector3 } | null>(null);
  const editable = !!onAdd && !!onRemove;
  const resetRef = useRef<() => void>(() => {});
  // The arrow pad and zoom buttons (Fred, 2026-10-06: "navigation bars up and down, left and right").
  const panRef = useRef<(right: number, forward: number) => void>(() => {});
  const zoomRef = useRef<(factor: number) => void>(() => {});

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const W = sketch.width, D = sketch.height;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf2efe9);
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 5000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.touchAction = 'none';

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI / 2.05;
    const home = () => {
      const span = Math.max(W, D);
      camera.position.set(W / 2 + span * 0.2, span * 0.55, D + span * 0.3);
      controls.target.set(W / 2, 0, D / 2);
      controls.update();
    };
    if (camSaved.current) {
      camera.position.copy(camSaved.current.pos);
      controls.target.copy(camSaved.current.target);
      controls.update();
    } else home();
    resetRef.current = home;
    const step = Math.max(W, D) * 0.12;
    panRef.current = (right, forward) => {
      // Slide along the ground, relative to where the camera is looking.
      const fwd = new THREE.Vector3().subVectors(controls.target, camera.position).setY(0).normalize();
      const side = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
      const move = side.multiplyScalar(right * step).add(fwd.multiplyScalar(forward * step));
      camera.position.add(move);
      controls.target.add(move);
      controls.update();
    };
    zoomRef.current = (factor) => {
      const offset = new THREE.Vector3().subVectors(camera.position, controls.target).multiplyScalar(factor);
      camera.position.copy(controls.target).add(offset);
      controls.update();
    };

    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const sun = new THREE.DirectionalLight(0xffffff, 1.0);
    sun.position.set(W * 0.7, 60, D * 0.2);
    scene.add(sun);

    // Floor with a 5-ft grid.
    const floor = new THREE.Mesh(new THREE.BoxGeometry(W, 0.2, D), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }));
    floor.position.set(W / 2, -0.1, D / 2);
    scene.add(floor);
    // A 5-ft grid over exactly the plan area (not a square that spills past it).
    const gridPts: THREE.Vector3[] = [];
    for (let x = 0; x <= W + 0.001; x += 5) gridPts.push(new THREE.Vector3(x, 0.01, 0), new THREE.Vector3(x, 0.01, D));
    for (let z = 0; z <= D + 0.001; z += 5) gridPts.push(new THREE.Vector3(0, 0.01, z), new THREE.Vector3(W, 0.01, z));
    scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(gridPts), new THREE.LineBasicMaterial({ color: 0xd5dbe3 })));

    const wallH = cutaway ? 3 : CEILING;
    // Walls (drawn ones and room sides), cut around doors, windows and openings.
    const openings = openingsOf(sketch.shapes);
    for (const run of wallRuns(sketch.shapes)) {
      // Each wall type its own colour and height (a half wall stops at 3½ ft, a cubicle panel at 5).
      const t = wallTypeInfo(run.wtype);
      const color = t.type === 'drywall' && run.room ? '#e9e4da' : t.color3d;
      const opacity = t.opacity < 1 ? t.opacity : run.room && !cutaway && t.type === 'drywall' ? 0.92 : 1;
      const top = Math.min(t.height ?? CEILING, wallH);
      for (const p of wallPieces(run, openings)) {
        const parts: [number, number][] = p.kind === 'solid' ? [[0, top]]
          : p.kind === 'door' ? [[DOOR_TOP, top]]
          : [[0, Math.min(SILL, top)], [WINDOW_TOP, top]];
        for (const [lo, hi] of parts) {
          if (hi - lo < 0.05) continue;
          const m = wallMesh(p.a, p.b, hi - lo, color, opacity, lo);
          m.userData = { wall: true, run, piece: p };
          scene.add(m);
        }
      }
    }
    for (const s of sketch.shapes) {
      if (s.kind === 'room') {
        const c = s.color;
        const tint = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.h), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.08 }));
        tint.rotation.x = -Math.PI / 2;
        // A turned room's floor turns with it (its walls come from wallRuns, already turned).
        const floorOf = new THREE.Group();
        floorOf.position.set(s.x + s.w / 2, 0.03, s.y + s.h / 2);
        floorOf.rotation.y = -((s.rot ?? 0) * Math.PI) / 180;
        floorOf.add(tint);
        scene.add(floorOf);
        const tag = labelSprite(`${s.name || 'Room'} · ${feet(s.w)} × ${feet(s.h)}`);
        tag.position.set(s.x + s.w / 2, 0.8, s.y + s.h / 2);
        scene.add(tag);
      } else if (s.kind === 'gap') {
        // A gold strip on the floor marks where wall was taken out (tap it in Remove to put the wall back).
        const strip = wallMesh(s.a, s.b, 0.04, '#C9A24B', 0.8, 0.01);
        strip.userData = { shapeId: s.id };
        scene.add(strip);
      } else if (s.kind === 'symbol') {
        const o = symbolObject(s);
        o.userData = { shapeId: s.id };
        scene.add(o);
      } else if (s.kind === 'cable' && s.pts.length >= 2) {
        const path = new THREE.CurvePath<THREE.Vector3>();
        for (let i = 1; i < s.pts.length; i++) {
          path.add(new THREE.LineCurve3(new THREE.Vector3(s.pts[i - 1].x, CEILING - 0.3, s.pts[i - 1].y), new THREE.Vector3(s.pts[i].x, CEILING - 0.3, s.pts[i].y)));
        }
        const tube = new THREE.Mesh(new THREE.TubeGeometry(path, Math.max(8, s.pts.length * 8), 0.09, 8, false),
          new THREE.MeshStandardMaterial({ color: s.color, roughness: 0.6 }));
        tube.userData = { shapeId: s.id };
        scene.add(tube);
      } else if (s.kind === 'photo') {
        const tag = labelSprite('📷 Photo');
        tag.position.set(s.at.x, 6, s.at.y);
        scene.add(tag);
      } else if (s.kind === 'pen' || s.kind === 'line') {
        // Markings stay on the floor, as on the plan.
        const pts = s.kind === 'pen' ? s.pts : [s.a, s.b];
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(p.x, 0.05, p.y))),
          new THREE.LineBasicMaterial({ color: s.color }));
        scene.add(line);
      } else if (s.kind === 'box' || s.kind === 'ellipse') {
        const shape = s.kind === 'box'
          ? new THREE.EdgesGeometry(new THREE.PlaneGeometry(s.w, s.h))
          : new THREE.EdgesGeometry(new THREE.CircleGeometry(0.5, 40));
        const outline = new THREE.LineSegments(shape, new THREE.LineBasicMaterial({ color: s.color }));
        outline.rotation.x = -Math.PI / 2;
        if (s.kind === 'ellipse') outline.scale.set(s.w, s.h, 1);
        outline.position.set(s.x + s.w / 2, 0.05, s.y + s.h / 2);
        scene.add(outline);
      } else if (s.kind === 'text') {
        const tag = labelSprite(s.text.slice(0, 40), s.color);
        tag.position.set(s.at.x, 0.6, s.at.y);
        scene.add(tag);
      }
    }

    const resize = () => {
      const w = mount.clientWidth, h = mount.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    // Tapping (not dragging) in an edit mode: find what's under the finger.
    const raycaster = new THREE.Raycaster();
    let downAt: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => { downAt = { x: e.clientX, y: e.clientY }; };
    const onUp = (e: PointerEvent) => {
      const m = modeRef.current;
      if (m === 'look' || !downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6) return;
      const { onAdd: add, onRemove: remove } = actions.current;
      if (!add || !remove) return;
      const r = renderer.domElement.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      const hits = raycaster.intersectObjects(scene.children, true);
      const tagged = (o: THREE.Object3D | null): Record<string, unknown> | null => {
        for (let x = o; x; x = x.parent) if (x.userData && (x.userData.wall || x.userData.shapeId)) return x.userData;
        return null;
      };
      for (const h of hits) {
        const data = tagged(h.object);
        if (!data) continue;
        const p: Pt = { x: h.point.x, y: h.point.z };
        if (m === 'remove') {
          if (typeof data.shapeId === 'string') { remove(data.shapeId); return; }
          const piece = data.piece as { a: Pt; b: Pt; kind: string };
          const run = data.run as { shapeId: string; room: boolean; a: Pt; b: Pt };
          if (piece.kind !== 'solid') {
            // The wall above a door or around a window: remove that door or window.
            const mid = { x: (piece.a.x + piece.b.x) / 2, y: (piece.a.y + piece.b.y) / 2 };
            const o = openings.filter((x) => x.kind !== 'gap').sort((x, y) => dist(mid, { x: (x.a.x + x.b.x) / 2, y: (x.a.y + x.b.y) / 2 }) - dist(mid, { x: (y.a.x + y.b.x) / 2, y: (y.a.y + y.b.y) / 2 }))[0];
            if (o) remove(o.shapeId);
            return;
          }
          // A drawn wall with nothing in it goes altogether; otherwise take out just this stretch.
          const whole = !run.room && dist(piece.a, run.a) < 0.01 && dist(piece.b, run.b) < 0.01;
          if (whole) remove(run.shapeId);
          else add({ id: newId(), kind: 'gap', a: piece.a, b: piece.b });
          return;
        }
        if (!data.wall) return; // add modes work on walls only
        if (m === 'gap') {
          const g = gapAt(sketch.shapes, p);
          if (g) add({ id: newId(), kind: 'gap', ...g });
        } else if (isPlace(m)) {
          const w = snapToWall(sketch.shapes, p);
          if (w) add({ id: newId(), kind: 'symbol', sym: m, at: w.at, rot: w.rot, label: '' });
        }
        return;
      }
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);

    let raf = 0;
    const tick = () => { controls.update(); renderer.render(scene, camera); raf = requestAnimationFrame(tick); };
    tick();

    return () => {
      camSaved.current = { pos: camera.position.clone(), target: controls.target.clone() };
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose?.();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((x) => { (x as THREE.SpriteMaterial).map?.dispose?.(); x.dispose(); });
      });
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, [sketch, cutaway]);

  const pad: React.CSSProperties = { width: 38, height: 38, borderRadius: 10, border: '1px solid #d8dde5', background: 'rgba(255,255,255,0.95)', color: '#0E1B2E', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 2px 6px rgba(0,0,0,0.12)' };
  const side: React.CSSProperties = { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, width: '100%', padding: '8px 2px', borderRadius: 8, border: 'none', background: 'transparent', color: '#fff', fontWeight: 700, fontSize: 10, lineHeight: 1.15, textAlign: 'center', cursor: 'pointer', flexShrink: 0 };
  const btn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.3)', background: 'transparent', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' };
  return (
    <div role="dialog" aria-modal="true" aria-label="3D model" style={{ position: 'fixed', inset: 0, zIndex: 320, display: 'flex', flexDirection: 'column', background: '#f2efe9' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: '#0E1B2E', color: '#fff' }}>
        <button type="button" onClick={onClose} aria-label="Back to the drawing" style={btn}><X size={16} /> 2D</button>
        <div style={{ flex: 1, minWidth: 0, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}><BoxIcon size={15} style={{ verticalAlign: -2 }} /> {title} — 3D</div>
        <button type="button" onClick={() => setCutaway((v) => !v)} aria-pressed={cutaway} style={{ ...btn, background: cutaway ? '#C9A24B' : 'transparent', color: cutaway ? '#0E1B2E' : '#fff' }}><Scissors size={15} /> Cut away</button>
        <button type="button" onClick={() => resetRef.current()} aria-label="Back to the starting view" style={btn}><RotateCcw size={15} /></button>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
      {/* Edit tools down the left (Fred, 2026-10-06: "menu bar to the left") */}
      {editable && (
        <nav style={{ width: 78, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 4px', background: '#13284A', overflowY: 'auto' }} aria-label="Edit in 3D">
          {([
            ['look', 'Look around', <Rotate3d key="i" size={17} />],
            ['door', 'Door', <DoorOpen key="i" size={17} />],
            ['door2', 'Double door', <DoorOpen key="i" size={17} />],
            ['slider', 'Sliding glass', <DoorOpen key="i" size={17} />],
            ['window', 'Window', <AppWindow key="i" size={17} />],
            ['window2', 'Wide window', <AppWindow key="i" size={17} />],
            ['gap', 'Cut opening', <SquareDashed key="i" size={17} />],
            ['remove', 'Remove', <Eraser key="i" size={17} />],
          ] as [Mode, string, React.ReactNode][]).map(([m, label, icon]) => (
            <button key={m} type="button" onClick={() => setMode(m)} aria-pressed={mode === m}
              style={{ ...side, background: mode === m ? '#C9A24B' : 'transparent', color: mode === m ? '#0E1B2E' : '#fff' }}>
              {icon}<span>{label}</span>
            </button>
          ))}
          <button type="button" onClick={onUndo} disabled={!canUndo} aria-label="Undo"
            style={{ ...side, opacity: canUndo ? 1 : 0.4, cursor: canUndo ? 'pointer' : 'default' }}><Undo2 size={16} /><span>Undo</span></button>
        </nav>
      )}
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, position: 'relative' }}>
        <div ref={mountRef} style={{ position: 'absolute', inset: 0, cursor: mode === 'look' ? 'grab' : 'crosshair' }} />
        <div style={{ position: 'absolute', left: 10, bottom: 10, display: 'grid', gridTemplateColumns: 'repeat(3, 38px)', gridTemplateRows: 'repeat(3, 38px)', gap: 4 }} aria-label="Move around">
          <span />
          <button type="button" onClick={() => panRef.current(0, 1)} aria-label="Move forward" style={pad}><ChevronUp size={20} /></button>
          <span />
          <button type="button" onClick={() => panRef.current(-1, 0)} aria-label="Move left" style={pad}><ChevronLeft size={20} /></button>
          <button type="button" onClick={() => resetRef.current()} aria-label="Back to the starting view" style={pad}><RotateCcw size={16} /></button>
          <button type="button" onClick={() => panRef.current(1, 0)} aria-label="Move right" style={pad}><ChevronRight size={20} /></button>
          <span />
          <button type="button" onClick={() => panRef.current(0, -1)} aria-label="Move back" style={pad}><ChevronDown size={20} /></button>
          <span />
        </div>
        <div style={{ position: 'absolute', right: 10, bottom: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button type="button" onClick={() => zoomRef.current(0.8)} aria-label="Zoom in" style={pad}><Plus size={18} /></button>
          <button type="button" onClick={() => zoomRef.current(1.25)} aria-label="Zoom out" style={pad}><Minus size={18} /></button>
        </div>
      </div>
      </div>
      <div style={{ padding: '6px 12px', fontSize: 12, color: mode === 'look' ? '#455A64' : '#0E1B2E', fontWeight: mode === 'look' ? 400 : 700, background: mode === 'look' ? '#fff' : '#FBF5E6', borderTop: '1px solid #e2e6ec' }}>
        {MODE_HINT[mode]}
      </div>
    </div>
  );
}
