'use client';
import { Plus, X, ChevronUp, ChevronDown, Cable } from 'lucide-react';
import { addDrop, removeDrop, moveDrop, dropCounts, deviceTotal } from '@/lib/surveys';
import { fmtMoney } from '@/lib/utils';
import SurveyPhotoStrip from '@/components/SurveyPhotoStrip';
import type { CableDrop } from '@/lib/types';
import { CABLE_TYPES, DROP_MOUNTS, CABLE_RUN_PRESETS } from '@/lib/types';

/**
 * The drop schedule — the cabling equivalent of the camera schedule.
 *
 * A location and a jack are deliberately different things: a dual drop is one
 * location with two jacks, and the job is priced per jack while the walk is
 * recorded per location.
 */
export default function SurveyDrops({
  drops, folderKey, onChange,
}: {
  drops: CableDrop[];
  folderKey: string;
  onChange: (next: CableDrop[]) => void;
}) {
  const counts = dropCounts(drops);
  const scheduleValue = deviceTotal({ survey_type: 'cabling', cable_drops: drops });
  const update = (id: string, patch: Partial<CableDrop>) =>
    onChange(drops.map((d) => (d.id === id ? { ...d, ...patch } : d)));

  return (
    <div>
      {drops.length > 0 && (
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginBottom: 10,
          padding: '9px 12px', borderRadius: 10, background: 'rgba(13,115,119,0.06)',
          fontSize: 12, color: '#555',
        }}>
          <strong style={{ color: 'var(--teal)' }}>
            {counts.total} location{counts.total !== 1 ? 's' : ''}
          </strong>
          <span>{counts.jacks} jack{counts.jacks !== 1 ? 's' : ''}</span>
          {counts.byCable.map((c) => <span key={c.type}>{c.jacks}× {c.type}</span>)}
          <span style={{ color: scheduleValue > 0 ? '#047857' : '#b45309', fontWeight: 700 }}>
            {fmtMoney(scheduleValue)}{scheduleValue === 0 ? ' — unpriced' : ''}
          </span>
          {counts.runsUnknown > 0 && (
            <span style={{ color: '#b45309', fontWeight: 600 }}>
              {counts.runsUnknown} run{counts.runsUnknown !== 1 ? 's' : ''} still TBD
            </span>
          )}
        </div>
      )}

      {drops.length === 0 ? (
        <div style={{ padding: '20px 14px', textAlign: 'center', color: '#aaa', fontSize: 13, border: '1px dashed #ddd', borderRadius: 10 }}>
          <Cable size={22} color="#ddd" style={{ marginBottom: 6 }} />
          <div>No drops yet.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {drops.map((d, i) => (
            <div key={d.id} style={{ border: '1px solid #e8e8e8', borderRadius: 10, padding: 10, background: 'rgba(255,255,255,0.5)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{
                  width: 26, height: 26, borderRadius: '50%', background: 'var(--teal)', color: 'white',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 800, flexShrink: 0,
                }}>{d.position}</span>
                <input
                  className="input" placeholder="Location — e.g. Reception desk"
                  value={d.location} onChange={(e) => update(d.id, { location: e.target.value })}
                  style={{ fontWeight: 600 }}
                />
                <button title="Move up" onClick={() => onChange(moveDrop(drops, d.id, -1))}
                  disabled={i === 0} style={{ ...MINI_BTN, opacity: i === 0 ? 0.3 : 1 }}><ChevronUp size={15} /></button>
                <button title="Move down" onClick={() => onChange(moveDrop(drops, d.id, 1))}
                  disabled={i === drops.length - 1} style={{ ...MINI_BTN, opacity: i === drops.length - 1 ? 0.3 : 1 }}><ChevronDown size={15} /></button>
                <button title="Remove drop" onClick={() => onChange(removeDrop(drops, d.id))}
                  style={{ ...MINI_BTN, color: '#b91c1c' }}><X size={15} /></button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(115px, 1fr))', gap: 8 }}>
                <Cell label="Jacks">
                  <input
                    className="input" type="number" min={1} inputMode="numeric" value={d.jack_count}
                    onChange={(e) => update(d.id, { jack_count: Number(e.target.value) })}
                  />
                </Cell>
                <Cell label="Cable">
                  <select className="select input" value={d.cable_type} onChange={(e) => update(d.id, { cable_type: e.target.value })}>
                    {CABLE_TYPES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Cell>
                <Cell label="Run length">
                  <input
                    className="input" list="cable-run-presets" value={d.run_length}
                    onChange={(e) => update(d.id, { run_length: e.target.value })}
                  />
                </Cell>
                <Cell label="Mount">
                  <select className="select input" value={d.mount} onChange={(e) => update(d.id, { mount: e.target.value })}>
                    {DROP_MOUNTS.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </Cell>
                <Cell label="Price / jack">
                  <input
                    className="input" type="number" step="0.01" min={0} inputMode="decimal"
                    value={d.unit_price || ''} placeholder="0.00"
                    onChange={(e) => update(d.id, { unit_price: Number(e.target.value) || 0 })}
                  />
                </Cell>
                <Cell label="Terminates at">
                  <input
                    className="input" placeholder="Patch panel A, ports 12-13"
                    value={d.termination} onChange={(e) => update(d.id, { termination: e.target.value })}
                  />
                </Cell>
              </div>

              <input
                className="input" placeholder="Notes — pathway, obstructions, existing conduit…"
                value={d.notes ?? ''} onChange={(e) => update(d.id, { notes: e.target.value })}
                style={{ marginTop: 8, fontSize: 12 }}
              />

              <div style={{ marginTop: 8 }}>
                <SurveyPhotoStrip
                  photos={d.photos ?? []} folderKey={folderKey}
                  alt={`Drop ${d.position} location`}
                  onChange={(photos) => update(d.id, { photos })}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <datalist id="cable-run-presets">
        {CABLE_RUN_PRESETS.map((p) => <option key={p} value={p} />)}
      </datalist>

      <button className="btn btn-ghost" style={{ marginTop: 10, fontSize: 12 }} onClick={() => onChange(addDrop(drops))}>
        <Plus size={12} /> Add Drop
      </button>
    </div>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.4, color: '#999', textTransform: 'uppercase', display: 'block', marginBottom: 3 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const MINI_BTN: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer', color: '#999',
  padding: 6, display: 'flex', alignItems: 'center', flexShrink: 0,
};
