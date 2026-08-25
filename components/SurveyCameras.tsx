'use client';
import { Plus, X, ChevronUp, ChevronDown, Camera } from 'lucide-react';
import { addCamera, removeCamera, moveCamera, cameraCounts } from '@/lib/surveys';
import SurveyPhotoStrip from '@/components/SurveyPhotoStrip';
import type { SurveyCamera } from '@/lib/types';
import {
  CAMERA_TYPES, CAMERA_RESOLUTIONS, CAMERA_STATUSES, CABLE_RUN_PRESETS,
  CAMERA_MOUNTS, CAMERA_VARIANTS,
} from '@/lib/types';

/**
 * The numbered camera schedule — the table the whole job gets priced from.
 *
 * Positions are explicit and rewritten on every insert, delete and move, so
 * putting the head-end dome at the top really does shift everything below it
 * down, the way it does on paper.
 *
 * Each row carries photos of its recommended mounting area, because "camera 2,
 * inside office hallway" only means something to a client with the picture.
 */
export default function SurveyCameras({
  cameras, folderKey, onChange,
}: {
  cameras: SurveyCamera[];
  folderKey: string;
  onChange: (next: SurveyCamera[]) => void;
}) {
  const counts = cameraCounts(cameras);
  const update = (id: string, patch: Partial<SurveyCamera>) =>
    onChange(cameras.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  return (
    <div>
      {/* The counts the switch, NVR and materials are sized from — shown so a
          7-vs-8 disagreement can't hide in a long table. */}
      {cameras.length > 0 && (
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginBottom: 10,
          padding: '9px 12px', borderRadius: 10, background: 'rgba(13,115,119,0.06)',
          fontSize: 12, color: '#555',
        }}>
          <strong style={{ color: 'var(--teal)' }}>
            {counts.total} camera{counts.total !== 1 ? 's' : ''}
          </strong>
          <span>{counts.indoor} indoor · {counts.outdoor} outdoor</span>
          <span>{counts.poePorts} PoE port{counts.poePorts !== 1 ? 's' : ''} needed</span>
          {counts.existing > 0 && <span>{counts.existing} existing</span>}
          {counts.runsUnknown > 0 && (
            <span style={{ color: '#b45309', fontWeight: 600 }}>
              {counts.runsUnknown} run{counts.runsUnknown !== 1 ? 's' : ''} still TBD
            </span>
          )}
        </div>
      )}

      {cameras.length === 0 ? (
        <div style={{ padding: '20px 14px', textAlign: 'center', color: '#aaa', fontSize: 13, border: '1px dashed #ddd', borderRadius: 10 }}>
          <Camera size={22} color="#ddd" style={{ marginBottom: 6 }} />
          <div>No cameras yet.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {cameras.map((c, i) => (
            <div key={c.id} style={{ border: '1px solid #e8e8e8', borderRadius: 10, padding: 10, background: 'rgba(255,255,255,0.5)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{
                  width: 26, height: 26, borderRadius: '50%', background: 'var(--teal)', color: 'white',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 800, flexShrink: 0,
                }}>{c.position}</span>
                <input
                  className="input" placeholder="Location — e.g. Network room (head-end)"
                  value={c.location} onChange={(e) => update(c.id, { location: e.target.value })}
                  style={{ fontWeight: 600 }}
                />
                <button
                  title="Move up" onClick={() => onChange(moveCamera(cameras, c.id, -1))}
                  disabled={i === 0} style={{ ...MINI_BTN, opacity: i === 0 ? 0.3 : 1 }}
                ><ChevronUp size={15} /></button>
                <button
                  title="Move down" onClick={() => onChange(moveCamera(cameras, c.id, 1))}
                  disabled={i === cameras.length - 1} style={{ ...MINI_BTN, opacity: i === cameras.length - 1 ? 0.3 : 1 }}
                ><ChevronDown size={15} /></button>
                <button
                  title="Remove camera" onClick={() => onChange(removeCamera(cameras, c.id))}
                  style={{ ...MINI_BTN, color: '#b91c1c' }}
                ><X size={15} /></button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(115px, 1fr))', gap: 8 }}>
                <Cell label="Type">
                  <select className="select input" value={c.camera_type} onChange={(e) => update(c.id, { camera_type: e.target.value })}>
                    {CAMERA_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </Cell>
                <Cell label="Mount">
                  <select className="select input" value={c.mount} onChange={(e) => update(c.id, { mount: e.target.value })}>
                    {CAMERA_MOUNTS.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </Cell>
                <Cell label="Cover / housing">
                  <input
                    className="input" list="camera-variants" placeholder="e.g. tinted cover"
                    value={c.variant ?? ''} onChange={(e) => update(c.id, { variant: e.target.value })}
                  />
                </Cell>
                <Cell label="In / Out">
                  <select className="select input" value={c.placement} onChange={(e) => update(c.id, { placement: e.target.value as SurveyCamera['placement'] })}>
                    <option value="Indoor">Indoor</option>
                    <option value="Outdoor">Outdoor</option>
                  </select>
                </Cell>
                <Cell label="Cable run">
                  <input
                    className="input" list="cable-run-presets" value={c.cable_run}
                    onChange={(e) => update(c.id, { cable_run: e.target.value })}
                  />
                </Cell>
                <Cell label="Resolution">
                  <select className="select input" value={c.resolution} onChange={(e) => update(c.id, { resolution: e.target.value })}>
                    {CAMERA_RESOLUTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </Cell>
                <Cell label="Status">
                  <select className="select input" value={c.status} onChange={(e) => update(c.id, { status: e.target.value as SurveyCamera['status'] })}>
                    {CAMERA_STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
                  </select>
                </Cell>
                <Cell label="Mount ht (ft)">
                  <input
                    className="input" type="number" step="0.5" inputMode="decimal"
                    value={c.mount_height_ft ?? ''}
                    onChange={(e) => update(c.id, { mount_height_ft: e.target.value === '' ? null : Number(e.target.value) })}
                  />
                </Cell>
              </div>

              <input
                className="input" placeholder="Notes — drop ceiling, sightline, obstructions…"
                value={c.notes ?? ''} onChange={(e) => update(c.id, { notes: e.target.value })}
                style={{ marginTop: 8, fontSize: 12 }}
              />

              <div style={{ marginTop: 8 }}>
                <SurveyPhotoStrip
                  photos={c.photos ?? []} folderKey={folderKey}
                  alt={`Camera ${c.position} area`}
                  onChange={(photos) => update(c.id, { photos })}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Shared by every row on the page. */}
      <datalist id="cable-run-presets">
        {CABLE_RUN_PRESETS.map((p) => <option key={p} value={p} />)}
      </datalist>
      <datalist id="camera-variants">
        {CAMERA_VARIANTS.map((v) => <option key={v} value={v} />)}
      </datalist>

      <button className="btn btn-ghost" style={{ marginTop: 10, fontSize: 12 }} onClick={() => onChange(addCamera(cameras))}>
        <Plus size={12} /> Add Camera
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
