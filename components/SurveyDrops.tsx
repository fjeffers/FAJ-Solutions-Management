'use client';
import { useState } from 'react';
import {
  Plus, X, ChevronUp, ChevronDown, Cable, ChevronRight, Check,
} from 'lucide-react';
import {
  addDrop, removeDrop, moveDrop, dropCounts, deviceTotal, cableEstimate,
} from '@/lib/surveys';
import { fmtMoney } from '@/lib/utils';
import SurveyPhotoStrip from '@/components/SurveyPhotoStrip';
import type { CableDrop } from '@/lib/types';
import { CABLE_TYPES, DROP_MOUNTS, CABLE_RUN_PRESETS } from '@/lib/types';

/**
 * The drop schedule — the cabling equivalent of the camera schedule, and laid
 * out the same way: a row is a card until you open it, so twenty drops read as
 * a list rather than a wall of inputs.
 *
 * A location and a jack are deliberately different things: a dual drop is one
 * location with two jacks, and the job is priced per jack while the walk is
 * recorded per location. The card shows both.
 */
export default function SurveyDrops({
  drops, folderKey, onChange,
}: {
  drops: CableDrop[];
  folderKey: string;
  onChange: (next: CableDrop[]) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  const counts = dropCounts(drops);
  const value = deviceTotal({ survey_type: 'cabling', cable_drops: drops });
  const cable = cableEstimate({ survey_type: 'cabling', cable_drops: drops });

  const update = (id: string, patch: Partial<CableDrop>) =>
    onChange(drops.map((d) => (d.id === id ? { ...d, ...patch } : d)));

  const add = () => {
    const next = addDrop(drops);
    onChange(next);
    setOpenId(next[next.length - 1].id);
  };

  return (
    <div>
      {drops.length > 0 && <Totals counts={counts} value={value} cable={cable} />}

      {drops.length === 0 ? (
        <div style={{
          padding: '34px 20px', textAlign: 'center', color: '#a8a294',
          border: '1px dashed #ddd7c9', borderRadius: 14, background: 'rgba(255,255,255,0.5)',
        }}>
          <Cable size={26} color="#d8d2c4" style={{ marginBottom: 9 }} />
          <div style={{ fontSize: 15, fontWeight: 600, color: '#8a8578' }}>No drops yet</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>Add the first location to start the schedule.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {drops.map((d, i) => (
            <Row
              key={d.id}
              drop={d}
              index={i}
              last={i === drops.length - 1}
              open={openId === d.id}
              folderKey={folderKey}
              onToggle={() => setOpenId(openId === d.id ? null : d.id)}
              onUpdate={(patch) => update(d.id, patch)}
              onMove={(dir) => onChange(moveDrop(drops, d.id, dir))}
              onRemove={() => onChange(removeDrop(drops, d.id))}
            />
          ))}
        </div>
      )}

      <datalist id="cable-run-presets">
        {CABLE_RUN_PRESETS.map((p) => <option key={p} value={p} />)}
      </datalist>

      <button
        onClick={add}
        style={{
          marginTop: 12, width: '100%', padding: '13px 0', borderRadius: 12, cursor: 'pointer',
          border: '1px dashed #cfc9ba', background: 'white', color: 'var(--teal)',
          fontSize: 14, fontWeight: 700,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7,
        }}
      >
        <Plus size={16} /> Add drop {drops.length + 1}
      </button>
    </div>
  );
}

/** What the job is materialled and priced from, given room to read. */
function Totals({ counts, value, cable }: {
  counts: ReturnType<typeof dropCounts>;
  value: number;
  cable: ReturnType<typeof cableEstimate>;
}) {
  const cables = counts.byCable.map((c) => `${c.jacks}× ${c.type}`).join(' · ');
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))',
      gap: 1, marginBottom: 14, borderRadius: 14, overflow: 'hidden', background: '#e9e4d6',
    }}>
      <Stat label="Locations" value={String(counts.total)} />
      <Stat label="Jacks" value={String(counts.jacks)} sub={cables || undefined} />
      {cable.feet > 0 && (
        <Stat label="Cable" value={`~${cable.feetWithLoop} ft`} sub={`${cable.boxes} box${cable.boxes !== 1 ? 'es' : ''}`} />
      )}
      <Stat
        label="Schedule"
        value={value > 0 ? fmtMoney(value) : '—'}
        sub={value > 0 ? undefined : 'unpriced'}
        warn={value === 0}
      />
      {cable.unknown > 0 && <Stat label="Runs TBD" value={String(cable.unknown)} warn />}
    </div>
  );
}

function Stat({ label, value, sub, warn }: {
  label: string; value: string; sub?: string; warn?: boolean;
}) {
  return (
    <div style={{ background: 'white', padding: '11px 13px' }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.9, color: '#a8a294', textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ fontSize: 17, fontWeight: 800, marginTop: 3, color: warn ? '#b45309' : 'var(--teal)' }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: warn ? '#b45309' : '#a8a294', marginTop: 1 }}>{sub}</div>}
    </div>
  );
}

// ── One drop ────────────────────────────────────────────────────────────────

function Row({
  drop: d, index, last, open, folderKey, onToggle, onUpdate, onMove, onRemove,
}: {
  drop: CableDrop;
  index: number;
  last: boolean;
  open: boolean;
  folderKey: string;
  onToggle: () => void;
  onUpdate: (patch: Partial<CableDrop>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const jacks = Number(d.jack_count) || 0;
  const summary = [
    jacks > 0 ? `${jacks} jack${jacks !== 1 ? 's' : ''}` : '',
    d.cable_type && d.cable_type !== 'TBD' ? d.cable_type : '',
    d.mount ? d.mount.toLowerCase() : '',
    d.run_length && !/tbd/i.test(d.run_length) ? d.run_length : '',
  ].filter((p) => p && p.trim()).join(' · ');

  // A drop bills per jack, so the card shows the line total, not the unit rate.
  const lineTotal = (Number(d.unit_price) || 0) * jacks;
  const priced = lineTotal > 0;
  const photo = (d.photos ?? [])[0];

  return (
    <div style={{
      border: open ? '1px solid var(--teal)' : '1px solid #eae5d8',
      borderRadius: 14, background: 'white', overflow: 'hidden',
      boxShadow: open ? '0 4px 18px rgba(13,115,119,0.08)' : 'none',
      transition: 'border-color 0.15s',
    }}>
      <button
        onClick={onToggle}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 12,
          padding: '13px 14px', background: 'none', border: 'none',
          cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span style={{
          width: 32, height: 32, borderRadius: 10, flexShrink: 0,
          background: priced ? 'var(--teal)' : '#e9e4d6',
          color: priced ? 'white' : '#8a8578',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, fontWeight: 800,
        }}>{d.position}</span>

        {photo && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={photo} alt="" style={{ width: 34, height: 34, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
        )}

        <span style={{ minWidth: 0, flex: 1 }}>
          <span style={{ display: 'block', fontSize: 15, fontWeight: 700, color: d.location ? '#2a2a2a' : '#b5afa0', lineHeight: 1.3 }}>
            {d.location || 'Untitled location'}
          </span>
          <span style={{ display: 'block', fontSize: 12.5, color: '#8a8578', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {summary || 'Tap to fill in'}
          </span>
        </span>

        <span style={{ fontSize: 14, fontWeight: 800, color: priced ? '#047857' : '#c9c3b4', flexShrink: 0 }}>
          {priced ? fmtMoney(lineTotal) : '—'}
        </span>
        <ChevronRight
          size={17} color="#c9c3b4"
          style={{ flexShrink: 0, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}
        />
      </button>

      {open && (
        <div style={{ padding: '2px 14px 16px', borderTop: '1px solid #f2eee3' }}>
          <Group>Where it goes</Group>
          <Field label="Location">
            <input
              className="input" placeholder="e.g. Reception desk" autoFocus
              value={d.location} onChange={(e) => onUpdate({ location: e.target.value })}
            />
          </Field>
          <Two>
            <Field label="Jacks at this location">
              <input className="input" type="number" min={1} inputMode="numeric" value={d.jack_count}
                onChange={(e) => onUpdate({ jack_count: Number(e.target.value) })} />
            </Field>
            <Field label="Wall termination">
              <select className="select input" value={d.mount} onChange={(e) => onUpdate({ mount: e.target.value })}>
                {DROP_MOUNTS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </Field>
          </Two>

          <Group>Cable &amp; pathway</Group>
          <Two>
            <Field label="Cable type">
              <select className="select input" value={d.cable_type} onChange={(e) => onUpdate({ cable_type: e.target.value })}>
                {CABLE_TYPES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Run length">
              <input className="input" list="cable-run-presets" value={d.run_length}
                onChange={(e) => onUpdate({ run_length: e.target.value })} />
            </Field>
          </Two>
          <Two>
            <Field label="Runs from">
              <input className="input" placeholder="e.g. Network closet"
                value={d.origin_point ?? ''} onChange={(e) => onUpdate({ origin_point: e.target.value })} />
            </Field>
            <Field label="Pathway">
              <input className="input" placeholder="Plenum, J-hooks, conduit…"
                value={d.pathway_notes ?? ''} onChange={(e) => onUpdate({ pathway_notes: e.target.value })} />
            </Field>
          </Two>
          <Field label="Terminates at">
            <input className="input" placeholder="e.g. Patch panel A, ports 12-13"
              value={d.termination} onChange={(e) => onUpdate({ termination: e.target.value })} />
          </Field>

          <Group>Price &amp; materials</Group>
          <Two>
            <Field label="Price per jack">
              <input className="input" type="number" step="0.01" min={0} inputMode="decimal"
                value={d.unit_price || ''} placeholder="0.00"
                onChange={(e) => onUpdate({ unit_price: Number(e.target.value) || 0 })} />
            </Field>
            <Field label="Materials needed">
              <input className="input" placeholder="Plate, keystone, box…"
                value={d.materials_needed ?? ''} onChange={(e) => onUpdate({ materials_needed: e.target.value })} />
            </Field>
          </Two>
          {priced && (
            <div style={{ fontSize: 12, color: '#047857', fontWeight: 600, marginTop: -2, marginBottom: 10 }}>
              {jacks} × {fmtMoney(d.unit_price)} = {fmtMoney(lineTotal)}
            </div>
          )}
          <Field label="Notes">
            <input className="input" placeholder="Pathway, obstructions, existing conduit…"
              value={d.notes ?? ''} onChange={(e) => onUpdate({ notes: e.target.value })} />
          </Field>

          <Group>Photo of the spot</Group>
          <SurveyPhotoStrip
            photos={d.photos ?? []} folderKey={folderKey}
            alt={`Drop ${d.position} location`} size={64}
            onChange={(photos) => onUpdate({ photos })}
          />

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 18, paddingTop: 14, borderTop: '1px solid #f2eee3' }}>
            <button onClick={() => onMove(-1)} disabled={index === 0} style={{ ...GHOST, opacity: index === 0 ? 0.35 : 1 }}>
              <ChevronUp size={15} /> Up
            </button>
            <button onClick={() => onMove(1)} disabled={last} style={{ ...GHOST, opacity: last ? 0.35 : 1 }}>
              <ChevronDown size={15} /> Down
            </button>
            <div style={{ flex: 1 }} />
            <button onClick={onToggle} style={{ ...GHOST, color: 'var(--teal)', fontWeight: 700 }}>
              <Check size={15} /> Done
            </button>
            <button
              onClick={() => { if (confirm(`Remove drop ${d.position}?`)) onRemove(); }}
              style={{ ...GHOST, color: '#b91c1c' }}
            ><X size={15} /></button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Layout ──────────────────────────────────────────────────────────────────

function Group({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 800, letterSpacing: 1, color: 'var(--teal)',
      textTransform: 'uppercase', marginTop: 16, marginBottom: 9,
    }}>{children}</div>
  );
}

function Two({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>{children}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{ fontSize: 11.5, fontWeight: 600, color: '#7a746a', display: 'block', marginBottom: 5 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const GHOST: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  background: 'none', border: 'none', cursor: 'pointer', color: '#8a8578',
  fontSize: 12.5, fontWeight: 600, padding: '7px 9px', borderRadius: 8,
};
