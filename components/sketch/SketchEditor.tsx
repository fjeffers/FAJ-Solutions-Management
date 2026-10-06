'use client';
// The sketch pad (Fred, 2026-10-06: "I want to be able to sketch my own
// layout" — magicplan for the floor plan, sketch.io for the drawing). A plan
// in feet on a 1-ft grid: rooms show their size and square footage, walls and
// cable runs their length, symbols are counted, photos pin to a spot; plus a
// pen, marker, lines, arrows, boxes, circles and text. Works with a finger
// (two fingers pan and zoom) or a mouse (wheel zooms). The rules and every
// measurement are in lib/sketch.ts; this file only draws and edits.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  ArrowUpRight, Camera, Circle, Eraser, Grid3x3, Hand, Highlighter, Image as ImageIcon, Magnet, Minus, MousePointer2,
  Pencil, Plus, Redo2, Save, Square, Trash2, Type, Undo2, X, Maximize, Cable, BrickWall, LayoutPanelTop, Loader2, Box,
  Move, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, DoorOpen, DoorClosed, AppWindow, SquareDashed,
} from 'lucide-react';
import {
  CABLE_TYPES, COLORS, OPENING_SYMBOLS, WALL_TYPES, addBendAt, footprint, splitAt, wallTypeInfo, type WallType, OPENING_WIDTH, isFurniture, SYMBOLS, SYMBOL_GROUPS, cableInfo, dragHandle, feet, gapOnWall, isOpeningSymbol, snapToWall, handlesOf, hitTest, midpoint, moveShape, newId, normalizeSketch, openingsOf, pathLength, roomFromCorners, seatInWall, setLength, setSize, snapPt, wallPieces,
  sqft, summarize, symbolInfo, type CableType, type Pt, type Shape, type Sketch, type SymbolKind,
} from '@/lib/sketch';

// The 3D model (Fred, 2026-10-06: "also 3d model") — three.js, loaded only when opened.
const Sketch3D = dynamic(() => import('./Sketch3D'), { ssr: false });

type Tool = 'select' | 'hand' | 'moveall' | 'opening' | 'doors' | 'pen' | 'marker' | 'line' | 'arrow' | 'box' | 'ellipse' | 'text'
  | 'room' | 'wall' | 'cable' | 'symbol' | 'photo' | 'eraser';

const TOOLS: { tool: Tool; label: string; icon: React.ReactNode; group: 'plan' | 'draw' | 'edit' }[] = [
  { tool: 'select', label: 'Select / move', icon: <MousePointer2 size={18} />, group: 'edit' },
  { tool: 'hand', label: 'Pan', icon: <Hand size={18} />, group: 'edit' },
  // Fred, 2026-10-06: "select and move the site around" — drag everything at once.
  { tool: 'moveall', label: 'Move all', icon: <Move size={18} />, group: 'edit' },
  { tool: 'room', label: 'Room', icon: <LayoutPanelTop size={18} />, group: 'plan' },
  // Drywall, exterior, block, brick, concrete, glass, half wall, partition, fire-rated (WALL_TYPES).
  { tool: 'wall', label: 'Walls', icon: <BrickWall size={18} />, group: 'plan' },
  // Fred, 2026-10-06: "where are the windows, doors, glass".
  { tool: 'doors', label: 'Doors & windows', icon: <DoorClosed size={18} />, group: 'plan' },
  // Fred, 2026-10-06: "delete a portion of the wall or room".
  { tool: 'opening', label: 'Opening', icon: <SquareDashed size={18} />, group: 'plan' },
  { tool: 'cable', label: 'Cable run', icon: <Cable size={18} />, group: 'plan' },
  { tool: 'symbol', label: 'Symbol', icon: <Plus size={18} />, group: 'plan' },
  { tool: 'photo', label: 'Photo pin', icon: <Camera size={18} />, group: 'plan' },
  { tool: 'pen', label: 'Pen', icon: <Pencil size={18} />, group: 'draw' },
  { tool: 'marker', label: 'Marker', icon: <Highlighter size={18} />, group: 'draw' },
  { tool: 'line', label: 'Line', icon: <Minus size={18} />, group: 'draw' },
  { tool: 'arrow', label: 'Arrow', icon: <ArrowUpRight size={18} />, group: 'draw' },
  { tool: 'box', label: 'Box', icon: <Square size={18} />, group: 'draw' },
  { tool: 'ellipse', label: 'Circle', icon: <Circle size={18} />, group: 'draw' },
  { tool: 'text', label: 'Text', icon: <Type size={18} />, group: 'draw' },
  { tool: 'eraser', label: 'Eraser', icon: <Eraser size={18} />, group: 'edit' },
];
const WIDTHS = [{ label: 'Thin', w: 0.08 }, { label: 'Medium', w: 0.18 }, { label: 'Thick', w: 0.4 }];
const LABEL = 0.75; // label text height, feet

type Draft =
  | { kind: 'drag'; tool: Tool; a: Pt; b: Pt }
  | { kind: 'stroke'; tool: 'pen' | 'marker'; pts: Pt[] }
  | { kind: 'cable'; pts: Pt[]; hover: Pt | null }
  | null;

export type SketchEditorProps = {
  title: string;
  initial: Sketch;
  /** Save the drawing, its title and a PNG of the plan. Returns an error to show, or null. */
  onSave: (sketch: Sketch, title: string, png: Blob | null) => Promise<string | null>;
  onClose: () => void;
  /** Store a photo (a photo pin or a floor plan to trace over); returns its path. */
  uploadFile: (file: Blob, kind: 'photo' | 'bg') => Promise<string | null>;
  /** A link to show a stored file. */
  fileUrl: (path: string) => Promise<string | null>;
};

export default function SketchEditor({ title: initialTitle, initial, onSave, onClose, uploadFile, fileUrl }: SketchEditorProps) {
  const [sketch, setSketch] = useState<Sketch>(() => normalizeSketch(initial));
  const [past, setPast] = useState<Sketch[]>([]);
  const [future, setFuture] = useState<Sketch[]>([]);
  const [title, setTitle] = useState(initialTitle);
  const [dirty, setDirty] = useState(false);
  const [tool, setTool] = useState<Tool>('room');
  const [sym, setSym] = useState<SymbolKind>('camera');
  const [doorKind, setDoorKind] = useState<SymbolKind>('door');
  const [wallType, setWallType] = useState<WallType>('drywall');
  // Symbol picker: one group at a time, so nothing is lost off the end of the row.
  const [symGroup, setSymGroup] = useState<(typeof SYMBOL_GROUPS)[number]['group']>('network');
  const [cableType, setCableType] = useState<CableType>('cat6');
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(WIDTHS[1].w);
  const [fill, setFill] = useState(false);
  const [snapOn, setSnapOn] = useState(true);
  const [gridOn, setGridOn] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busyUpload, setBusyUpload] = useState(false);
  // Details start open on a computer, closed on a phone (the plan needs the room).
  const [showPanel, setShowPanel] = useState(true);
  const [show3d, setShow3d] = useState(false);
  useEffect(() => { if (window.innerWidth < 900) setShowPanel(false); }, []);
  const [view, setView] = useState(() => ({ x: -2, y: -2, w: normalizeSketch(initial).width + 4 }));

  const svgRef = useRef<SVGSVGElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [aspect, setAspect] = useState(0.6);
  const photoInput = useRef<HTMLInputElement | null>(null);
  const bgInput = useRef<HTMLInputElement | null>(null);
  const pendingPhotoAt = useRef<Pt | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  // Double-click or double-tap anything to change it (Fred, 2026-10-06): it's
  // selected, its details open, and where you clicked is kept for Split here /
  // Add a bend here.
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  const [editPoint, setEditPoint] = useState<{ id: string; at: Pt } | null>(null);
  const gesture = useRef<{ kind: 'pan'; from: { x: number; y: number }; view: typeof view } | { kind: 'pinch'; d0: number; mid0: Pt; view: typeof view } | { kind: 'move'; id: string; from: Pt; base: Shape; moved: boolean } | { kind: 'moveall'; from: Pt; base: Shape[]; moved: boolean } | { kind: 'handle'; id: string; handle: string; base: Shape; moved: boolean } | null>(null);

  const viewH = view.w * aspect;
  const summary = useMemo(() => summarize(sketch), [sketch]);
  const selected = sketch.shapes.find((s) => s.id === selectedId) ?? null;
  // Doors, windows and cut-outs, which break up the walls they sit in.
  const openings = useMemo(() => openingsOf(sketch.shapes), [sketch.shapes]);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(null), 4000); return () => clearTimeout(t); }, [notice]);

  // Keep the drawing area's shape in step with the window.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => { if (el.clientWidth > 0) setAspect(el.clientHeight / el.clientWidth); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Links for the floor-plan photo and photo pins.
  useEffect(() => {
    const paths = [sketch.bg?.path, ...sketch.shapes.filter((s) => s.kind === 'photo').map((s) => (s as Extract<Shape, { kind: 'photo' }>).path)]
      .filter((p): p is string => !!p && !urls[p]);
    if (paths.length === 0) return;
    void Promise.all(paths.map(async (p) => [p, await fileUrl(p)] as const)).then((pairs) => {
      setUrls((u) => ({ ...u, ...Object.fromEntries(pairs.filter(([, v]) => !!v) as [string, string][]) }));
    });
  }, [sketch, urls, fileUrl]);

  const commit = useCallback((next: Sketch) => {
    setPast((p) => [...p.slice(-99), sketch]);
    setFuture([]);
    setSketch(next);
    setDirty(true);
  }, [sketch]);
  const addShape = (s: Shape) => commit({ ...sketch, shapes: [...sketch.shapes, s] });
  const updateShape = (id: string, patch: Partial<Shape>) =>
    commit({ ...sketch, shapes: sketch.shapes.map((s) => (s.id === id ? ({ ...s, ...patch } as Shape) : s)) });
  const removeShape = (id: string) => { commit({ ...sketch, shapes: sketch.shapes.filter((s) => s.id !== id) }); setSelectedId(null); };
  const undo = () => { if (!past.length) return; setFuture((f) => [sketch, ...f]); setSketch(past[past.length - 1]); setPast((p) => p.slice(0, -1)); setDirty(true); setSelectedId(null); };
  const redo = () => { if (!future.length) return; setPast((p) => [...p, sketch]); setSketch(future[0]); setFuture((f) => f.slice(1)); setDirty(true); };

  const toWorld = (clientX: number, clientY: number): Pt => {
    const svg = svgRef.current!;
    const r = svg.getBoundingClientRect();
    return { x: view.x + ((clientX - r.left) / r.width) * view.w, y: view.y + ((clientY - r.top) / r.height) * viewH };
  };
  const snapIf = (p: Pt, plan: boolean) => (snapOn && plan ? snapPt(p, 0.5) : p);

  const zoomAt = (factor: number, at?: Pt) => {
    setView((v) => {
      const w = Math.min(Math.max(v.w * factor, 4), 800);
      const c = at ?? { x: v.x + v.w / 2, y: v.y + (v.w * aspect) / 2 };
      return { x: c.x - ((c.x - v.x) * w) / v.w, y: c.y - ((c.y - v.y) * w) / v.w, w };
    });
  };
  const fit = () => setView({ x: -2, y: -2, w: Math.max(sketch.width, sketch.height / aspect) + 4 });
  /** Slide the view: the arrow pad and arrow keys (Fred, 2026-10-06: "navigation bars up and down, left and right"). */
  const panBy = (fx: number, fy: number) => setView((v) => ({ ...v, x: v.x + v.w * fx, y: v.y + v.w * aspect * fy }));
  /** Nudge the selected item (arrow keys), as one undo step. */
  const nudge = (id: string, dx: number, dy: number) => commit({ ...sketch, shapes: sketch.shapes.map((s) => (s.id === id ? moveShape(s, dx, dy) : s)) });

  // ── Pointer handling ──────────────────────────────────────────────────────
  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      // Two fingers: pan and zoom, whatever the tool.
      const [a, b] = [...pointers.current.values()];
      setDraft(null);
      gesture.current = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y), mid0: toWorld((a.x + b.x) / 2, (a.y + b.y) / 2), view };
      return;
    }
    const raw = toWorld(e.clientX, e.clientY);
    {
      const now = performance.now(), last = lastTap.current;
      lastTap.current = { t: now, x: e.clientX, y: e.clientY };
      // Tools that put something down on each tap keep doing that.
      const places = tool === 'symbol' || tool === 'doors' || tool === 'text' || tool === 'photo' || tool === 'cable';
      if (!places && last && now - last.t < 380 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 14) {
        const hit = hitTest(sketch.shapes, raw, view.w / 50);
        if (hit) {
          lastTap.current = null;
          gesture.current = null;
          setDraft(null);
          setTool('select');
          setSelectedId(hit.id);
          setEditPoint({ id: hit.id, at: raw });
          setShowPanel(true);
          return;
        }
      }
    }
    const plan = tool === 'room' || tool === 'wall' || tool === 'cable' || tool === 'symbol' || tool === 'opening' || tool === 'doors';
    const p = snapIf(raw, plan || tool === 'line' || tool === 'arrow' || tool === 'box');

    if (tool === 'hand' || e.button === 1) { gesture.current = { kind: 'pan', from: { x: e.clientX, y: e.clientY }, view }; return; }
    if (tool === 'moveall') { gesture.current = { kind: 'moveall', from: raw, base: sketch.shapes, moved: false }; return; }
    if (tool === 'select') {
      // A grab point of the selected item first: resize a room, move a wall's end.
      if (selected) {
        const grab = handlesOf(selected).find((h) => Math.hypot(h.at.x - raw.x, h.at.y - raw.y) <= view.w / 45);
        if (grab) { gesture.current = { kind: 'handle', id: selected.id, handle: grab.id, base: selected, moved: false }; return; }
      }
      const hit = hitTest(sketch.shapes, raw, view.w / 60);
      setSelectedId(hit?.id ?? null);
      gesture.current = hit
        ? { kind: 'move', id: hit.id, from: raw, base: hit, moved: false }
        : { kind: 'pan', from: { x: e.clientX, y: e.clientY }, view };
      return;
    }
    if (tool === 'eraser') {
      const hit = hitTest(sketch.shapes, raw, view.w / 60);
      if (hit) removeShape(hit.id);
      return;
    }
    if (tool === 'pen' || tool === 'marker') { setDraft({ kind: 'stroke', tool, pts: [raw] }); return; }
    if (tool === 'cable') {
      setDraft((d) => (d?.kind === 'cable' ? { ...d, pts: [...d.pts, p] } : { kind: 'cable', pts: [p], hover: p }));
      return;
    }
    if (tool === 'doors') {
      // Tapped on (or near) a wall: the door or window sits in it, turned to match.
      const s: Shape = seatInWall({ id: newId(), kind: 'symbol', sym: doorKind, at: p, label: '', rot: 0 }, sketch.shapes);
      addShape(s);
      setSelectedId(s.id);
      if (!snapToWall(sketch.shapes, p)) setNotice('That one isn\u2019t on a wall. Drag it onto a wall, or tap right on the wall line.');
      return;
    }
    if (tool === 'symbol') {
      // A door or window tapped near a wall sits in it, turned to match.
      const s: Shape = seatInWall({ id: newId(), kind: 'symbol', sym, at: p, label: '', rot: 0 }, sketch.shapes);
      addShape(s);
      setSelectedId(s.id);
      return;
    }
    if (tool === 'text') {
      const text = window.prompt('Text to place here:');
      if (text && text.trim()) addShape({ id: newId(), kind: 'text', at: raw, text: text.trim(), color, size: 1.2 });
      return;
    }
    if (tool === 'photo') {
      pendingPhotoAt.current = p;
      photoInput.current?.click();
      return;
    }
    setDraft({ kind: 'drag', tool, a: p, b: p });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (g?.kind === 'pinch' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const w = Math.min(Math.max((g.view.w * g.d0) / d, 4), 800);
      const svg = svgRef.current!;
      const r = svg.getBoundingClientRect();
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      setView({ x: g.mid0.x - ((mx - r.left) / r.width) * w, y: g.mid0.y - ((my - r.top) / r.height) * w * aspect, w });
      return;
    }
    if (g?.kind === 'pan') {
      const svg = svgRef.current!;
      const r = svg.getBoundingClientRect();
      const k = g.view.w / r.width;
      setView({ ...g.view, x: g.view.x - (e.clientX - g.from.x) * k, y: g.view.y - (e.clientY - g.from.y) * k });
      return;
    }
    const raw = toWorld(e.clientX, e.clientY);
    if (g?.kind === 'moveall') {
      let dx = raw.x - g.from.x, dy = raw.y - g.from.y;
      if (snapOn) { dx = Math.round(dx * 2) / 2; dy = Math.round(dy * 2) / 2; }
      if (dx || dy || g.moved) {
        g.moved = true;
        setSketch((s) => ({ ...s, shapes: g.base.map((x) => moveShape(x, dx, dy)) }));
      }
      return;
    }
    if (g?.kind === 'handle') {
      g.moved = true;
      const p = snapOn ? snapPt(raw, 0.5) : raw;
      setSketch((s) => ({ ...s, shapes: s.shapes.map((x) => (x.id === g.id ? dragHandle(g.base, g.handle, p) : x)) }));
      return;
    }
    if (g?.kind === 'move') {
      let dx = raw.x - g.from.x, dy = raw.y - g.from.y;
      if (snapOn) { dx = Math.round(dx * 2) / 2; dy = Math.round(dy * 2) / 2; }
      if (dx || dy || g.moved) {
        g.moved = true;
        setSketch((s) => ({ ...s, shapes: s.shapes.map((x) => (x.id === g.id ? seatInWall(moveShape(g.base, dx, dy), s.shapes) : x)) }));
      }
      return;
    }
    if (!draft) return;
    if (draft.kind === 'stroke') {
      const last = draft.pts[draft.pts.length - 1];
      if (Math.hypot(raw.x - last.x, raw.y - last.y) > view.w / 400) setDraft({ ...draft, pts: [...draft.pts, raw] });
    } else if (draft.kind === 'drag') {
      setDraft({ ...draft, b: snapIf(raw, draft.tool !== 'ellipse') });
    } else if (draft.kind === 'cable') {
      setDraft({ ...draft, hover: snapIf(raw, true) });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if ((g?.kind === 'move' || g?.kind === 'handle') && g.moved) {
      // Record the move as one step, so Undo puts it back.
      const moved = sketch.shapes.find((s) => s.id === g.id);
      if (moved) { setPast((p) => [...p.slice(-99), { ...sketch, shapes: sketch.shapes.map((s) => (s.id === g.id ? g.base : s)) }]); setFuture([]); setDirty(true); }
    }
    if (g?.kind === 'moveall' && g.moved) {
      setPast((p) => [...p.slice(-99), { ...sketch, shapes: g.base }]); setFuture([]); setDirty(true);
    }
    if (pointers.current.size === 0) gesture.current = null;
    if (!draft) return;
    if (draft.kind === 'stroke') {
      if (draft.pts.length >= 2) addShape({ id: newId(), kind: 'pen', pts: draft.pts, color: draft.tool === 'marker' ? (color === COLORS[0] ? '#C9A24B' : color) : color, width: draft.tool === 'marker' ? Math.max(width * 4, 0.6) : width, marker: draft.tool === 'marker' });
      setDraft(null);
    } else if (draft.kind === 'drag') {
      const { tool: t, a, b } = draft;
      const r = roomFromCorners(a, b);
      if (t === 'room' && r.w >= 1 && r.h >= 1) {
        const n = sketch.shapes.filter((s) => s.kind === 'room').length + 1;
        const s: Shape = { id: newId(), kind: 'room', ...r, name: `Room ${n}`, color };
        addShape(s); setSelectedId(s.id);
      } else if ((t === 'box' || t === 'ellipse') && r.w >= 0.3 && r.h >= 0.3) {
        addShape({ id: newId(), kind: t, ...r, color, width, fill });
      } else if (t === 'wall' && Math.hypot(b.x - a.x, b.y - a.y) >= 0.5) {
        addShape({ id: newId(), kind: 'wall', a, b, color, ...(wallType !== 'drywall' && { wtype: wallType }) });
      } else if (t === 'opening') {
        const gap = gapOnWall(sketch.shapes, a, b);
        if (gap) { const s: Shape = { id: newId(), kind: 'gap', ...gap }; addShape(s); setSelectedId(s.id); }
        else setNotice("Drag along a wall or a room's side to take that stretch of wall out.");
      } else if ((t === 'line' || t === 'arrow') && Math.hypot(b.x - a.x, b.y - a.y) >= 0.3) {
        addShape({ id: newId(), kind: 'line', a, b, color, width, arrow: t === 'arrow' });
      }
      setDraft(null);
    }
  };

  const finishCable = () => {
    if (draft?.kind === 'cable' && draft.pts.length >= 2) {
      const s: Shape = { id: newId(), kind: 'cable', pts: draft.pts, color: cableInfo(cableType).color, label: '', cable: cableType };
      addShape(s); setSelectedId(s.id);
    }
    setDraft(null);
  };

  const onWheel = (e: React.WheelEvent) => {
    zoomAt(e.deltaY > 0 ? 1.12 : 1 / 1.12, toWorld(e.clientX, e.clientY));
  };

  // Keyboard: undo/redo, delete, finish a cable run.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest?.('input, textarea, select');
      if (typing) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) { e.preventDefault(); removeShape(selectedId); }
      else if (e.key === 'Enter' && draft?.kind === 'cable') finishCable();
      else if (e.key.startsWith('Arrow')) {
        // With something selected the arrows nudge it (Shift: 5 ft); otherwise they slide the view.
        e.preventDefault();
        const dir = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.key];
        if (!dir) return;
        if (selectedId) { const step = e.shiftKey ? 5 : 0.5; nudge(selectedId, dir[0] * step, dir[1] * step); }
        else panBy(dir[0] * 0.15, dir[1] * 0.15);
      }
      else if (e.key === 'Escape') { if (draft?.kind === 'cable') finishCable(); else { setDraft(null); setSelectedId(null); } }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ── Photos ────────────────────────────────────────────────────────────────
  const onPhotoChosen = async (file: File | undefined, kind: 'photo' | 'bg') => {
    if (!file) return;
    setBusyUpload(true); setError(null);
    try {
      const path = await uploadFile(file, kind);
      if (!path) { setError("That photo didn't upload. Try again."); return; }
      const url = await fileUrl(path);
      if (url) setUrls((u) => ({ ...u, [path]: url }));
      if (kind === 'bg') commit({ ...sketch, bg: { path, opacity: 0.5 } });
      else if (pendingPhotoAt.current) {
        const s: Shape = { id: newId(), kind: 'photo', at: pendingPhotoAt.current, path, note: '' };
        addShape(s); setSelectedId(s.id);
      }
    } finally {
      setBusyUpload(false);
      pendingPhotoAt.current = null;
    }
  };

  // ── Save ──────────────────────────────────────────────────────────────────
  const save = async () => {
    setSaving(true); setError(null);
    let png: Blob | null = null;
    try { png = await exportPng(svgRef.current, sketch, summary, title, sketch.bg ? urls[sketch.bg.path] : undefined); } catch { png = null; }
    const err = await onSave(sketch, title.trim() || 'Sketch', png);
    setSaving(false);
    if (err) setError(err); else setDirty(false);
  };
  const close = () => {
    if (dirty && !window.confirm('You have changes that are not saved. Close without saving?')) return;
    onClose();
  };

  // ── Drawing ───────────────────────────────────────────────────────────────
  const sw = (n: number) => n; // stroke widths are already in feet
  const tag = (at: Pt, text: string, key: string, size = LABEL, fillColor = '#0E1B2E') => (
    <g key={key} pointerEvents="none">
      <text x={at.x} y={at.y} fontSize={size} textAnchor="middle" dominantBaseline="middle" stroke="#fff" strokeWidth={size * 0.35} strokeLinejoin="round" paintOrder="stroke" fill={fillColor} fontWeight={700} fontFamily="Inter, system-ui, sans-serif">{text}</text>
    </g>
  );

  /** A piece of furniture to size: its footprint, turned, with its name inside. */
  const furniture = (s: Extract<Shape, { kind: 'symbol' }>, color: string, label: string) => {
    const { w, d } = footprint(s)!;
    const sel = s.id === selectedId;
    const x0 = -w / 2, y0 = -d / 2, line = { stroke: color, strokeWidth: 0.07, fill: 'none' } as const;
    const round = s.sym === 'plant' || s.sym === 'trash' || s.sym === 'watercooler';
    const special: Partial<Record<SymbolKind, React.ReactNode>> = {
      // L-shaped desk: the long run along the back, the return down the left.
      ldesk: <path d={`M ${x0} ${y0} H ${-x0} V ${y0 + 2.5} H ${x0 + 2.5} V ${-y0} H ${x0} Z`} fill="#F3EDE3" stroke={color} strokeWidth={0.1} />,
      cubicle: <path d={`M ${x0} ${-y0} V ${y0} H ${-x0} V ${-y0}`} fill="none" stroke={color} strokeWidth={0.25} />,
      toilet: <><rect x={-w / 2} y={y0} width={w} height={d * 0.3} rx={0.15} fill="#fff" stroke={color} strokeWidth={0.08} /><ellipse cx={0} cy={y0 + d * 0.62} rx={w * 0.42} ry={d * 0.36} fill="#fff" stroke={color} strokeWidth={0.08} /></>,
      sink: <ellipse cx={0} cy={0.1} rx={w * 0.33} ry={d * 0.3} fill="#fff" stroke={color} strokeWidth={0.07} />,
      urinal: <ellipse cx={0} cy={0.1} rx={w * 0.32} ry={d * 0.32} fill="#fff" stroke={color} strokeWidth={0.07} />,
      tub: <rect x={x0 + 0.3} y={y0 + 0.3} width={w - 0.6} height={d - 0.6} rx={0.6} fill="#fff" stroke={color} strokeWidth={0.07} />,
      shower: <><line x1={x0} y1={y0} x2={-x0} y2={-y0} {...line} /><line x1={-x0} y1={y0} x2={x0} y2={-y0} {...line} /><circle cx={0} cy={0} r={0.2} fill="#fff" stroke={color} strokeWidth={0.06} /></>,
      stove: <>{[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([i, j]) => <circle key={`${i}${j}`} cx={(i * w) / 4} cy={(j * d) / 4} r={Math.min(w, d) / 6} {...line} />)}</>,
      fridge: <line x1={x0} y1={y0 + d * 0.15} x2={-x0} y2={y0 + d * 0.15} {...line} />,
      bed: <>{[-1, 1].map((i) => <rect key={i} x={i < 0 ? x0 + 0.3 : 0.15} y={y0 + 0.3} width={w / 2 - 0.45} height={1.2} rx={0.3} fill="#fff" stroke={color} strokeWidth={0.06} />)}<line x1={x0} y1={y0 + 2} x2={-x0} y2={y0 + 2} {...line} /></>,
      twinbed: <><rect x={x0 + 0.3} y={y0 + 0.3} width={w - 0.6} height={1.2} rx={0.3} fill="#fff" stroke={color} strokeWidth={0.06} /><line x1={x0} y1={y0 + 2} x2={-x0} y2={y0 + 2} {...line} /></>,
      stairs: <>{Array.from({ length: Math.max(2, Math.floor(d)) }, (_, i) => <line key={i} x1={x0} y1={y0 + i + 1} x2={-x0} y2={y0 + i + 1} {...line} />)}<path d={`M 0 ${-y0 - 0.6} V ${y0 + 0.8} M -0.5 ${y0 + 1.4} L 0 ${y0 + 0.8} L 0.5 ${y0 + 1.4}`} {...line} strokeWidth={0.1} /></>,
      elevator: <><line x1={x0} y1={y0} x2={-x0} y2={-y0} {...line} /><line x1={-x0} y1={y0} x2={x0} y2={-y0} {...line} /></>,
      lockers: <>{Array.from({ length: Math.max(1, Math.round(w / 1.2)) - 1 }, (_, i) => <line key={i} x1={x0 + ((i + 1) * w) / Math.round(w / 1.2)} y1={y0} x2={x0 + ((i + 1) * w) / Math.round(w / 1.2)} y2={-y0} {...line} />)}</>,
      filecab: <>{[1, 2, 3].map((i) => <line key={i} x1={x0} y1={y0 + (i * d) / 4} x2={-x0} y2={y0 + (i * d) / 4} {...line} />)}</>,
      plant: <circle cx={0} cy={0} r={w * 0.28} fill="#A5D6A7" stroke={color} strokeWidth={0.06} />,
    };
    return (
      <g transform={`translate(${s.at.x} ${s.at.y}) rotate(${s.rot})`}>
        {s.sym === 'ldesk' || s.sym === 'cubicle' ? null : round
          ? <circle cx={0} cy={0} r={w / 2} fill="#F3EDE3" stroke={color} strokeWidth={0.1} />
          : <rect x={-w / 2} y={-d / 2} width={w} height={d} rx={Math.min(0.3, d / 6)} fill={s.sym === 'column' ? color : s.sym === 'elevator' || s.sym === 'stairs' ? '#ECEFF1' : '#F3EDE3'} stroke={color} strokeWidth={0.1} />}
        {special[s.sym]}
        {/* Backs for seats; a door line for cabinets */}
        {(s.sym === 'chair' || s.sym === 'sofa' || s.sym === 'bench') && <rect x={-w / 2} y={-d / 2} width={w} height={Math.min(0.5, d / 4)} fill={color} fillOpacity={0.5} />}
        {s.sym === 'sofa' && <><rect x={-w / 2} y={-d / 2} width={0.5} height={d} fill={color} fillOpacity={0.35} /><rect x={w / 2 - 0.5} y={-d / 2} width={0.5} height={d} fill={color} fillOpacity={0.35} /></>}
        {s.sym === 'cabinet' && <line x1={0} y1={-d / 2} x2={0} y2={d / 2} stroke={color} strokeWidth={0.06} />}
        {s.sym === 'shelf' && [-1, 0, 1].map((i) => <line key={i} x1={(i * w) / 4} y1={-d / 2} x2={(i * w) / 4} y2={d / 2} stroke={color} strokeWidth={0.05} />)}
        {s.sym !== 'chair' && s.sym !== 'stairs' && w >= 3 && d >= 1.2 && (
          <text x={0} y={0.05} fontSize={Math.min(0.6, d * 0.32)} textAnchor="middle" dominantBaseline="middle" fill={color} fontWeight={700} fontFamily="Inter, system-ui, sans-serif" pointerEvents="none">{s.label || label}</text>
        )}
        {sel && <rect x={-w / 2 - 0.3} y={-d / 2 - 0.3} width={w + 0.6} height={d + 0.6} fill="none" stroke="#C9A24B" strokeWidth={0.12} strokeDasharray="0.5 0.3" data-noexport />}
      </g>
    );
  };

  /** Wall lines broken where a door, window or opening sits (a window keeps a thin line). */
  const wallLines = (key: string, runs: { a: Pt; b: Pt }[], stroke: string, width: number, isDraft: boolean, dash?: string) =>
    runs.flatMap((run, i) => (isDraft ? [{ ...run, kind: 'solid' as const }] : wallPieces(run, openings)).map((p, j) => (
      <line key={`${key}-${i}-${j}`} x1={p.a.x} y1={p.a.y} x2={p.b.x} y2={p.b.y} stroke={stroke} strokeDasharray={dash}
        strokeWidth={p.kind === 'solid' ? width : p.kind === 'window' ? width / 3 : 0} strokeLinecap={p.kind === 'solid' && !dash ? 'square' : 'butt'} />
    )));
  /**
   * A wall drawn the way its type looks on a plan: drywall in the room's own
   * colour, block and brick with a light core, glass blue, low walls dashed.
   */
  const typedWall = (key: string, runs: { a: Pt; b: Pt }[], wtype: WallType | undefined, ownColor: string, ownWidth: number, isDraft: boolean) => {
    const t = wallTypeInfo(wtype);
    if (t.type === 'drywall') return wallLines(key, runs, ownColor, ownWidth, isDraft);
    const core = t.type === 'glass' || t.type === 'block' || t.type === 'brick' || t.type === 'fire';
    return (
      <>
        {wallLines(`${key}-o`, runs, t.color, t.width, isDraft, t.dash)}
        {core && wallLines(`${key}-i`, runs, '#fff', t.width * 0.3, isDraft, t.type === 'block' ? '0.8 0.25' : t.type === 'brick' ? '0.4 0.2' : t.type === 'fire' ? '0.25 0.25' : undefined)}
      </>
    );
  };

  const renderShape = (s: Shape, isDraft = false) => {
    const sel = s.id === selectedId && !isDraft;
    switch (s.kind) {
      case 'gap':
        // The wall is simply not drawn here; this faint mark (not printed) lets you pick the opening.
        return (
          <g key={s.id} data-noexport>
            <line x1={s.a.x} y1={s.a.y} x2={s.b.x} y2={s.b.y} stroke="#C9A24B" strokeWidth={0.12} strokeDasharray="0.3 0.25" />
            {sel && <line x1={s.a.x} y1={s.a.y} x2={s.b.x} y2={s.b.y} stroke="#C9A24B" strokeWidth={0.9} strokeOpacity={0.4} />}
            {(sel || isDraft) && tag(midpoint([s.a, s.b]), `${feet(Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y))} opening`, `${s.id}-l`, LABEL * 0.7, '#8a6d2b')}
          </g>
        );
      case 'room': {
        const label = `${feet(s.w)} × ${feet(s.h)}`;
        return (
          <g key={s.id}>
            <rect x={s.x} y={s.y} width={s.w} height={s.h} fill={s.color} fillOpacity={0.07} />
            {typedWall(s.id, [{ x: s.x, y: s.y }, { x: s.x + s.w, y: s.y }, { x: s.x + s.w, y: s.y + s.h }, { x: s.x, y: s.y + s.h }].map((a, i, c) => ({ a, b: c[(i + 1) % 4] })), s.wtype, s.color, sw(0.3), isDraft)}
            {tag({ x: s.x + s.w / 2, y: s.y + s.h / 2 - LABEL * 0.8 }, s.name || 'Room', `${s.id}-n`, LABEL * 1.1)}
            {tag({ x: s.x + s.w / 2, y: s.y + s.h / 2 + LABEL * 0.5 }, label, `${s.id}-d`, LABEL * 0.85, '#455A64')}
            {tag({ x: s.x + s.w / 2, y: s.y + s.h / 2 + LABEL * 1.6 }, sqft(s.w * s.h), `${s.id}-a`, LABEL * 0.8, '#455A64')}
            {tag({ x: s.x + s.w / 2, y: s.y - LABEL * 0.8 }, feet(s.w), `${s.id}-tw`, LABEL * 0.75, s.color)}
            {tag({ x: s.x - LABEL * 1.6, y: s.y + s.h / 2 }, feet(s.h), `${s.id}-th`, LABEL * 0.75, s.color)}
            {sel && <rect x={s.x - 0.3} y={s.y - 0.3} width={s.w + 0.6} height={s.h + 0.6} fill="none" stroke="#C9A24B" strokeWidth={0.12} strokeDasharray="0.5 0.3" data-noexport />}
          </g>
        );
      }
      case 'wall': {
        const len = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
        return (
          <g key={s.id}>
            {typedWall(s.id, [{ a: s.a, b: s.b }], s.wtype, s.color, 0.45, isDraft)}
            {tag(midpoint([s.a, s.b]), feet(len), `${s.id}-l`, LABEL * 0.8, s.color)}
            {sel && <line x1={s.a.x} y1={s.a.y} x2={s.b.x} y2={s.b.y} stroke="#C9A24B" strokeWidth={0.9} strokeOpacity={0.4} data-noexport />}
          </g>
        );
      }
      case 'cable': {
        const total = pathLength(s.pts);
        return (
          <g key={s.id}>
            <polyline points={s.pts.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={s.color} strokeWidth={0.18} strokeDasharray="0.6 0.3" strokeLinejoin="round" />
            {s.pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={0.18} fill={s.color} />)}
            {tag(midpoint(s.pts), `${s.label ? `${s.label} · ` : ''}${cableInfo(s.cable).label} ${Math.round(total)} ft`, `${s.id}-l`, LABEL * 0.8, s.color)}
            {sel && <polyline points={s.pts.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#C9A24B" strokeWidth={0.8} strokeOpacity={0.35} data-noexport />}
          </g>
        );
      }
      case 'pen':
        return (
          <g key={s.id}>
            <polyline points={s.pts.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={s.color} strokeWidth={s.width} strokeOpacity={s.marker ? 0.35 : 1} strokeLinecap="round" strokeLinejoin="round" />
            {sel && <polyline points={s.pts.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#C9A24B" strokeWidth={s.width + 0.4} strokeOpacity={0.3} data-noexport />}
          </g>
        );
      case 'line':
        return (
          <g key={s.id}>
            <line x1={s.a.x} y1={s.a.y} x2={s.b.x} y2={s.b.y} stroke={s.color} strokeWidth={s.width} strokeLinecap="round" markerEnd={s.arrow ? `url(#arrow-${s.color.slice(1)})` : undefined} />
            {sel && <line x1={s.a.x} y1={s.a.y} x2={s.b.x} y2={s.b.y} stroke="#C9A24B" strokeWidth={s.width + 0.5} strokeOpacity={0.35} data-noexport />}
          </g>
        );
      case 'box': case 'ellipse': {
        const common = { fill: s.fill ? s.color : 'none', fillOpacity: s.fill ? 0.25 : undefined, stroke: s.color, strokeWidth: s.width };
        return (
          <g key={s.id}>
            {s.kind === 'box'
              ? <rect x={s.x} y={s.y} width={s.w} height={s.h} {...common} />
              : <ellipse cx={s.x + s.w / 2} cy={s.y + s.h / 2} rx={s.w / 2} ry={s.h / 2} {...common} />}
            {sel && <rect x={s.x - 0.3} y={s.y - 0.3} width={s.w + 0.6} height={s.h + 0.6} fill="none" stroke="#C9A24B" strokeWidth={0.12} strokeDasharray="0.5 0.3" data-noexport />}
          </g>
        );
      }
      case 'text':
        return (
          <g key={s.id}>
            <text x={s.at.x} y={s.at.y} fontSize={s.size} fill={s.color} fontWeight={600} fontFamily="Inter, system-ui, sans-serif">{s.text}</text>
            {sel && <rect x={s.at.x - 0.2} y={s.at.y - s.size} width={s.text.length * s.size * 0.6 + 0.4} height={s.size * 1.3} fill="none" stroke="#C9A24B" strokeWidth={0.1} strokeDasharray="0.4 0.2" data-noexport />}
          </g>
        );
      case 'symbol': {
        const info = symbolInfo(s.sym);
        const r = 0.9;
        return (
          <g key={s.id}>
            {isFurniture(s.sym) ? furniture(s, info.color, info.label) : s.sym === 'door2' ? (
              <g transform={`translate(${s.at.x} ${s.at.y}) rotate(${s.rot})`}>
                <line x1={-3} y1={0} x2={3} y2={0} stroke={info.color} strokeWidth={0.2} />
                <line x1={-3} y1={0} x2={-3} y2={-3} stroke={info.color} strokeWidth={0.15} />
                <line x1={3} y1={0} x2={3} y2={-3} stroke={info.color} strokeWidth={0.15} />
                <path d="M 0 0 A 3 3 0 0 0 -3 -3 M 0 0 A 3 3 0 0 1 3 -3" fill="none" stroke={info.color} strokeWidth={0.1} strokeDasharray="0.3 0.2" />
              </g>
            ) : s.sym === 'slider' ? (
              <g transform={`translate(${s.at.x} ${s.at.y}) rotate(${s.rot})`}>
                <rect x={-3} y={-0.3} width={6} height={0.6} fill="#E3F2FD" stroke={info.color} strokeWidth={0.08} />
                <line x1={-3} y1={-0.12} x2={0.4} y2={-0.12} stroke={info.color} strokeWidth={0.14} />
                <line x1={-0.4} y1={0.12} x2={3} y2={0.12} stroke={info.color} strokeWidth={0.14} />
              </g>
            ) : s.sym === 'window2' ? (
              <g transform={`translate(${s.at.x} ${s.at.y}) rotate(${s.rot})`}>
                <rect x={-3} y={-0.25} width={6} height={0.5} fill="#fff" stroke={info.color} strokeWidth={0.12} />
                <line x1={-3} y1={0} x2={3} y2={0} stroke={info.color} strokeWidth={0.08} />
                <line x1={0} y1={-0.25} x2={0} y2={0.25} stroke={info.color} strokeWidth={0.08} />
              </g>
            ) : s.sym === 'door' ? (
              <g transform={`translate(${s.at.x} ${s.at.y}) rotate(${s.rot})`}>
                <line x1={-1.5} y1={0} x2={1.5} y2={0} stroke={info.color} strokeWidth={0.2} />
                <path d="M -1.5 0 A 3 3 0 0 1 1.5 -3" fill="none" stroke={info.color} strokeWidth={0.1} strokeDasharray="0.3 0.2" />
                <line x1={-1.5} y1={0} x2={1.5} y2={-3} stroke={info.color} strokeWidth={0.15} />
              </g>
            ) : s.sym === 'window' ? (
              <g transform={`translate(${s.at.x} ${s.at.y}) rotate(${s.rot})`}>
                <rect x={-1.6} y={-0.25} width={3.2} height={0.5} fill="#fff" stroke={info.color} strokeWidth={0.12} />
                <line x1={-1.6} y1={0} x2={1.6} y2={0} stroke={info.color} strokeWidth={0.08} />
              </g>
            ) : (
              <>
                <circle cx={s.at.x} cy={s.at.y} r={r} fill="#fff" stroke={info.color} strokeWidth={0.18} />
                <text x={s.at.x} y={s.at.y} fontSize={info.code.length > 1 ? 0.75 : 0.95} textAnchor="middle" dominantBaseline="central" fill={info.color} fontWeight={800} fontFamily="Inter, system-ui, sans-serif">{info.code}</text>
              </>
            )}
            {s.label && !isFurniture(s.sym) && tag({ x: s.at.x, y: s.at.y + 1.7 }, s.label, `${s.id}-l`, LABEL * 0.7, info.color)}
            {sel && !isFurniture(s.sym) && <circle cx={s.at.x} cy={s.at.y} r={1.4} fill="none" stroke="#C9A24B" strokeWidth={0.15} strokeDasharray="0.4 0.25" data-noexport />}
          </g>
        );
      }
      case 'photo':
        return (
          <g key={s.id}>
            <circle cx={s.at.x} cy={s.at.y} r={0.95} fill="#0E1B2E" stroke="#C9A24B" strokeWidth={0.15} />
            <text x={s.at.x} y={s.at.y} fontSize={0.8} textAnchor="middle" dominantBaseline="central" fill="#fff" fontFamily="Inter, system-ui, sans-serif">📷</text>
            {s.note && tag({ x: s.at.x, y: s.at.y + 1.7 }, s.note.slice(0, 40), `${s.id}-n`, LABEL * 0.7)}
            {sel && <circle cx={s.at.x} cy={s.at.y} r={1.5} fill="none" stroke="#C9A24B" strokeWidth={0.15} strokeDasharray="0.4 0.25" data-noexport />}
          </g>
        );
    }
  };

  const draftShape = (): React.ReactNode => {
    if (!draft) return null;
    if (draft.kind === 'stroke') {
      return <polyline points={draft.pts.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={color} strokeWidth={draft.tool === 'marker' ? Math.max(width * 4, 0.6) : width} strokeOpacity={draft.tool === 'marker' ? 0.35 : 1} strokeLinecap="round" strokeLinejoin="round" />;
    }
    if (draft.kind === 'cable') {
      const all = draft.hover ? [...draft.pts, draft.hover] : draft.pts;
      return (
        <g>
          <polyline points={all.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={cableInfo(cableType).color} strokeWidth={0.18} strokeDasharray="0.6 0.3" />
          {tag(all[all.length - 1], `${Math.round(pathLength(all))} ft ${cableInfo(cableType).label}`, 'draft-len', LABEL * 0.8, cableInfo(cableType).color)}
        </g>
      );
    }
    const { tool: t, a, b } = draft;
    const r = roomFromCorners(a, b);
    if (t === 'room') return renderShape({ id: '_draft', kind: 'room', ...r, name: 'New room', color }, true);
    if (t === 'box' || t === 'ellipse') return renderShape({ id: '_draft', kind: t, ...r, color, width, fill }, true);
    if (t === 'wall') return renderShape({ id: '_draft', kind: 'wall', a, b, color, ...(wallType !== 'drywall' && { wtype: wallType }) }, true);
    if (t === 'opening') {
      const gap = gapOnWall(sketch.shapes, a, b);
      return gap ? renderShape({ id: '_draft', kind: 'gap', ...gap }, true) : <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#C62828" strokeWidth={0.12} strokeDasharray="0.4 0.3" />;
    }
    if (t === 'line' || t === 'arrow') return renderShape({ id: '_draft', kind: 'line', a, b, color, width, arrow: t === 'arrow' }, true);
    return null;
  };

  const arrowColors = [...new Set([...COLORS, ...sketch.shapes.filter((s) => s.kind === 'line').map((s) => (s as Extract<Shape, { kind: 'line' }>).color)])];
  const toolBtn = (t: (typeof TOOLS)[number]) => (
    <button key={t.tool} type="button" onClick={() => { if (draft?.kind === 'cable') finishCable(); setTool(t.tool); setDraft(null); }}
      title={t.label} aria-label={t.label} aria-pressed={tool === t.tool}
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, width: '100%', padding: '7px 2px', borderRadius: 8, border: 'none', cursor: 'pointer', flexShrink: 0,
        background: tool === t.tool ? '#C9A24B' : 'transparent', color: tool === t.tool ? '#0E1B2E' : '#fff', fontSize: 10, fontWeight: 700, lineHeight: 1.15 }}>
      {t.icon}<span style={{ textAlign: 'center' }}>{t.label.split(' / ')[0]}</span>
    </button>
  );
  const smallBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4, height: 32, minWidth: 32, padding: '0 8px', borderRadius: 8, border: '1px solid #d8dde5', background: '#fff', color: '#0E1B2E', fontSize: 12, fontWeight: 700, cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' };

  return (
    <div role="dialog" aria-modal="true" aria-label="Sketch" style={{ position: 'fixed', inset: 0, zIndex: 300, background: '#F6F4EF', display: 'flex', flexDirection: 'column' }}>
      {/* Top bar: title, undo/redo, save */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', background: '#0E1B2E', color: '#fff' }}>
        <button type="button" onClick={close} aria-label="Close" style={{ ...smallBtn, background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.3)' }}><X size={16} /></button>
        <input value={title} onChange={(e) => { setTitle(e.target.value); setDirty(true); }} aria-label="Sketch name" maxLength={120}
          style={{ flex: '1 1 auto', minWidth: 0, width: 60, height: 34, borderRadius: 8, border: '1px solid rgba(255,255,255,0.25)', background: 'rgba(255,255,255,0.08)', color: '#fff', padding: '0 10px', fontSize: 16, fontWeight: 700 }} />
        <button type="button" onClick={() => { if (draft?.kind === 'cable') finishCable(); setShow3d(true); }} title="See it in 3D" style={{ ...smallBtn, background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.3)' }}><Box size={15} /> 3D</button>
        <button type="button" onClick={undo} disabled={!past.length} aria-label="Undo" title="Undo (Ctrl+Z)" style={{ ...smallBtn, opacity: past.length ? 1 : 0.4 }}><Undo2 size={16} /></button>
        <button type="button" onClick={redo} disabled={!future.length} aria-label="Redo" title="Redo (Ctrl+Y)" style={{ ...smallBtn, opacity: future.length ? 1 : 0.4 }}><Redo2 size={16} /></button>
        <button type="button" onClick={() => void save()} disabled={saving} style={{ ...smallBtn, background: '#C9A24B', border: 'none', padding: '0 14px' }}>
          {saving ? <Loader2 size={15} className="spin" /> : <Save size={15} />} {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
        </button>
      </div>

      {/* Options for the current tool */}
      {/* One row that swipes sideways on a phone, so the plan keeps its room. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: '#fff', borderBottom: '1px solid #e2e6ec', flexWrap: 'nowrap', overflowX: 'auto', whiteSpace: 'nowrap', fontSize: 12, flexShrink: 0 }}>
        {tool === 'symbol' ? (
          <>
            <span role="group" aria-label="Kind of symbol" style={{ display: 'inline-flex', flexShrink: 0, border: '1px solid #d8dde5', borderRadius: 8, overflow: 'hidden' }}>
              {SYMBOL_GROUPS.map((g) => (
                <button key={g.group} type="button" onClick={() => { setSymGroup(g.group); setSym(SYMBOLS.find((s) => s.group === g.group)!.kind); }} aria-pressed={symGroup === g.group}
                  style={{ height: 32, padding: '0 10px', border: 'none', borderRight: '1px solid #e2e6ec', fontSize: 12, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap',
                    background: symGroup === g.group ? '#0E1B2E' : '#fff', color: symGroup === g.group ? '#fff' : '#0E1B2E' }}>
                  {g.label}
                </button>
              ))}
            </span>
            {SYMBOLS.filter((s) => s.group === symGroup).map((s) => (
              <button key={s.kind} type="button" onClick={() => setSym(s.kind)} aria-pressed={sym === s.kind}
                style={{ ...smallBtn, borderColor: sym === s.kind ? s.color : '#d8dde5', background: sym === s.kind ? `${s.color}18` : '#fff', color: s.color }}>
                {s.code && <b>{s.code}</b>} {s.label}
              </button>
            ))}
            {symGroup === 'furniture' && <span style={{ color: '#455A64', marginLeft: 4 }}>Drawn to size. Select one and use Turn to face it another way.</span>}
          </>
        ) : tool === 'doors' ? (
          <>
            {OPENING_SYMBOLS.map((k) => {
              const info = SYMBOLS.find((x) => x.kind === k)!;
              return (
                <button key={k} type="button" onClick={() => setDoorKind(k)} aria-pressed={doorKind === k}
                  style={{ ...smallBtn, borderColor: doorKind === k ? '#0E1B2E' : '#d8dde5', background: doorKind === k ? '#0E1B2E' : '#fff', color: doorKind === k ? '#fff' : '#0E1B2E' }}>
                  {k.startsWith('window') ? <AppWindow size={14} /> : <DoorOpen size={14} />} {info.label} <span style={{ opacity: 0.6, fontWeight: 600 }}>{OPENING_WIDTH[k]} ft</span>
                </button>
              );
            })}
            <span style={{ color: '#455A64', marginLeft: 4 }}>Tap on a wall — it sits in the wall, facing the right way.</span>
          </>
        ) : tool === 'cable' ? (
          <>
            {CABLE_TYPES.map((c) => (
              <button key={c.type} type="button" onClick={() => setCableType(c.type)} aria-pressed={cableType === c.type}
                style={{ ...smallBtn, borderColor: cableType === c.type ? c.color : '#d8dde5', background: cableType === c.type ? `${c.color}18` : '#fff', color: c.color }}>
                <span style={{ width: 14, height: 3, background: c.color, display: 'inline-block', borderRadius: 2 }} /> {c.label}
              </button>
            ))}
            <span style={{ color: '#455A64', marginLeft: 4 }}>Tap each point of the run, then</span>
            <button type="button" onClick={finishCable} disabled={draft?.kind !== 'cable' || draft.pts.length < 2} style={{ ...smallBtn, background: cableInfo(cableType).color, color: '#fff', border: 'none', opacity: draft?.kind === 'cable' && draft.pts.length >= 2 ? 1 : 0.5 }}>Finish run</button>
          </>
        ) : (
          <>
            {COLORS.map((c) => (
              <button key={c} type="button" onClick={() => { setColor(c); if (selected && 'color' in selected) updateShape(selected.id, { color: c } as Partial<Shape>); }}
                aria-label={`Colour ${c}`} aria-pressed={color === c}
                style={{ width: 26, height: 26, flexShrink: 0, borderRadius: 999, background: c, border: color === c ? '3px solid #C9A24B' : '2px solid #fff', boxShadow: '0 0 0 1px #d8dde5', cursor: 'pointer' }} />
            ))}
            <span style={{ width: 8 }} />
            {(tool === 'pen' || tool === 'marker' || tool === 'line' || tool === 'arrow' || tool === 'box' || tool === 'ellipse') && WIDTHS.map((w) => (
              <button key={w.label} type="button" onClick={() => setWidth(w.w)} aria-pressed={width === w.w} style={{ ...smallBtn, background: width === w.w ? '#0E1B2E' : '#fff', color: width === w.w ? '#fff' : '#0E1B2E' }}>{w.label}</button>
            ))}
            {(tool === 'box' || tool === 'ellipse') && (
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 700 }}><input type="checkbox" checked={fill} onChange={(e) => setFill(e.target.checked)} /> Fill</label>
            )}
            {tool === 'room' && <span style={{ color: '#455A64' }}>Drag from one corner to the other. Each square is 1 ft.</span>}
            {tool === 'wall' && <>
              <span role="group" aria-label="Wall type" style={{ display: 'inline-flex', gap: 4, flexShrink: 0 }}>
                {WALL_TYPES.map((w) => (
                  <button key={w.type} type="button" onClick={() => setWallType(w.type)} aria-pressed={wallType === w.type} title={`${w.hint} · Wi-Fi about −${w.wifiDb} dB`}
                    style={{ ...smallBtn, borderColor: wallType === w.type ? '#0E1B2E' : '#d8dde5', background: wallType === w.type ? '#0E1B2E' : '#fff', color: wallType === w.type ? '#fff' : '#0E1B2E' }}>
                    <svg width={18} height={8} aria-hidden><line x1={1} y1={4} x2={17} y2={4} stroke={w.color || color} strokeWidth={Math.max(2, w.width * 8)} strokeDasharray={w.dash ? '4 2' : undefined} /></svg>
                    {w.label}
                  </button>
                ))}
              </span>
              <span style={{ color: '#455A64', marginLeft: 4 }}>{wallTypeInfo(wallType).hint}. Wi-Fi through it: about −{wallTypeInfo(wallType).wifiDb} dB.</span>
            </>}
            {tool === 'opening' && <span style={{ color: '#455A64' }}>Drag along a wall or a room&apos;s side to take that stretch of wall out.</span>}
            {tool === 'moveall' && <span style={{ color: '#455A64' }}>Drag anywhere to move the whole site. Arrow keys or the pad slide the view.</span>}
            {tool === 'select' && <span style={{ color: '#455A64' }}>Double-click anything to change it. Drag to move it; drag the white squares to change its size or move a wall&apos;s end. Arrow keys nudge it (Shift = 5 ft).</span>}
            {tool === 'photo' && <span style={{ color: '#455A64' }}>{busyUpload ? 'Uploading…' : 'Tap the spot, then take or choose the photo.'}</span>}
          </>
        )}
        <span style={{ flex: 1 }} />
        <button type="button" onClick={() => setSnapOn((v) => !v)} aria-pressed={snapOn} title="Snap to the grid" style={{ ...smallBtn, background: snapOn ? '#0E1B2E' : '#fff', color: snapOn ? '#fff' : '#0E1B2E' }}><Magnet size={14} /> Snap</button>
        <button type="button" onClick={() => setGridOn((v) => !v)} aria-pressed={gridOn} title="Show the grid" style={{ ...smallBtn, background: gridOn ? '#0E1B2E' : '#fff', color: gridOn ? '#fff' : '#0E1B2E' }}><Grid3x3 size={14} /> Grid</button>
        <button type="button" onClick={() => bgInput.current?.click()} title="Put a floor-plan photo under the drawing" style={smallBtn}><ImageIcon size={14} /> Floor plan</button>
        <button type="button" onClick={() => setShowPanel((v) => !v)} aria-pressed={showPanel} style={smallBtn}>{showPanel ? 'Hide details' : 'Details'}</button>
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 320px', minWidth: 0, minHeight: 260, display: 'flex' }}>
        {/* Tools, down the left (Fred, 2026-10-06: "menu bar to the left") */}
        <nav aria-label="Tools" style={{ width: 70, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 2, padding: '6px 4px', background: '#13284A', overflowY: 'auto' }}>
          {TOOLS.filter((t) => t.group === 'edit' && t.tool !== 'eraser').map(toolBtn)}
          <span style={{ height: 1, flexShrink: 0, background: 'rgba(255,255,255,0.2)', margin: '4px 6px' }} />
          {TOOLS.filter((t) => t.group === 'plan').map(toolBtn)}
          <span style={{ height: 1, flexShrink: 0, background: 'rgba(255,255,255,0.2)', margin: '4px 6px' }} />
          {TOOLS.filter((t) => t.group === 'draw').map(toolBtn)}
          <span style={{ height: 1, flexShrink: 0, background: 'rgba(255,255,255,0.2)', margin: '4px 6px' }} />
          {TOOLS.filter((t) => t.tool === 'eraser').map(toolBtn)}
        </nav>
        {/* Drawing area */}
        <div ref={wrapRef} style={{ flex: '1 1 auto', minWidth: 0, position: 'relative', background: '#fff', touchAction: 'none' }}>
          <svg ref={svgRef} viewBox={`${view.x} ${view.y} ${view.w} ${viewH}`} preserveAspectRatio="xMidYMid meet"
            style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none', cursor: tool === 'hand' ? 'grab' : tool === 'select' ? 'default' : 'crosshair' }}
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
            onWheel={onWheel} onDoubleClick={() => { if (draft?.kind === 'cable') finishCable(); }}>
            <defs>
              <pattern id="grid1" width={1} height={1} patternUnits="userSpaceOnUse"><path d="M 1 0 L 0 0 0 1" fill="none" stroke="#e6e9ef" strokeWidth={0.04} /></pattern>
              <pattern id="grid5" width={5} height={5} patternUnits="userSpaceOnUse"><rect width={5} height={5} fill="url(#grid1)" /><path d="M 5 0 L 0 0 0 5" fill="none" stroke="#cfd5de" strokeWidth={0.07} /></pattern>
              {arrowColors.map((c) => (
                <marker key={c} id={`arrow-${c.slice(1)}`} viewBox="0 0 10 10" refX={8} refY={5} markerWidth={4} markerHeight={4} orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill={c} />
                </marker>
              ))}
            </defs>
            <rect x={0} y={0} width={sketch.width} height={sketch.height} fill="#fff" />
            {sketch.bg && urls[sketch.bg.path] && (
              <image data-bg href={urls[sketch.bg.path]} x={0} y={0} width={sketch.width} height={sketch.height} preserveAspectRatio="xMidYMid meet" opacity={sketch.bg.opacity} />
            )}
            {gridOn && <rect x={0} y={0} width={sketch.width} height={sketch.height} fill="url(#grid5)" />}
            <rect x={0} y={0} width={sketch.width} height={sketch.height} fill="none" stroke="#b7bfcc" strokeWidth={0.08} />
            {sketch.shapes.map((s) => renderShape(s))}
            {draftShape()}
            {/* Grab points of the selected item: drag to resize or reshape it. */}
            {tool === 'select' && selected && handlesOf(selected).map((h) => {
              const hs = view.w / 70;
              return <rect key={h.id} x={h.at.x - hs / 2} y={h.at.y - hs / 2} width={hs} height={hs} rx={hs / 5} fill="#fff" stroke="#C9A24B" strokeWidth={hs / 5} data-noexport style={{ cursor: 'pointer' }} />;
            })}
          </svg>
          {/* Arrow pad: slide the drawing up, down, left and right */}
          <div style={{ position: 'absolute', left: 10, bottom: 10, display: 'grid', gridTemplateColumns: 'repeat(3, 34px)', gridTemplateRows: 'repeat(3, 34px)', gap: 4 }} aria-label="Move the view">
            <span />
            <button type="button" onClick={() => panBy(0, -0.2)} aria-label="Move the view up" title="Up" style={smallBtn}><ChevronUp size={18} /></button>
            <span />
            <button type="button" onClick={() => panBy(-0.2, 0)} aria-label="Move the view left" title="Left" style={smallBtn}><ChevronLeft size={18} /></button>
            <button type="button" onClick={fit} aria-label="Centre the plan" title="Centre the plan" style={{ ...smallBtn, padding: 0 }}><Maximize size={14} /></button>
            <button type="button" onClick={() => panBy(0.2, 0)} aria-label="Move the view right" title="Right" style={smallBtn}><ChevronRight size={18} /></button>
            <span />
            <button type="button" onClick={() => panBy(0, 0.2)} aria-label="Move the view down" title="Down" style={smallBtn}><ChevronDown size={18} /></button>
            <span />
          </div>
          {/* Zoom */}
          <div style={{ position: 'absolute', right: 10, bottom: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button type="button" onClick={() => zoomAt(1 / 1.25)} aria-label="Zoom in" style={smallBtn}><Plus size={16} /></button>
            <button type="button" onClick={() => zoomAt(1.25)} aria-label="Zoom out" style={smallBtn}><Minus size={16} /></button>
            <button type="button" onClick={fit} aria-label="Fit the plan" title="Fit the plan" style={smallBtn}><Maximize size={15} /></button>
          </div>
          {/* Floating Save (Fred, 2026-10-06: "the save bar should be floating" — "every time I
              edit something it should be there"): shows at the bottom whenever there's anything unsaved. */}
          {dirty && (
            <button type="button" onClick={() => void save()} disabled={saving} className="sketch-float-save"
              style={{ position: 'absolute', bottom: 14, left: '50%', transform: 'translateX(-50%)', zIndex: 5, height: 44, padding: '0 20px', borderRadius: 999, border: 'none',
                background: '#C9A24B', color: '#0E1B2E', fontWeight: 800, fontSize: 15, display: 'inline-flex', alignItems: 'center', gap: 8, cursor: saving ? 'default' : 'pointer',
                boxShadow: '0 6px 18px rgba(14,27,46,0.28)', whiteSpace: 'nowrap' }}>
              {saving ? <Loader2 size={17} className="spin" /> : <Save size={17} />} {saving ? 'Saving…' : 'Save changes'}
            </button>
          )}
          {/* On a phone the details are tucked away: one tap opens them for the selected item. */}
          {selected && !showPanel && (
            <button type="button" onClick={() => setShowPanel(true)}
              style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', height: 36, padding: '0 14px', borderRadius: 999, border: 'none', background: '#0E1B2E', color: '#fff', fontWeight: 700, fontSize: 13, boxShadow: '0 4px 12px rgba(0,0,0,0.2)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              Edit size &amp; name
            </button>
          )}
          {notice && <div role="status" style={{ position: 'absolute', left: 10, top: 52, right: 60, padding: '8px 12px', borderRadius: 8, background: '#FBF5E6', color: '#5c4813', fontSize: 13, fontWeight: 600, border: '1px solid #e7d3a3' }}>{notice}</div>}
          {error && <div role="alert" style={{ position: 'absolute', left: 10, top: 10, right: 60, padding: '8px 12px', borderRadius: 8, background: '#fde8e8', color: '#b91c1c', fontSize: 13, fontWeight: 600 }}>{error}</div>}
        </div>

        </div>
        {/* Details: the selected item, and the counts */}
        {showPanel && (
          <div style={{ flex: '0 1 280px', minWidth: 240, maxHeight: '100%', overflowY: 'auto', background: '#fff', borderLeft: '1px solid #e2e6ec', padding: 12, display: 'flex', flexDirection: 'column', gap: 14, fontSize: 13 }}>
            {selected ? (
              <>
                <SelectedPanel shape={selected} url={selected.kind === 'photo' ? urls[selected.path] : undefined}
                  onChange={(patch) => updateShape(selected.id, patch)} onDelete={() => removeShape(selected.id)} />
                {/* Changes at the spot that was double-clicked */}
                {editPoint?.id === selected.id && (() => {
                  const parts = splitAt(selected, editPoint.at);
                  const bent = addBendAt(selected, editPoint.at);
                  if (!parts && !bent) return null;
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 10, borderRadius: 10, background: '#FBF5E6', border: '1px solid #e7d3a3' }}>
                      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: '#8a6d2b' }}>Where you double-clicked</div>
                      {parts && (
                        <button type="button" style={{ ...smallBtn, alignSelf: 'flex-start' }}
                          onClick={() => {
                            commit({ ...sketch, shapes: sketch.shapes.flatMap((x) => (x.id === selected.id ? parts : [x])) });
                            setSelectedId(parts[1].id); setEditPoint(null);
                            setNotice('Split in two — each part can now be changed, moved or deleted on its own.');
                          }}>
                          Split here
                        </button>
                      )}
                      {bent && (
                        <button type="button" style={{ ...smallBtn, alignSelf: 'flex-start' }}
                          onClick={() => { updateShape(selected.id, bent); setEditPoint(null); setNotice('Bend added — drag its white square to route the cable.'); }}>
                          Add a bend here
                        </button>
                      )}
                    </div>
                  );
                })()}
              </>
            ) : (
              <div style={{ color: '#78909C' }}>Double-click (or double-tap) anything to change it, or tap it with <b>Select</b>.</div>
            )}

            <div>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: '#0E1B2E', marginBottom: 6 }}>On this plan</div>
              {summary.symbols.length === 0 && !summary.cableFeet && !summary.rooms.length && !summary.photos && <div style={{ color: '#78909C' }}>Nothing yet.</div>}
              {summary.symbols.map((x) => {
                const info = symbolInfo(x.kind);
                return <div key={x.kind} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}><span style={{ color: info.color, fontWeight: 700 }}>{info.code ? `${info.code} · ` : ''}{x.label}</span><b>{x.count}</b></div>;
              })}
              {summary.walls.map((w) => (
                <div key={w.type} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                  <span style={{ color: wallTypeInfo(w.type).color, fontWeight: 700 }}>{w.label} walls</span><b>{w.feet.toLocaleString('en-US')} ft</b>
                </div>
              ))}
              {summary.cables.map((c) => (
                <div key={c.type} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                  <span style={{ color: cableInfo(c.type).color, fontWeight: 700 }}>{c.label} ({c.runs} run{c.runs === 1 ? '' : 's'})</span><b>{c.feet.toLocaleString('en-US')} ft</b>
                </div>
              ))}
              {summary.rooms.map((r, i) => <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}><span>{r.name}</span><span>{sqft(r.area)}</span></div>)}
              {summary.rooms.length > 1 && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderTop: '1px solid #eee', fontWeight: 700 }}><span>All rooms</span><span>{sqft(summary.totalArea)}</span></div>}
              {summary.photos > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}><span>Photos</span><b>{summary.photos}</b></div>}
            </div>

            <div>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: '#0E1B2E', marginBottom: 6 }}>Plan size</div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="number" min={10} max={400} value={sketch.width} aria-label="Plan width in feet"
                  onChange={(e) => commit(normalizeSketch({ ...sketch, width: Number(e.target.value) }))} style={{ width: 70, height: 32, fontSize: 16, padding: '0 6px', border: '1px solid #d8dde5', borderRadius: 6 }} />
                <span>×</span>
                <input type="number" min={10} max={400} value={sketch.height} aria-label="Plan height in feet"
                  onChange={(e) => commit(normalizeSketch({ ...sketch, height: Number(e.target.value) }))} style={{ width: 70, height: 32, fontSize: 16, padding: '0 6px', border: '1px solid #d8dde5', borderRadius: 6 }} />
                <span>ft</span>
              </div>
            </div>

            {sketch.bg && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: '#0E1B2E', marginBottom: 6 }}>Floor-plan photo</div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  Faded
                  <input type="range" min={0.1} max={1} step={0.05} value={sketch.bg.opacity} onChange={(e) => commit({ ...sketch, bg: { ...sketch.bg!, opacity: Number(e.target.value) } })} style={{ flex: 1 }} />
                  Strong
                </label>
                <button type="button" onClick={() => commit({ ...sketch, bg: null })} style={{ ...smallBtn, marginTop: 6, color: '#b91c1c' }}><Trash2 size={13} /> Remove it</button>
              </div>
            )}
          </div>
        )}
      </div>

      {show3d && (
        <Sketch3D sketch={sketch} title={title} onClose={() => setShow3d(false)}
          onAdd={(s) => addShape(s)} onRemove={(id) => removeShape(id)} onUndo={undo} canUndo={past.length > 0} />
      )}

      <input ref={photoInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void onPhotoChosen(e.target.files?.[0], 'photo'); e.target.value = ''; }} />
      <input ref={bgInput} type="file" accept="image/*" hidden onChange={(e) => { void onPhotoChosen(e.target.files?.[0], 'bg'); e.target.value = ''; }} />
    </div>
  );
}

/** Only the fields a resize changes, so the rest of the item stays as it is. */
function sizePatch(s: Shape): Partial<Shape> {
  if (s.kind === 'room' || s.kind === 'box' || s.kind === 'ellipse') return { w: s.w, h: s.h } as Partial<Shape>;
  if (s.kind === 'wall' || s.kind === 'line' || s.kind === 'gap') return { b: s.b } as Partial<Shape>;
  return {};
}

/** A size in feet: applied when you leave the box or press Enter, not on every keystroke. */
function FeetBox({ label, value, onSet }: { label: string; value: number; onSet: (v: number) => void }) {
  const shown = String(Math.round(value * 10) / 10);
  const [text, setText] = useState(shown);
  useEffect(() => { setText(shown); }, [shown]);
  const apply = () => {
    const v = Number(text);
    if (Number.isFinite(v) && v > 0 && String(Math.round(v * 10) / 10) !== shown) onSet(v);
    else setText(shown);
  };
  return (
    <label style={{ display: 'block', flex: 1, minWidth: 0 }}>
      <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#78909C', marginBottom: 3 }}>{label}</span>
      <input type="number" inputMode="decimal" min={0.5} step={0.5} value={text}
        onChange={(e) => setText(e.target.value)} onBlur={apply}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } }}
        style={{ width: '100%', height: 34, fontSize: 16, padding: '0 8px', border: '1px solid #d8dde5', borderRadius: 6 }} />
    </label>
  );
}

function SelectedPanel({ shape, url, onChange, onDelete }: {
  shape: Shape; url?: string; onChange: (patch: Partial<Shape>) => void; onDelete: () => void;
}) {
  const field = (label: string, value: string, set: (v: string) => void, placeholder = '') => (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#78909C', marginBottom: 3 }}>{label}</span>
      <input value={value} placeholder={placeholder} onChange={(e) => set(e.target.value)} maxLength={80}
        style={{ width: '100%', height: 34, fontSize: 16, padding: '0 8px', border: '1px solid #d8dde5', borderRadius: 6 }} />
    </label>
  );
  const heading = { room: 'Room', wall: shape.kind === 'wall' ? `${wallTypeInfo(shape.wtype).label}${shape.wtype && shape.wtype !== 'drywall' && !wallTypeInfo(shape.wtype).label.toLowerCase().includes('wall') ? ' wall' : ''}` : 'Wall', gap: 'Opening in a wall', cable: 'Cable run', pen: 'Drawing', line: 'Line', box: 'Box', ellipse: 'Circle', text: 'Text', symbol: shape.kind === 'symbol' ? symbolInfo(shape.sym).label : '', photo: 'Photo' }[shape.kind];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: '#0E1B2E' }}>{heading}</div>
      {shape.kind === 'room' && field('Name', shape.name, (v) => onChange({ name: v } as Partial<Shape>), 'e.g. Lobby')}
      {(shape.kind === 'room' || shape.kind === 'box' || shape.kind === 'ellipse') && (
        <>
          <div style={{ display: 'flex', gap: 8 }}>
            <FeetBox label="Width (ft)" value={shape.w} onSet={(v) => onChange(sizePatch(setSize(shape, v, shape.h)))} />
            <FeetBox label="Length (ft)" value={shape.h} onSet={(v) => onChange(sizePatch(setSize(shape, shape.w, v)))} />
          </div>
          {shape.kind === 'room' && <div style={{ color: '#455A64' }}>{feet(shape.w)} × {feet(shape.h)} · {sqft(shape.w * shape.h)}</div>}
          <div style={{ color: '#78909C', fontSize: 12 }}>Or drag the white squares on its corners and sides.</div>
        </>
      )}
      {(shape.kind === 'wall' || shape.kind === 'line' || shape.kind === 'gap') && (
        <>
          <FeetBox label={shape.kind === 'gap' ? 'Width (ft)' : 'Length (ft)'} value={Math.hypot(shape.b.x - shape.a.x, shape.b.y - shape.a.y)} onSet={(v) => onChange(sizePatch(setLength(shape, v)))} />
          <div style={{ color: '#78909C', fontSize: 12 }}>
            {shape.kind === 'gap'
              ? 'This stretch of wall is taken out. Drag its ends to make it wider, or Delete to put the wall back.'
              : 'Or drag either end (the white squares) to stretch or turn it.'}
          </div>
        </>
      )}
      {(shape.kind === 'wall' || shape.kind === 'room') && (
        <label style={{ display: 'block' }}>
          <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#78909C', marginBottom: 3 }}>{shape.kind === 'room' ? "Room's walls" : 'Wall type'}</span>
          <select value={shape.wtype ?? 'drywall'} onChange={(e) => onChange({ wtype: e.target.value === 'drywall' ? undefined : (e.target.value as WallType) } as Partial<Shape>)}
            style={{ width: '100%', height: 34, fontSize: 16, padding: '0 6px', border: '1px solid #d8dde5', borderRadius: 6 }}>
            {WALL_TYPES.map((w) => <option key={w.type} value={w.type}>{w.label}</option>)}
          </select>
          <span style={{ display: 'block', color: '#78909C', fontSize: 12, marginTop: 3 }}>
            {wallTypeInfo(shape.wtype).hint}. Wi-Fi through it: about −{wallTypeInfo(shape.wtype).wifiDb} dB.
          </span>
        </label>
      )}
      {shape.kind === 'symbol' && isFurniture(shape.sym) && (() => {
        const f = footprint(shape)!;
        return (
          <div style={{ display: 'flex', gap: 8 }}>
            <FeetBox label="Width (ft)" value={f.w} onSet={(v) => onChange({ size: { w: Math.min(Math.max(v, 0.3), 60), d: f.d } } as Partial<Shape>)} />
            <FeetBox label="Depth (ft)" value={f.d} onSet={(v) => onChange({ size: { w: f.w, d: Math.min(Math.max(v, 0.3), 60) } } as Partial<Shape>)} />
          </div>
        );
      })()}
      {shape.kind === 'symbol' && (isOpeningSymbol(shape.sym) || isFurniture(shape.sym)) && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => onChange({ rot: (shape.rot + 90) % 360 } as Partial<Shape>)}
            style={{ height: 32, padding: '0 10px', borderRadius: 8, border: '1px solid #d8dde5', background: '#fff', fontWeight: 700, cursor: 'pointer' }}>
            Turn 90°
          </button>
          {isOpeningSymbol(shape.sym) && (
            <button type="button" onClick={() => onChange({ rot: (shape.rot + 180) % 360 } as Partial<Shape>)}
              style={{ height: 32, padding: '0 10px', borderRadius: 8, border: '1px solid #d8dde5', background: '#fff', fontWeight: 700, cursor: 'pointer' }}>
              Flip side
            </button>
          )}
        </div>
      )}
      {shape.kind === 'symbol' && isOpeningSymbol(shape.sym) && (
        <div style={{ color: '#78909C', fontSize: 12 }}>Put it on a wall and it sits in the wall, with the gap shown in 3D.</div>
      )}
      {shape.kind === 'cable' && (
        <>
          <label style={{ display: 'block' }}>
            <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#78909C', marginBottom: 3 }}>Cable type</span>
            <select value={shape.cable} onChange={(e) => onChange({ cable: e.target.value as CableType, color: cableInfo(e.target.value as CableType).color } as Partial<Shape>)}
              style={{ width: '100%', height: 34, fontSize: 16, padding: '0 6px', border: '1px solid #d8dde5', borderRadius: 6 }}>
              {CABLE_TYPES.map((c) => <option key={c.type} value={c.type}>{c.label}</option>)}
            </select>
          </label>
          {field('Label', shape.label, (v) => onChange({ label: v } as Partial<Shape>), 'e.g. To camera 3')}
          <div style={{ color: '#455A64' }}>{Math.round(pathLength(shape.pts))} ft of {cableInfo(shape.cable).label}</div>
        </>
      )}
      {shape.kind === 'symbol' && field('Label', shape.label, (v) => onChange({ label: v } as Partial<Shape>), 'e.g. CAM-03')}
      {shape.kind === 'text' && (
        <>
          {field('Text', shape.text, (v) => onChange({ text: v } as Partial<Shape>))}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>Size
            <input type="range" min={0.5} max={5} step={0.1} value={shape.size} onChange={(e) => onChange({ size: Number(e.target.value) } as Partial<Shape>)} style={{ flex: 1 }} />
          </label>
        </>
      )}
      {shape.kind === 'photo' && (
        <>
          {url
            // eslint-disable-next-line @next/next/no-img-element
            ? <a href={url} target="_blank" rel="noopener noreferrer"><img src={url} alt="Photo pinned here" style={{ width: '100%', borderRadius: 8, border: '1px solid #e2e6ec' }} /></a>
            : <div style={{ color: '#78909C' }}>Loading the photo…</div>}
          {field('Note', shape.note, (v) => onChange({ note: v } as Partial<Shape>), 'What this shows')}
        </>
      )}
      <button type="button" onClick={onDelete} style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 10px', borderRadius: 8, border: '1px solid #f3c4c4', background: '#fff', color: '#b91c1c', fontWeight: 700, cursor: 'pointer' }}>
        <Trash2 size={14} /> Delete
      </button>
    </div>
  );
}

/**
 * A PNG of the whole plan with its counts underneath — for the job, reports
 * and quotes. The live drawing is copied with the selection marks taken out
 * and the floor-plan photo inlined (a linked photo would block the export).
 */
async function exportPng(svg: SVGSVGElement | null, sketch: Sketch, summary: ReturnType<typeof summarize>, title: string, bgUrl?: string): Promise<Blob | null> {
  if (!svg) return null;
  const pxPerFt = Math.min(24, 3000 / Math.max(sketch.width, sketch.height));
  const W = Math.round(sketch.width * pxPerFt), H = Math.round(sketch.height * pxPerFt);
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.querySelectorAll('[data-noexport]').forEach((n) => n.remove());
  clone.setAttribute('viewBox', `-1 -1 ${sketch.width + 2} ${sketch.height + 2}`);
  clone.setAttribute('width', String(W));
  clone.setAttribute('height', String(H));
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.removeAttribute('style');
  const bgImg = clone.querySelector('image[data-bg]');
  if (bgImg) {
    let dataUrl: string | null = null;
    if (bgUrl) {
      try {
        const blob = await (await fetch(bgUrl)).blob();
        dataUrl = await new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = rej; fr.readAsDataURL(blob); });
      } catch { dataUrl = null; }
    }
    if (dataUrl) bgImg.setAttribute('href', dataUrl); else bgImg.remove();
  }
  const xml = new XMLSerializer().serializeToString(clone);
  const img = new Image();
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('draw')); img.src = url; });
    const lines: { text: string; color: string; bold?: boolean }[] = [
      { text: title, color: '#0E1B2E', bold: true },
      ...summary.symbols.map((x) => ({ text: `${x.count}  ${x.label}`, color: symbolInfo(x.kind).color })),
      ...summary.cables.map((c) => ({ text: `${c.feet.toLocaleString('en-US')} ft ${c.label} (${c.runs} run${c.runs === 1 ? '' : 's'})`, color: cableInfo(c.type).color })),
      ...summary.rooms.map((r) => ({ text: `${r.name}: ${sqft(r.area)}`, color: '#455A64' })),
      { text: 'Each grid square = 1 ft · FAJ Solutions', color: '#90a4ae' },
    ];
    const lineH = 30, pad = 20;
    const legendH = pad * 2 + lines.length * lineH;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(W, 900);
    canvas.height = H + legendH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, W, H);
    ctx.fillStyle = '#f6f4ef';
    ctx.fillRect(0, H, canvas.width, legendH);
    lines.forEach((l, i) => {
      ctx.fillStyle = l.color;
      ctx.font = `${l.bold ? '700 ' : '600 '}${l.bold ? 22 : 18}px Inter, system-ui, sans-serif`;
      ctx.fillText(l.text, pad, H + pad + lineH * (i + 0.75));
    });
    return await new Promise<Blob | null>((res) => canvas.toBlob((b) => res(b), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}
