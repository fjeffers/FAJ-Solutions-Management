'use client';
// The odometer photo at the start and end of each drive (Fred, 2026-10-18:
// "the mileage photos ... of start and ending mileage"). Asked right after
// Start travel and Confirm arrival on a job that asks for it (lib/capture.ts),
// so the tap's time and GPS aren't held up by the photo. The AI reads the
// number (/api/tech/read-photo); the tech checks it and sends it with the
// photo (/api/tech/odometer). GPS miles are still worked out from the taps,
// as a check. Needs signal: with none, the tech can skip and the weekly bill
// shows the reading as missing.
import { useEffect, useState } from 'react';
import { Camera, Gauge } from 'lucide-react';
import { shrinkPhoto } from '@/lib/photo-stamp';
import { toastError, toastSuccess } from '@/lib/toast';
import { Dialog } from './WfUi';

export type OdometerMoment = 'start' | 'end';

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

export default function OdometerDialog({ woNumber, moment, onClose }: {
  woNumber: string; moment: OdometerMoment; onClose: () => void;
}) {
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [takenAt, setTakenAt] = useState<string | null>(null);
  const [reading, setReading] = useState('');
  const [ai, setAi] = useState<number | null>(null);
  const [readingBusy, setReadingBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const take = async (f: File | undefined) => {
    if (!f) return;
    try {
      const small = await shrinkPhoto(f);
      setPhoto(small);
      setPreview(URL.createObjectURL(small));
      setTakenAt(new Date().toISOString());
      setReadingBusy(true);
      const r = await readPhoto<{ reading: number | null }>(woNumber, 'odometer', small);
      setReadingBusy(false);
      setAi(r?.reading ?? null);
      if (r?.reading != null) setReading(String(r.reading));
    } catch (e) {
      setReadingBusy(false);
      toastError(e instanceof Error ? e.message : "Couldn't use that photo.");
    }
  };

  const typed = Number(reading.replace(/[,\s]/g, ''));
  const ok = reading.trim() !== '' && Number.isFinite(typed) && typed >= 0 && typed < 10_000_000;

  const send = async () => {
    if (!ok) { toastError('Enter the miles on the odometer.'); return; }
    setBusy(true);
    const fd = new FormData();
    fd.append('wo_number', woNumber);
    fd.append('at', takenAt ?? new Date().toISOString());
    fd.append('reading', String(typed));
    if (ai != null) fd.append('ai_reading', String(ai));
    if (photo) fd.append('file', new File([photo], 'odometer.jpg', { type: 'image/jpeg' }));
    try {
      const res = await fetch('/api/tech/odometer', { method: 'POST', body: fd });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      setBusy(false);
      if (!res.ok || !json.ok) { toastError(json.error ?? "Couldn't send the odometer."); return; }
      toastSuccess('Odometer sent.');
      onClose();
    } catch {
      setBusy(false);
      toastError('The odometer needs signal to send. Keep the photo on your phone and add it later, or skip it.');
    }
  };

  return (
    <Dialog
      title={moment === 'start' ? 'Odometer at the start' : 'Odometer at the end'}
      onClose={onClose}
      footer={<>
        <button className="wf-btn wf-btn-ghost" onClick={onClose}>Skip</button>
        <button className="wf-btn wf-btn-navy" disabled={busy || readingBusy || !ok} onClick={() => void send()}><Gauge size={16} /> {busy ? 'Sending…' : 'Send'}</button>
      </>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p className="wf-subtle" style={{ margin: 0, fontSize: 13.5 }}>
          {moment === 'start' ? 'Take a photo of the odometer before you drive off.' : 'Take a photo of the odometer now you have arrived.'}
          {' '}It goes on the weekly bill with the miles.
        </p>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {preview && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Odometer" style={{ width: 120, height: 90, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--wf-line)' }} />
          )}
          <label className="wf-btn wf-btn-outline">
            <Camera size={16} /> {preview ? 'Retake' : 'Take photo'}
            <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void take(f); }} />
          </label>
        </div>
        <label style={{ display: 'block' }}>
          <span className="wf-label" style={{ display: 'block', marginBottom: 4, fontWeight: 600, color: 'var(--wf-text)', fontSize: 13 }}>Miles on the odometer</span>
          <input className="wf-input" inputMode="decimal" placeholder={readingBusy ? 'Reading the photo…' : 'e.g. 48213'} value={reading}
            onChange={(e) => setReading(e.target.value)} aria-describedby="odo-ai" />
        </label>
        <div id="odo-ai" className="wf-subtle" style={{ fontSize: 12.5 }} aria-live="polite">
          {readingBusy ? 'Reading the photo…'
            : ai != null ? (typed === ai ? 'Read from the photo. Check it matches the dashboard.' : `The photo reads ${ai.toLocaleString('en-US')}. The office sees both.`)
              : photo ? "Couldn't read the photo. Type the number in." : null}
        </div>
      </div>
    </Dialog>
  );
}
