'use client';
// Settings -> Screen designer (Fred, 2026-10-06: "go ahead with the screen
// designer"). Arrange the Dashboard and the job page: move blocks up and
// down (or drag them on a computer), make a Dashboard block wide or half
// width, move job-page cards between the two columns, hide what you don't
// use, and add your own notes and shortcut buttons to the Dashboard.
// Saved with the menu layout by itself (components/useAppLayout.ts); the rules
// are in lib/screen-design.ts.
import { useMemo, useState, type DragEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Eye, EyeOff, GripVertical, Link2, Plus, StickyNote, Trash2 } from 'lucide-react';
import { resolveLayout, setPartShown, type Layout } from '@/lib/app-layout';
import { SCREEN_PARTS } from '@/lib/screen-parts';
import {
  CUSTOM_MAX, LINKS_MAX, NOTE_COLORS, NOTE_MAX, STANDARD_DESIGN, TITLE_MAX, addLinks, addNote, dashRows, editBlock,
  isStandardDesign, moveDashBefore, moveJob, removeBlock, setDashWidth, shiftJob, type DashBlock, type JobColumn, type ScreenDesign,
} from '@/lib/screen-design';
import type { LayoutSaveState } from '@/components/useAppLayout';
import { SaveLine } from '@/components/LayoutEditor';
import { NOTE_STYLE } from '@/components/DashboardView';

const PART_INFO: Record<string, { label: string; hint: string }> = Object.fromEntries(
  SCREEN_PARTS.flatMap((s) => s.parts.map((p) => [p.key, { label: p.label, hint: p.hint }])),
);

export default function ScreenDesigner({ layout, onChange, saveState, saveError, onRetry }: {
  layout: Layout;
  onChange: (next: Layout) => void;
  saveState: LayoutSaveState;
  saveError: string | null;
  onRetry: () => void;
}) {
  const [screen, setScreen] = useState<'dash' | 'job'>('dash');
  const [dragKey, setDragKey] = useState<string | null>(null);
  const d = layout.design ?? STANDARD_DESIGN;
  const off = new Set(layout.off ?? []);
  const setDesign = (next: ScreenDesign) => onChange({ ...layout, design: next });
  const setShown = (key: string, show: boolean) => onChange(setPartShown(layout, key, show));

  // Every screen a shortcut can open, by the name it has in Fred's menu.
  const screens = useMemo(() => {
    const r = resolveLayout(layout);
    return [...r.main, ...r.sections.flatMap((s) => s.items)].filter((s) => s.view !== null);
  }, [layout]);

  const tab = (key: 'dash' | 'job', label: string) => (
    <button type="button" onClick={() => setScreen(key)} aria-pressed={screen === key}
      className={`wf-btn wf-btn-sm ${screen === key ? 'wf-btn-gold' : 'wf-btn-outline'}`}>{label}</button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '18px 28px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {tab('dash', 'Dashboard')}
        {tab('job', 'Job page')}
        <span style={{ flex: 1 }} />
        <SaveLine state={saveState} error={saveError} onRetry={onRetry} />
        {!isStandardDesign(d) && (
          <button type="button" className="wf-btn wf-btn-outline wf-btn-sm"
            onClick={() => { if (window.confirm('Put the Dashboard and the job page back the way they came? Your notes and shortcut blocks will be removed.')) setDesign(STANDARD_DESIGN); }}>
            Back to standard
          </button>
        )}
      </div>
      <p className="wf-p-small" style={{ margin: 0, color: 'var(--wf-subtle)', lineHeight: 1.5 }}>
        {screen === 'dash'
          ? 'This is your Dashboard, block by block. Use the arrows (or drag a block on a computer) to change the order. Two half-width blocks in a row sit side by side; on a phone they stack.'
          : 'This is a job page. Cards can sit in the wide main area or the narrow column on the right. Use the arrows to move them, or drag them on a computer.'}
      </p>
      {screen === 'dash'
        ? <DashDesigner d={d} off={off} screens={screens} setDesign={setDesign} setShown={setShown} dragKey={dragKey} setDragKey={setDragKey} />
        : <JobDesigner d={d} off={off} setDesign={setDesign} setShown={setShown} dragKey={dragKey} setDragKey={setDragKey} />}
    </div>
  );
}

// ── Shared bits ──────────────────────────────────────────────────────────────

const iconBtn = (label: string, icon: ReactNode, onClick: () => void, disabled = false, danger = false) => (
  <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label}
    style={{
      width: 34, height: 34, borderRadius: 8, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      border: `1px solid ${danger ? '#f3c4c4' : 'var(--wf-line)'}`, background: '#fff', color: danger ? '#b91c1c' : 'var(--wf-ink, #0E1B2E)',
      cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.35 : 1,
    }}>
    {icon}
  </button>
);

function Tile({ title, hint, faded, dragging, draggable, onDragStart, onDragEnd, onDrop, children, accent }: {
  title: string; hint?: string; faded?: boolean; dragging?: boolean; draggable?: boolean;
  onDragStart?: () => void; onDragEnd?: () => void; onDrop?: () => void; children?: ReactNode; accent?: string;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      draggable={draggable}
      onDragStart={(e: DragEvent) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', title); onDragStart?.(); }}
      onDragEnd={() => { setOver(false); onDragEnd?.(); }}
      onDragOver={(e) => { if (onDrop) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); onDrop?.(); }}
      style={{
        border: `1px solid ${over ? '#C9A24B' : 'var(--wf-line)'}`, borderLeft: accent ? `4px solid ${accent}` : undefined,
        borderRadius: 12, background: 'var(--wf-card, #fff)', padding: 10, display: 'flex', flexDirection: 'column', gap: 8,
        opacity: faded ? 0.55 : dragging ? 0.4 : 1, boxShadow: over ? '0 0 0 3px rgba(201,162,75,0.25)' : 'none', minWidth: 0,
      }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
        {draggable && <GripVertical size={16} style={{ flexShrink: 0, marginTop: 2, color: 'var(--wf-subtle)', cursor: 'grab' }} aria-hidden />}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{title}</div>
          {hint && <div className="wf-p-small wf-subtle">{hint}</div>}
        </div>
      </div>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = { width: '100%', fontSize: 16, padding: '7px 9px', border: '1px solid var(--wf-line)', borderRadius: 8, background: '#fff' };

// ── Dashboard ────────────────────────────────────────────────────────────────

function DashDesigner({ d, off, screens, setDesign, setShown, dragKey, setDragKey }: {
  d: ScreenDesign; off: Set<string>; screens: { key: string; label: string }[];
  setDesign: (d: ScreenDesign) => void; setShown: (key: string, show: boolean) => void;
  dragKey: string | null; setDragKey: (k: string | null) => void;
}) {
  const isHidden = (b: DashBlock) => b.kind === 'part' && off.has(b.key);
  const visible = d.dash.filter((b) => !isHidden(b));
  const hidden = d.dash.filter(isHidden);
  const custom = d.dash.filter((b) => b.kind !== 'part').length;

  // Up and down step past hidden blocks, so every tap visibly moves something.
  const up = (i: number) => { if (i > 0) setDesign(moveDashBefore(d, visible[i].key, visible[i - 1].key)); };
  const down = (i: number) => { if (i < visible.length - 1) setDesign(moveDashBefore(d, visible[i].key, visible[i + 2]?.key ?? null)); };

  const tile = (b: DashBlock) => {
    const i = visible.indexOf(b);
    const title = b.kind === 'part' ? PART_INFO[b.key]?.label ?? b.key : b.kind === 'note' ? 'Your note' : 'Shortcut buttons';
    const hint = b.kind === 'part' ? PART_INFO[b.key]?.hint : b.kind === 'note' ? 'Only you see it, on the Dashboard' : 'Buttons that open the screens you use most';
    return (
      <Tile key={b.key} title={title} hint={hint} draggable dragging={dragKey === b.key}
        accent={b.kind === 'note' ? NOTE_STYLE[b.color]?.edge : undefined}
        onDragStart={() => setDragKey(b.key)} onDragEnd={() => setDragKey(null)}
        onDrop={() => { if (dragKey) setDesign(moveDashBefore(d, dragKey, b.key)); setDragKey(null); }}>
        {b.kind === 'note' && (
          <>
            <input value={b.title} maxLength={TITLE_MAX} placeholder="Title" aria-label="Note title" style={inputStyle}
              onChange={(e) => setDesign(editBlock(d, b.key, { title: e.target.value }))} />
            <textarea value={b.text} maxLength={NOTE_MAX} rows={3} placeholder="Write anything: reminders, numbers, this week's goals" aria-label="Note"
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
              onChange={(e) => setDesign(editBlock(d, b.key, { text: e.target.value }))} />
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span className="wf-p-small wf-subtle">Colour</span>
              {NOTE_COLORS.map((c) => (
                <button key={c} type="button" aria-label={`Colour: ${c}`} aria-pressed={b.color === c}
                  onClick={() => setDesign(editBlock(d, b.key, { color: c }))}
                  style={{ width: 24, height: 24, borderRadius: 999, flexShrink: 0, cursor: 'pointer', background: NOTE_STYLE[c].bg,
                    border: `${b.color === c ? 3 : 2}px solid ${NOTE_STYLE[c].edge}` }} />
              ))}
            </div>
          </>
        )}
        {b.kind === 'links' && (
          <>
            <input value={b.title} maxLength={TITLE_MAX} placeholder="Title" aria-label="Shortcut block title" style={inputStyle}
              onChange={(e) => setDesign(editBlock(d, b.key, { title: e.target.value }))} />
            <div className="wf-p-small wf-subtle">Pick up to {LINKS_MAX} screens:</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 180, overflowY: 'auto' }}>
              {screens.map((s) => {
                const on = b.views.includes(s.key);
                const full = !on && b.views.length >= LINKS_MAX;
                return (
                  <button key={s.key} type="button" aria-pressed={on} disabled={full}
                    onClick={() => setDesign(editBlock(d, b.key, { views: on ? b.views.filter((v) => v !== s.key) : [...b.views, s.key] }))}
                    style={{ padding: '6px 10px', borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: full ? 'default' : 'pointer',
                      border: `1px solid ${on ? '#C9A24B' : 'var(--wf-line)'}`, background: on ? '#FBF5E6' : '#fff', opacity: full ? 0.4 : 1 }}>
                    {on ? '✓ ' : ''}{s.label}
                  </button>
                );
              })}
            </div>
          </>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {iconBtn('Move up', <ArrowUp size={16} />, () => up(i), i <= 0)}
          {iconBtn('Move down', <ArrowDown size={16} />, () => down(i), i >= visible.length - 1)}
          <div role="group" aria-label="Width" style={{ display: 'inline-flex', border: '1px solid var(--wf-line)', borderRadius: 8, overflow: 'hidden' }}>
            {(['full', 'half'] as const).map((w) => (
              <button key={w} type="button" aria-pressed={b.width === w} onClick={() => setDesign(setDashWidth(d, b.key, w))}
                style={{ height: 32, padding: '0 10px', border: 'none', fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
                  background: b.width === w ? '#0E1B2E' : '#fff', color: b.width === w ? '#fff' : '#0E1B2E' }}>
                {w === 'full' ? 'Wide' : 'Half'}
              </button>
            ))}
          </div>
          <span style={{ flex: 1 }} />
          {b.kind === 'part'
            ? iconBtn('Hide this block', <EyeOff size={16} />, () => setShown(b.key, false))
            : iconBtn('Remove this block', <Trash2 size={16} />, () => { if (window.confirm('Remove this block from the Dashboard?')) setDesign(removeBlock(d, b.key)); }, false, true)}
        </div>
      </Tile>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="wf-btn wf-btn-outline wf-btn-sm" disabled={custom >= CUSTOM_MAX} onClick={() => setDesign(addNote(d))}>
          <Plus size={15} /><StickyNote size={15} /> Add a note
        </button>
        <button type="button" className="wf-btn wf-btn-outline wf-btn-sm" disabled={custom >= CUSTOM_MAX} onClick={() => setDesign(addLinks(d))}>
          <Plus size={15} /><Link2 size={15} /> Add shortcut buttons
        </button>
      </div>

      {/* The Dashboard as it will look: rows of wide and half blocks. */}
      <div style={{ background: 'var(--wf-surface, #F6F4EF)', border: '1px dashed var(--wf-line)', borderRadius: 14, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="wf-p-small wf-subtle" style={{ fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>Dashboard</div>
        {visible.length === 0 && <div className="wf-p-small wf-subtle">Every block is hidden. Show one below.</div>}
        {dashRows(visible).map((row) => (
          <div key={row.map((b) => b.key).join('|')} className={row.length === 2 ? 'dash-row-2' : undefined}
            style={{ display: 'grid', gridTemplateColumns: row.length === 2 ? '1fr 1fr' : '1fr', gap: 10, alignItems: 'start' }}>
            {row.map(tile)}
          </div>
        ))}
        {dragKey && (
          <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); setDesign(moveDashBefore(d, dragKey, null)); setDragKey(null); }}
            style={{ border: '2px dashed #C9A24B', borderRadius: 12, padding: 12, textAlign: 'center', color: '#8a6d2b', fontWeight: 700, fontSize: 13 }}>
            Drop here to put it last
          </div>
        )}
      </div>

      {hidden.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="wf-p-small wf-subtle" style={{ fontWeight: 700 }}>Hidden blocks</div>
          {hidden.map((b) => (
            <div key={b.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', border: '1px solid var(--wf-line)', borderRadius: 10, background: '#fff' }}>
              <span style={{ flex: 1, minWidth: 0, opacity: 0.7 }}>{PART_INFO[b.key]?.label ?? b.key}</span>
              <button type="button" className="wf-btn wf-btn-outline wf-btn-sm" onClick={() => setShown(b.key, true)}><Eye size={15} /> Show</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Job page ─────────────────────────────────────────────────────────────────

function JobDesigner({ d, off, setDesign, setShown, dragKey, setDragKey }: {
  d: ScreenDesign; off: Set<string>;
  setDesign: (d: ScreenDesign) => void; setShown: (key: string, show: boolean) => void;
  dragKey: string | null; setDragKey: (k: string | null) => void;
}) {
  const fixed = (text: string) => (
    <div className="wf-p-small" style={{ padding: '8px 10px', borderRadius: 10, background: 'rgba(14,27,46,0.05)', color: 'var(--wf-subtle)' }}>{text}</div>
  );

  const column = (col: JobColumn, keys: string[]) => (
    <div onDragOver={(e) => { if (dragKey) e.preventDefault(); }}
      onDrop={(e) => { e.preventDefault(); if (dragKey) setDesign(moveJob(d, dragKey, col, null)); setDragKey(null); }}
      style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, minHeight: 80 }}>
      <div className="wf-p-small wf-subtle" style={{ fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>
        {col === 'below' ? 'Main area (wide)' : 'Right column (narrow)'}
      </div>
      {col === 'below' && fixed('The job itself: overview, work type, description, site and checklist — always first')}
      {keys.length === 0 && <div className="wf-p-small wf-subtle" style={{ padding: 8 }}>Nothing here. Move a card in, or drop one here.</div>}
      {keys.map((k, i) => {
        const info = PART_INFO[k] ?? { label: k, hint: '' };
        const isOff = off.has(k);
        return (
          <Tile key={k} title={info.label} hint={info.hint} faded={isOff} draggable dragging={dragKey === k}
            onDragStart={() => setDragKey(k)} onDragEnd={() => setDragKey(null)}
            onDrop={() => { if (dragKey) setDesign(moveJob(d, dragKey, col, k)); setDragKey(null); }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {iconBtn('Move up', <ArrowUp size={16} />, () => setDesign(shiftJob(d, k, -1)), i === 0)}
              {iconBtn('Move down', <ArrowDown size={16} />, () => setDesign(shiftJob(d, k, 1)), i === keys.length - 1)}
              <button type="button" className="wf-btn wf-btn-outline wf-btn-sm" onClick={() => setDesign(moveJob(d, k, col === 'side' ? 'below' : 'side'))}>
                {col === 'side' ? <><ArrowLeft size={15} /> To main area</> : <>To right column <ArrowRight size={15} /></>}
              </button>
              <span style={{ flex: 1 }} />
              {isOff
                ? iconBtn('Show this card', <Eye size={16} />, () => setShown(k, true))
                : iconBtn('Hide this card', <EyeOff size={16} />, () => setShown(k, false))}
            </div>
            {isOff && <div className="wf-p-small wf-subtle">Hidden — tap the eye to show it again.</div>}
          </Tile>
        );
      })}
      {col === 'below' && fixed('Map — always last')}
      {col === 'side' && fixed('Schedule — always last')}
    </div>
  );

  return (
    <div className="screen-designer-job" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)', gap: 12, background: 'var(--wf-surface, #F6F4EF)', border: '1px dashed var(--wf-line)', borderRadius: 14, padding: 12 }}>
      {column('below', d.jobBelow)}
      {column('side', d.jobSide)}
    </div>
  );
}
