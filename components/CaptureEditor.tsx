'use client';
// What a job asks the tech for (lib/capture.ts), as tick boxes. Used on the
// job form ("What the tech records") and for each saved template in Settings
// (JobTemplatesEditor below). Fred, 2026-10-18: "No one want to look at blank
// items it not needed."
import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  CAPTURE_ITEMS, TEMPLATE_MAX, addTemplate, removeTemplate, renameTemplate, setTemplateItems, setTemplateStartAsks, toggleItem,
  type CaptureItem,
} from '@/lib/capture';
import { START_ASK_MAX, addStartAsk, type StartAsk } from '@/lib/checkin';
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

/**
 * What else to ask for at check-in (Fred, 2026-10-18: "I want to be able to add
 * what I'm looking for when starting"): a photo or a short answer each, asked
 * after the drive and the starting mileage (components/wf/CheckIn.tsx).
 */
export function StartAsksEditor({ asks, onChange, idPrefix }: {
  asks: StartAsk[]; onChange: (next: StartAsk[]) => void; idPrefix: string;
}) {
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<StartAsk['kind']>('photo');
  const add = () => {
    const next = addStartAsk(asks, label, kind, Math.random().toString(36).slice(2));
    if (!next) return;
    onChange(next);
    setLabel('');
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontWeight: 600, fontSize: 13.5 }}>At check-in, also ask for</div>
      <div style={{ fontSize: 12, color: 'var(--wf-subtle)' }}>
        After the tech picks the drive and takes the starting mileage photo. A photo gets the time and GPS printed on it.
      </div>
      {asks.map((a) => (
        <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 9px', border: '1px solid var(--wf-line)', borderRadius: 9 }}>
          <span className="wf-chip" style={{ fontSize: 11.5 }}>{a.kind === 'photo' ? 'Photo' : 'Answer'}</span>
          <span style={{ flex: 1, fontSize: 13.5 }}>{a.label}</span>
          <button type="button" className="wf-btn wf-btn-ghost wf-btn-sm" aria-label={`Remove ${a.label}`} onClick={() => onChange(asks.filter((x) => x.id !== a.id))}>
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      {asks.length < START_ASK_MAX && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <input id={`${idPrefix}-ask`} className="wf-input" style={{ flex: '1 1 220px' }} value={label} maxLength={80}
            placeholder={kind === 'photo' ? 'e.g. Photo of the truck' : 'e.g. Truck number'} aria-label="New check-in item"
            onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
          <select className="wf-input" style={{ width: 120 }} value={kind} aria-label="Kind" onChange={(e) => setKind(e.target.value as StartAsk['kind'])}>
            <option value="photo">Photo</option>
            <option value="answer">Answer</option>
          </select>
          <button type="button" className="wf-btn wf-btn-outline wf-btn-sm" disabled={!label.trim()} onClick={add}><Plus size={14} /> Add</button>
        </div>
      )}
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
    // A new template starts blank; tick what it needs (Fred, 2026-10-18).
    const next = addTemplate(templates, newName, [], Math.random().toString(36).slice(2));
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
            update(setTemplateItems(templates, t.id, items));
            setError(null);
          }} />
          <StartAsksEditor idPrefix={`tpl-${t.id}`} asks={t.startAsks ?? []} onChange={(asks) => update(setTemplateStartAsks(templates, t.id, asks))} />
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
