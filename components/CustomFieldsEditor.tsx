'use client';
// Settings -> Custom fields (Fred, 2026-10-05: "full admin privilege in
// settings"). Make your own boxes on jobs, techs and customers: name, kind
// (text, number, date, yes/no, pick from a list), order. "Remove" takes a field
// off the forms but keeps every answer; Restore brings it back. Saves by
// itself (components/useCustomFields.ts); rules in lib/custom-fields.ts.
import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, RotateCcw, Trash2 } from 'lucide-react';
import {
  FIELD_KINDS, FIELD_LIMIT, FIELD_NAME_MAX, FIELD_TARGETS, activeFields, addField, renameField, setFieldHidden,
  setFieldKind, setFieldOptions, shiftField, type FieldKind, type FieldSets, type FieldTarget,
} from '@/lib/custom-fields';
import type { LayoutSaveState } from '@/components/useAppLayout';
import { SaveLine } from '@/components/LayoutEditor';

const iconBtn: React.CSSProperties = {
  width: 34, height: 34, borderRadius: 8, border: '1px solid var(--wf-line)', background: 'var(--wf-card)',
  color: 'var(--wf-text)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0,
};
const off: React.CSSProperties = { ...iconBtn, opacity: 0.35, cursor: 'default' };
const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap', padding: '10px 12px', borderTop: '1px solid var(--wf-line)' };

export default function CustomFieldsEditor({ fields, onChange, saveState, saveError, onRetry }: {
  fields: FieldSets;
  onChange: (next: FieldSets) => void;
  saveState: LayoutSaveState;
  saveError: string | null;
  onRetry: () => void;
}) {
  const [target, setTarget] = useState<FieldTarget>('jobs');
  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState<FieldKind>('text');
  const [error, setError] = useState<string | null>(null);
  // While Fred types a list's choices, keep exactly what he typed.
  const [optionText, setOptionText] = useState<Record<string, string>>({});

  const meta = FIELD_TARGETS.find((t) => t.target === target)!;
  const active = activeFields(target, fields);
  const removed = fields[target].filter((d) => d.hidden);

  const add = () => {
    const name = newName.trim();
    if (!name) { setError('Type a name for the new field first.'); return; }
    if (active.length >= FIELD_LIMIT) { setError(`That's the most fields a ${meta.one} can have (${FIELD_LIMIT}).`); return; }
    const next = addField(fields, target, name, newKind);
    if (!next) { setError(`There's already a ${meta.one} field called "${name}".`); return; }
    onChange(next);
    setNewName('');
    setNewKind('text');
    setError(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '18px 28px 24px' }}>
      <p className="wf-p-small" style={{ margin: 0, color: 'var(--wf-subtle)', lineHeight: 1.5 }}>
        Add your own boxes to the job, tech and customer forms. They show on the form under “Your fields” and on the
        record once filled in. <strong>Techs never see them</strong>, so they&apos;re safe for prices, PO numbers or notes.
        Renaming a field keeps every answer. Remove takes it off the forms but keeps the answers, and Restore brings it back.
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div role="tablist" aria-label="Which forms" style={{ display: 'flex', gap: 4, background: 'var(--wf-surface)', border: '1px solid var(--wf-line)', borderRadius: 999, padding: 3 }}>
          {FIELD_TARGETS.map((t) => (
            <button key={t.target} role="tab" aria-selected={target === t.target} onClick={() => { setTarget(t.target); setError(null); }}
              style={{ border: 'none', borderRadius: 999, padding: '7px 14px', font: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                background: target === t.target ? 'var(--wf-navy)' : 'transparent', color: target === t.target ? 'white' : 'var(--wf-text)' }}>
              {t.label}{activeFields(t.target, fields).length ? ` (${activeFields(t.target, fields).length})` : ''}
            </button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        <SaveLine state={saveState} error={saveError} onRetry={onRetry} />
      </div>

      <section style={{ border: '1px solid var(--wf-line)', borderRadius: 12, overflow: 'hidden', background: 'var(--wf-card)' }}>
        <div style={{ padding: '10px 12px', background: 'var(--wf-surface)' }}>
          <div className="wf-p-title">Fields on every {meta.one}</div>
        </div>
        {active.length === 0 && (
          <div className="wf-p-small wf-subtle" style={{ padding: 12, borderTop: '1px solid var(--wf-line)' }}>
            None yet. Add one below — for example {target === 'jobs' ? '“Gate code”, “Client PO” or “Permit needed”' : target === 'techs' ? '“Truck”, “Certifications” or “Shirt size”' : '“Account number”, “Region” or “Contract renews”'}.
          </div>
        )}
        {active.map((d, i) => (
          <div key={d.id} style={rowStyle}>
            <div style={{ flex: '1 1 200px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <input className="wf-input" value={d.label} maxLength={FIELD_NAME_MAX} aria-label="Field name" placeholder="Field name"
                onChange={(e) => onChange(renameField(fields, target, d.id, e.target.value))} style={{ minHeight: 36, padding: '6px 10px', fontWeight: 600 }} />
              {d.kind === 'choice' && (
                <textarea className="wf-input" rows={2} aria-label={`Choices for ${d.label}`} placeholder="The choices, one per line (or separated by commas)"
                  value={optionText[d.id] ?? d.options.join('\n')}
                  onChange={(e) => { setOptionText((o) => ({ ...o, [d.id]: e.target.value })); onChange(setFieldOptions(fields, target, d.id, e.target.value)); }}
                  style={{ minHeight: 60, padding: '6px 10px' }} />
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <select className="wf-input" value={d.kind} aria-label={`Kind of field for ${d.label}`} style={{ width: 160, minHeight: 36, padding: '6px 8px' }}
                onChange={(e) => onChange(setFieldKind(fields, target, d.id, e.target.value as FieldKind))}>
                {FIELD_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
              </select>
              <button type="button" style={i === 0 ? off : iconBtn} disabled={i === 0} aria-label={`Move ${d.label} up`}
                onClick={() => onChange(shiftField(fields, target, d.id, -1))}><ArrowUp size={16} /></button>
              <button type="button" style={i === active.length - 1 ? off : iconBtn} disabled={i === active.length - 1} aria-label={`Move ${d.label} down`}
                onClick={() => onChange(shiftField(fields, target, d.id, 1))}><ArrowDown size={16} /></button>
              <button type="button" className="wf-btn wf-btn-outline wf-btn-sm" title="Take it off the forms (answers are kept)"
                onClick={() => onChange(setFieldHidden(fields, target, d.id, true))}><Trash2 size={14} /> Remove</button>
            </div>
          </div>
        ))}
        <div style={{ ...rowStyle, alignItems: 'center', background: 'var(--wf-surface)' }}>
          <input className="wf-input" value={newName} maxLength={FIELD_NAME_MAX} placeholder={`New ${meta.one} field`} aria-label={`New ${meta.one} field name`}
            style={{ flex: '1 1 200px', minHeight: 36, padding: '6px 10px' }}
            onChange={(e) => { setNewName(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
          <select className="wf-input" value={newKind} aria-label="Kind of new field" style={{ width: 160, minHeight: 36, padding: '6px 8px' }}
            onChange={(e) => setNewKind(e.target.value as FieldKind)}>
            {FIELD_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
          </select>
          <button type="button" className="wf-btn wf-btn-navy wf-btn-sm" onClick={add}><Plus size={14} /> Add field</button>
          {error && <div role="alert" className="wf-p-small" style={{ width: '100%', color: 'var(--wf-danger)', fontWeight: 600 }}>{error}</div>}
        </div>
      </section>

      {removed.length > 0 && (
        <details>
          <summary className="wf-p-small" style={{ cursor: 'pointer', fontWeight: 700 }}>Removed {meta.one} fields ({removed.length}) — answers kept</summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
            {removed.map((d) => (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ flex: 1 }}>{d.label}</span>
                <button type="button" className="wf-btn wf-btn-outline wf-btn-sm" onClick={() => onChange(setFieldHidden(fields, target, d.id, false))}>
                  <RotateCcw size={14} /> Restore
                </button>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
