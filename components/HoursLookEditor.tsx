'use client';
// Settings -> Hours screen (Fred, 2026-10-24: "i want to be change they way i
// view the cards manually"; "add that to settings"; "weeek view month view etc").
// How the day cards show on Hours and on a work order's Time Logs tab. Saved
// with the menu layout (components/useAppLayout.ts); the choices are in
// lib/hours-look.ts. The bar above the cards changes the same setting.
import type { Layout } from '@/lib/app-layout';
import { HOURS_CARDS, HOURS_GROUPS, normalizeHoursLook, type HoursLook } from '@/lib/hours-look';
import type { LayoutSaveState } from '@/components/useAppLayout';
import { SaveLine } from '@/components/LayoutEditor';

const CHOICES: { key: keyof HoursLook; title: string; options: { value: string; label: string; hint: string }[] }[] = [
  { key: 'group', title: 'View', options: HOURS_GROUPS.map((g) => ({
    ...g, hint: g.value === 'day' ? 'Every day one after another' : g.value === 'week' ? 'Monday to Sunday, with the week’s totals' : 'Each month with its totals',
  })) },
  { key: 'order', title: 'Order', options: [
    { value: 'new', label: 'Newest day first', hint: 'The last day worked on top' },
    { value: 'old', label: 'Oldest day first', hint: 'The first day on top, like an invoice' },
  ] },
  { key: 'cards', title: 'Cards', options: HOURS_CARDS },
];

export default function HoursLookEditor({ layout, onChange, saveState, saveError, onRetry }: {
  layout: Layout;
  onChange: (next: Layout) => void;
  saveState: LayoutSaveState;
  saveError: string | null;
  onRetry: () => void;
}) {
  const look = normalizeHoursLook(layout.hours);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '18px 28px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <p className="wf-p-small" style={{ margin: 0, color: 'var(--wf-subtle)', lineHeight: 1.5, flex: '1 1 300px' }}>
          Pick how the day cards open. You can still switch on the Hours screen any time; what you pick there is kept here too.
        </p>
        <SaveLine state={saveState} error={saveError} onRetry={onRetry} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
        {CHOICES.map((c) => (
          <fieldset key={c.key} style={{ border: '1px solid var(--wf-line)', borderRadius: 12, padding: '10px 12px', margin: 0, display: 'grid', gap: 8, alignSelf: 'start' }}>
            <legend className="wf-p-title" style={{ padding: '0 4px' }}>{c.title}</legend>
            {c.options.map((o) => (
              <label key={o.value} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}>
                <input type="radio" name={`hours-${c.key}`} checked={look[c.key] === o.value}
                  onChange={() => onChange({ ...layout, hours: normalizeHoursLook({ ...look, [c.key]: o.value }) })} />
                <span><b>{o.label}</b><br /><span className="wf-p-small wf-subtle">{o.hint}</span></span>
              </label>
            ))}
          </fieldset>
        ))}
      </div>
    </div>
  );
}
