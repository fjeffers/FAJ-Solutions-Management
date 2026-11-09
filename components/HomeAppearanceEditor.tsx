'use client';

import { CheckCircle2, RotateCcw, Sparkles } from 'lucide-react';
import {
  STANDARD_HOME_LOOK, normalizeHomeLook, type HomeTheme, type Layout,
} from '@/lib/app-layout';
import type { LayoutSaveState } from './useAppLayout';
import { SaveLine } from './LayoutEditor';

const themes: { value: HomeTheme; name: string; colors: string[] }[] = [
  { value: 'midnight', name: 'Midnight gold', colors: ['#071629', '#123B56', '#D9AF55'] },
  { value: 'violet', name: 'Future violet', colors: ['#17102D', '#5B3FC3', '#62D6C4'] },
  { value: 'light', name: 'Bright executive', colors: ['#F8F5EC', '#FFFFFF', '#0E5667'] },
];

export default function HomeAppearanceEditor({
  layout, onChange, saveState, saveError, onRetry,
}: {
  layout: Layout;
  onChange: (next: Layout) => void;
  saveState: LayoutSaveState;
  saveError: string | null;
  onRetry: () => void;
}) {
  const home = normalizeHomeLook(layout.home);
  const update = (patch: Partial<typeof home>) => onChange({ ...layout, home: { ...home, ...patch } });
  const standard = JSON.stringify(home) === JSON.stringify(STANDARD_HOME_LOOK);

  return (
    <div className="wf" style={{ padding: '18px 28px 24px', display: 'grid', gap: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <SaveLine state={saveState} error={saveError} onRetry={onRetry} />
        <span style={{ flex: 1 }} />
        {!standard && (
          <button className="wf-btn wf-btn-outline wf-btn-sm" type="button"
            onClick={() => onChange({ ...layout, home: STANDARD_HOME_LOOK })}>
            <RotateCcw size={14} /> Standard look
          </button>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
        <label className="wf-field">
          <span className="wf-label">Brand name</span>
          <input className="wf-input" value={home.brand} maxLength={32}
            onChange={(e) => update({ brand: e.target.value })} />
        </label>
        <label className="wf-field">
          <span className="wf-label">Home headline</span>
          <input className="wf-input" value={home.title} maxLength={72}
            onChange={(e) => update({ title: e.target.value })} />
        </label>
      </div>

      <label className="wf-field">
        <span className="wf-label">Message under the headline</span>
        <input className="wf-input" value={home.subtitle} maxLength={150}
          onChange={(e) => update({ subtitle: e.target.value })} />
      </label>

      <div>
        <div className="wf-label" style={{ marginBottom: 9 }}>Home style</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))', gap: 10 }}>
          {themes.map((theme) => {
            const selected = home.theme === theme.value;
            return (
              <button key={theme.value} type="button" onClick={() => update({ theme: theme.value })}
                aria-pressed={selected}
                style={{
                  border: selected ? '2px solid var(--wf-gold)' : '1px solid var(--wf-line)',
                  borderRadius: 12, padding: 12, background: 'var(--wf-card)', cursor: 'pointer',
                  textAlign: 'left', color: 'var(--wf-text)',
                }}>
                <span style={{ display: 'flex', gap: 5, marginBottom: 9 }}>
                  {theme.colors.map((color) => <span key={color} style={{ width: 29, height: 20, borderRadius: 6, background: color, border: '1px solid rgba(0,0,0,.08)' }} />)}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, fontWeight: 750 }}>
                  {theme.name} {selected ? <CheckCircle2 size={16} color="var(--wf-success)" /> : <Sparkles size={15} />}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
