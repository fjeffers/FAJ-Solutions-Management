'use client';
// Floor plan site survey editor — draw rooms, drop in equipment/outlet pins,
// link pins to real network drops, attach photos, and flip to a 3D view.
// Lives as the "Floor Plan" tab of NetworkView; plan JSON persists on
// network_sites.floor_plan (migration-037), photos in the network-photos bucket.
import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { createClient } from '@/lib/supabase/client';
import { toastError, toastSuccess } from '@/lib/toast';
import {
  ITEM_META, ITEM_VARIANTS, PLAN_W, PLAN_H, newPlanId, RACK_BUILDER_URL,
  polylineLength, unitsToFeet, withServiceLoop, cat6Boxes,
} from '@/lib/floorplan';
import { buildSurveyReportHTML, openSurveyReport } from '@/lib/survey-report';
import type { NetworkSite, NetworkDrop, FloorPlan, PlanRoom, PlanItem, PlanItemType, PlanRoomKind, PlanRun } from '@/lib/types';
import {
  MousePointer2, Square, Trash2, Save, Box, Map as MapIcon, ImagePlus, ExternalLink, X,
  Image as ImageIcon, Ruler, Route, FileDown, ClipboardList,
} from 'lucide-react';

const Plan3D = dynamic(() => import('./FloorPlan3D'), { ssr: false, loading: () => <div style={{ padding: 40, color: '#999', textAlign: 'center' }}>Loading 3D view…</div> });

type Tool = 'select' | 'room' | 'scale' | 'run' | `place:${PlanItemType}`;
type Sel = { kind: 'room' | 'item' | 'run'; id: string } | null;

const emptyPlan: FloorPlan = { rooms: [], items: [] };

export default function FloorPlanView({ site, drops, projectName, onSaved }: {
  site: NetworkSite;
  drops: NetworkDrop[];
  projectName: string;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const svgRef = useRef<SVGSVGElement>(null);
  const draftKey = `faj-plan-draft-${site.id}`;
  // Field safety net: unsaved edits live in localStorage so a dead spot or a
  // closed tab on-site doesn't lose the survey. Cleared on successful save.
  const restoredRef = useRef(false);
  const [plan, setPlanRaw] = useState<FloorPlan>(() => {
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem(`faj-plan-draft-${site.id}`);
        if (raw) {
          const parsed = JSON.parse(raw) as { plan?: FloorPlan };
          if (parsed?.plan) { restoredRef.current = true; return parsed.plan; }
        }
      } catch { /* corrupted draft — fall through to saved plan */ }
    }
    return site.floor_plan ?? emptyPlan;
  });
  const [tool, setTool] = useState<Tool>('select');
  const [sel, setSel] = useState<Sel>(null);
  const [view, setView] = useState<'2d' | '3d'>('2d');
  const [dirty, setDirty] = useState(() => restoredRef.current);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [draft, setDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [scalePt, setScalePt] = useState<{ x: number; y: number } | null>(null);
  const [runDraft, setRunDraft] = useState<{ x: number; y: number }[] | null>(null);
  const dragRef = useRef<{ kind: 'room' | 'item'; id: string; dx: number; dy: number } | null>(null);

  const setPlan = (fn: (p: FloorPlan) => FloorPlan) => { setPlanRaw(fn); setDirty(true); };
  const mutateItem = (id: string, fn: (i: PlanItem) => PlanItem) =>
    setPlan((p) => ({ ...p, items: p.items.map((i) => (i.id === id ? fn(i) : i)) }));
  const mutateRoom = (id: string, fn: (r: PlanRoom) => PlanRoom) =>
    setPlan((p) => ({ ...p, rooms: p.rooms.map((r) => (r.id === id ? fn(r) : r)) }));

  const mutateRun = (id: string, fn: (r: PlanRun) => PlanRun) =>
    setPlan((p) => ({ ...p, runs: (p.runs ?? []).map((r) => (r.id === id ? fn(r) : r)) }));

  const selRoom = sel?.kind === 'room' ? plan.rooms.find((r) => r.id === sel.id) ?? null : null;
  const selItem = sel?.kind === 'item' ? plan.items.find((i) => i.id === sel.id) ?? null : null;
  const selRun = sel?.kind === 'run' ? (plan.runs ?? []).find((r) => r.id === sel.id) ?? null : null;
  const linkedDrop = selItem?.drop_id ? drops.find((d) => d.id === selItem.drop_id) ?? null : null;
  const unitsPerFt = plan.scale?.unitsPerFt ?? null;

  useEffect(() => {
    if (restoredRef.current) toastSuccess('Restored unsaved survey changes from this device — Save Plan to keep them');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (dirty) {
      try { localStorage.setItem(draftKey, JSON.stringify({ t: Date.now(), plan })); } catch { /* storage full */ }
    }
  }, [plan, dirty, draftKey]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // Leaving the scale/run tools abandons their in-progress drafts.
  useEffect(() => {
    if (tool !== 'run') setRunDraft(null);
    if (tool !== 'scale') setScalePt(null);
  }, [tool]);

  // ── Pointer helpers ─────────────────────────────────────────────────────
  const pt = (e: React.PointerEvent): { x: number; y: number } => {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(PLAN_W, ((e.clientX - rect.left) / rect.width) * PLAN_W)),
      y: Math.max(0, Math.min(PLAN_H, ((e.clientY - rect.top) / rect.height) * PLAN_H)),
    };
  };

  const onCanvasDown = (e: React.PointerEvent) => {
    const p = pt(e);
    if (tool === 'room') {
      setDraft({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
    } else if (tool === 'scale') {
      if (!scalePt) { setScalePt(p); return; }
      const units = Math.hypot(p.x - scalePt.x, p.y - scalePt.y);
      setScalePt(null);
      setTool('select');
      if (units < 5) { toastError('Points too close together — use a longer reference, like a hallway.'); return; }
      const ft = Number(window.prompt('Real-world distance between those two points, in feet:', '10'));
      if (!ft || ft <= 0 || isNaN(ft)) return;
      setPlan((pl) => ({ ...pl, scale: { unitsPerFt: units / ft } }));
      toastSuccess('Scale set — cable runs now measure in feet');
    } else if (tool === 'run') {
      setRunDraft((r) => [...(r ?? []), p]);
    } else if (tool.startsWith('place:')) {
      const type = tool.slice(6) as PlanItemType;
      const item: PlanItem = { id: newPlanId(), type, x: p.x, y: p.y, label: '', photos: [] };
      setPlan((pl) => ({ ...pl, items: [...pl.items, item] }));
      setSel({ kind: 'item', id: item.id });
    } else {
      setSel(null);
    }
  };

  const onMove = (e: React.PointerEvent) => {
    if (draft) {
      const p = pt(e);
      setDraft((d) => d && { ...d, x1: p.x, y1: p.y });
      return;
    }
    const drag = dragRef.current;
    if (drag) {
      const p = pt(e);
      if (drag.kind === 'item') mutateItem(drag.id, (i) => ({ ...i, x: p.x - drag.dx, y: p.y - drag.dy }));
      else mutateRoom(drag.id, (r) => ({ ...r, x: Math.max(0, p.x - drag.dx), y: Math.max(0, p.y - drag.dy) }));
    }
  };

  const onUp = () => {
    if (draft) {
      const x = Math.min(draft.x0, draft.x1), y = Math.min(draft.y0, draft.y1);
      const w = Math.abs(draft.x1 - draft.x0), h = Math.abs(draft.y1 - draft.y0);
      if (w >= 40 && h >= 40) {
        const room: PlanRoom = { id: newPlanId(), name: `Room ${plan.rooms.length + 1}`, x, y, w, h, kind: 'room' };
        setPlan((p) => ({ ...p, rooms: [...p.rooms, room] }));
        setSel({ kind: 'room', id: room.id });
        setTool('select');
      }
      setDraft(null);
    }
    dragRef.current = null;
  };

  const startDrag = (e: React.PointerEvent, kind: 'room' | 'item', id: string, ox: number, oy: number) => {
    if (tool !== 'select') return;
    e.stopPropagation();
    const p = pt(e);
    setSel({ kind, id });
    dragRef.current = { kind, id, dx: p.x - ox, dy: p.y - oy };
  };

  // ── Persistence ─────────────────────────────────────────────────────────
  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from('network_sites')
      .update({ floor_plan: plan, updated_at: new Date().toISOString() })
      .eq('id', site.id);
    setSaving(false);
    if (error) { toastError(`Couldn't save plan: ${error.message}`); return; }
    setDirty(false);
    try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
    toastSuccess('Floor plan saved');
    onSaved();
  };

  const exportPdf = () => {
    const svg = svgRef.current?.outerHTML;
    if (!svg) { setView('2d'); toastError('Switched to the 2D plan — hit Survey PDF again.'); return; }
    const html = buildSurveyReportHTML({ projectName, floorName: site.name, plan, drops, planSvg: svg });
    if (!openSurveyReport(html)) toastError('Popup blocked — allow popups for this site to export the survey PDF.');
  };

  // Turn the placed pins + measured runs into a draft quote in the Quotes tab.
  const draftQuote = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setQuoting(true);
    const year = new Date().getFullYear();
    const { data: qnums } = await supabase.from('quotes').select('quote_number');
    const nums = (qnums ?? [])
      .map((q) => q.quote_number as string)
      .filter((n) => n?.startsWith(`Q-${year}-`))
      .map((n) => parseInt(n.split('-')[2] ?? '0', 10))
      .filter((n) => !isNaN(n));
    const quote_number = `Q-${year}-${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0')}`;

    const groups = new Map<string, number>();
    for (const it of plan.items) {
      const desc = `${ITEM_META[it.type].label}${it.variant ? ` — ${it.variant}` : ''} (supply/install)`;
      groups.set(desc, (groups.get(desc) ?? 0) + 1);
    }
    const line_items = [...groups.entries()].map(([description, quantity]) => ({ id: newPlanId(), description, quantity, rate: 0 }));
    const runs = plan.runs ?? [];
    if (runs.length > 0) {
      const totalUnits = runs.reduce((s, r) => s + polylineLength(r.points), 0);
      const ft = unitsToFeet(totalUnits, unitsPerFt);
      line_items.push({
        id: newPlanId(),
        description: ft != null
          ? `Cat6 cable runs — ${Math.round(ft)} ft measured, ~${Math.round(withServiceLoop(ft))} ft with service loop (${cat6Boxes(ft)} box${cat6Boxes(ft) !== 1 ? 'es' : ''} of Cat6)`
          : `Cat6 cable runs — ${runs.length} measured path${runs.length !== 1 ? 's' : ''} (set the plan scale for footage)`,
        quantity: 1,
        rate: 0,
      });
    }
    const { error } = await supabase.from('quotes').insert({
      user_id: user.id, quote_number, client_name: projectName || null,
      title: `Site survey — ${projectName ? `${projectName} ` : ''}${site.name}`,
      description: 'Drafted from the floor plan site survey. Set your rate on each line.',
      line_items, subtotal: 0, tax_rate: 0, tax_amount: 0, total: 0, status: 'draft',
    });
    setQuoting(false);
    if (error) { toastError(`Couldn't create quote: ${error.message}`); return; }
    toastSuccess(`Draft ${quote_number} created — open Quotes to set your rates`);
  };

  const uploadPhoto = async (item: PlanItem, file: File) => {
    setUploading(true);
    const path = `${site.id}/${item.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;
    const { error } = await supabase.storage.from('network-photos').upload(path, file);
    if (error) { setUploading(false); toastError(`Upload failed: ${error.message}`); return; }
    const { data } = supabase.storage.from('network-photos').getPublicUrl(path);
    mutateItem(item.id, (i) => ({ ...i, photos: [...i.photos, data.publicUrl] }));
    setUploading(false);
    toastSuccess('Photo added — remember to Save Plan');
  };

  const removePhoto = async (item: PlanItem, url: string) => {
    const path = url.split('/network-photos/')[1];
    if (path) await supabase.storage.from('network-photos').remove([decodeURIComponent(path)]);
    mutateItem(item.id, (i) => ({ ...i, photos: i.photos.filter((u) => u !== url) }));
  };

  const uploadBg = async (file: File) => {
    setUploading(true);
    const path = `${site.id}/background/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;
    const { error } = await supabase.storage.from('network-photos').upload(path, file);
    if (error) { setUploading(false); toastError(`Upload failed: ${error.message}`); return; }
    const { data } = supabase.storage.from('network-photos').getPublicUrl(path);
    setPlan((p) => ({ ...p, bg: { url: data.publicUrl, opacity: 0.5 } }));
    setUploading(false);
    toastSuccess('Photo set as underlay — trace rooms over it, then Save Plan');
  };

  const removeBg = async () => {
    const url = plan.bg?.url;
    if (url) {
      const path = url.split('/network-photos/')[1];
      if (path) await supabase.storage.from('network-photos').remove([decodeURIComponent(path)]);
    }
    setPlan((p) => ({ ...p, bg: null }));
  };

  const dropName = (d: NetworkDrop) =>
    `${d.room}${d.wall_jack_label ? ` — ${d.wall_jack_label}` : d.assigned_to ? ` — ${d.assigned_to}` : ''}`;

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <button className={`filter-chip ${view === '2d' ? 'active' : ''}`} onClick={() => setView('2d')}><MapIcon size={12} style={{ marginRight: 4, verticalAlign: -2 }} />2D Plan</button>
        <button className={`filter-chip ${view === '3d' ? 'active' : ''}`} onClick={() => setView('3d')}><Box size={12} style={{ marginRight: 4, verticalAlign: -2 }} />3D View</button>
        {view === '2d' && (
          <>
            <span style={{ width: 1, height: 22, background: '#ddd', margin: '0 4px' }} />
            <button className={`filter-chip ${tool === 'select' ? 'active' : ''}`} onClick={() => setTool('select')} title="Select / move"><MousePointer2 size={12} style={{ marginRight: 4, verticalAlign: -2 }} />Select</button>
            <button className={`filter-chip ${tool === 'room' ? 'active' : ''}`} onClick={() => setTool('room')} title="Drag on the canvas to draw a room"><Square size={12} style={{ marginRight: 4, verticalAlign: -2 }} />Draw Room</button>
            {(Object.keys(ITEM_META) as PlanItemType[]).map((t) => (
              <button
                key={t}
                className={`filter-chip ${tool === `place:${t}` ? 'active' : ''}`}
                onClick={() => setTool(`place:${t}`)}
                title={`Click the canvas to place: ${ITEM_META[t].label}`}
                style={{ borderLeft: `4px solid ${ITEM_META[t].color}` }}
              >
                {ITEM_META[t].label}
              </button>
            ))}
            <span style={{ width: 1, height: 22, background: '#ddd', margin: '0 4px' }} />
            <button className={`filter-chip ${tool === 'scale' ? 'active' : ''}`} onClick={() => setTool('scale')} title="Click two points a known distance apart, then enter the feet — cable runs then measure in real footage">
              <Ruler size={12} style={{ marginRight: 4, verticalAlign: -2 }} />{plan.scale ? 'Rescale' : 'Set Scale'}
            </button>
            <button className={`filter-chip ${tool === 'run' ? 'active' : ''}`} onClick={() => setTool('run')} title="Click waypoints along a cable path (drop to closet); double-click to finish">
              <Route size={12} style={{ marginRight: 4, verticalAlign: -2 }} />Measure Run
            </button>
            <span style={{ width: 1, height: 22, background: '#ddd', margin: '0 4px' }} />
            {!plan.bg ? (
              <label className="filter-chip" style={{ cursor: 'pointer' }} title="Photo of the building's floor plan / evac map / blueprint — shows faded under the canvas so you can trace rooms over it">
                <ImageIcon size={12} style={{ marginRight: 4, verticalAlign: -2 }} />{uploading ? 'Uploading…' : 'Trace Photo'}
                <input type="file" accept="image/*" style={{ display: 'none' }}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadBg(f); e.target.value = ''; }} />
              </label>
            ) : (
              <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 11, color: '#777' }}>
                <ImageIcon size={12} /> Underlay
                <input
                  type="range" min={10} max={100} value={Math.round(plan.bg.opacity * 100)} style={{ width: 80 }}
                  title="Underlay visibility"
                  onChange={(e) => setPlan((p) => ({ ...p, bg: p.bg && { ...p.bg, opacity: Number(e.target.value) / 100 } }))}
                />
                <button onClick={removeBg} title="Remove underlay photo" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b91c1c', padding: 2, display: 'flex' }}><X size={13} /></button>
              </span>
            )}
          </>
        )}
        <div style={{ flex: 1 }} />
        <button className="btn btn-ghost" onClick={exportPdf} title="Print-ready site survey report — save as PDF from the print dialog">
          <FileDown size={14} /> Survey PDF
        </button>
        <button className="btn btn-ghost" onClick={draftQuote} disabled={quoting || plan.items.length === 0} title="Create a draft quote in Quotes from the items and cable runs on this plan">
          <ClipboardList size={14} /> {quoting ? 'Creating…' : 'Draft Quote'}
        </button>
        <button className="btn btn-primary" onClick={save} disabled={!dirty || saving}>
          <Save size={14} /> {saving ? 'Saving…' : dirty ? 'Save Plan' : 'Saved'}
        </button>
      </div>

      {view === '3d' ? (
        <div className="glass card" style={{ padding: 8 }}>
          <Plan3D plan={plan} floorName={site.name} />
          <div style={{ fontSize: 11, color: '#999', padding: '8px 6px 2px' }}>
            Drag to orbit · scroll to zoom · right-drag to pan. Edit in the 2D plan; changes appear here instantly.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {/* Canvas */}
          <div className="glass card" style={{ padding: 8, flex: '1 1 560px', minWidth: 320 }}>
            <svg
              ref={svgRef}
              viewBox={`0 0 ${PLAN_W} ${PLAN_H}`}
              style={{ width: '100%', aspectRatio: `${PLAN_W}/${PLAN_H}`, display: 'block', borderRadius: 8, background: '#fbfaf7', cursor: tool === 'select' ? 'default' : 'crosshair', touchAction: 'none' }}
              onPointerDown={onCanvasDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerLeave={onUp}
              onDoubleClick={() => {
                if (tool === 'run' && runDraft && runDraft.length >= 3) {
                  const pts = runDraft.slice(0, -1); // the double-click added a duplicate endpoint
                  const run: PlanRun = { id: newPlanId(), points: pts };
                  setPlan((p) => ({ ...p, runs: [...(p.runs ?? []), run] }));
                  setSel({ kind: 'run', id: run.id });
                  setRunDraft(null);
                  setTool('select');
                }
              }}
            >
              <defs>
                <pattern id="fp-grid" width="25" height="25" patternUnits="userSpaceOnUse">
                  <path d="M 25 0 L 0 0 0 25" fill="none" stroke="#eee8dd" strokeWidth="1" />
                </pattern>
              </defs>
              <rect width={PLAN_W} height={PLAN_H} fill="url(#fp-grid)" />
              {plan.bg && (
                <image
                  href={plan.bg.url} x={0} y={0} width={PLAN_W} height={PLAN_H}
                  preserveAspectRatio="xMidYMid meet" opacity={plan.bg.opacity}
                  style={{ pointerEvents: 'none' }}
                />
              )}

              {plan.rooms.map((r) => (
                <g key={r.id} onPointerDown={(e) => startDrag(e, 'room', r.id, r.x, r.y)} style={{ cursor: tool === 'select' ? 'move' : undefined }}>
                  <rect
                    x={r.x} y={r.y} width={r.w} height={r.h} rx={4}
                    fill={r.kind === 'closet' ? 'rgba(201,169,97,0.18)' : r.kind === 'open' ? 'rgba(13,115,119,0.04)' : 'rgba(13,115,119,0.08)'}
                    stroke={sel?.kind === 'room' && sel.id === r.id ? '#C9A961' : r.kind === 'closet' ? '#a8863d' : '#0D7377'}
                    strokeWidth={sel?.kind === 'room' && sel.id === r.id ? 3 : 1.5}
                    strokeDasharray={r.kind === 'open' ? '6 4' : undefined}
                  />
                  <text x={r.x + r.w / 2} y={r.y + 16} textAnchor="middle" fontSize={13} fontWeight={700} fill={r.kind === 'closet' ? '#8a6d2f' : '#0D7377'}>
                    {r.name}{r.kind === 'closet' ? ' 🔧' : ''}
                  </text>
                </g>
              ))}

              {plan.items.map((it) => {
                const meta = ITEM_META[it.type];
                const isSel = sel?.kind === 'item' && sel.id === it.id;
                return (
                  <g key={it.id} onPointerDown={(e) => startDrag(e, 'item', it.id, it.x, it.y)} style={{ cursor: tool === 'select' ? 'move' : undefined }}>
                    <title>{[meta.label, it.variant, it.label, it.ports].filter(Boolean).join(' · ')}</title>
                    {isSel && <circle cx={it.x} cy={it.y} r={16} fill="none" stroke="#C9A961" strokeWidth={2.5} />}
                    <circle cx={it.x} cy={it.y} r={11} fill={meta.color} />
                    <text x={it.x} y={it.y + 4} textAnchor="middle" fontSize={11} fontWeight={800} fill="white">{meta.glyph}</text>
                    {it.photos.length > 0 && <circle cx={it.x + 9} cy={it.y - 9} r={4.5} fill="#C9A961" stroke="white" strokeWidth={1} />}
                    {it.label && (
                      <text x={it.x} y={it.y + 26} textAnchor="middle" fontSize={10} fontWeight={600} fill="#555">{it.label}</text>
                    )}
                  </g>
                );
              })}

              {(plan.runs ?? []).map((r) => {
                const isSel = sel?.kind === 'run' && sel.id === r.id;
                const len = polylineLength(r.points);
                const ft = unitsToFeet(len, unitsPerFt);
                const mid = r.points[Math.floor(r.points.length / 2)];
                const ptsStr = r.points.map((p) => `${p.x},${p.y}`).join(' ');
                return (
                  <g
                    key={r.id}
                    onPointerDown={(e) => { if (tool === 'select') { e.stopPropagation(); setSel({ kind: 'run', id: r.id }); } }}
                    style={{ cursor: tool === 'select' ? 'pointer' : undefined }}
                  >
                    <polyline points={ptsStr} fill="none" stroke="transparent" strokeWidth={14} />
                    <polyline points={ptsStr} fill="none" stroke={isSel ? '#C9A961' : '#e8590c'} strokeWidth={isSel ? 3 : 2} strokeDasharray="8 5" />
                    <text x={mid.x} y={mid.y - 8} textAnchor="middle" fontSize={11} fontWeight={700} fill="#e8590c">
                      {ft != null ? `${Math.round(ft)} ft` : `${Math.round(len)} u`}
                    </text>
                  </g>
                );
              })}
              {runDraft && runDraft.length > 0 && (
                <polyline points={runDraft.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#e8590c" strokeWidth={2} strokeDasharray="4 4" opacity={0.7} />
              )}
              {scalePt && <circle cx={scalePt.x} cy={scalePt.y} r={5} fill="#C9A961" stroke="white" strokeWidth={1.5} />}
              {draft && (
                <rect
                  x={Math.min(draft.x0, draft.x1)} y={Math.min(draft.y0, draft.y1)}
                  width={Math.abs(draft.x1 - draft.x0)} height={Math.abs(draft.y1 - draft.y0)}
                  fill="rgba(13,115,119,0.08)" stroke="#0D7377" strokeDasharray="6 4" strokeWidth={1.5}
                />
              )}
            </svg>
            <div style={{ fontSize: 11, color: '#999', padding: '8px 6px 2px' }}>
              {tool === 'room' ? 'Drag on the canvas to draw a room.'
                : tool === 'scale' ? (scalePt ? 'Now click the second reference point…' : 'Click the first of two points a known distance apart (e.g. both ends of a hallway).')
                : tool === 'run' ? 'Click waypoints along the cable path — double-click to finish the run.'
                : tool.startsWith('place:') ? `Click anywhere to place a ${ITEM_META[tool.slice(6) as PlanItemType].label} — keep clicking to place more, then hit Select.`
                : `Click to select · drag to move. Gold dot on a pin = has photos.${plan.scale ? '' : ' Tip: Set Scale to measure cable runs in feet.'}`}
            </div>
          </div>

          {/* Properties panel */}
          <div className="glass card" style={{ flex: '0 1 320px', minWidth: 280 }}>
            {selRoom && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontWeight: 700 }}>Room</div>
                <PanelField label="Name"><input className="input" value={selRoom.name} onChange={(e) => mutateRoom(selRoom.id, (r) => ({ ...r, name: e.target.value }))} /></PanelField>
                <PanelField label="Type">
                  <select className="input" value={selRoom.kind} onChange={(e) => mutateRoom(selRoom.id, (r) => ({ ...r, kind: e.target.value as PlanRoomKind }))}>
                    <option value="room">Room / Office</option>
                    <option value="closet">IT Closet / IDF</option>
                    <option value="open">Open Area</option>
                  </select>
                </PanelField>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <PanelField label="Width"><input className="input" type="number" value={Math.round(selRoom.w)} onChange={(e) => mutateRoom(selRoom.id, (r) => ({ ...r, w: Math.max(40, Number(e.target.value) || 40) }))} /></PanelField>
                  <PanelField label="Depth"><input className="input" type="number" value={Math.round(selRoom.h)} onChange={(e) => mutateRoom(selRoom.id, (r) => ({ ...r, h: Math.max(40, Number(e.target.value) || 40) }))} /></PanelField>
                </div>
                <button className="btn btn-ghost" style={{ color: '#b91c1c' }} onClick={() => { setPlan((p) => ({ ...p, rooms: p.rooms.filter((r) => r.id !== selRoom.id) })); setSel(null); }}>
                  <Trash2 size={13} /> Delete Room
                </button>
              </div>
            )}

            {selItem && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 12, height: 12, borderRadius: 4, background: ITEM_META[selItem.type].color, display: 'inline-block' }} />
                  {ITEM_META[selItem.type].label}
                </div>
                <PanelField label="Type">
                  <select className="input" value={selItem.type} onChange={(e) => mutateItem(selItem.id, (i) => ({ ...i, type: e.target.value as PlanItemType, variant: '' }))}>
                    {(Object.keys(ITEM_META) as PlanItemType[]).map((t) => <option key={t} value={t}>{ITEM_META[t].label}</option>)}
                  </select>
                </PanelField>
                <PanelField label="Variety / Model">
                  <input
                    className="input"
                    list={`fp-variants-${selItem.type}`}
                    value={selItem.variant ?? ''}
                    onChange={(e) => mutateItem(selItem.id, (i) => ({ ...i, variant: e.target.value }))}
                    placeholder={ITEM_VARIANTS[selItem.type][0] ?? 'e.g. model / kind'}
                  />
                  <datalist id={`fp-variants-${selItem.type}`}>
                    {ITEM_VARIANTS[selItem.type].map((v) => <option key={v} value={v} />)}
                  </datalist>
                </PanelField>
                <PanelField label="Label"><input className="input" value={selItem.label} onChange={(e) => mutateItem(selItem.id, (i) => ({ ...i, label: e.target.value }))} placeholder="e.g. 2153-A, WS-Reception" /></PanelField>
                <PanelField label="Link to Network Drop">
                  <select
                    className="input"
                    value={selItem.drop_id ?? ''}
                    onChange={(e) => {
                      const d = drops.find((x) => x.id === e.target.value) ?? null;
                      mutateItem(selItem.id, (i) => ({
                        ...i,
                        drop_id: d?.id ?? null,
                        label: i.label || (d ? (d.target_label ?? d.wall_jack_label ?? d.room) : i.label),
                      }));
                    }}
                  >
                    <option value="">— Not linked —</option>
                    {drops.map((d) => <option key={d.id} value={d.id}>{dropName(d)}</option>)}
                  </select>
                </PanelField>
                {linkedDrop && (
                  <div style={{ fontSize: 12, background: 'rgba(13,115,119,0.07)', borderRadius: 8, padding: '8px 10px', color: '#333' }}>
                    <div><b>{linkedDrop.room}</b>{linkedDrop.assigned_to ? ` · ${linkedDrop.assigned_to}` : ''}</div>
                    {linkedDrop.target_label && <div>New label: <b style={{ color: 'var(--teal)' }}>{linkedDrop.target_label}</b></div>}
                    {linkedDrop.switch_port != null && <div>Switch port: {linkedDrop.switch_port}</div>}
                    {linkedDrop.jacks && <div>Jacks: {linkedDrop.jacks}</div>}
                  </div>
                )}
                <PanelField label="Ports / Jacks"><input className="input" value={selItem.ports ?? ''} onChange={(e) => mutateItem(selItem.id, (i) => ({ ...i, ports: e.target.value }))} placeholder="e.g. 2x Cat6 — A data, B voice" /></PanelField>
                <PanelField label="Notes"><textarea className="input" rows={2} value={selItem.notes ?? ''} onChange={(e) => mutateItem(selItem.id, (i) => ({ ...i, notes: e.target.value }))} /></PanelField>

                {selItem.type === 'rack' && (
                  <a className="btn btn-ghost" href={RACK_BUILDER_URL} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', justifyContent: 'center' }}>
                    <ExternalLink size={13} /> Design this rack in 3D Rack Builder
                  </a>
                )}

                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: '#555', textTransform: 'uppercase', marginBottom: 6 }}>
                    Photos ({selItem.photos.length})
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {selItem.photos.map((url) => (
                      <div key={url} style={{ position: 'relative' }}>
                        <a href={url} target="_blank" rel="noopener noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={url} alt="site photo" style={{ width: 74, height: 74, objectFit: 'cover', borderRadius: 8, border: '1px solid #eee' }} />
                        </a>
                        <button
                          onClick={() => removePhoto(selItem, url)}
                          title="Remove photo"
                          style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 999, border: 'none', background: '#b91c1c', color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        ><X size={11} /></button>
                      </div>
                    ))}
                    <label className="btn btn-ghost" style={{ cursor: 'pointer', height: 74, width: 74, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, fontSize: 10 }}>
                      <ImagePlus size={16} /> {uploading ? 'Uploading…' : 'Add'}
                      <input
                        type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPhoto(selItem, f); e.target.value = ''; }}
                      />
                    </label>
                  </div>
                </div>

                <button className="btn btn-ghost" style={{ color: '#b91c1c' }} onClick={() => { setPlan((p) => ({ ...p, items: p.items.filter((i) => i.id !== selItem.id) })); setSel(null); }}>
                  <Trash2 size={13} /> Delete Item
                </button>
              </div>
            )}

            {selRun && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 12, height: 12, borderRadius: 4, background: '#e8590c', display: 'inline-block' }} />
                  Cable Run
                </div>
                {(() => {
                  const len = polylineLength(selRun.points);
                  const ft = unitsToFeet(len, unitsPerFt);
                  return (
                    <div style={{ fontSize: 12, background: 'rgba(232,89,12,0.07)', borderRadius: 8, padding: '8px 10px', color: '#333' }}>
                      {ft != null ? (
                        <>
                          <div>Measured: <b>{Math.round(ft)} ft</b></div>
                          <div>With 15% service loop: <b>{Math.round(withServiceLoop(ft))} ft</b></div>
                        </>
                      ) : (
                        <div>{Math.round(len)} plan units — use <b>Set Scale</b> to get feet.</div>
                      )}
                      <div style={{ color: '#999' }}>{selRun.points.length} waypoints</div>
                    </div>
                  );
                })()}
                <PanelField label="Note"><input className="input" value={selRun.note ?? ''} onChange={(e) => mutateRun(selRun.id, (r) => ({ ...r, note: e.target.value }))} placeholder="e.g. 2153 to IDF, above ceiling" /></PanelField>
                <button className="btn btn-ghost" style={{ color: '#b91c1c' }} onClick={() => { setPlan((p) => ({ ...p, runs: (p.runs ?? []).filter((r) => r.id !== selRun.id) })); setSel(null); }}>
                  <Trash2 size={13} /> Delete Run
                </button>
              </div>
            )}

            {!selRoom && !selItem && !selRun && (
              <div style={{ fontSize: 13, color: '#777', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontWeight: 700, color: '#333' }}>Site Survey</div>
                <div>0. Got a photo of the building plan (evac map, blueprint)? <b>Trace Photo</b> puts it under the canvas so your rooms match reality.</div>
                <div>1. <b>Draw Room</b> — drag out each office, the IT closet, open areas.</div>
                <div>2. Pick an item from the palette and <b>click to place</b> drops, outlets, workstations, APs, the rack…</div>
                <div>3. Select a pin to <b>link it to a real drop</b>, note ports, and <b>attach photos</b> from your phone camera.</div>
                <div>4. <b>Set Scale</b> once, then <b>Measure Run</b> drop-to-closet paths for real cable footage.</div>
                <div>5. Flip to <b>3D View</b> to walk the client through it — then <b>Survey PDF</b> or <b>Draft Quote</b>.</div>
                {(plan.runs?.length ?? 0) > 0 && (() => {
                  const totalUnits = (plan.runs ?? []).reduce((s, r) => s + polylineLength(r.points), 0);
                  const ft = unitsToFeet(totalUnits, unitsPerFt);
                  return (
                    <div style={{ background: 'rgba(232,89,12,0.07)', borderRadius: 8, padding: '8px 10px', color: '#333', fontSize: 12 }}>
                      <b>{plan.runs!.length} cable run{plan.runs!.length !== 1 ? 's' : ''}</b>
                      {ft != null
                        ? <> · {Math.round(ft)} ft measured · {Math.round(withServiceLoop(ft))} ft with loop ≈ <b>{cat6Boxes(ft)} box{cat6Boxes(ft) !== 1 ? 'es' : ''} of Cat6</b></>
                        : <> · set the scale to total footage</>}
                    </div>
                  );
                })()}
                <div style={{ borderTop: '1px dashed #eee', paddingTop: 8 }}>
                  {(Object.keys(ITEM_META) as PlanItemType[]).map((t) => (
                    <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginRight: 10, marginBottom: 4, fontSize: 11 }}>
                      <span style={{ width: 9, height: 9, borderRadius: 3, background: ITEM_META[t].color, display: 'inline-block' }} />{ITEM_META[t].label}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PanelField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: '#555', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  );
}
