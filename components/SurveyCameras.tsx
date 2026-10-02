'use client';
import { useState } from 'react';
import {
  Plus, X, ChevronUp, ChevronDown, Camera, ChevronRight, Check,
} from 'lucide-react';
import {
  addCamera, removeCamera, moveCamera, cameraCounts, deviceTotal, cableEstimate,
} from '@/lib/surveys';
import { fmtMoney } from '@/lib/utils';
import SurveyPhotoStrip from '@/components/SurveyPhotoStrip';
import SurveyPhotoRead from '@/components/SurveyPhotoRead';
import type { SurveyCamera } from '@/lib/types';
import {
  CAMERA_TYPES, CAMERA_RESOLUTIONS, CAMERA_STATUSES, CABLE_RUN_PRESETS,
  CAMERA_MOUNTS, CAMERA_VARIANTS,
} from '@/lib/types';

/**
 * The numbered camera schedule.
 *
 * A camera row carries fourteen fields. Showing all fourteen for every camera
 * turns eight positions into a wall of boxes nobody wants to read, so a row is
 * a CARD by default — number, location, one-line summary, price — and opens
 * only when you actually want to change something.
 *
 * Positions are explicit and rewritten on every insert, delete and move, so
 * putting the head-end dome at the top really does shift everything below it
 * down, the way it does on paper.
 */
export default function SurveyCameras({
  cameras, folderKey, onChange,
}: {
  cameras: SurveyCamera[];
  folderKey: string;
  onChange: (next: SurveyCamera[]) => void;
}) {
  // Open the row you just added; everything else stays calm and closed.
  const [openId, setOpenId] = useState<string | null>(null);

  const counts = cameraCounts(cameras);
  const value = deviceTotal({ survey_type: 'camera', cameras });
  const cable = cableEstimate({ survey_type: 'camera', cameras });

  const update = (id: string, patch: Partial<SurveyCamera>) =>
    onChange(cameras.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  const add = () => {
    const next = addCamera(cameras);
    onChange(next);
    setOpenId(next[next.length - 1].id);
  };

  return (
    <div>
      {cameras.length > 0 && <Totals counts={counts} value={value} cable={cable} />}

      {cameras.length === 0 ? (
        <div style={{
          padding: '34px 20px', textAlign: 'center', color: '#a8a294',
          border: '1px dashed #ddd7c9', borderRadius: 14, background: 'rgba(255,255,255,0.5)',
        }}>
          <Camera size={26} color="#d8d2c4" style={{ marginBottom: 9 }} />
          <div style={{ fontSize: 15, fontWeight: 600, color: '#8a8578' }}>No cameras yet</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>Add the first position to start the schedule.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {cameras.map((c, i) => (
            <Row
              key={c.id}
              camera={c}
              index={i}
              last={i === cameras.length - 1}
              open={openId === c.id}
              folderKey={folderKey}
              onToggle={() => setOpenId(openId === c.id ? null : c.id)}
              onUpdate={(patch) => update(c.id, patch)}
              onMove={(dir) => onChange(moveCamera(cameras, c.id, dir))}
              onRemove={() => onChange(removeCamera(cameras, c.id))}
            />
          ))}
        </div>
      )}

      <datalist id="cable-run-presets">
        {CABLE_RUN_PRESETS.map((p) => <option key={p} value={p} />)}
      </datalist>
      <datalist id="camera-variants">
        {CAMERA_VARIANTS.map((v) => <option key={v} value={v} />)}
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
        <Plus size={16} /> Add camera {cameras.length + 1}
      </button>
    </div>
  );
}

/** The numbers the switch, NVR and materials are sized from, given room. */
function Totals({ counts, value, cable }: {
  counts: ReturnType<typeof cameraCounts>;
  value: number;
  cable: ReturnType<typeof cableEstimate>;
}) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))',
      gap: 1, marginBottom: 14, borderRadius: 14, overflow: 'hidden', background: '#e9e4d6',
    }}>
      <Stat label="Cameras" value={String(counts.total)} sub={`${counts.indoor} in · ${counts.outdoor} out`} />
      <Stat label="PoE ports" value={String(counts.poePorts)} />
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

// ── One camera ──────────────────────────────────────────────────────────────

function Row({
  camera: c, index, last, open, folderKey, onToggle, onUpdate, onMove, onRemove,
}: {
  camera: SurveyCamera;
  index: number;
  last: boolean;
  open: boolean;
  folderKey: string;
  onToggle: () => void;
  onUpdate: (patch: Partial<SurveyCamera>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  // The one-line summary that makes opening the row unnecessary most of the time.
  const summary = [
    c.camera_type,
    c.mount ? `${c.mount.toLowerCase()} mount` : '',
    (c.variant ?? '').trim(),
    c.placement === 'Outdoor' ? 'outdoor' : '',
    c.cable_run && !/tbd/i.test(c.cable_run) ? c.cable_run : '',
  ].filter((p) => p && p.trim()).join(' · ');

  const priced = Number(c.unit_price) > 0;
  const photo = (c.photos ?? [])[0];

  return (
    <div style={{
      border: open ? '1px solid var(--teal)' : '1px solid #eae5d8',
      borderRadius: 14, background: 'white', overflow: 'hidden',
      boxShadow: open ? '0 4px 18px rgba(14,27,46,0.08)' : 'none',
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
        }}>{c.position}</span>

        {photo && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={photo} alt="" style={{ width: 34, height: 34, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
        )}

        <span style={{ minWidth: 0, flex: 1 }}>
          <span style={{ display: 'block', fontSize: 15, fontWeight: 700, color: c.location ? '#2a2a2a' : '#b5afa0', lineHeight: 1.3 }}>
            {c.location || 'Untitled position'}
          </span>
          <span style={{ display: 'block', fontSize: 12.5, color: '#8a8578', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {summary || 'Tap to fill in'}
          </span>
        </span>

        <span style={{ fontSize: 14, fontWeight: 800, color: priced ? '#047857' : '#c9c3b4', flexShrink: 0 }}>
          {priced ? fmtMoney(c.unit_price) : '—'}
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
              className="input" placeholder="e.g. Network room (head-end)" autoFocus
              value={c.location} onChange={(e) => onUpdate({ location: e.target.value })}
            />
          </Field>
          <Two>
            <Field label="Indoor or outdoor">
              <select className="select input" value={c.placement}
                onChange={(e) => onUpdate({ placement: e.target.value as SurveyCamera['placement'] })}>
                <option value="Indoor">Indoor</option>
                <option value="Outdoor">Outdoor</option>
              </select>
            </Field>
            <Field label="Mount height (ft)">
              <input className="input" type="number" step="0.5" inputMode="decimal"
                value={c.mount_height_ft ?? ''}
                onChange={(e) => onUpdate({ mount_height_ft: e.target.value === '' ? null : Number(e.target.value) })} />
            </Field>
          </Two>

          <Group>The camera</Group>
          <Two>
            <Field label="Type">
              <select className="select input" value={c.camera_type} onChange={(e) => onUpdate({ camera_type: e.target.value })}>
                {CAMERA_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Mount">
              <select className="select input" value={c.mount} onChange={(e) => onUpdate({ mount: e.target.value })}>
                {CAMERA_MOUNTS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </Field>
          </Two>
          <Two>
            <Field label="Cover / housing">
              <input className="input" list="camera-variants" placeholder="e.g. tinted cover"
                value={c.variant ?? ''} onChange={(e) => onUpdate({ variant: e.target.value })} />
            </Field>
            <Field label="Resolution">
              <select className="select input" value={c.resolution} onChange={(e) => onUpdate({ resolution: e.target.value })}>
                {CAMERA_RESOLUTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>
          </Two>

          <Group>Cable &amp; pathway</Group>
          <Two>
            <Field label="Cable run">
              <input className="input" list="cable-run-presets" value={c.cable_run}
                onChange={(e) => onUpdate({ cable_run: e.target.value })} />
            </Field>
            <Field label="Runs from">
              <input className="input" placeholder="e.g. IDF-2 / network room"
                value={c.origin_point ?? ''} onChange={(e) => onUpdate({ origin_point: e.target.value })} />
            </Field>
          </Two>
          <Two>
            <Field label="Pathway">
              <input className="input" placeholder="Plenum, J-hooks, conduit…"
                value={c.pathway_notes ?? ''} onChange={(e) => onUpdate({ pathway_notes: e.target.value })} />
            </Field>
            <Field label="Materials needed">
              <input className="input" placeholder="Mount, box, whip…"
                value={c.materials_needed ?? ''} onChange={(e) => onUpdate({ materials_needed: e.target.value })} />
            </Field>
          </Two>

          <Group>Price &amp; status</Group>
          <Two>
            <Field label="Price installed">
              <input className="input" type="number" step="0.01" min={0} inputMode="decimal"
                value={c.unit_price || ''} placeholder="0.00"
                onChange={(e) => onUpdate({ unit_price: Number(e.target.value) || 0 })} />
            </Field>
            <Field label="Status">
              <select className="select input" value={c.status}
                onChange={(e) => onUpdate({ status: e.target.value as SurveyCamera['status'] })}>
                {CAMERA_STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
              </select>
            </Field>
          </Two>
          <Field label="Notes">
            <input className="input" placeholder="Drop ceiling, sightline, obstructions…"
              value={c.notes ?? ''} onChange={(e) => onUpdate({ notes: e.target.value })} />
          </Field>

          <Group>Photo of the spot</Group>
          <SurveyPhotoStrip
            photos={c.photos ?? []} folderKey={folderKey}
            alt={`Camera ${c.position} area`} size={64}
            onChange={(photos) => onUpdate({ photos })}
          />
          <SurveyPhotoRead
            photoUrl={(c.photos ?? [])[0]}
            position={c.position}
            noun="camera"
            onAccept={(patch) => onUpdate(patch as Partial<SurveyCamera>)}
          />

          {/* Row actions live here, out of the way until the row is open. */}
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
              onClick={() => { if (confirm(`Remove camera ${c.position}?`)) onRemove(); }}
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
