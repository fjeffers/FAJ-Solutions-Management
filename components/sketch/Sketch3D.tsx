'use client';
// The 3D model of a sketch (Fred, 2026-10-06: "also 3d model", like
// magicplan's 3D view). Rooms and walls stand up to ceiling height, each
// symbol sits where it really goes — cameras, APs and speakers up high, drops
// and outlets near the floor, the TV on the wall, the rack standing on the
// floor — and cable runs follow the ceiling. One finger (or the mouse) turns
// it, two fingers or the wheel zoom, right-drag pans. Read-only: drawing
// happens in 2D. Loaded only when opened (three.js needs the browser).
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { X, Scissors, Box as BoxIcon, RotateCcw, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Plus, Minus } from 'lucide-react';
import { feet, symbolInfo, type Shape, type Sketch, type SymbolKind } from '@/lib/sketch';

const CEILING = 9; // ft

/** How high each symbol sits, in feet. */
const MOUNT: Record<SymbolKind, number> = {
  camera: 8.5, ap: 8.85, speaker: 8.85, drop: 1.5, outlet: 1.25, tv: 5, reader: 4, rack: 0, door: 0, window: 3,
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

/** A wall from a to b (plan feet), standing on the floor. Plan y → 3D z. */
function wallMesh(a: { x: number; y: number }, b: { x: number; y: number }, height: number, color: string, opacity: number): THREE.Mesh {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const geo = new THREE.BoxGeometry(Math.max(len, 0.01), height, 0.35);
  const mat = new THREE.MeshStandardMaterial({ color, transparent: opacity < 1, opacity, roughness: 0.85 });
  const m = new THREE.Mesh(geo, mat);
  m.position.set((a.x + b.x) / 2, height / 2, (a.y + b.y) / 2);
  m.rotation.y = -Math.atan2(b.y - a.y, b.x - a.x);
  return m;
}

function symbolObject(s: Extract<Shape, { kind: 'symbol' }>): THREE.Object3D {
  const info = symbolInfo(s.sym);
  const color = new THREE.Color(info.color);
  const group = new THREE.Group();
  const y = MOUNT[s.sym];
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
    case 'window':
      body = new THREE.Mesh(new THREE.BoxGeometry(3.2, 3, 0.12), new THREE.MeshStandardMaterial({ color: 0x9fc6ea, transparent: true, opacity: 0.5 }));
      body.position.y = y + 1.5;
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

export default function Sketch3D({ sketch, title, onClose }: { sketch: Sketch; title: string; onClose: () => void }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [cutaway, setCutaway] = useState(false);
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
    home();
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
    for (const s of sketch.shapes) {
      if (s.kind === 'room') {
        const c = s.color;
        const corners = [{ x: s.x, y: s.y }, { x: s.x + s.w, y: s.y }, { x: s.x + s.w, y: s.y + s.h }, { x: s.x, y: s.y + s.h }];
        corners.forEach((a, i) => scene.add(wallMesh(a, corners[(i + 1) % 4], wallH, '#e9e4da', cutaway ? 1 : 0.92)));
        const tint = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.h), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.08 }));
        tint.rotation.x = -Math.PI / 2;
        tint.position.set(s.x + s.w / 2, 0.03, s.y + s.h / 2);
        scene.add(tint);
        const tag = labelSprite(`${s.name || 'Room'} · ${feet(s.w)} × ${feet(s.h)}`);
        tag.position.set(s.x + s.w / 2, 0.8, s.y + s.h / 2);
        scene.add(tag);
      } else if (s.kind === 'wall') {
        scene.add(wallMesh(s.a, s.b, wallH, '#d9d2c4', 1));
      } else if (s.kind === 'symbol') {
        scene.add(symbolObject(s));
      } else if (s.kind === 'cable' && s.pts.length >= 2) {
        const path = new THREE.CurvePath<THREE.Vector3>();
        for (let i = 1; i < s.pts.length; i++) {
          path.add(new THREE.LineCurve3(new THREE.Vector3(s.pts[i - 1].x, CEILING - 0.3, s.pts[i - 1].y), new THREE.Vector3(s.pts[i].x, CEILING - 0.3, s.pts[i].y)));
        }
        const tube = new THREE.Mesh(new THREE.TubeGeometry(path, Math.max(8, s.pts.length * 8), 0.09, 8, false),
          new THREE.MeshStandardMaterial({ color: s.color, roughness: 0.6 }));
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

    let raf = 0;
    const tick = () => { controls.update(); renderer.render(scene, camera); raf = requestAnimationFrame(tick); };
    tick();

    return () => {
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
  const btn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.3)', background: 'transparent', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' };
  return (
    <div role="dialog" aria-modal="true" aria-label="3D model" style={{ position: 'fixed', inset: 0, zIndex: 320, display: 'flex', flexDirection: 'column', background: '#f2efe9' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: '#0E1B2E', color: '#fff' }}>
        <button type="button" onClick={onClose} aria-label="Back to the drawing" style={btn}><X size={16} /> 2D</button>
        <div style={{ flex: 1, minWidth: 0, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}><BoxIcon size={15} style={{ verticalAlign: -2 }} /> {title} — 3D</div>
        <button type="button" onClick={() => setCutaway((v) => !v)} aria-pressed={cutaway} style={{ ...btn, background: cutaway ? '#C9A24B' : 'transparent', color: cutaway ? '#0E1B2E' : '#fff' }}><Scissors size={15} /> Cut away</button>
        <button type="button" onClick={() => resetRef.current()} aria-label="Back to the starting view" style={btn}><RotateCcw size={15} /></button>
      </div>
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />
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
      <div style={{ padding: '6px 12px', fontSize: 12, color: '#455A64', background: '#fff', borderTop: '1px solid #e2e6ec' }}>
        Drag to turn · pinch or scroll to zoom · right-drag or two fingers to slide. Walls are 9 ft; cameras, APs and speakers sit at the ceiling.
      </div>
    </div>
  );
}
