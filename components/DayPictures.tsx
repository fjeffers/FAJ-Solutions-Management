'use client';
// A tech's pictures on one day of a job, and adding more from the office
// (Fred, 2026-10-24: "i need to add pictures also to the days also the odometer
// pictures"). The odometer photos and the receipts from that day, small, each
// opening full size; + Odometer start and + Odometer end add one
// (app/api/jobs/day-photo). An odometer picture takes its reading, and the
// reading fills the day's odometer box so the miles work out. No site photos
// here (Fred, 2026-10-25: "time log should only have the receipt and odometer
// reading"); they stay with the job's photos.
import { useRef, useState } from 'react';
import { Gauge } from 'lucide-react';
import { stampPhoto } from '@/lib/photo-stamp';
import { toastError, toastSuccess } from '@/lib/toast';

export type DayPic = { src: string; caption: string };
type Kind = 'odo_start' | 'odo_end';
const LABEL: Record<Kind, string> = { odo_start: 'Odometer start', odo_end: 'Odometer end' };
const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

export default function DayPictures({ pics, woId, woNumber, day, tech, onAdded }: {
  pics: DayPic[]; woId: string; woNumber: string; day: string; tech: string;
  /** After an odometer picture is stored, with its moment and reading. */
  onAdded: (odo: { moment: 'start' | 'end'; reading: number }) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<Kind>('odo_start');
  const [file, setFile] = useState<File | null>(null);
  const [reading, setReading] = useState('');
  const [busy, setBusy] = useState(false);

  const pick = (k: Kind) => { setKind(k); setFile(null); setReading(''); input.current?.click(); };
  const send = async (f: File, k: Kind, miles: number) => {
    setBusy(true);
    try {
      // Made small and stamped like a tech's, so it reads the same on the bill.
      const jpeg = await stampPhoto(f, [`WO ${woNumber} · ${tech}`, `${fmtDay(day)} · ${LABEL[k]} ${miles.toLocaleString('en-US')}`, 'Added by the office']);
      const body = new FormData();
      body.set('wo_id', woId); body.set('day', day); body.set('tech', tech); body.set('kind', k);
      body.set('reading', String(miles));
      body.set('file', new File([jpeg], 'photo.jpg', { type: 'image/jpeg' }));
      const res = await fetch('/api/jobs/day-photo', { method: 'POST', body });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) { toastError(j.error ?? "Couldn't add the picture."); return; }
      toastSuccess(`${LABEL[k]} added to ${fmtDay(day)}.`);
      setFile(null); setReading('');
      onAdded({ moment: k === 'odo_start' ? 'start' : 'end', reading: miles });
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Couldn't add the picture.");
    } finally {
      setBusy(false);
    }
  };
  const chosen = (f: File | undefined) => { if (f) setFile(f); };
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
          onChange={(e) => { chosen(e.target.files?.[0]); e.target.value = ''; }} />
        <button type="button" className="wf-btn wf-btn-outline wf-btn-sm" disabled={busy} onClick={() => pick('odo_start')}><Gauge size={14} /> + Odometer start</button>
        <button type="button" className="wf-btn wf-btn-outline wf-btn-sm" disabled={busy} onClick={() => pick('odo_end')}><Gauge size={14} /> + Odometer end</button>
        {busy && <span className="wf-subtle" style={{ fontSize: 12.5 }}>Adding…</span>}
      </div>
      {file && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', background: '#F6F4EF', borderRadius: 8, padding: 8 }}>
          <label style={{ display: 'grid', gap: 3, fontSize: 12 }}><span className="wf-label">{LABEL[kind]}: miles on the odometer</span>
            <input className="wf-input" inputMode="decimal" value={reading} onChange={(e) => setReading(e.target.value)} placeholder="142,130"
              aria-label={`${LABEL[kind]} reading ${tech} ${day}`} autoFocus /></label>
          <button type="button" className="wf-btn wf-btn-navy wf-btn-sm" disabled={busy} onClick={addOdo}>Add</button>
          <button type="button" className="wf-btn wf-btn-ghost wf-btn-sm" disabled={busy} onClick={() => setFile(null)}>Cancel</button>
        </div>
      )}
    </div>
  );
}
