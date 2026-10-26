'use client';
// A tech's pictures on one day of a job, and adding more from the office
// (Fred, 2026-10-24: "i need to add pictures also to the days also the odometer
// pictures"). The odometer photos and the receipts from that day, small, each
// opening full size; + Odometer start and + Odometer end add one
// (app/api/jobs/day-photo). An odometer picture takes its reading, and the
// reading fills the day's odometer box so the miles work out. No site photos
// here (Fred, 2026-10-25: "time log should only have the receipt and odometer
// reading"); they stay with the job's photos.
//
// When the app was down and the mileage is done by hand from the techs' photos
// (Fred, 2026-10-26), the AI reads the miles off the picture
// (app/api/jobs/read-photo) and the time comes from the photo itself
// (lib/photo-time.ts); both fill the boxes, and the office checks them before Add.
import { useRef, useState } from 'react';
import { Gauge } from 'lucide-react';
import { stampPhoto, shrinkPhoto } from '@/lib/photo-stamp';
import { photoTakenAt } from '@/lib/photo-time';
import { clockOf } from '@/lib/clock-fix';
import { todayISO } from '@/lib/utils';
import { toastError, toastSuccess } from '@/lib/toast';

export type DayPic = { src: string; caption: string };
type Kind = 'odo_start' | 'odo_end';
const LABEL: Record<Kind, string> = { odo_start: 'Odometer start', odo_end: 'Odometer end' };
const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const TZ = 'America/New_York';
const fmtTime = (hhmm: string) => new Date(`2000-01-01T${hhmm}:00Z`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });

/** What the AI read off an odometer picture; null when it couldn't, or isn't set up. */
async function readOdometer(woId: string, f: File): Promise<number | null> {
  try {
    const body = new FormData();
    body.set('wo_id', woId);
    body.set('file', new File([await shrinkPhoto(f, 1600)], 'photo.jpg', { type: 'image/jpeg' }));
    const res = await fetch('/api/jobs/read-photo', { method: 'POST', body });
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: { reading?: number | null } | null };
    const n = res.ok && j.ok ? j.result?.reading : null;
    return typeof n === 'number' && Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export default function DayPictures({ pics, woId, woNumber, day, tech, onAdded }: {
  pics: DayPic[]; woId: string; woNumber: string; day: string; tech: string;
  /** After an odometer picture is stored, with its moment and reading. */
  onAdded: (odo: { moment: 'start' | 'end'; reading: number }) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<Kind>('odo_start');
  const [file, setFile] = useState<File | null>(null);
  const [reading, setReading] = useState('');
  const [time, setTime] = useState('');
  const [aiRead, setAiRead] = useState<number | null>(null);
  /** The day the photo says it was taken, when that isn't this day. */
  const [otherDay, setOtherDay] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const picked = useRef<File | null>(null);

  const pick = (k: Kind) => { setKind(k); setFile(null); setReading(''); setTime(''); setAiRead(null); setOtherDay(null); input.current?.click(); };
  const send = async (f: File, k: Kind, miles: number) => {
    setBusy(true);
    try {
      // Made small and stamped like a tech's, so it reads the same on the bill.
      const when = time ? `${fmtDay(day)}, ${fmtTime(time)}` : fmtDay(day);
      const jpeg = await stampPhoto(f, [`WO ${woNumber} · ${tech}`, `${when} · ${LABEL[k]} ${miles.toLocaleString('en-US')}`, 'Added by the office']);
      const body = new FormData();
      body.set('wo_id', woId); body.set('day', day); body.set('tech', tech); body.set('kind', k);
      body.set('reading', String(miles));
      if (aiRead != null) body.set('ai_reading', String(aiRead));
      if (/^\d{2}:\d{2}$/.test(time)) body.set('time', time);
      body.set('file', new File([jpeg], 'photo.jpg', { type: 'image/jpeg' }));
      const res = await fetch('/api/jobs/day-photo', { method: 'POST', body });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) { toastError(j.error ?? "Couldn't add the picture."); return; }
      toastSuccess(`${LABEL[k]} added to ${fmtDay(day)}.`);
      setFile(null); setReading(''); setTime(''); setAiRead(null); setOtherDay(null);
      onAdded({ moment: k === 'odo_start' ? 'start' : 'end', reading: miles });
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Couldn't add the picture.");
    } finally {
      setBusy(false);
    }
  };
  /** A picture picked: its own time fills the time box, and the AI reads the miles into the reading box. */
  const chosen = async (f: File | undefined) => {
    if (!f) return;
    setFile(f);
    picked.current = f;
    const taken = await photoTakenAt(f, TZ);
    if (picked.current !== f) return;
    if (taken.at) {
      setTime(clockOf(taken.at, TZ));
      const on = todayISO(new Date(taken.at));
      setOtherDay(on !== day ? on : null);
    }
    setScanning(true);
    const n = await readOdometer(woId, f);
    if (picked.current !== f) return;
    setScanning(false);
    setAiRead(n);
    if (n != null) setReading((r) => r || String(n));
  };
  const addOdo = () => {
    const miles = Number(reading.replace(/[,\s]/g, ''));
    if (!reading.trim() || !Number.isFinite(miles) || miles < 0) { toastError('Type the miles on the odometer.'); return; }
    if (file) void send(file, kind, miles);
  };

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="wf-label">Pictures</span>
        {pics.length === 0 && <span className="wf-subtle" style={{ fontSize: 12.5 }}>none yet</span>}
        {pics.map((p) => (
          <a key={p.src} href={p.src} target="_blank" rel="noopener noreferrer" title={p.caption}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.src} alt={p.caption} style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--wf-line)' }} />
          </a>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <input ref={input} type="file" accept="image/*" hidden aria-label={`Picture for ${tech} ${day}`}
          onChange={(e) => { void chosen(e.target.files?.[0]); e.target.value = ''; }} />
        <button type="button" className="wf-btn wf-btn-outline wf-btn-sm" disabled={busy} onClick={() => pick('odo_start')}><Gauge size={14} /> + Odometer start</button>
        <button type="button" className="wf-btn wf-btn-outline wf-btn-sm" disabled={busy} onClick={() => pick('odo_end')}><Gauge size={14} /> + Odometer end</button>
        {busy && <span className="wf-subtle" style={{ fontSize: 12.5 }}>Adding…</span>}
      </div>
      {file && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', background: '#F6F4EF', borderRadius: 8, padding: 8 }}>
          <label style={{ display: 'grid', gap: 3, fontSize: 12 }}><span className="wf-label">{LABEL[kind]}: miles on the odometer</span>
            <input className="wf-input" inputMode="decimal" value={reading} onChange={(e) => setReading(e.target.value)} placeholder={scanning ? 'Reading the photo…' : '142,130'}
              aria-label={`${LABEL[kind]} reading ${tech} ${day}`} autoFocus /></label>
          <label style={{ display: 'grid', gap: 3, fontSize: 12 }}><span className="wf-label">Time</span>
            <input type="time" className="wf-input" style={{ minHeight: 34, padding: '4px 8px' }} value={time} onChange={(e) => setTime(e.target.value)}
              aria-label={`${LABEL[kind]} time ${tech} ${day}`} /></label>
          <button type="button" className="wf-btn wf-btn-navy wf-btn-sm" disabled={busy} onClick={addOdo}>Add</button>
          <button type="button" className="wf-btn wf-btn-ghost wf-btn-sm" disabled={busy} onClick={() => { picked.current = null; setFile(null); setScanning(false); }}>Cancel</button>
          <div className="wf-subtle" style={{ flexBasis: '100%', fontSize: 12 }} aria-live="polite">
            {scanning ? 'Reading the miles off the photo…'
              : aiRead != null ? `Read from the photo${time ? ', with the time it was taken' : ''}. Check it matches before Add.`
                : time ? 'The time is from the photo. Type the miles shown.' : null}
            {otherDay && ` This photo was taken on ${fmtDay(otherDay)}, not ${fmtDay(day)}.`}
          </div>
        </div>
      )}
    </div>
  );
}
