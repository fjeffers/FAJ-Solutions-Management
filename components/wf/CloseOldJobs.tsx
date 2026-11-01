'use client';
// Old jobs (Fred, 2026-10-31: close every work order before October in one go instead of one
// by one ... "close or reschedule"). Tick the jobs, then close them or move them to a new date.
// Closed jobs leave the techs' lists and the board; they stay under Closed, Payments and the
// Ledger, and can be reopened.
import { useState } from 'react';
import { jobDay, jobsBefore } from '@/lib/job-sheet';
import type { EnrichedWorkOrder } from '@/lib/types';
import { Dialog } from './WfUi';

const firstOfMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; };
const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export default function CloseOldJobs({ workOrders, onClose, onCloseJobs, onMoveJobs }: {
  workOrders: EnrichedWorkOrder[];
  onClose: () => void;
  onCloseJobs: (jobs: EnrichedWorkOrder[]) => Promise<number>;
  /** Move these jobs to a new start date (a multi-day job keeps its length). */
  onMoveJobs?: (jobs: EnrichedWorkOrder[], day: string) => Promise<number>;
}) {
  const [cutoff, setCutoff] = useState(firstOfMonth);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [moveTo, setMoveTo] = useState('');
  const [busy, setBusy] = useState(false);
  const jobs = cutoff ? jobsBefore(workOrders, cutoff).sort((a, b) => jobDay(a).localeCompare(jobDay(b))) : [];
  const picked = jobs.filter((w) => !skip.has(w.id));
  const n = picked.length;
  const s = n === 1 ? '' : 's';
  const run = async (fn: () => Promise<number>) => { setBusy(true); await fn(); setBusy(false); onClose(); };
  return (
    <Dialog title="Old jobs" onClose={onClose}
      footer={<>
        <button type="button" className="wf-btn wf-btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        {onMoveJobs && (
          <button type="button" className="wf-btn wf-btn-outline" disabled={busy || n === 0 || !moveTo}
            onClick={() => void run(() => onMoveJobs(picked, moveTo))}>
            {moveTo ? `Move ${n} to ${day(moveTo)}` : 'Pick a new date to move'}
          </button>
        )}
        <button type="button" className="wf-btn wf-btn-gold" disabled={busy || n === 0}
          onClick={() => void run(() => onCloseJobs(picked))}>
          {busy ? 'Working…' : `Close ${n} job${s}`}
        </button>
      </>}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, flexWrap: 'wrap' }}>
        Open jobs dated before
        <input type="date" className="wf-sheet-input" value={cutoff} onChange={(e) => { setCutoff(e.target.value); setSkip(new Set()); }} aria-label="Jobs before" />
      </label>
      {onMoveJobs && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, marginTop: 8, flexWrap: 'wrap' }}>
          Move to
          <input type="date" className="wf-sheet-input" value={moveTo} onChange={(e) => setMoveTo(e.target.value)} aria-label="Move to date" />
        </label>
      )}
      <p className="wf-subtle" style={{ fontSize: 13, margin: '10px 0' }}>
        Untick any you want to leave alone. <b>Close</b>: they leave the techs&apos; lists and the board, and stay under Closed, Payments and the Ledger
        (fully paid closes as Paid, any other as Approved). <b>Move</b>: they get the new date and stay open.
      </p>
      {jobs.length === 0 ? <div className="wf-subtle" style={{ fontSize: 13.5 }}>No open jobs before {cutoff ? day(cutoff) : 'that day'}.</div> : (
        <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid var(--wf-line)', borderRadius: 10 }}>
          <label style={{ display: 'flex', gap: 10, padding: '6px 10px', fontSize: 13, borderBottom: '1px solid var(--wf-line)', background: '#FAF9F5' }}>
            <input type="checkbox" checked={skip.size === 0} onChange={() => setSkip(skip.size === 0 ? new Set(jobs.map((w) => w.id)) : new Set())} />
            <b>{n} of {jobs.length} ticked</b>
          </label>
          {jobs.map((w) => (
            <label key={w.id} style={{ display: 'flex', gap: 10, padding: '6px 10px', fontSize: 13.5, borderBottom: '1px solid var(--wf-line)', alignItems: 'center' }}>
              <input type="checkbox" checked={!skip.has(w.id)}
                onChange={() => setSkip((cur) => { const x = new Set(cur); if (x.has(w.id)) x.delete(w.id); else x.add(w.id); return x; })} />
              <b style={{ minWidth: 64 }}>{w.wo_number}</b>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.title || 'Untitled job'}</span>
              <span className="wf-subtle" style={{ whiteSpace: 'nowrap' }}>{day(jobDay(w))}</span>
            </label>
          ))}
        </div>
      )}
    </Dialog>
  );
}
