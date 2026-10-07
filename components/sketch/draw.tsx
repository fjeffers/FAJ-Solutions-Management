'use client';
// A sketch drawn as SVG, shared by the sketch pad (live, with the selected
// item marked) and the sketch report (Fred, 2026-10-06: "this is how it should
// look after it saves to PDF") — so the printed plan is the plan on screen,
// sharp at any size, not a picture of it.
import type React from 'react';
import {
  cableInfo, feet, footprint, isFurniture, midpoint, pathLength, roomCenter, roomCorners, sqft, symbolInfo, wallPieces, wallTypeInfo,
  type Opening, type Pt, type Shape, type SymbolKind, type WallType,
} from '@/lib/sketch';

export const LABEL = 0.75; // label text height, feet

/** The drawing functions for one sketch. selectedId marks the selection (the report passes null). */
export function makeDraw({ selectedId, openings }: { selectedId: string | null; openings: Opening[] }) {
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

    /**
     * A wall's length written along it, just outside (Fred, 2026-10-06: "add
     * measurements to show on each wall"). The text turns with the wall and is
     * never upside down.
     */
    const measure = (a: Pt, b: Pt, key: string, fill: string, offset = 0.85) => {
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 0.5) return null;
      const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
      const at = { x: (a.x + b.x) / 2 + uy * offset, y: (a.y + b.y) / 2 - ux * offset };
      let deg = (Math.atan2(uy, ux) * 180) / Math.PI;
      if (deg > 90) deg -= 180; else if (deg < -90) deg += 180;
      const size = LABEL * 0.75;
      return (
        <text key={key} x={at.x} y={at.y} transform={`rotate(${deg} ${at.x} ${at.y})`} fontSize={size} textAnchor="middle" dominantBaseline="middle"
          stroke="#fff" strokeWidth={size * 0.35} strokeLinejoin="round" paintOrder="stroke" fill={fill} fontWeight={700} fontFamily="Inter, system-ui, sans-serif" pointerEvents="none">
          {feet(len)}
        </text>
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
          const corners = roomCorners(s);
          const sides = corners.map((a, i) => ({ a, b: corners[(i + 1) % 4] }));
          const c = roomCenter(s);
          return (
            <g key={s.id}>
              <polygon points={corners.map((p) => `${p.x},${p.y}`).join(' ')} fill={s.color} fillOpacity={0.07} />
              {typedWall(s.id, sides, s.wtype, s.color, sw(0.3), isDraft)}
              {tag({ x: c.x, y: c.y - LABEL * 0.8 }, s.name || 'Room', `${s.id}-n`, LABEL * 1.1)}
              {tag({ x: c.x, y: c.y + LABEL * 0.5 }, label, `${s.id}-d`, LABEL * 0.85, '#455A64')}
              {tag({ x: c.x, y: c.y + LABEL * 1.6 }, sqft(s.w * s.h), `${s.id}-a`, LABEL * 0.8, '#455A64')}
              {/* The length of every side, outside the wall */}
              {sides.map((sd, i) => measure(sd.a, sd.b, `${s.id}-m${i}`, s.color, 0.55 + wallTypeInfo(s.wtype).width / 2))}
              {sel && <rect x={s.x - 0.3} y={s.y - 0.3} width={s.w + 0.6} height={s.h + 0.6} transform={s.rot ? `rotate(${s.rot} ${c.x} ${c.y})` : undefined} fill="none" stroke="#C9A24B" strokeWidth={0.12} strokeDasharray="0.5 0.3" data-noexport />}
            </g>
          );
        }
        case 'wall': {
          const len = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
          return (
            <g key={s.id}>
              {typedWall(s.id, [{ a: s.a, b: s.b }], s.wtype, s.color, 0.45, isDraft)}
              {len >= 0.5 && measure(s.a, s.b, `${s.id}-l`, s.color, 0.6 + wallTypeInfo(s.wtype).width / 2)}
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
              ) : s.sym === 'sliding' ? (
                // Two solid panels that slide past each other.
                <g transform={`translate(${s.at.x} ${s.at.y}) rotate(${s.rot})`}>
                  <rect x={-3} y={-0.3} width={6} height={0.6} fill="#fff" stroke={info.color} strokeWidth={0.06} />
                  <rect x={-3} y={-0.24} width={3.3} height={0.2} fill={info.color} fillOpacity={0.55} />
                  <rect x={-0.3} y={0.04} width={3.3} height={0.2} fill={info.color} fillOpacity={0.55} />
                </g>
              ) : s.sym === 'pocket' ? (
                // One panel that slides into a pocket inside the wall (dashed).
                <g transform={`translate(${s.at.x} ${s.at.y}) rotate(${s.rot})`}>
                  <rect x={-1.5} y={-0.1} width={3} height={0.2} fill={info.color} fillOpacity={0.55} stroke={info.color} strokeWidth={0.04} />
                  <line x1={-4.5} y1={0} x2={-1.5} y2={0} stroke={info.color} strokeWidth={0.12} strokeDasharray="0.3 0.2" />
                </g>
              ) : s.sym === 'barn' ? (
                // A panel hung on a track on the face of the wall.
                <g transform={`translate(${s.at.x} ${s.at.y}) rotate(${s.rot})`}>
                  <line x1={-4.6} y1={-0.55} x2={1.7} y2={-0.55} stroke={info.color} strokeWidth={0.08} />
                  <rect x={-1.7} y={-0.75} width={3.4} height={0.25} fill={info.color} fillOpacity={0.6} stroke={info.color} strokeWidth={0.04} />
                </g>
              ) : s.sym === 'bifold' ? (
                // Two pairs of leaves folding toward the sides.
                <g transform={`translate(${s.at.x} ${s.at.y}) rotate(${s.rot})`}>
                  <line x1={-2} y1={0} x2={2} y2={0} stroke={info.color} strokeWidth={0.06} strokeDasharray="0.2 0.15" />
                  <path d="M -2 0 L -1.5 -0.9 L -1 0 M 2 0 L 1.5 -0.9 L 1 0" fill="none" stroke={info.color} strokeWidth={0.12} strokeLinejoin="round" />
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

  return { renderShape, tag, measure, wallLines, typedWall };
}

/** Grid patterns and an arrowhead in each colour a line uses — every sketch SVG needs them. */
export function SketchDefs({ arrowColors }: { arrowColors: string[] }) {
  return (
    <defs>
      <pattern id="grid1" width={1} height={1} patternUnits="userSpaceOnUse"><path d="M 1 0 L 0 0 0 1" fill="none" stroke="#e6e9ef" strokeWidth={0.04} /></pattern>
      <pattern id="grid5" width={5} height={5} patternUnits="userSpaceOnUse"><rect width={5} height={5} fill="url(#grid1)" /><path d="M 5 0 L 0 0 0 5" fill="none" stroke="#cfd5de" strokeWidth={0.07} /></pattern>
      {arrowColors.map((c) => (
        <marker key={c} id={`arrow-${c.slice(1)}`} viewBox="0 0 10 10" refX={8} refY={5} markerWidth={4} markerHeight={4} orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill={c} />
        </marker>
      ))}
    </defs>
  );
}
