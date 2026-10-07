'use client';
// Settings -> Menu & screens (Fred, 2026-10-05: "I want setting to be able to
// create or change layouts of the app, add, remove anything — full admin
// privilege in settings"). Rename, reorder, hide or move any screen, and make
// Office sections of his own. Every change shows in the menu at once and saves
// by itself (components/useAppLayout.ts); the rules are in lib/app-layout.ts.
import { useState } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, Eye, EyeOff, FolderPlus, Loader2, RotateCcw, Trash2, Undo2 } from 'lucide-react';
import {
  OFFICE_KEY, SETTINGS_KEY, addSection, isStandardMenu, moveScreen, normalizeLayout, placeOf, resetMenu,
  removeSection, renameScreen, renameSection, resolveLayout, setHidden, shiftScreen, shiftSection,
  type Layout, type Screen,
} from '@/lib/app-layout';
import { OfficeIcon } from '@/components/OfficeHub';
import type { LayoutSaveState } from '@/components/useAppLayout';

const iconBtn: React.CSSProperties = {
  width: 34, height: 34, borderRadius: 8, border: '1px solid var(--wf-line)', background: 'var(--wf-card)',
  color: 'var(--wf-text)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0,
};
const disabledBtn: React.CSSProperties = { ...iconBtn, opacity: 0.35, cursor: 'default' };

export default function LayoutEditor({ layout, onChange, saveState, saveError, onRetry }: {
  layout: Layout;
  onChange: (next: Layout) => void;
  saveState: LayoutSaveState;
  saveError: string | null;
  onRetry: () => void;
}) {
  // What the menu was when Settings opened, for "Undo my changes".
  const [start] = useState<Layout>(() => normalizeLayout(layout));
  const r = resolveLayout(layout);
  const changedSinceOpen = JSON.stringify(normalizeLayout(layout)) !== JSON.stringify(start);
  const places = [{ id: 'main', title: 'Left menu' }, ...r.sections.map((s) => ({ id: s.id, title: s.title }))];

  const nameValue = (key: string, standard: string) => (key in layout.labels ? layout.labels[key] : standard);

  const row = (s: Screen, i: number, count: number) => {
    const renamed = s.label !== s.standardLabel;
    const place = placeOf(layout, s.key) ?? 'main';
    return (
      <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '8px 12px', borderTop: '1px solid var(--wf-line)', opacity: s.hidden ? 0.55 : 1 }}>
        <span style={{ color: 'var(--wf-subtle)', display: 'inline-flex' }}><OfficeIcon k={s.key} size={18} /></span>
        <div style={{ flex: '1 1 170px', minWidth: 0 }}>
          <input className="wf-input" value={nameValue(s.key, s.standardLabel)} placeholder={s.standardLabel}
            aria-label={`Name for ${s.standardLabel}`} maxLength={40}
            onChange={(e) => onChange(renameScreen(layout, s.key, e.target.value))}
            style={{ minHeight: 36, padding: '6px 10px' }} />
          {(renamed || s.hidden) && (
            <div className="wf-p-small wf-subtle" style={{ marginTop: 2 }}>
              {renamed && <>Standard name: {s.standardLabel}</>}
              {renamed && s.hidden && ' · '}
              {s.hidden && <strong>Hidden from the menu</strong>}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" style={i === 0 ? disabledBtn : iconBtn} disabled={i === 0} title="Move up" aria-label={`Move ${s.label} up`}
            onClick={() => onChange(shiftScreen(layout, s.key, -1))}><ArrowUp size={16} /></button>
          <button type="button" style={i === count - 1 ? disabledBtn : iconBtn} disabled={i === count - 1} title="Move down" aria-label={`Move ${s.label} down`}
            onClick={() => onChange(shiftScreen(layout, s.key, 1))}><ArrowDown size={16} /></button>
          {s.key === OFFICE_KEY ? (
            <span className="wf-p-small wf-subtle" style={{ width: 150 }}>Always in the left menu</span>
          ) : (
            <select className="wf-input" value={place} aria-label={`Where ${s.label} goes`}
              onChange={(e) => onChange(moveScreen(layout, s.key, e.target.value))}
              style={{ width: 150, minHeight: 36, padding: '6px 8px' }}>
              {places.map((p) => <option key={p.id} value={p.id}>{p.id === 'main' ? 'Left menu' : `Office › ${p.title}`}</option>)}
            </select>
          )}
          {s.key === OFFICE_KEY || s.key === SETTINGS_KEY ? (
            <span style={{ ...disabledBtn, width: 92, opacity: 0.6, fontSize: 12 }} title="Always shown, so you can always get back to Settings">Always on</span>
          ) : (
            <button type="button" className={`wf-btn wf-btn-sm ${s.hidden ? 'wf-btn-gold' : 'wf-btn-outline'}`} style={{ width: 92 }}
              onClick={() => onChange(setHidden(layout, s.key, !s.hidden))} aria-pressed={s.hidden}
              title={s.hidden ? 'Put it back on the menu' : 'Take it off the menu (nothing is deleted)'}>
              {s.hidden ? <><Eye size={14} /> Show</> : <><EyeOff size={14} /> Hide</>}
            </button>
          )}
        </div>
      </div>
    );
  };

  const box: React.CSSProperties = { border: '1px solid var(--wf-line)', borderRadius: 12, overflow: 'hidden', background: 'var(--wf-card)' };
  const head: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '10px 12px', background: 'var(--wf-surface, #F6F4EF)' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '18px 28px 24px' }}>
      <p className="wf-p-small" style={{ margin: 0, color: 'var(--wf-subtle)', lineHeight: 1.5 }}>
        Rename, reorder, hide or move any screen, and make Office sections of your own. Changes show in the menu
        right away and save by themselves. <strong>Hiding only takes a screen off the menu</strong> — nothing is
        deleted, and you can show it again here. Office always stays in the left menu and Settings can&apos;t be
        hidden, so you can always get back here.
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minHeight: 34 }}>
        <SaveLine state={saveState} error={saveError} onRetry={onRetry} />
        <span style={{ flex: 1 }} />
        {changedSinceOpen && (
          <button type="button" className="wf-btn wf-btn-outline wf-btn-sm" onClick={() => onChange(start)}>
            <Undo2 size={14} /> Undo my changes
          </button>
        )}
        {!isStandardMenu(layout) && (
          <button type="button" className="wf-btn wf-btn-outline wf-btn-sm"
            onClick={() => { if (window.confirm('Put the menu back to the standard layout? Your names, order, sections and hidden screens go back to how they came.')) onChange(resetMenu(layout)); }}>
            <RotateCcw size={14} /> Standard menu
          </button>
        )}
      </div>

      <section style={box}>
        <div style={head}>
          <span className="wf-p-title" style={{ flex: 1 }}>Left menu</span>
          <span className="wf-p-small wf-subtle">Always on screen, top to bottom</span>
        </div>
        {r.main.map((s, i) => row(s, i, r.main.length))}
      </section>

      {r.sections.map((sec, si) => {
        const raw = layout.sections.find((x) => x.id === sec.id)!;
        const empty = sec.items.length === 0;
        return (
          <section key={sec.id} style={box}>
            <div style={head}>
              <span className="wf-p-small wf-subtle" style={{ fontWeight: 700 }}>Office ›</span>
              <input className="wf-input" value={raw.title} aria-label="Section name" placeholder="Section name" maxLength={40}
                onChange={(e) => onChange(renameSection(layout, sec.id, e.target.value))}
                style={{ flex: '1 1 160px', minHeight: 36, padding: '6px 10px', fontWeight: 700 }} />
              <button type="button" style={si === 0 ? disabledBtn : iconBtn} disabled={si === 0} title="Move section up" aria-label={`Move ${sec.title} up`}
                onClick={() => onChange(shiftSection(layout, sec.id, -1))}><ArrowUp size={16} /></button>
              <button type="button" style={si === r.sections.length - 1 ? disabledBtn : iconBtn} disabled={si === r.sections.length - 1} title="Move section down" aria-label={`Move ${sec.title} down`}
                onClick={() => onChange(shiftSection(layout, sec.id, 1))}><ArrowDown size={16} /></button>
              <button type="button" style={empty ? iconBtn : disabledBtn} disabled={!empty}
                title={empty ? 'Delete this section' : 'Move its screens to another section first'} aria-label={`Delete section ${sec.title}`}
                onClick={() => onChange(removeSection(layout, sec.id))}><Trash2 size={16} /></button>
            </div>
            {empty
              ? <div className="wf-p-small wf-subtle" style={{ padding: '12px', borderTop: '1px solid var(--wf-line)' }}>No screens yet. Use “Where it goes” on any screen to move it here.</div>
              : sec.items.map((s, i) => row(s, i, sec.items.length))}
          </section>
        );
      })}

      <button type="button" className="wf-btn wf-btn-outline" style={{ alignSelf: 'flex-start' }}
        onClick={() => onChange(addSection(layout, 'New section'))}>
        <FolderPlus size={16} /> Add a section
      </button>
    </div>
  );
}

export function SaveLine({ state, error, onRetry }: { state: LayoutSaveState; error: string | null; onRetry: () => void }) {
  if (state === 'saving') return <span className="wf-p-small wf-subtle" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Loader2 size={14} className="spin" /> Saving…</span>;
  if (state === 'saved') return <span className="wf-p-small" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--wf-success)', fontWeight: 600 }}><CheckCircle2 size={14} /> Saved</span>;
  if (state === 'error') {
    return (
      <span role="alert" className="wf-p-small" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--wf-danger)', fontWeight: 600, flexWrap: 'wrap' }}>
        <AlertTriangle size={14} /> Not saved{error ? `: ${error}` : ''}. It shows on this device only.
        <button type="button" className="wf-btn wf-btn-outline wf-btn-sm" onClick={onRetry}>Try again</button>
      </span>
    );
  }
  return null;
}
