'use client';
// The mileage photo at the start and end of each drive (Fred, 2026-10-18:
// "a GPS photo of the starting mileage"). The photo gets the time, the job and
// the GPS position printed on it, like every job photo. The AI reads the
// number (/api/tech/read-photo) and that is the reading: the tech can't type
// or change it (Fred, 2026-10-21: "so that way you can't alter it"). A photo
// the AI can't read is retaken. When the AI can't be reached (no signal, or
// not set up), the stamped photo is kept as a job photo for the office to
// read, so nothing is lost and nothing is typed.
//
// The start is part of Check in (components/wf/CheckIn.tsx); the end is asked
// right after arriving (OdometerDialog), so the tap keeps its own time.
import { useEffect, useRef, useState } from 'react';
import { Camera, Gauge } from 'lucide-react';
import { getPosition, stampLines, type Position } from '@/lib/geo';
import { stampPhoto } from '@/lib/photo-stamp';
import { toastError, toastSuccess } from '@/lib/toast';
import { Dialog } from './WfUi';

export type OdometerMoment = 'start' | 'end';
/** Keep a stamped photo with the job: sent now, or on the phone until there's signal. */
export type SavePhoto = (blob: Blob, label: string, takenAt: string, pos: Position | null) => Promise<'sent' | 'queued' | { error: string }>;

export async function readPhoto<T>(woNumber: string, kind: 'odometer' | 'receipt', photo: Blob): Promise<T | null> {
  return (await readPhotoFull<T>(woNumber, kind, photo)).result;
}

/**
 * The AI's read, and whether it could try: 'ai' (it looked; result may be null
 * when the photo is unreadable) or 'unavailable' (no signal, not set up, or an error).
 */
async function readPhotoFull<T>(woNumber: string, kind: 'odometer' | 'receipt', photo: Blob): Promise<{ result: T | null; source: 'ai' | 'unavailable' }> {
  const fd = new FormData();
  fd.append('wo_number', woNumber);
  fd.append('kind', kind);
  fd.append('file', new File([photo], `${kind}.jpg`, { type: 'image/jpeg' }));
  try {
    const res = await fetch('/api/tech/read-photo', { method: 'POST', body: fd });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T | null; source?: string };
    if (!res.ok || !json.ok) return { result: null, source: 'unavailable' };
    const looked = json.source === 'ai' || json.source === 'unreadable';
    return { result: json.result ?? null, source: looked ? 'ai' : 'unavailable' };
  } catch {
    return { result: null, source: 'unavailable' };
  }
}

/** Where a mileage photo stands: nothing yet, read, unreadable (retake), or the AI can't be reached (the office reads it). */
export type MileageRead = 'none' | 'read' | 'unreadable' | 'unavailable';

/** One mileage photo: the stamped picture, where it was taken, and the number the AI read from it. */
export function useMileage(woNumber: string, moment: OdometerMoment) {
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [takenAt, setTakenAt] = useState<string | null>(null);
  const [pos, setPos] = useState<Position | null>(null);
  const [ai, setAi] = useState<number | null>(null);
  const [read, setRead] = useState<MileageRead>('none');
  const [busy, setBusy] = useState(false);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const take = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      const at = new Date();
      const where = await getPosition(8000);
      const title = moment === 'start' ? 'Starting mileage' : 'Ending mileage';
      const stamped = await stampPhoto(f, stampLines({ woNumber, title, at, pos: where }));
      setPhoto(stamped);
      setPreview(URL.createObjectURL(stamped));
      setTakenAt(at.toISOString());
      setPos(where);
      setAi(null);
      setRead('none');
      const r = await readPhotoFull<{ reading: number | null }>(woNumber, 'odometer', stamped);
      const n = r.result?.reading ?? null;
      setAi(n);
      setRead(n != null ? 'read' : r.source === 'ai' ? 'unreadable' : 'unavailable');
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Couldn't use that photo.");
    }
    setBusy(false);
  };
  // Ready to send: the photo with its GPS, and a number read from it (or the office reads it).
  const complete = !!photo && !!pos && (read === 'read' || read === 'unavailable');
  return { photo, preview, takenAt, pos, ai, read, busy, take, complete };
}
export type Mileage = ReturnType<typeof useMileage>;

/** Save the reading; when the AI couldn't be reached, or the save fails, keep the photo as a job photo for the office to read. */
/** 'saved': a reading; 'kept': kept as a job photo; null: not sent (the tech was told why). */
export async function sendMileage(woNumber: string, moment: OdometerMoment, m: Mileage, keep: SavePhoto): Promise<'saved' | 'kept' | null> {
  if (!m.photo) { toastError('Take the photo of the odometer first.'); return null; }
  const at = m.takenAt ?? new Date().toISOString();
  let error: string | null = null;
  if (m.ai != null) {
    const fd = new FormData();
    fd.append('wo_number', woNumber);
    fd.append('at', at);
    fd.append('moment', moment);
    fd.append('reading', String(m.ai));
    fd.append('ai_reading', String(m.ai));
    if (m.pos) {
      fd.append('lat', String(m.pos.lat));
      fd.append('lng', String(m.pos.lng));
      if (m.pos.accuracy != null) fd.append('accuracy', String(m.pos.accuracy));
    }
    fd.append('file', new File([m.photo], 'odometer.jpg', { type: 'image/jpeg' }));
    try {
      const res = await fetch('/api/tech/odometer', { method: 'POST', body: fd });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && json.ok) return 'saved';
      error = json.error ?? null;
    } catch { /* no signal */ }
  }
  const title = moment === 'start' ? 'Starting mileage' : 'Ending mileage';
  const label = m.ai != null ? `${title}: ${m.ai.toLocaleString('en-US')}` : `${title} (for the office to read)`;
  const r = await keep(m.photo, label, at, m.pos);
  if (typeof r === 'object') { toastError(error ?? r.error); return null; }
  toastSuccess(r === 'queued' ? 'Mileage photo saved on your phone. It goes to the office when you have signal.' : 'Mileage photo sent.');
  return 'kept';
}

/** The photo and the number read from it. Nothing to type. */
export function MileagePhoto({ m, moment }: { m: Mileage; moment: OdometerMoment }) {
  const label = moment === 'start' ? 'Starting mileage' : 'Ending mileage';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        {m.preview && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={m.preview} alt={label} style={{ width: 132, height: 99, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--wf-line)' }} />
        )}
        <label className={`wf-btn ${m.preview ? 'wf-btn-outline' : 'wf-btn-navy'}`} style={{ opacity: m.busy ? 0.6 : 1 }}>
          <Camera size={16} /> {m.busy ? 'One moment…' : m.preview ? 'Retake' : 'Take the photo'}
          <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} disabled={m.busy}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void m.take(f); }} />
        </label>
      </div>
      <div>
        <div className="wf-label" style={{ fontWeight: 600, color: 'var(--wf-text)', fontSize: 13, marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: 20, fontWeight: 700 }} aria-live="polite">
          {m.busy ? 'Reading the photo…' : m.ai != null ? m.ai.toLocaleString('en-US') : '—'}
        </div>
      </div>
      <div className="wf-subtle" style={{ fontSize: 12.5 }} aria-live="polite">
        {m.busy ? null
          : m.read === 'read' ? 'Read from the photo. If it doesn\'t match the dashboard, retake the photo.'
            : m.read === 'unreadable' ? "Couldn't read the number. Retake the photo closer, with the numbers sharp and in the light."
              : m.read === 'unavailable' ? "The number can't be read right now. The photo is saved and the office reads it."
                : 'The number is read from the photo.'}
        {!m.busy && m.photo && !m.pos ? ' No GPS on this photo. Turn on Location for this app and retake it.' : ''}
      </div>
    </div>
  );
}

/** The ending mileage, asked right after arriving. */
export default function OdometerDialog({ woNumber, moment, keep, onClose, initialFile, required = false }: {
  woNumber: string; moment: OdometerMoment; keep: SavePhoto; onClose: () => void;
  /** A photo already taken (the job's Photo icon, marked as mileage): stamped and read at once. */
  initialFile?: File | null;
  /** The end or start of a drive: no Skip (lib/checkin.ts needsOdometer). */
  required?: boolean;
}) {
  const m = useMileage(woNumber, moment);
  const started = useRef(false);
  useEffect(() => {
    if (initialFile && !started.current) { started.current = true; void m.take(initialFile); }
  }, [initialFile]); // eslint-disable-line react-hooks/exhaustive-deps
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    const done = await sendMileage(woNumber, moment, m, keep);
    setBusy(false);
    if (done === 'saved') toastSuccess('Mileage sent.');
    if (done) onClose();
  };
  const close = required ? () => toastError('The mileage photo is needed for every drive.') : onClose;
  return (
    <Dialog
      title={moment === 'start' ? 'Starting mileage' : 'Ending mileage'}
      onClose={close}
      footer={<>
        {!required && <button className="wf-btn wf-btn-ghost" onClick={onClose}>Skip</button>}
        <button className="wf-btn wf-btn-navy" disabled={busy || m.busy || !m.complete} onClick={() => void send()}><Gauge size={16} /> {busy ? 'Sending…' : 'Send'}</button>
      </>}
    >
      <p className="wf-subtle" style={{ margin: '0 0 12px', fontSize: 13.5 }}>
        {moment === 'start' ? 'Take a photo of the odometer before you drive off.' : 'Take a photo of the odometer now you have arrived.'} The time and GPS go on the photo, and the miles go on the weekly bill.
      </p>
      <MileagePhoto m={m} moment={moment} />
    </Dialog>
  );
}
