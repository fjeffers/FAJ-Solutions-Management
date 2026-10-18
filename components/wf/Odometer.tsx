'use client';
// The mileage photo at the start and end of each drive (Fred, 2026-10-18:
// "a GPS photo of the starting mileage"). The photo gets the time, the job and
// the GPS position printed on it, like every job photo. The AI reads the
// number (/api/tech/read-photo); the tech checks it and it's saved with the
// photo and the position (/api/tech/odometer). With no signal, or before the
// office has switched odometer readings on, the stamped photo is kept as a job
// photo labelled with the number, so nothing is lost.
//
// The start is part of Check in (components/wf/CheckIn.tsx); the end is asked
// right after arriving (OdometerDialog), so the tap keeps its own time.
import { useEffect, useState } from 'react';
import { Camera, Gauge } from 'lucide-react';
import { getPosition, stampLines, type Position } from '@/lib/geo';
import { stampPhoto } from '@/lib/photo-stamp';
import { toastError, toastSuccess } from '@/lib/toast';
import { Dialog } from './WfUi';

export type OdometerMoment = 'start' | 'end';
/** Keep a stamped photo with the job: sent now, or on the phone until there's signal. */
export type SavePhoto = (blob: Blob, label: string, takenAt: string, pos: Position | null) => Promise<'sent' | 'queued' | { error: string }>;

export async function readPhoto<T>(woNumber: string, kind: 'odometer' | 'receipt', photo: Blob): Promise<T | null> {
  const fd = new FormData();
  fd.append('wo_number', woNumber);
  fd.append('kind', kind);
  fd.append('file', new File([photo], `${kind}.jpg`, { type: 'image/jpeg' }));
  try {
    const res = await fetch('/api/tech/read-photo', { method: 'POST', body: fd });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T | null };
    return res.ok && json.ok ? json.result ?? null : null;
  } catch {
    return null;
  }
}

/** One mileage photo: the stamped picture, where it was taken, what the AI read, what the tech typed. */
export function useMileage(woNumber: string, moment: OdometerMoment) {
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [takenAt, setTakenAt] = useState<string | null>(null);
  const [pos, setPos] = useState<Position | null>(null);
  const [reading, setReading] = useState('');
  const [ai, setAi] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const take = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      const at = new Date();
      const where = await getPosition(6000);
      const title = moment === 'start' ? 'Starting mileage' : 'Ending mileage';
      const stamped = await stampPhoto(f, stampLines({ woNumber, title, at, pos: where }));
      setPhoto(stamped);
      setPreview(URL.createObjectURL(stamped));
      setTakenAt(at.toISOString());
      setPos(where);
      const r = await readPhoto<{ reading: number | null }>(woNumber, 'odometer', stamped);
      setAi(r?.reading ?? null);
      if (r?.reading != null) setReading(String(r.reading));
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Couldn't use that photo.");
    }
    setBusy(false);
  };
  const typed = Number(reading.replace(/[,\s]/g, ''));
  const ok = reading.trim() !== '' && Number.isFinite(typed) && typed >= 0 && typed < 10_000_000;
  return { photo, preview, takenAt, pos, reading, setReading, ai, busy, take, typed, ok };
}
export type Mileage = ReturnType<typeof useMileage>;

/** Save the reading; with no signal or before it's switched on, keep the photo as a job photo instead. */
/** 'saved': a reading; 'kept': kept as a job photo; null: not sent (the tech was told why). */
export async function sendMileage(woNumber: string, moment: OdometerMoment, m: Mileage, keep: SavePhoto): Promise<'saved' | 'kept' | null> {
  const at = m.takenAt ?? new Date().toISOString();
  const fd = new FormData();
  fd.append('wo_number', woNumber);
  fd.append('at', at);
  fd.append('reading', String(m.typed));
  if (m.ai != null) fd.append('ai_reading', String(m.ai));
  if (m.pos) {
    fd.append('lat', String(m.pos.lat));
    fd.append('lng', String(m.pos.lng));
    if (m.pos.accuracy != null) fd.append('accuracy', String(m.pos.accuracy));
  }
  if (m.photo) fd.append('file', new File([m.photo], 'odometer.jpg', { type: 'image/jpeg' }));
  let error: string | null = null;
  try {
    const res = await fetch('/api/tech/odometer', { method: 'POST', body: fd });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (res.ok && json.ok) return 'saved';
    // A wrong number is the tech's to fix; anything else falls back to a job photo.
    if (res.status === 400) { toastError(json.error ?? 'Check the mileage.'); return null; }
    error = json.error ?? null;
  } catch { /* no signal */ }
  if (!m.photo) { toastError(error ?? 'The mileage needs signal to send. Try again when you have it.'); return null; }
  const label = `${moment === 'start' ? 'Starting' : 'Ending'} mileage: ${m.typed.toLocaleString('en-US')}`;
  const r = await keep(m.photo, label, at, m.pos);
  if (typeof r === 'object') { toastError(r.error); return null; }
  toastSuccess(r === 'queued' ? 'Mileage photo saved on your phone. It goes to the office when you have signal.' : 'Mileage photo sent.');
  return 'kept';
}

/** The photo, the number and what the AI read. */
export function MileagePhoto({ m, moment }: { m: Mileage; moment: OdometerMoment }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        {m.preview && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={m.preview} alt={moment === 'start' ? 'Starting mileage' : 'Ending mileage'} style={{ width: 132, height: 99, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--wf-line)' }} />
        )}
        <label className={`wf-btn ${m.preview ? 'wf-btn-outline' : 'wf-btn-navy'}`} style={{ opacity: m.busy ? 0.6 : 1 }}>
          <Camera size={16} /> {m.busy ? 'One moment…' : m.preview ? 'Retake' : 'Take the photo'}
          <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} disabled={m.busy}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void m.take(f); }} />
        </label>
      </div>
      <label style={{ display: 'block' }}>
        <span className="wf-label" style={{ display: 'block', marginBottom: 4, fontWeight: 600, color: 'var(--wf-text)', fontSize: 13 }}>
          {moment === 'start' ? 'Starting mileage' : 'Ending mileage'}
        </span>
        <input className="wf-input" inputMode="decimal" placeholder={m.busy ? 'Reading the photo…' : 'e.g. 48213'} value={m.reading}
          onChange={(e) => m.setReading(e.target.value)} aria-describedby={`odo-ai-${moment}`} />
      </label>
      <div id={`odo-ai-${moment}`} className="wf-subtle" style={{ fontSize: 12.5 }} aria-live="polite">
        {m.busy ? 'Reading the photo…'
          : m.ai != null ? (m.typed === m.ai ? 'Read from the photo. Check it matches the dashboard.' : `The photo reads ${m.ai.toLocaleString('en-US')}. The office sees both.`)
            : m.photo ? "Couldn't read the photo. Type the number in." : null}
        {!m.busy && m.photo && !m.pos ? ' No GPS on this photo: the phone did not give a location.' : ''}
      </div>
    </div>
  );
}

/** The ending mileage, asked right after arriving. */
export default function OdometerDialog({ woNumber, moment, keep, onClose }: {
  woNumber: string; moment: OdometerMoment; keep: SavePhoto; onClose: () => void;
}) {
  const m = useMileage(woNumber, moment);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!m.ok) { toastError('Enter the mileage on the odometer.'); return; }
    setBusy(true);
    const done = await sendMileage(woNumber, moment, m, keep);
    setBusy(false);
    if (done === 'saved') toastSuccess('Mileage sent.');
    if (done) onClose();
  };
  return (
    <Dialog
      title={moment === 'start' ? 'Starting mileage' : 'Ending mileage'}
      onClose={onClose}
      footer={<>
        <button className="wf-btn wf-btn-ghost" onClick={onClose}>Skip</button>
        <button className="wf-btn wf-btn-navy" disabled={busy || m.busy || !m.ok} onClick={() => void send()}><Gauge size={16} /> {busy ? 'Sending…' : 'Send'}</button>
      </>}
    >
      <p className="wf-subtle" style={{ margin: '0 0 12px', fontSize: 13.5 }}>
        Take a photo of the odometer now you have arrived. The time and GPS go on the photo, and the miles go on the weekly bill.
      </p>
      <MileagePhoto m={m} moment={moment} />
    </Dialog>
  );
}
