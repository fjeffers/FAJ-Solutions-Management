'use client';
// Fred's own fields on a job / tech / customer form (Settings -> Custom
// fields). Shows nothing until he has made some. Answers are kept in the
// record's `custom` value; lib/custom-fields.ts has the rules.
import { activeFields, answeredFields, inputValue, setAnswer, type CustomValues, type FieldTarget } from '@/lib/custom-fields';

export default function CustomFieldInputs({ target, values, onChange, title = 'Your fields', inputClass = 'input' }: {
  target: FieldTarget;
  values: CustomValues;
  onChange: (next: CustomValues) => void;
  title?: string;
  /** The form's own input style ('input' on the office forms). */
  inputClass?: string;
}) {
  const defs = activeFields(target);
  if (defs.length === 0) return null;
  return (
    <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid #eee' }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--teal, #0E1B2E)', marginBottom: 10 }}>{title}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
        {defs.map((d) => {
          const id = `cf-${target}-${d.id}`;
          const value = inputValue(values, d);
          const set = (v: string | boolean) => onChange(setAnswer(values, d, v));
          return (
            <div key={d.id} style={d.kind === 'longtext' ? { gridColumn: '1 / -1' } : undefined}>
              <label htmlFor={id} style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 4 }}>{d.label}</label>
              {d.kind === 'longtext' ? (
                <textarea id={id} className={inputClass} rows={3} value={value} onChange={(e) => set(e.target.value)} />
              ) : d.kind === 'yesno' ? (
                <select id={id} className={inputClass} value={value} onChange={(e) => set(e.target.value)}>
                  <option value="">—</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              ) : d.kind === 'choice' ? (
                <select id={id} className={inputClass} value={value} onChange={(e) => set(e.target.value)}>
                  <option value="">—</option>
                  {d.options.map((o) => <option key={o} value={o}>{o}</option>)}
                  {value && !d.options.includes(value) && <option value={value}>{value}</option>}
                </select>
              ) : (
                <input id={id} className={inputClass} value={value}
                  type={d.kind === 'date' ? 'date' : 'text'} inputMode={d.kind === 'number' ? 'decimal' : undefined}
                  onChange={(e) => set(e.target.value)} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A record's answered fields as a small read-only list; nothing when there are none. */
export function CustomFieldList({ target, values, compact = false }: { target: FieldTarget; values: unknown; compact?: boolean }) {
  const rows = answeredFields(target, values);
  if (rows.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: compact ? '2px 16px' : '6px 18px', fontSize: compact ? 12 : 13 }}>
      {rows.map((r) => (
        <span key={r.label}><span style={{ color: '#888' }}>{r.label}:</span> <strong style={{ fontWeight: 600 }}>{r.value}</strong></span>
      ))}
    </div>
  );
}
