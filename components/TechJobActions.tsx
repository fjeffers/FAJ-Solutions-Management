'use client';
import { useState } from 'react';
import { LogIn, LogOut, CheckCircle2, Save, Loader2, Undo2 } from 'lucide-react';
import { techClock, setTechJobStatus, saveTechCloseout } from '@/lib/tech-portal';
import { toastError, toastSuccess } from '@/lib/toast';
import type { TechJob } from '@/lib/types';

/**
 * Working the job, from the tech's own login.
 *
 * A tech can start the clock, stop it, write what they did, and say the work is
 * done. What they cannot do is approve or pay their own job — that stays the
 * owner's, and the database refuses it rather than the button merely hiding.
 *
 * Once a job is Approved or Paid it is closed and these controls disappear, so
 * a finished job cannot be edited after the fact.
 *
 * Saying "work done" hands the job back to the office. From that moment the
 * working controls go away and the card drops into History — a tech should not
 * have to keep looking at a job they have finished. The one thing left is a way
 * to undo a mistap, which is allowed only while the office has not closed it.
 */
export default function TechJobActions({
  job, onChanged,
}: {
  job: TechJob;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState(job.closeout_notes ?? '');
  const [notesOpen, setNotesOpen] = useState(false);

  // Closed work is read-only. Nothing to offer.
  if (job.is_closed) return null;

  const wo = job.wo_number ?? '';
  const onSite = !!job.checked_in_at && !job.checked_out_at;
  const workDone = job.wo_status === 'Work Done';

  const run = async (key: string, fn: () => Promise<{ ok: boolean; reason: string }>, good: string) => {
    setBusy(key);
    const { ok, reason } = await fn();
    setBusy(null);
    if (ok) { toastSuccess(good); onChanged(); }
    else if (reason === 'closed_or_not_yours') toastError('That job is closed or no longer yours.');
    else if (reason === 'not_allowed') toastError('Only the office can approve a job.');
    else toastError("That didn't go through.");
  };

  const saveNotes = async () => {
    setBusy('notes');
    try {
      if (await saveTechCloseout(wo, notes)) {
        toastSuccess('Notes saved');
        setNotesOpen(false);
        onChanged();
      } else toastError("Couldn't save those notes.");
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Couldn't save those notes");
    }
    setBusy(null);
  };

  // Handed back to the office. Read-only, minus one way out of a mistap.
  if (workDone) {
    return (
      <div style={{ marginTop: 11, paddingTop: 11, borderTop: '1px solid #eee' }}>
        <div style={{
          padding: '10px 12px', borderRadius: 10, fontSize: 12.5,
          background: 'rgba(16,185,129,0.08)', color: '#047857', fontWeight: 600,
          display: 'flex', alignItems: 'center', gap: 7,
        }}>
          <CheckCircle2 size={15} /> Work done — with Fred to approve and pay
        </div>
        <button
          className="btn btn-ghost" disabled={busy !== null}
          onClick={() => {
            if (!confirm(`Reopen WO ${wo}? It goes back into your active work.`)) return;
            run('reopen', () => setTechJobStatus(wo, 'In Progress'), 'Back in your active work');
          }}
          style={{ width: '100%', marginTop: 7, justifyContent: 'center', padding: '9px 0', fontSize: 12.5 }}
        >
          {busy === 'reopen' ? <Loader2 size={15} /> : <Undo2 size={14} />} Not done yet — reopen
        </button>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 11, paddingTop: 11, borderTop: '1px solid #eee' }}>
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
        {!onSite ? (
          <button
            className="btn btn-primary" disabled={busy !== null}
            onClick={() => run('in', () => techClock(wo, 'in'), 'Clocked in — job is In Progress')}
            style={{ flex: '1 1 130px', justifyContent: 'center', padding: '11px 0' }}
          >
            {busy === 'in' ? <Loader2 size={15} /> : <LogIn size={15} />} Start
          </button>
        ) : (
          <button
            className="btn btn-ghost" disabled={busy !== null}
            onClick={() => run('out', () => techClock(wo, 'out'), 'Clocked out')}
            style={{
              flex: '1 1 130px', justifyContent: 'center', padding: '11px 0',
              border: '1px solid rgba(245,158,11,0.4)', color: '#b45309',
            }}
          >
            {busy === 'out' ? <Loader2 size={15} /> : <LogOut size={15} />} Stop
          </button>
        )}

        <button
          className="btn btn-ghost" disabled={busy !== null}
          onClick={() => setNotesOpen((v) => !v)}
          style={{ flex: '1 1 130px', justifyContent: 'center', padding: '11px 0' }}
        >
          <Save size={15} /> {job.closeout_notes ? 'Edit notes' : 'Add notes'}
        </button>
      </div>

      {notesOpen && (
        <div style={{ marginTop: 9 }}>
          <textarea
            className="input" rows={3} value={notes} autoFocus
            placeholder="What did you do on this job?"
            onChange={(e) => setNotes(e.target.value)}
          />
          <div style={{ display: 'flex', gap: 7, marginTop: 7, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={() => { setNotes(job.closeout_notes ?? ''); setNotesOpen(false); }}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={saveNotes} disabled={busy === 'notes'}>
              {busy === 'notes' ? 'Saving…' : 'Save notes'}
            </button>
          </div>
        </div>
      )}

      <button
        disabled={busy !== null}
        onClick={() => {
          if (!confirm(`Mark WO ${wo} as work done? It moves to your history and Fred takes it from there.`)) return;
          run('done', () => setTechJobStatus(wo, 'Work Done'), 'Sent to Fred — it is in your history now');
        }}
        style={{
          width: '100%', marginTop: 9, padding: '11px 0', borderRadius: 10, cursor: 'pointer',
          border: '1px solid rgba(16,185,129,0.4)', background: 'rgba(16,185,129,0.08)',
          color: '#047857', fontSize: 13.5, fontWeight: 700,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7,
        }}
      >
        {busy === 'done' ? <Loader2 size={15} /> : <CheckCircle2 size={15} />} Work done
      </button>
    </div>
  );
}
