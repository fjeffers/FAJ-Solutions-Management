'use client';
// What a job asks the tech for (lib/capture.ts), as tick boxes. Used on the
// job form ("What the tech records") and for each saved template in Settings
// (JobTemplatesEditor below). Fred, 2026-10-18: "No one want to look at blank
// items it not needed."
import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  CAPTURE_ITEMS, TEMPLATE_MAX, addTemplate, removeTemplate, renameTemplate, setTemplateItems, toggleItem,
  type CaptureItem,
} from '@/lib/capture';
import { SaveLine } from '@/components/LayoutEditor';
import { useJobTemplates } from '@/components/useJobTemplates';

/** One tick box per item, with what it means. */
export function CaptureTicks({ items, onChange, idPrefix }: {
  items: readonly CaptureItem[]; onChange: (next: CaptureItem[]) => void; idPrefix: string;
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 6 }}>
      {CAPTURE_ITEMS.map((c) => {
        const id = `${idPrefix}-${c.key}`;
        return (
          <label key={c.key} htmlFor={id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '7px 9px', border: '1px solid var(--wf-line)', borderRadius: 9, cursor: 'pointer', background: items.includes(c.key) ? 'rgba(14,27,46,0.05)' : 'var(--wf-card)' }}>
            <input id={id} type="checkbox" checked={items.includes(c.key)} onChange={() => onChange(toggleItem(items, c.key))} style={{ marginTop: 3 }} />
            <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ fontWeight: 600, fontSize: 13.5 }}>{c.label}</span>
              <span style={{ fontSize: 12, color: 'var(--wf-subtle)', lineHeight: 1.35 }}>{c.hint}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

/** Settings -> Job templates: Fred's saved sets of items. */
export default function JobTemplatesEditor() {
  const { templates, update, retry, saveState, saveError } = useJobTemplates();
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  // While Fred types a new name, keep exactly what he typed.
  const [names, setNames] = useState<Record<string, string>>({});

  const add = () => {
    const next = addTemplate(templates, newName, ['travel', 'receipts', 'notes'], Math.random().toString(36).slice(2));
    if (!next) {
      setError(!newName.trim() ? 'Type a name for the template first.'
        : templates.length >= TEMPLATE_MAX ? `That's the most templates you can keep (${TEMPLATE_MAX}).`
          : `There's already a template called "${newName.trim()}".`);
      return;
    }
    update(next);
    setNewName('');
    setError(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '18px 28px 24px' }}>
      <p className="wf-p-small" style={{ margin: 0, color: 'var(--wf-subtle)', lineHeight: 1.5 }}>
        Pick a template on a job, or tick the items yourself. The tech sees only what the job asks for, and the job log and
        the weekly bill leave out everything else. Time on site is always kept. Jobs you made before keep asking for everything.
      </p>
      {templates.map((t) => (
        <section key={t.id} className="wf-card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ flex: '1 1 240px', display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600 }}>
              Template name
              <input className="wf-input" value={names[t.id] ?? t.name} maxLength={60}
                onChange={(e) => setNames((n) => ({ ...n, [t.id]: e.target.value }))}
                onBlur={() => {
                  const typed = names[t.id];
                  if (typed == null) return;
                  const next = renameTemplate(templates, t.id, typed);
                  if (next) { update(next); setError(null); } else setError(`Can't rename to "${typed.trim()}": it's empty or another template has that name.`);
                  setNames((n) => Object.fromEntries(Object.entries(n).filter(([k]) => k !== t.id)));
                }} />
            </label>
            <button type="button" className="wf-btn wf-btn-ghost wf-btn-sm" onClick={() => update(removeTemplate(templates, t.id))} aria-label={`Remove ${t.name}`}>
              <Trash2 size={15} /> Remove
            </button>
          </div>
          <CaptureTicks idPrefix={`tpl-${t.id}`} items={t.items} onChange={(items) => {
            if (items.length === 0) { setError('A template asks for at least one thing.'); return; }
            update(setTemplateItems(templates, t.id, items));
            setError(null);
          }} />
        </section>
      ))}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label style={{ flex: '1 1 240px', display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600 }}>
          New template
          <input className="wf-input" value={newName} maxLength={60} placeholder="Store refresh"
            onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
        </label>
        <button type="button" className="wf-btn wf-btn-navy wf-btn-sm" onClick={add}><Plus size={15} /> Add template</button>
      </div>
      {error && <div role="alert" className="wf-p-small" style={{ color: 'var(--wf-danger)' }}>{error}</div>}
      <SaveLine state={saveState} error={saveError} onRetry={retry} />
    </div>
  );
}
