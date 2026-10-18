'use client';
// Check in (Fred, 2026-10-18: "they leave home, they sign into the app, hit
// Check in, then it asks them from where, then asks for a GPS photo of the
// starting mileage, along with any other things listed"). Step by step:
//   1. Where are you driving? One drop-down: Home → Hotel, Hotel → Site,
//      Site → Hotel… (lib/checkin.ts). Tapping Start the drive records it at
//      once, with the time and GPS, through the outbox, so it works with no signal.
//   2. The starting mileage: a GPS-stamped photo, read by the AI (Odometer.tsx),
//      when the job asks for odometer photos.
//   3. At the start of the day, what the office listed for check-in on the job:
//      a photo (GPS-stamped, kept with the job's photos) or a short answer (sent
//      to the office as messages).
// A job that doesn't ask for travel skips the drive: Check in is arriving on site.
import { useState } from 'react';
import { Camera, CheckCircle2, MapPin } from 'lucide-react';
import { asks } from '@/lib/capture';
import { checkInMissing, checkInNotes, drivesFor, driveOf, type Drive } from '@/lib/checkin';
import { getPosition, stampLines } from '@/lib/geo';
import { stampPhoto } from '@/lib/photo-stamp';
import type { Origin } from '@/lib/project-day';
import { toastError, toastSuccess } from '@/lib/toast';
import type { WfJob } from '@/lib/wf';
import { MileagePhoto, sendMileage, useMileage, type SavePhoto } from './Odometer';
import { Dialog } from './WfUi';

export type CheckInSend = {
  /** Record the drive (FAJ's travel_start), starting the day first when it hasn't started. */
  startDrive: (drive: Drive, startDay: boolean) => Promise<void>;
  /** No drive on this job: Check in is arriving on site. */
  arriveOnSite: () => Promise<void>;
  /** A stamped photo for the job. */
  keep: SavePhoto;
  /** The answers, as messages to the office. */
  note: (text: string) => void;
};

type Step = 'drive' | 'mileage' | 'asks';

export default function CheckInDialog({ job, startOfDay, afterWork = false, from, send, onClose }: {
  job: WfJob;
  /** The first check-in of the day: the day starts, and the office's items are asked. */
  startOfDay: boolean;
  /** Work done: only the drive back to the hotel or home. */
  afterWork?: boolean;
  /** Where the tech is now (their last drive), to list the likely drives first. */
  from: Origin | null;
  send: CheckInSend;
  onClose: () => void;
}) {
  const travel = asks(job.capture, 'travel');
  const mileageAsked = travel && asks(job.capture, 'odometer');
  const items = startOfDay && !afterWork ? job.startAsks : [];
  // The first step records the drive, or the arrival on a job with no drive.
  const steps: Step[] = ['drive', mileageAsked ? 'mileage' : null, items.length ? 'asks' : null].filter((s): s is Step => !!s);
  const [step, setStep] = useState<Step>('drive');
  const [driveKey, setDriveKey] = useState('');
  const [busy, setBusy] = useState(false);
  const m = useMileage(job.number, 'start');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [photos, setPhotos] = useState<Record<string, boolean>>({});
  const [photoBusy, setPhotoBusy] = useState<string | null>(null);
  const drive = driveOf(driveKey);
  const at = steps.indexOf(step);
  const next = () => { const n = steps[at + 1]; if (n) setStep(n); else finish(); };
  const finish = () => {
    for (const line of checkInNotes(drive, items, answers)) send.note(line);
    toastSuccess(travel ? 'Checked in. Drive safe.' : 'Checked in on site.');
    onClose();
  };

  const startDrive = async () => {
    if (!drive) { toastError('Pick where you are driving.'); return; }
    setBusy(true);
    await send.startDrive(drive, startOfDay);
    setBusy(false);
    next();
  };
  const arrive = async () => {
    setBusy(true);
    await send.arriveOnSite();
    setBusy(false);
    next();
  };
  const mileage = async () => {
    setBusy(true);
    const done = await sendMileage(job.number, 'start', m, send.keep);
    setBusy(false);
    if (done) next();
  };
  const askPhoto = async (id: string, label: string, f: File | undefined) => {
    if (!f) return;
    setPhotoBusy(id);
    try {
      const when = new Date();
      const pos = await getPosition(6000);
      const blob = await stampPhoto(f, stampLines({ woNumber: job.number, title: label, at: when, pos }));
      const r = await send.keep(blob, label, when.toISOString(), pos);
      if (typeof r === 'object') toastError(r.error);
      else setPhotos((p) => ({ ...p, [id]: true }));
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Couldn't use that photo.");
    }
    setPhotoBusy(null);
  };
  const missing = checkInMissing({
    needsDrive: false, drive, needsMileage: false, mileage: '', hasMileagePhoto: false, asks: items, answers, photos,
  });

  const title = step === 'drive' ? (travel ? 'Check in: where are you driving?' : 'Check in on site') : step === 'mileage' ? 'Starting mileage' : 'Before you go';
  const counter = steps.length > 1 ? <div className="wf-subtle" style={{ fontSize: 12, marginBottom: 8 }}>Step {at + 1} of {steps.length}</div> : null;

  return (
    <Dialog
      title={title}
      // Once the drive is recorded, closing only skips the rest.
      onClose={onClose}
      footer={step === 'drive' ? <>
        <button className="wf-btn wf-btn-ghost" onClick={onClose}>Cancel</button>
        {travel
          ? <button className="wf-btn wf-btn-navy" disabled={busy || !drive} onClick={() => void startDrive()}>{busy ? 'One moment…' : 'Start the drive'}</button>
          : <button className="wf-btn wf-btn-navy" disabled={busy} onClick={() => void arrive()}><MapPin size={16} /> {busy ? 'One moment…' : "I'm on site"}</button>}
      </> : step === 'mileage' ? <>
        <button className="wf-btn wf-btn-ghost" onClick={next}>Skip</button>
        <button className="wf-btn wf-btn-navy" disabled={busy || m.busy || !m.ok} onClick={() => void mileage()}>{busy ? 'Sending…' : 'Next'}</button>
      </> : <>
        <button className="wf-btn wf-btn-ghost" onClick={finish}>Skip</button>
        <button className="wf-btn wf-btn-navy" disabled={missing.length > 0 || !!photoBusy} onClick={finish}><CheckCircle2 size={16} /> Done</button>
      </>}
    >
      {counter}
      {step === 'drive' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {travel && (
            <label style={{ display: 'block' }}>
              <span className="wf-label" style={{ display: 'block', marginBottom: 4, fontWeight: 600, color: 'var(--wf-text)', fontSize: 13 }}>From → to</span>
              <select className="wf-input" value={driveKey} onChange={(e) => setDriveKey(e.target.value)} aria-label="Where are you driving?">
                <option value="" disabled>Pick your drive</option>
                {drivesFor(from, afterWork).map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
              </select>
            </label>
          )}
          <p className="wf-subtle" style={{ margin: 0, fontSize: 13 }}>
            {startOfDay ? 'This checks you in for the day. ' : ''}The time and your location are saved when you tap {travel ? 'Start the drive' : "I'm on site"}.
          </p>
        </div>
      )}
      {step === 'mileage' && (
        <>
          <p className="wf-subtle" style={{ margin: '0 0 12px', fontSize: 13.5 }}>
            Take a photo of the odometer before you drive off. The time and GPS go on the photo, and the miles go on the weekly bill.
          </p>
          <MileagePhoto m={m} moment="start" />
        </>
      )}
      {step === 'asks' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {items.map((a) => (
            <div key={a.id}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>{a.label}</div>
              {a.kind === 'photo' ? (
                <label className={`wf-btn ${photos[a.id] ? 'wf-btn-outline' : 'wf-btn-navy'} wf-btn-sm`} style={{ opacity: photoBusy === a.id ? 0.6 : 1 }}>
                  {photos[a.id] ? <CheckCircle2 size={15} /> : <Camera size={15} />}
                  {photoBusy === a.id ? 'Saving…' : photos[a.id] ? 'Taken · retake' : 'Take photo'}
                  <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} disabled={!!photoBusy}
                    onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void askPhoto(a.id, a.label, f); }} />
                </label>
              ) : (
                <input className="wf-input" aria-label={a.label} value={answers[a.id] ?? ''} maxLength={300}
                  onChange={(e) => setAnswers((x) => ({ ...x, [a.id]: e.target.value }))} />
              )}
            </div>
          ))}
          {missing.length > 0 && <div className="wf-subtle" style={{ fontSize: 12.5 }}>Still to do: {missing.join(' · ')}</div>}
        </div>
      )}
    </Dialog>
  );
}
