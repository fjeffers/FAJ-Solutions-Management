'use client';
// Adding pictures to a job from the office (Fred, 2026-10-26: "still unable to
// download photo or add them"): pick one or more from the device, say which day
// and whose they are, and each is stamped like a tech's and saved with the
// job's photos (app/api/jobs/day-photo, a site photo). On the job's Photos and
// in the job log.
import { useRef, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { stampPhoto } from '@/lib/photo-stamp';
import { toastError, toastSuccess } from '@/lib/toast';

const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

export default function AddJobPhotos({ woId, woNumber, techs, day: firstDay, onAdded }: {
  woId: string; woNumber: string;
  /** Whose the pictures can be: the job's techs; the office is always there too. */
  techs: string[];
  /** The day picked to start with (lib/job-photos.ts photoDay). */
  day: string;
  onAdded: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const crew = [...new Set(techs.filter(Boolean)), 'Office'];
  const [files, setFiles] = useState<File[]>([]);
  const [day, setDay] = useState(firstDay);
  const [tech, setTech] = useState(crew[0]);
  // The job's techs can change while this is open: one no longer on it isn't picked (Greptile on PR #23).
  const who = crew.includes(tech) ? tech : crew[0];
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) { toastError('Pick the day the pictures are from.'); return; }
    setBusy(true);
    let added = 0;
    try {
      for (const f of files) {
        const jpeg = await stampPhoto(f, [`WO ${woNumber} · ${who}`, fmtDay(day), 'Added by the office']);
        const body = new FormData();
        body.set('wo_id', woId); body.set('day', day); body.set('tech', who); body.set('kind', 'site');
        body.set('file', new File([jpeg], 'photo.jpg', { type: 'image/jpeg' }));
        const res = await fetch('/api/jobs/day-photo', { method: 'POST', body });
        const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!res.ok || !j.ok) { toastError(j.error ?? "Couldn't add the picture."); break; }
        added++;
      }
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Couldn't add the picture.");
    } finally {
      setBusy(false);
    }
    if (added) {
      toastSuccess(`${added} picture${added === 1 ? '' : 's'} added to ${fmtDay(day)}.`);
      // The ones not added stay picked, to try again.
      setFiles((fs) => fs.slice(added));
      onAdded();
    }
  };

  return (
    <div className="no-print" style={{ display: 'grid', gap: 8 }}>
      <input ref={input} type="file" accept="image/*" multiple hidden aria-label="Pictures to add to the job"
        onChange={(e) => { setFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
      <button type="button" className="wf-btn wf-btn-outline wf-btn-sm" disabled={busy} onClick={() => input.current?.click()}>
        <ImagePlus size={15} /> Add photos
      </button>
      {files.length > 0 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', background: '#F6F4EF', borderRadius: 8, padding: 8 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, alignSelf: 'center' }}>{files.length} picture{files.length === 1 ? '' : 's'}</span>
          <label style={{ display: 'grid', gap: 3, fontSize: 12 }}><span className="wf-label">Day</span>
            <input type="date" className="wf-input" style={{ minHeight: 34, padding: '4px 8px' }} value={day} onChange={(e) => setDay(e.target.value)} aria-label="Day the pictures are from" /></label>
          <label style={{ display: 'grid', gap: 3, fontSize: 12 }}><span className="wf-label">Whose</span>
            <select className="wf-input" style={{ minHeight: 34, padding: '4px 8px' }} value={who} onChange={(e) => setTech(e.target.value)} aria-label="Whose pictures">
              {crew.map((t) => <option key={t} value={t}>{t}</option>)}
            </select></label>
          <button type="button" className="wf-btn wf-btn-navy wf-btn-sm" disabled={busy} onClick={() => void add()}>{busy ? 'Adding…' : 'Add to the job'}</button>
          <button type="button" className="wf-btn wf-btn-ghost wf-btn-sm" disabled={busy} onClick={() => setFiles([])}>Cancel</button>
        </div>
      )}
    </div>
  );
}
