'use client';
// 3D walkthrough view of a floor plan — extruded rooms with color-coded item
// markers and floating labels. Loaded dynamically (client only): three.js
// touches window/canvas at import time. Read-only: editing happens in 2D.
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { FloorPlan } from '@/lib/types';
import { ITEM_META } from '@/lib/floorplan';

const WALL_H = 60;

function labelSprite(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const font = 'bold 28px Arial';
  ctx.font = font;
  const w = Math.min(360, Math.max(80, ctx.measureText(text).width + 24));
  canvas.width = w; canvas.height = 44;
  ctx.font = font;
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.beginPath(); ctx.roundRect(0, 0, w, 44, 10); ctx.fill();
  ctx.fillStyle = '#1a1a1a';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, 24, w - 20);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sprite.scale.set(w / 3, 44 / 3, 1);
  return sprite;
}

export default function FloorPlan3D({ plan, floorName }: { plan: FloorPlan; floorName: string }) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf2efe9);
    const camera = new THREE.PerspectiveCamera(50, 1, 1, 8000);
    camera.position.set(500, 620, 1050);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(500, 0, 350);
    controls.maxPolarAngle = Math.PI / 2.05;
    controls.enableDamping = true;

    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const sun = new THREE.DirectionalLight(0xffffff, 1.1);
    sun.position.set(600, 900, 500);
    scene.add(sun);

    // Floor slab (plan space: x right, y down -> 3D x right, z toward viewer)
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(1040, 8, 740),
      new THREE.MeshLambertMaterial({ color: 0xd9d2c5 }),
    );
    slab.position.set(500, -4, 350);
    scene.add(slab);

    // Traced photo underlay draped on the floor, matching the 2D canvas
    if (plan.bg?.url) {
      new THREE.TextureLoader().load(plan.bg.url, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        const img = tex.image as { width: number; height: number };
        const fit = Math.min(1000 / img.width, 700 / img.height);
        const overlay = new THREE.Mesh(
          new THREE.PlaneGeometry(img.width * fit, img.height * fit),
          new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: Math.min(0.85, plan.bg!.opacity + 0.2) }),
        );
        overlay.rotation.x = -Math.PI / 2;
        overlay.position.set(500, 0.6, 350);
        scene.add(overlay);
      });
    }

    // Rooms: transparent extruded boxes + edge outlines
    for (const r of plan.rooms) {
      const color = r.kind === 'closet' ? 0xc9a961 : 0x0d7377;
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(r.w, WALL_H, r.h),
        new THREE.MeshLambertMaterial({ color, transparent: true, opacity: r.kind === 'closet' ? 0.35 : 0.14 }),
      );
      box.position.set(r.x + r.w / 2, WALL_H / 2, r.y + r.h / 2);
      scene.add(box);
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(box.geometry),
        new THREE.LineBasicMaterial({ color: r.kind === 'closet' ? 0x8a6d2f : 0x0d7377 }),
      );
      edges.position.copy(box.position);
      scene.add(edges);
      const tag = labelSprite(r.name + (r.kind === 'closet' ? ' (IT)' : ''));
      tag.position.set(r.x + r.w / 2, WALL_H + 16, r.y + r.h / 2);
      scene.add(tag);
    }

    // Items: color-coded markers (racks/switches taller boxes, others pins)
    for (const it of plan.items) {
      const color = new THREE.Color(ITEM_META[it.type]?.color ?? '#6b7280');
      const tall = it.type === 'rack' || it.type === 'switch' || it.type === 'firewall';
      const mesh = tall
        ? new THREE.Mesh(new THREE.BoxGeometry(18, 42, 14), new THREE.MeshLambertMaterial({ color }))
        : new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 18, 16), new THREE.MeshLambertMaterial({ color }));
      mesh.position.set(it.x, tall ? 21 : 9, it.y);
      scene.add(mesh);
      const tagText = it.label || it.variant;
      if (tagText) {
        const tag = labelSprite(tagText);
        tag.position.set(it.x, tall ? 58 : 34, it.y);
        tag.scale.multiplyScalar(0.62);
        scene.add(tag);
      }
    }

    const tag = labelSprite(floorName);
    tag.position.set(500, WALL_H + 60, -30);
    tag.scale.multiplyScalar(1.4);
    scene.add(tag);

    let raf = 0;
    const tick = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };

    const resize = () => {
      const w = mount.clientWidth;
      const h = Math.max(380, Math.round(w * 0.55));
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    window.addEventListener('resize', resize);
    tick();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      controls.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, [plan, floorName]);

  return <div ref={mountRef} style={{ width: '100%', borderRadius: 12, overflow: 'hidden' }} />;
}
