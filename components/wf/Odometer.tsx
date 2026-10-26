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
//
// A photo picked from the phone later (Fred, 2026-10-26: the app was down, "if
// I take a picture on my phone and then upload later on"): the AI looks whether
// it is the odometer and reads it, then the tech says starting or ending
// (PhotoMileageDialog). It is saved at the time the photo was taken
// (lib/photo-time.ts), with the photo's own GPS when it has one.
import { useEffect, useRef, useState } from 'react';
import { Camera, Gauge } from 'lucide-react';
import { getPosition, stampLines, type Position } from '@/lib/geo';
import { stampPhoto, shrinkPhoto } from '@/lib/photo-stamp';
import { photoTakenAt, PHOTO_MILEAGE_MAX_AGE_MS, type PhotoTime } from '@/lib/photo-time';
import type { SortRead } from '@/lib/photo-read';
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
async function readPhotoFull<T>(woNumber: string, kind: 'odometer' | 'receipt' | 'sort', photo: Blob): Promise<{ result: T | null; source: 'ai' | 'unavailable' }> {
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
export async function sendMileage(woNumber: string, moment: OdometerMoment, m: Pick<Mileage, 'photo' | 'takenAt' | 'pos' | 'ai'>, keep: SavePhoto): Promise<'saved' | 'kept' | null> {
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

/** What a photo picked from the phone is: the odometer (sure: the AI said so) or not, its reading, and when it was taken. */
export type PhonePhoto = { what: 'odometer' | 'other'; sure: boolean; read: number | null; taken: PhotoTime };

/** Looks at a photo picked from the phone. With no answer from the AI (no signal, not set up, unreadable), the tech is asked. */
export async function sortPhonePhoto(woNumber: string, file: File): Promise<PhonePhoto> {
  const taken = await photoTakenAt(file);
  let small: Blob;
  try { small = await shrinkPhoto(file, 1600); } catch { return { what: 'other', sure: false, read: null, taken }; }
  const r = await readPhotoFull<SortRead>(woNumber, 'sort', small);
  // No answer at all (out of reach, or it looked and said nothing): ask, rather than file it as a job photo (Greptile on PR #27).
  if (r.source === 'unavailable' || !r.result) return { what: 'odometer', sure: false, read: null, taken };
  if (r.result?.what === 'odometer') return { what: 'odometer', sure: true, read: r.result.reading, taken };
  return { what: 'other', sure: true, read: null, taken };
}

const fmtTaken = (iso: string) => new Date(iso).toLocaleString('en-US', {
  weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York',
});

/**
 * A mileage photo from the phone: the number read from it, when it was taken,
 * and "starting or ending?". Saved as a reading at the photo's own time; when
 * the number can't be read, the photo has no date, or it is over two days old
 * (the app keeps a tap's own time only that long), it goes to the office as a
 * job photo with what is known, and the office adds it (components/DayPictures).
 */
export function PhotoMileageDialog({ woNumber, file, photo, keep, onNotMileage, onClose, now: nowProp }: {
  woNumber: string; file: File; photo: PhonePhoto; keep: SavePhoto;
  /** Not the odometer after all: it goes with the job's photos. */
  onNotMileage: () => void;
  onClose: () => void;
  now?: number;
}) {
  const [moment, setMoment] = useState<OdometerMoment | null>(null);
  const [busy, setBusy] = useState(false);
  // How old the photo is, from when the dialog opened.
  const [now] = useState(() => nowProp ?? Date.now());
  const [preview] = useState(() => URL.createObjectURL(file));
  useEffect(() => () => URL.revokeObjectURL(preview), [preview]);
  const { read, taken } = photo;
  const tooOld = !!taken.at && now - Date.parse(taken.at) > PHOTO_MILEAGE_MAX_AGE_MS;
  const direct = read != null && !!taken.at && !tooOld;
  const why = read == null
    ? (photo.sure ? "Couldn't read the number, so the office reads it from the photo." : "The number can't be read right now, so the office reads it from the photo.")
    : !taken.at ? 'This photo has no date on it, so the office adds it from the photo.'
      : tooOld ? 'This photo is over two days old, so the office adds it from the photo.' : null;

  const send = async () => {
    if (!moment) return;
    setBusy(true);
    const title = moment === 'start' ? 'Starting mileage' : 'Ending mileage';
    try {
      const at = taken.at ?? new Date(now).toISOString();
      const stamped = await stampPhoto(file, stampLines({ woNumber, title: `${title}, added later`, at: new Date(at), pos: taken.gps, fromLibrary: !taken.at }));
      if (direct) {
        const done = await sendMileage(woNumber, moment, { photo: stamped, takenAt: at, pos: taken.gps, ai: read }, keep);
        if (done === 'saved') toastSuccess(`${title} sent: ${read!.toLocaleString('en-US')}.`);
        if (done) onClose();
      } else {
        const label = `${title}${read != null ? ` ${read.toLocaleString('en-US')}` : ''} (${taken.at ? `photo from ${fmtTaken(taken.at)}` : 'no date on the photo'}, for the office to add)`;
        const r = await keep(stamped, label, at, taken.gps);
        if (typeof r === 'object') { toastError(r.error); return; }
        toastSuccess(r === 'queued' ? 'Mileage photo saved on your phone. It goes to the office when you have signal.' : 'Mileage photo sent to the office.');
        onClose();
      }
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Couldn't use that photo.");
    } finally {
      setBusy(false);
    }
  };

  const choice = (m: OdometerMoment, label: string) => (
    <button type="button" className={`wf-btn ${moment === m ? 'wf-btn-navy' : 'wf-btn-outline'}`} aria-pressed={moment === m}
      style={{ flex: '1 1 140px' }} onClick={() => setMoment(m)}>{label}</button>
  );
  return (
    <Dialog
      title={photo.sure ? 'Mileage photo' : 'Is this a mileage photo?'}
      onClose={onClose}
      footer={<>
        <button className="wf-btn wf-btn-ghost" disabled={busy} onClick={onNotMileage}>Not a mileage photo</button>
        <button className="wf-btn wf-btn-navy" disabled={busy || !moment} onClick={() => void send()}><Gauge size={16} /> {busy ? 'Sending…' : 'Send'}</button>
      </>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="The photo picked" style={{ width: 132, height: 99, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--wf-line)' }} />
          <div>
            <div className="wf-label" style={{ fontWeight: 600, color: 'var(--wf-text)', fontSize: 13, marginBottom: 2 }}>Odometer</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{read != null ? read.toLocaleString('en-US') : '—'}</div>
            <div className="wf-subtle" style={{ fontSize: 12.5 }}>{taken.at ? `Taken ${fmtTaken(taken.at)}` : 'No date on this photo'}</div>
          </div>
        </div>
        <div>
          <p style={{ margin: '0 0 8px', fontWeight: 600 }}>Is this the starting or ending mileage?</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {choice('start', 'Starting mileage')}
            {choice('end', 'Ending mileage')}
          </div>
        </div>
        {why && <p className="wf-subtle" style={{ margin: 0, fontSize: 12.5 }}>{why}</p>}
      </div>
    </Dialog>
  );
}
