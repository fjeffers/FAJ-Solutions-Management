'use client';
// Closeout — the end of a job, from the Primio WorkFlow app (Fred, 2026-10-04:
// "can workflow update to what you see", "everything"). Three parts in one card:
//   Deliverables   the list for the job type (kiosk / survey / everything
//                  else), ticked off as the tech finishes each one
//   Delays         time lost on site and why
//   Approval       the customer's printed name and finger signature
// The tech fills it in; the office sees the same card, read only. No money.
import { useState } from 'react';
import { Ban, CheckCircle2, Circle, Clock, PenLine, Plus, Trash2 } from 'lucide-react';
import {
  closeoutMissing, delayFromTimes, delayMs, doneCount, skipReason, totalDelayMs, type CloseoutOp,
} from '@/lib/closeout';
import { formatDuration, type WfJob } from '@/lib/wf';
import { Dialog, Section } from './WfUi';
import SignaturePad from './SignaturePad';

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const dayTime = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

function SubHead({ title, note }: { title: string; note: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
      <div style={{ fontWeight: 700, flex: 1 }}>{title}</div>
      <div className="wf-subtle" style={{ fontSize: 12 }}>{note}</div>
    </div>
  );
}

const rule = { border: 'none', borderTop: '1px solid var(--wf-line)', margin: '14px 0' } as const;

export default function CloseoutCard({ job, items, listName, canEdit, ownerView = false, onOp, onSign }: {
  job: WfJob;
  /** The job's checklist (listFor: the office's lists, by keyword). */
  items: string[];
  /** Which checklist it is ("Kiosk install", "Standard job"…). */
  listName?: string;
  canEdit: boolean;
  ownerView?: boolean;
  onOp?: (op: CloseoutOp) => void;
  /** Sends the signature picture with the job's photos, then records the name. */
  onSign?: (name: string, signature: Blob) => Promise<void>;
}) {
  const c = job.closeout;
  const [delayOpen, setDelayOpen] = useState(false);
  const [signOpen, setSignOpen] = useState(false);
  /** "Can't do it" for this deliverable, or '__sign__' for the signature. */
  const [why, setWhy] = useState<string | null>(null);
  const done = doneCount(c, items);
  const cant = items.filter((i) => skipReason(c, i)).length;
  const lost = totalDelayMs(c);
  const missing = closeoutMissing(c, items, job.signatureRequired);
  const edit = canEdit && !!onOp;

  return (
    <Section
      title="Closeout"
      subtitle={`${done} of ${items.length} deliverables${cant ? ` · ${cant} can't be done` : ''} · ${c.signoff ? 'signed off' : c.signSkip ? 'no signature (reason given)' : job.signatureRequired ? 'sign-off needed' : 'not signed'}`}
      right={missing.length === 0 ? <CheckCircle2 size={20} color="var(--wf-success)" aria-label="Closeout complete" /> : undefined}
    >
      {/* Deliverables */}
      <SubHead title={listName ? `Deliverables · ${listName}` : 'Deliverables'} note={`${done} of ${items.length}`} />
      <div className="wf-subtle" style={{ fontSize: 12.5, marginBottom: 6 }}>
        {ownerView
          ? (edit ? 'The tech ticks these off in the portal — or tick them here yourself.' : 'What the tech ticked off for this job.')
          : "Take each photo under Photos, then tick it off here. Can't do one? Tap Can't do it and say why."}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, margin: '0 -6px' }}>
        {items.map((item) => {
          const on = c.done.includes(item);
          const reason = skipReason(c, item);
          return (
            <div key={item} style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
              <button
                onClick={edit ? () => onOp!({ op: 'tick', item, done: !on }) : undefined}
                disabled={!edit}
                aria-pressed={on}
                style={{
                  flex: 1, display: 'flex', alignItems: 'flex-start', gap: 10, padding: '7px 6px', borderRadius: 8, border: 'none',
                  background: 'transparent', font: 'inherit', textAlign: 'left', cursor: edit ? 'pointer' : 'default', color: 'inherit',
                }}
              >
                {on ? <CheckCircle2 size={21} color="var(--wf-success)" style={{ flexShrink: 0 }} />
                  : reason ? <Ban size={21} color="var(--wf-warning)" style={{ flexShrink: 0 }} />
                    : <Circle size={21} color="var(--wf-subtle)" style={{ flexShrink: 0 }} />}
                <span style={{ flex: 1, paddingTop: 1, color: on ? 'var(--wf-subtle)' : undefined }}>
                  {item}
                  {reason && <span style={{ display: 'block', fontSize: 12.5, color: 'var(--wf-warning)', fontWeight: 600 }}>Can&apos;t be done: {reason}</span>}
                </span>
              </button>
              {edit && !ownerView && !on && (
                reason
                  ? <button className="wf-btn wf-btn-ghost wf-btn-sm" style={{ flexShrink: 0 }} onClick={() => onOp!({ op: 'skip', item, reason: '' })}>Undo</button>
                  : <button className="wf-btn wf-btn-ghost wf-btn-sm" style={{ flexShrink: 0, fontSize: 12.5 }} onClick={() => setWhy(item)}>Can&apos;t do it</button>
              )}
            </div>
          );
        })}
      </div>

      <hr style={rule} />

      {/* Delays */}
      <SubHead title="Delays" note={c.delays.length ? `${formatDuration(lost)} lost in all` : 'None logged'} />
      {c.delays.length === 0 && !edit && <div className="wf-subtle" style={{ fontSize: 12.5 }}>No delays logged.</div>}
      {c.delays.map((d) => (
        <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
          <Clock size={16} color="var(--wf-warning)" style={{ flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{d.reason || 'Delay'}</div>
            <div className="wf-subtle" style={{ fontSize: 12.5 }}>
              {new Date(d.start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · {timeOf(d.start)} – {timeOf(d.end)} · {formatDuration(delayMs(d))}
            </div>
          </div>
          {edit && (
            <button className="wf-btn wf-btn-ghost wf-btn-sm" aria-label={`Remove delay: ${d.reason || 'delay'}`}
              onClick={() => { if (confirm('Remove this delay?')) onOp!({ op: 'remove_delay', id: d.id }); }}>
              <Trash2 size={15} />
            </button>
          )}
        </div>
      ))}
      {edit && (
        <button className="wf-btn wf-btn-outline wf-btn-sm" style={{ marginTop: 6 }} onClick={() => setDelayOpen(true)}>
          <Plus size={15} /> Add delay
        </button>
      )}

      <hr style={rule} />

      {/* Approval of work */}
      <SubHead title="Approval of work" note={c.signoff ? 'Signed' : 'Not signed'} />
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 12px', fontSize: 13.5 }}>
        <span className="wf-subtle">Arrival</span><span>{job.checkedInAt ? dayTime(job.checkedInAt) : '—'}</span>
        <span className="wf-subtle">Departure</span><span>{job.checkedOutAt ? dayTime(job.checkedOutAt) : '—'}</span>
        {c.signoff && <>
          <span className="wf-subtle">Signed by</span><span style={{ fontWeight: 600 }}>{c.signoff.name}</span>
          <span className="wf-subtle">Date</span><span>{c.signoff.signedAt ? dayTime(c.signoff.signedAt) : '—'}</span>
        </>}
      </div>
      {c.signoff && ownerView && <div className="wf-subtle" style={{ fontSize: 12, marginTop: 6 }}>The signature picture is with the job&apos;s photos.</div>}
      {!c.signoff && c.signSkip && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
          <Ban size={16} color="var(--wf-warning)" />
          <span style={{ flex: 1, fontSize: 13, color: 'var(--wf-warning)', fontWeight: 600 }}>No signature: {c.signSkip.reason}</span>
          {edit && !ownerView && <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={() => onOp!({ op: 'skip_sign', reason: '', at: new Date().toISOString() })}>Undo</button>}
        </div>
      )}
      {!c.signoff && !c.signSkip && ownerView && job.signatureRequired && (
        <div style={{ fontSize: 12.5, marginTop: 6, color: 'var(--wf-warning)', fontWeight: 600 }}>Customer signature required — not signed yet.</div>
      )}
      {edit && onSign && !c.signoff && !c.signSkip && (
        <>
          <div className="wf-subtle" style={{ fontSize: 12.5, margin: '8px 0' }}>
            Hand the phone to the on-site contact to sign once the work is done{job.signatureRequired ? ' — this job needs it' : ''}.
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="wf-btn wf-btn-navy wf-btn-sm" onClick={() => setSignOpen(true)}><PenLine size={15} /> Get customer signature</button>
            {!ownerView && <button className="wf-btn wf-btn-outline wf-btn-sm" onClick={() => setWhy('__sign__')}>Can&apos;t get a signature</button>}
          </div>
        </>
      )}
      {edit && c.signoff && (
        <div style={{ marginTop: 8 }}>
          <button className="wf-btn wf-btn-ghost wf-btn-sm"
            onClick={() => { if (confirm('Clear the sign-off so the customer can sign again?')) onOp!({ op: 'clear_sign' }); }}>
            Clear and sign again
          </button>
        </div>
      )}

      {why && (
        <ReasonDialog
          key={why}
          title={why === '__sign__' ? "Why can't you get a signature?" : "Why can't this be done?"}
          what={why === '__sign__' ? 'Customer signature' : why}
          ideas={why === '__sign__'
            ? ['Contact not on site', 'Contact refused to sign', 'Site closed when we finished']
            : ['No access to that area', 'Not part of this site', 'Equipment not delivered']}
          onClose={() => setWhy(null)}
          onSave={(reason) => {
            onOp?.(why === '__sign__' ? { op: 'skip_sign', reason, at: new Date().toISOString() } : { op: 'skip', item: why, reason });
            setWhy(null);
          }}
        />
      )}
      {delayOpen && <DelayDialog onClose={() => setDelayOpen(false)} onAdd={(op) => { setDelayOpen(false); onOp?.(op); }} />}
      {signOpen && onSign && (
        <SignOffDialog contact={job.pocName} onClose={() => setSignOpen(false)}
          onSign={async (name, blob) => { await onSign(name, blob); setSignOpen(false); }} />
      )}
    </Section>
  );
}

function ReasonDialog({ title, what, ideas, onClose, onSave }: {
  title: string; what: string; ideas: string[]; onClose: () => void; onSave: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <Dialog title={title} onClose={onClose}
      footer={<>
        <button className="wf-btn wf-btn-ghost" onClick={onClose}>Cancel</button>
        <button className="wf-btn wf-btn-navy" disabled={!reason.trim()} onClick={() => onSave(reason.trim())}>Save reason</button>
      </>}>
      <div className="wf-subtle" style={{ fontSize: 13, marginBottom: 8 }}>{what}</div>
      <input className="wf-input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} autoFocus
        placeholder="Say why. The office and the client see this." aria-label="Reason" />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
        {ideas.map((i) => (
          <button key={i} className="wf-chip" onClick={() => setReason(i)}
            style={{ border: '1px solid var(--wf-line)', background: 'var(--wf-card)', cursor: 'pointer', font: 'inherit', fontSize: 12.5 }}>{i}</button>
        ))}
      </div>
    </Dialog>
  );
}

const nowHHMM = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

function DelayDialog({ onClose, onAdd }: { onClose: () => void; onAdd: (op: CloseoutOp) => void }) {
  const [reason, setReason] = useState('');
  const [start, setStart] = useState(nowHHMM);
  const [end, setEnd] = useState(nowHHMM);
  const delay = delayFromTimes(`${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, reason, new Date(), start, end);
  const ok = !!reason.trim() && !!delay && delayMs(delay) > 0;
  return (
    <Dialog title="Log a delay" onClose={onClose}
      footer={<>
        <button className="wf-btn wf-btn-ghost" onClick={onClose}>Cancel</button>
        <button className="wf-btn wf-btn-navy" disabled={!ok} onClick={() => delay && onAdd({ op: 'add_delay', delay })}>Add</button>
      </>}>
      <label className="wf-label" htmlFor="delay-reason" style={{ display: 'block', marginBottom: 4 }}>Reason for the delay</label>
      <input id="delay-reason" className="wf-input" value={reason} onChange={(e) => setReason(e.target.value)}
        placeholder="Waiting on the manager to open the IDF" maxLength={300} autoFocus />
      <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
        <div style={{ flex: 1 }}>
          <label className="wf-label" htmlFor="delay-start" style={{ display: 'block', marginBottom: 4 }}>Start</label>
          <input id="delay-start" className="wf-input" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div style={{ flex: 1 }}>
          <label className="wf-label" htmlFor="delay-end" style={{ display: 'block', marginBottom: 4 }}>End</label>
          <input id="delay-end" className="wf-input" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
      </div>
      <div className="wf-subtle" style={{ fontSize: 12.5, marginTop: 8 }}>
        {delay && delayMs(delay) > 0 ? `${formatDuration(delayMs(delay))} today.` : 'Set when the delay started and ended.'}
      </div>
    </Dialog>
  );
}

function SignOffDialog({ contact, onClose, onSign }: {
  contact: string; onClose: () => void; onSign: (name: string, blob: Blob) => Promise<void>;
}) {
  const [name, setName] = useState(contact);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title="Customer sign-off" onClose={onClose}
      footer={<>
        <button className="wf-btn wf-btn-ghost" onClick={onClose}>Cancel</button>
        <button className="wf-btn wf-btn-navy" disabled={!name.trim() || !blob || busy}
          onClick={async () => { if (!blob) return; setBusy(true); try { await onSign(name.trim(), blob); } finally { setBusy(false); } }}>
          {busy ? 'Saving…' : 'Save sign-off'}
        </button>
      </>}>
      <p style={{ marginTop: 0 }}>By signing, the customer approves the work done today.</p>
      <label className="wf-label" htmlFor="signoff-name" style={{ display: 'block', marginBottom: 4 }}>Printed name</label>
      <input id="signoff-name" className="wf-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="off" />
      <div style={{ fontWeight: 600, margin: '12px 0 6px' }}>Signature</div>
      {blob ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <CheckCircle2 size={18} color="var(--wf-success)" /> Signed
          <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={() => setBlob(null)}>Sign again</button>
        </div>
      ) : (
        <SignaturePad existing={null} onSigned={setBlob} />
      )}
    </Dialog>
  );
}
