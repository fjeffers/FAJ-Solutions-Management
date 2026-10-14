'use client';

// The tech's side of the live sheet's messages (migration 121). Fred,
// 2026-10-14: "we don't have access to the building: I open the app, select
// the PM and say no access. Then it should ask reasons (box code is not
// working). The PM sees it and gets the tech the info he needs" ... "until the
// PM gets back to him it shows time spent without access; he gets the code,
// the app asks 'do you have access?', he replies yes, the time on site carries
// on and the time without access goes to the PM's sheet" ... "the client asks
// a question for the tech to answer right away".
//
// Shown at the top of a project job: the "without access" clock, the PM's
// questions waiting for an answer, and "Can't get in?".
import { useCallback, useEffect, useState } from 'react';
import { DoorClosed, KeyRound, MessageCircleQuestion } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { fetchTechMessages } from '@/lib/tech-portal';
import { toastError, toastSuccess } from '@/lib/toast';
import type { TechMessage } from '@/lib/types';
import { Dialog } from './WfUi';

export const NO_ACCESS_REASONS = [
  'Lockbox or door code not working',
  'Nobody on site to let us in',
  'Gate or door locked',
  'Key is not where they said',
  'Wrong address or building',
];

export type SiteContact = { name: string; role: string };
type SendArgs = { body?: string; to?: string; kind?: 'message' | 'answer' | 'issue' | 'resolved'; reason?: string; parent?: string };
const POLL_MS = 10_000;

/** A message on the sheet, from the tech (needs signal). Null when sent, else what went wrong. */
export async function sendSiteMessage(number: string, a: SendArgs): Promise<string | null> {
  try {
    const { data, error } = await createClient().rpc('wf_tech_site_send', {
      p_wo_number: number, p_body: a.body ?? '', p_to: a.to ?? null, p_kind: a.kind ?? 'message',
      p_reason: a.reason ?? null, p_parent: a.parent ?? null,
    });
    if (error) return 'No signal — try again when you have it.';
    const r = data as { ok?: boolean; reason?: string } | null;
    if (r?.ok) return null;
    return r?.reason === 'reason_needed' ? 'Pick why first.' : r?.reason === 'empty' ? 'Type the message first.' : "Couldn't send that.";
  } catch {
    return 'No signal — try again when you have it.';
  }
}

/** The job's thread and who the tech can message, kept fresh while the job is open. */
export function useSiteTalk(number: string, enabled: boolean) {
  const [msgs, setMsgs] = useState<TechMessage[]>([]);
  const [contacts, setContacts] = useState<SiteContact[]>([]);
  const load = useCallback(async () => {
    try { setMsgs(await fetchTechMessages(number)); } catch { /* no signal: keep what's showing */ }
  }, [number]);
  useEffect(() => {
    if (!enabled) return;
    void load();
    void createClient().rpc('wf_tech_site_contacts', { p_wo_number: number })
      .then(({ data }) => setContacts(Array.isArray(data) ? (data as SiteContact[]) : []));
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, POLL_MS);
    const back = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', back);
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', back); };
  }, [enabled, load, number]);
  const send = async (a: SendArgs) => {
    const err = await sendSiteMessage(number, a);
    if (!err) await load();
    return err;
  };
  return { msgs, contacts, load, send };
}

const mins = (fromIso: string, to = Date.now()) => Math.max(0, Math.round((to - Date.parse(fromIso)) / 60000));
const isMine = (m: TechMessage) => m.mine ?? m.sender_role === 'contractor';
const ASKED_KEY = 'faj-access-asked';
function askedBefore(id: string): boolean {
  try { return (window.localStorage.getItem(ASKED_KEY) ?? '').split(',').includes(id); } catch { return false; }
}
function markAsked(id: string) {
  try {
    const list = (window.localStorage.getItem(ASKED_KEY) ?? '').split(',').filter(Boolean).slice(-40);
    window.localStorage.setItem(ASKED_KEY, [...list, id].join(','));
  } catch { /* fine: it may ask once more */ }
}

export function SiteAccessBar({ number, talk, working }: { number: string; talk: ReturnType<typeof useSiteTalk>; working: boolean }) {
  const { msgs, contacts, send } = talk;
  const [tick, setTick] = useState(() => Date.now());
  const [reporting, setReporting] = useState(false);
  const [answering, setAnswering] = useState<string | null>(null);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [prompted, setPrompted] = useState<string | null>(null);
  useEffect(() => {
    const t = window.setInterval(() => setTick(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const issue = [...msgs].reverse().find((m) => m.kind === 'issue' && isMine(m) && !m.resolved_at) ?? null;
  // Someone got back to them after they said they couldn't get in.
  const reply = issue ? [...msgs].reverse().find((m) => !isMine(m) && m.sender_role !== 'contractor' && m.created_at > issue.created_at
    && (m.parent_id === issue.id || (!m.parent_id && m.for_me !== false))) ?? null : null;
  useEffect(() => {
    if (reply && !askedBefore(reply.id)) setPrompted(reply.id);
  }, [reply]);
  const questions = msgs.filter((m) => m.kind === 'question' && !m.resolved_at && !isMine(m) && m.for_me !== false);

  const resolve = async () => {
    if (!issue) return;
    setBusy(true);
    const err = await send({ kind: 'resolved', parent: issue.id, body: 'Got access' });
    setBusy(false);
    if (err) { toastError(err); return; }
    if (prompted) markAsked(prompted);
    setPrompted(null);
    toastSuccess(`Logged: ${mins(issue.created_at)} min without access.`);
  };
  const notYet = async () => {
    if (!issue || !prompted) return;
    markAsked(prompted);
    setPrompted(null);
    const err = await send({ kind: 'message', parent: issue.id, to: issue.to_name ?? 'Everyone', body: 'Still no access.' });
    if (err) toastError(err);
  };
  const sendAnswer = async (q: TechMessage) => {
    if (!answer.trim()) return;
    setBusy(true);
    const err = await send({ kind: 'answer', parent: q.id, body: answer.trim() });
    setBusy(false);
    if (err) { toastError(err); return; }
    setAnswer(''); setAnswering(null);
    toastSuccess('Answer sent.');
  };

  if (!issue && questions.length === 0 && !working) return null;
  void tick;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
      {issue && (
        <div className="wf-card" style={{ padding: 12, borderColor: '#FDA29B', background: '#FEF3F2' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <DoorClosed size={18} color="#B42318" />
            <b style={{ flex: 1, color: '#B42318' }}>No access · {mins(issue.created_at)} min</b>
            <button className="wf-btn wf-btn-navy wf-btn-sm" disabled={busy} onClick={() => void resolve()}><KeyRound size={15} /> I&apos;m in</button>
          </div>
          <div className="wf-subtle" style={{ fontSize: 13, marginTop: 4 }}>
            {issue.reason}{issue.to_name ? ` · sent to ${issue.to_name}` : ''}. The clock runs until you tap I&apos;m in.
          </div>
          {reply && <div style={{ marginTop: 6, fontSize: 14 }}><b>{reply.sender_name}:</b> {reply.content}</div>}
        </div>
      )}

      {questions.map((q) => (
        <div key={q.id} className="wf-card" style={{ padding: 12, borderColor: '#FEC84B', background: '#FFFAEB' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <MessageCircleQuestion size={18} color="#B54708" />
            <b style={{ flex: 1 }}>{q.sender_name} asked</b>
          </div>
          <div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{q.content}</div>
          {answering === q.id ? (
            <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'flex-end' }}>
              <textarea className="wf-input" rows={2} autoFocus value={answer} onChange={(e) => setAnswer(e.target.value)} style={{ flex: 1, fontSize: 16 }}
                placeholder="Your answer (take the photo too if they asked for one)" />
              <button className="wf-btn wf-btn-navy wf-btn-sm" disabled={busy || !answer.trim()} onClick={() => void sendAnswer(q)}>Send</button>
            </div>
          ) : (
            <button className="wf-btn wf-btn-gold wf-btn-sm" style={{ marginTop: 8 }} onClick={() => { setAnswering(q.id); setAnswer(''); }}>Answer</button>
          )}
        </div>
      ))}

      {!issue && working && (
        <button className="wf-btn wf-btn-outline wf-btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setReporting(true)}>
          <DoorClosed size={15} /> Can&apos;t get in?
        </button>
      )}

      {reporting && (
        <NoAccessDialog contacts={contacts} onClose={() => setReporting(false)}
          onSend={async (to, reason, note) => {
            const err = await send({ kind: 'issue', to, reason, body: note ? `No access to the building. ${note}` : 'No access to the building' });
            if (err) { toastError(err); return; }
            setReporting(false);
            toastSuccess(`Sent${to && to !== 'Everyone' ? ` to ${to}` : ''}. The clock is running until you tap I'm in.`);
          }} />
      )}

      {issue && prompted && reply && (
        <Dialog title="Do you have access now?" onClose={() => { markAsked(prompted); setPrompted(null); }}
          footer={<>
            <button className="wf-btn wf-btn-ghost" onClick={() => void notYet()}>Not yet</button>
            <button className="wf-btn wf-btn-navy" disabled={busy} onClick={() => void resolve()}><KeyRound size={16} /> Yes, I&apos;m in</button>
          </>}>
          <p style={{ marginTop: 0 }}><b>{reply.sender_name}:</b> {reply.content}</p>
          <p className="wf-subtle" style={{ marginBottom: 0 }}>Without access so far: {mins(issue.created_at)} min (WO {number}).</p>
        </Dialog>
      )}
    </div>
  );
}

function NoAccessDialog({ contacts, onSend, onClose }: {
  contacts: SiteContact[]; onSend: (to: string, reason: string, note: string) => Promise<void>; onClose: () => void;
}) {
  const [to, setTo] = useState(contacts.find((c) => c.role === 'pm')?.name ?? 'Everyone');
  const [reason, setReason] = useState('');
  const [other, setOther] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (contacts.length > 0 && to === 'Everyone') setTo(contacts.find((c) => c.role === 'pm')?.name ?? 'Everyone'); }, [contacts]); // eslint-disable-line react-hooks/exhaustive-deps
  const why = reason === 'Other' ? other.trim() : reason;
  return (
    <Dialog title="No access to the building" onClose={onClose}
      footer={<>
        <button className="wf-btn wf-btn-ghost" onClick={onClose}>Cancel</button>
        <button className="wf-btn wf-btn-navy" disabled={busy || !why}
          onClick={async () => { setBusy(true); await onSend(to, why, note.trim()); setBusy(false); }}>Send now</button>
      </>}>
      <label className="wf-label" htmlFor="na-to">Send to</label>
      <select id="na-to" className="wf-input" style={{ fontSize: 16, marginBottom: 10 }} value={to} onChange={(e) => setTo(e.target.value)}>
        {contacts.map((c) => <option key={c.name} value={c.name}>{c.name}{c.role === 'pm' ? ' (project manager)' : ''}</option>)}
        <option value="Everyone">Everyone on the project sheet</option>
      </select>
      <div className="wf-label">Why?</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
        {[...NO_ACCESS_REASONS, 'Other'].map((r) => (
          <button key={r} type="button" className={`wf-btn ${reason === r ? 'wf-btn-navy' : 'wf-btn-outline'}`} style={{ justifyContent: 'flex-start' }} onClick={() => setReason(r)}>{r}</button>
        ))}
      </div>
      {reason === 'Other' && (
        <input className="wf-input" style={{ marginTop: 8, fontSize: 16 }} autoFocus value={other} maxLength={200} onChange={(e) => setOther(e.target.value)} placeholder="What's stopping you?" />
      )}
      <textarea className="wf-input" rows={2} style={{ marginTop: 10, fontSize: 16 }} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)}
        placeholder="Anything else for them (optional)" />
      <div className="wf-subtle" style={{ fontSize: 12.5, marginTop: 6 }}>A clock starts now and runs until you tap I&apos;m in. It goes on the project sheet.</div>
    </Dialog>
  );
}
