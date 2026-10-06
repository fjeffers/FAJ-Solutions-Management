'use client';
// Settings -> What each screen shows (Fred, 2026-10-05: "full admin privilege
// in settings"). Switch parts of the Dashboard, Dispatch and the job page on
// or off. Saved with the menu layout (components/useAppLayout.ts); the parts
// are listed in lib/screen-parts.ts. Off only hides — nothing is lost.
import { setPartShown, type Layout } from '@/lib/app-layout';
import { SCREEN_PARTS } from '@/lib/screen-parts';
import type { LayoutSaveState } from '@/components/useAppLayout';
import { SaveLine } from '@/components/LayoutEditor';

export default function ScreenPartsEditor({ layout, onChange, saveState, saveError, onRetry }: {
  layout: Layout;
  onChange: (next: Layout) => void;
  saveState: LayoutSaveState;
  saveError: string | null;
  onRetry: () => void;
}) {
  const off = new Set(layout.off ?? []);
  const anyOff = off.size > 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '18px 28px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <p className="wf-p-small" style={{ margin: 0, color: 'var(--wf-subtle)', lineHeight: 1.5, flex: '1 1 300px' }}>
          Untick anything you don't want to see. It only hides that part — nothing is lost, and you can tick it again any time.
        </p>
        <SaveLine state={saveState} error={saveError} onRetry={onRetry} />
        {anyOff && (
          <button type="button" className="wf-btn wf-btn-outline wf-btn-sm" onClick={() => onChange({ ...layout, off: [] })}>Show everything</button>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
        {SCREEN_PARTS.map((s) => (
          <section key={s.screen} style={{ border: '1px solid var(--wf-line)', borderRadius: 12, overflow: 'hidden', background: 'var(--wf-card)', alignSelf: 'start' }}>
            <div style={{ padding: '10px 12px', background: 'var(--wf-surface)' }}>
              <div className="wf-p-title">{s.screen}</div>
              <div className="wf-p-small wf-subtle">{s.hint}</div>
            </div>
            {s.parts.map((p) => {
              const on = !off.has(p.key);
              return (
                <label key={p.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 12px', borderTop: '1px solid var(--wf-line)', cursor: 'pointer', opacity: on ? 1 : 0.6 }}>
                  <input type="checkbox" checked={on} onChange={(e) => onChange(setPartShown(layout, p.key, e.target.checked))}
                    style={{ width: 18, height: 18, marginTop: 1, flexShrink: 0 }} />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 600, fontSize: 14 }}>{p.label}</span>
                    {p.hint && <span className="wf-p-small wf-subtle">{p.hint}</span>}
                  </span>
                </label>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
}
