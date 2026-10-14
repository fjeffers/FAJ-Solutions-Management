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
import { useCallback, useEffect, useRef, useState } from 'react';
import { DoorClosed, KeyRound, MessageCircleQuestion } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { fetchTechMessages } from '@/lib/tech-portal';
import { toastError, toastSuccess } from '@/lib/toast';
import type { TechMessage } from '@/lib/types';
import { milesBetween } from '@/lib/geo';
import { Dialog } from './WfUi';
import { PushSwitch } from './PushSwitch';

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
  /** They've seen this job's messages (migration 123). */
  const markRead = useCallback(async () => {
    try { await createClient().rpc('wf_tech_mark_read', { p_wo_number: number }); } catch { /* next time */ }
    await load();
  }, [number, load]);
  return { msgs, contacts, load, send, markRead };
}

/**
 * Get the tech's attention (Fred, 2026-10-14: "needs to alert them, not just
 * come through"): a buzz and a two-tone beep. Phones that block one still do
 * the other; a closed app gets the phone pop-up instead (push).
 */
export function buzz() {
  try { navigator.vibrate?.([250, 120, 250]); } catch { /* not on this phone */ }
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(880, ctx.currentTime);
    o.frequency.setValueAtTime(1175, ctx.currentTime + 0.18);
    g.gain.setValueAtTime(0.18, ctx.currentTime);
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.4);
    window.setTimeout(() => { void ctx.close(); }, 700);
  } catch { /* sound blocked until they tap once */ }
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

/**
 * Problems on site: can't get in, missing materials, something else (Fred,
 * 2026-10-14). Stopped → an "issue" with a clock that runs until the tech is
 * back to work; still working → just a message to the project manager.
 */
export type ProblemKind = 'access' | 'materials' | 'other';
export const PROBLEMS: Record<ProblemKind, { label: string; head: string; clock: string; done: string; ask: string; yes: string; still: string; button: string }> = {
  access: { label: "Can't get into the building", head: 'No access to the building', clock: 'No access', done: 'Got access', ask: 'Do you have access now?', yes: "Yes, I'm in", still: 'Still no access.', button: "I'm in" },
  materials: { label: 'Missing materials', head: 'Missing materials', clock: 'Waiting on materials', done: 'Back to work', ask: 'Can you get back to work?', yes: 'Yes, back to work', still: 'Still waiting on materials.', button: 'Back to work' },
  other: { label: 'Something else', head: 'Stopped on site', clock: 'Stopped', done: 'Back to work', ask: 'Can you get back to work?', yes: 'Yes, back to work', still: 'Still stopped.', button: 'Back to work' },
};
export const problemOf = (body: string): ProblemKind =>
  body.startsWith('Missing materials') ? 'materials' : body.startsWith('No access') ? 'access' : 'other';

/**
 * The top of a project job: only what needs the tech right now (Fred,
 * 2026-10-14: "I need this clean"). A running clock, questions to answer,
 * a late start, and one small "Problem on site?" while they're working.
 */
export function SiteAccessBar({ number, talk, showProblem, late }: {
  number: string; talk: ReturnType<typeof useSiteTalk>; showProblem: boolean;
  late?: { marks: LateMark[]; load: () => Promise<void> };
}) {
  const { msgs, contacts, send, markRead } = talk;
  const [tick, setTick] = useState(() => Date.now());
  const [replyText, setReplyText] = useState('');
  const [popBusy, setPopBusy] = useState(false);
  const alerted = useRef<Set<string>>(new Set());
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
  const p = PROBLEMS[problemOf(issue?.content ?? '')];
  // Someone got back to them after they reported it.
  const reply = issue ? [...msgs].reverse().find((m) => !isMine(m) && m.sender_role !== 'contractor' && m.created_at > issue.created_at
    && (m.parent_id === issue.id || (!m.parent_id && (m.kind ?? 'message') === 'message' && m.for_me !== false))) ?? null : null;
  useEffect(() => {
    if (reply && !askedBefore(reply.id)) setPrompted(reply.id);
  }, [reply]);
  const questions = msgs.filter((m) => m.kind === 'question' && !m.resolved_at && !isMine(m) && m.for_me !== false);
  const lateNow = (late?.marks ?? []).filter((m) => !m.answered_at);
  // New messages for them they haven't seen: pop up, buzz, beep.
  const incoming = msgs.filter((m) => !isMine(m) && m.sender_role !== 'contractor' && m.for_me !== false && m.read === false
    && m.kind !== 'question' && !(issue && m.parent_id === issue.id));
  const pop = incoming[0] ?? null;
  useEffect(() => {
    const fresh = [...incoming, ...questions, ...(reply ? [reply] : [])].filter((m) => !alerted.current.has(m.id));
    if (fresh.length === 0) return;
    fresh.forEach((m) => alerted.current.add(m.id));
    buzz();
  }, [incoming, questions, reply]);
  const gotIt = async () => {
    setPopBusy(true);
    await markRead();
    setReplyText('');
    setPopBusy(false);
  };
  const replyToPop = async () => {
    if (!pop || !replyText.trim()) return;
    setPopBusy(true);
    const err = await send({ kind: 'message', parent: pop.id, to: pop.on_sheet ? pop.sender_name : 'FAJ', body: replyText.trim() });
    if (err) { toastError(err); setPopBusy(false); return; }
    await markRead();
    setReplyText('');
    setPopBusy(false);
    toastSuccess('Reply sent.');
  };

  const resolve = async () => {
    if (!issue) return;
    setBusy(true);
    const err = await send({ kind: 'resolved', parent: issue.id, body: p.done });
    setBusy(false);
    if (err) { toastError(err); return; }
    if (prompted) markAsked(prompted);
    setPrompted(null);
    toastSuccess(`Logged: ${mins(issue.created_at)} min ${p === PROBLEMS.access ? 'without access' : 'stopped'}.`);
  };
  const notYet = async () => {
    if (!issue || !prompted) return;
    markAsked(prompted);
    setPrompted(null);
    const err = await send({ kind: 'message', parent: issue.id, to: issue.to_name ?? 'Everyone', body: p.still });
    if (err) toastError(err);
  };
  const sendAnswer = async (q: TechMessage) => {
    if (!answer.trim()) return;
    setBusy(true);
    const err = await send({ kind: 'answer', parent: q.id, body: answer.trim() });
    setBusy(false);
    if (err) { toastError(err); return; }
    setAnswer(''); setAnswering(null);
    void markRead();
    toastSuccess('Answer sent.');
  };

  if (!issue && questions.length === 0 && lateNow.length === 0 && !showProblem && !pop) return null;
  void tick;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
      {/* Alerts even with the app closed: ask once, then out of the way. */}
      <PushSwitch hideWhenOn onText="" offText="Turn on alerts so the project manager can reach you right away, even with the app closed." />
      {lateNow.map((m) => <LateCard key={m.id} mark={m} onDone={() => void late?.load()} />)}

      {issue && (
        <div className="wf-card" style={{ padding: 12, borderColor: '#FDA29B', background: '#FEF3F2' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <DoorClosed size={18} color="#B42318" />
            <b style={{ flex: 1, color: '#B42318' }}>{p.clock} · {mins(issue.created_at)} min</b>
            <button className="wf-btn wf-btn-navy wf-btn-sm" disabled={busy} onClick={() => void resolve()}><KeyRound size={15} /> {p.button}</button>
          </div>
          <div className="wf-subtle" style={{ fontSize: 13, marginTop: 4 }}>
            {issue.reason}{issue.to_name ? ` · sent to ${issue.to_name}` : ''}. The clock runs until you tap {p.button}.
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

      {!issue && showProblem && (
        <button className="wf-btn wf-btn-ghost wf-btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setReporting(true)}>
          <DoorClosed size={15} /> Problem on site?
        </button>
      )}

      {reporting && (
        <ProblemDialog contacts={contacts} onClose={() => setReporting(false)}
          onSend={async (kind, to, reason, stopped, note) => {
            const pr = PROBLEMS[kind];
            const err = stopped
              ? await send({ kind: 'issue', to, reason, body: note ? `${pr.head}. ${note}` : pr.head })
              : await send({ kind: 'message', to, body: `${pr.head} (still working): ${reason}${note ? `. ${note}` : ''}` });
            if (err) { toastError(err); return; }
            setReporting(false);
            toastSuccess(stopped ? `Sent. The clock runs until you tap ${pr.button}.` : 'Sent to the project manager.');
          }} />
      )}

      {pop && !(issue && prompted && reply) && (
        <Dialog title={`Message from ${pop.sender_name}`} onClose={() => void gotIt()}
          footer={<>
            <button className="wf-btn wf-btn-ghost" disabled={popBusy} onClick={() => void gotIt()}>Got it</button>
            <button className="wf-btn wf-btn-navy" disabled={popBusy || !replyText.trim()} onClick={() => void replyToPop()}>Reply</button>
          </>}>
          <div className="wf-subtle" style={{ fontSize: 12, marginBottom: 4 }}>
            {pop.sender_role === 'client' ? 'On the project sheet' : 'From FAJ'} · {new Date(pop.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} · WO {number}
          </div>
          <p style={{ marginTop: 0, whiteSpace: 'pre-wrap', fontSize: 16 }}>{pop.content}</p>
          {incoming.length > 1 && <div className="wf-subtle" style={{ fontSize: 12, marginBottom: 6 }}>{incoming.length - 1} more under Messages.</div>}
          <textarea className="wf-input" rows={2} value={replyText} onChange={(e) => setReplyText(e.target.value)} style={{ fontSize: 16 }}
            placeholder={`Reply to ${pop.sender_name}`} />
        </Dialog>
      )}

      {issue && prompted && reply && (
        <Dialog title={p.ask} onClose={() => { markAsked(prompted); setPrompted(null); }}
          footer={<>
            <button className="wf-btn wf-btn-ghost" onClick={() => void notYet()}>Not yet</button>
            <button className="wf-btn wf-btn-navy" disabled={busy} onClick={() => void resolve()}><KeyRound size={16} /> {p.yes}</button>
          </>}>
          <p style={{ marginTop: 0 }}><b>{reply.sender_name}:</b> {reply.content}</p>
          <p className="wf-subtle" style={{ marginBottom: 0 }}>{p.clock} so far: {mins(issue.created_at)} min (WO {number}).</p>
        </Dialog>
      )}
    </div>
  );
}

function ProblemDialog({ contacts, onSend, onClose }: {
  contacts: SiteContact[];
  onSend: (kind: ProblemKind, to: string, reason: string, stopped: boolean, note: string) => Promise<void>;
  onClose: () => void;
}) {
  const pmName = () => contacts.find((c) => c.role === 'pm')?.name ?? 'Everyone';
  const [kind, setKind] = useState<ProblemKind | null>(null);
  const [to, setTo] = useState(pmName());
  const [reason, setReason] = useState('');
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [stopped, setStopped] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (to === 'Everyone') setTo(pmName()); }, [contacts]); // eslint-disable-line react-hooks/exhaustive-deps

  const why = kind === 'access' ? (reason === 'Other' ? text.trim() : reason) : text.trim();
  const isStopped = kind === 'access' ? true : stopped;
  const ready = !!kind && !!why && isStopped !== null;

  return (
    <Dialog title={kind ? PROBLEMS[kind].label : 'Problem on site'} onClose={onClose}
      footer={<>
        <button className="wf-btn wf-btn-ghost" onClick={kind ? () => { setKind(null); setReason(''); setText(''); setStopped(null); } : onClose}>{kind ? 'Back' : 'Cancel'}</button>
        {kind && (
          <button className="wf-btn wf-btn-navy" disabled={busy || !ready}
            onClick={async () => { setBusy(true); await onSend(kind, to, why, !!isStopped, note.trim()); setBusy(false); }}>Send now</button>
        )}
      </>}>
      {!kind ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(Object.keys(PROBLEMS) as ProblemKind[]).map((k) => (
            <button key={k} type="button" className="wf-btn wf-btn-outline" style={{ justifyContent: 'flex-start' }} onClick={() => setKind(k)}>{PROBLEMS[k].label}</button>
          ))}
        </div>
      ) : (
        <>
          <label className="wf-label" htmlFor="pb-to">Send to</label>
          <select id="pb-to" className="wf-input" style={{ fontSize: 16, marginBottom: 10 }} value={to} onChange={(e) => setTo(e.target.value)}>
            {contacts.map((c) => <option key={c.name} value={c.name}>{c.name}{c.role === 'pm' ? ' (project manager)' : ''}</option>)}
            <option value="Everyone">Everyone on the project sheet</option>
          </select>

          {kind === 'access' ? (
            <>
              <div className="wf-label">Why?</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                {[...NO_ACCESS_REASONS, 'Other'].map((r) => (
                  <button key={r} type="button" className={`wf-btn ${reason === r ? 'wf-btn-navy' : 'wf-btn-outline'}`} style={{ justifyContent: 'flex-start' }} onClick={() => setReason(r)}>{r}</button>
                ))}
              </div>
              {reason === 'Other' && (
                <input className="wf-input" style={{ marginTop: 8, fontSize: 16 }} autoFocus value={text} maxLength={200} onChange={(e) => setText(e.target.value)} placeholder="What's stopping you?" />
              )}
            </>
          ) : (
            <>
              <label className="wf-label" htmlFor="pb-what">{kind === 'materials' ? "What's missing, and how many?" : "What's wrong?"}</label>
              <textarea id="pb-what" className="wf-input" rows={3} autoFocus value={text} maxLength={500} onChange={(e) => setText(e.target.value)} style={{ fontSize: 16 }}
                placeholder={kind === 'materials' ? 'e.g. 2 boxes of Cat6, 1 24-port patch panel, 50 RJ45 jacks' : 'Tell the project manager what happened'} />
              <div className="wf-label" style={{ marginTop: 10 }}>Can you keep working?</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                <button type="button" className={`wf-btn ${stopped === false ? 'wf-btn-navy' : 'wf-btn-outline'}`} onClick={() => setStopped(false)}>Yes, on other work</button>
                <button type="button" className={`wf-btn ${stopped === true ? 'wf-btn-navy' : 'wf-btn-outline'}`} onClick={() => setStopped(true)}>No, I&apos;m stopped</button>
              </div>
            </>
          )}

          <textarea className="wf-input" rows={2} style={{ marginTop: 10, fontSize: 16 }} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)}
            placeholder="Anything else for them (optional)" />
          <div className="wf-subtle" style={{ fontSize: 12.5, marginTop: 6 }}>
            {isStopped ? 'A clock starts now and runs until you tap back to work. It goes on the project sheet.' : 'The project manager gets it on the project sheet right away.'}
          </div>
        </>
      )}
    </Dialog>
  );
}

// ── Running late (migration 122) ────────────────────────────────────────────
// Fred, 2026-10-14: "even if the schedule time and the tech is not there, mark
// late after 30 min, with a reason ... especially if there are multiple days".
// The database flags it every scheduled day; the tech says why here.

export const LATE_REASONS = ['Traffic', 'Previous site ran over', 'Picking up parts or material', 'Car trouble', 'Personal or emergency'];
export type LateMark = { id: string; day: string; start: string | null; due_at: string; reason: string | null; answered_at: string | null };

export function useLateMarks(number: string, enabled: boolean) {
  const [marks, setMarks] = useState<LateMark[]>([]);
  const load = useCallback(async () => {
    try {
      const { data } = await createClient().rpc('wf_tech_late', { p_wo_number: number });
      setMarks(Array.isArray(data) ? (data as LateMark[]) : []);
    } catch { /* no signal: keep what's showing */ }
  }, [number]);
  useEffect(() => {
    if (!enabled) return;
    void load();
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 60_000);
    return () => window.clearInterval(t);
  }, [enabled, load]);
  return { marks, load };
}

export function LateCard({ mark, onDone }: { mark: LateMark; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [other, setOther] = useState('');
  const [eta, setEta] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const why = reason === 'Other' ? other.trim() : reason;
  const send = async () => {
    setBusy(true);
    try {
      const { data, error } = await createClient().rpc('wf_tech_late_reason', { p_id: mark.id, p_reason: why, p_eta_min: eta, p_note: null });
      if (error || !(data as { ok?: boolean } | null)?.ok) { toastError(error ? 'No signal — try again when you have it.' : "Couldn't send that."); return; }
      toastSuccess('Sent. The project manager can see it.');
      onDone();
    } finally { setBusy(false); }
  };
  return (
    <div className="wf-card" style={{ padding: 12, borderColor: '#FEC84B', background: '#FFFAEB' }}>
      <b>You&apos;re past the {mark.start ?? 'scheduled'} start</b>
      <div className="wf-subtle" style={{ fontSize: 13, marginTop: 2 }}>The project manager sees you&apos;re not on site yet. What&apos;s going on?</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
        {[...LATE_REASONS, 'Other'].map((r) => (
          <button key={r} type="button" className={`wf-btn wf-btn-sm ${reason === r ? 'wf-btn-navy' : 'wf-btn-outline'}`} onClick={() => setReason(r)}>{r}</button>
        ))}
      </div>
      {reason === 'Other' && (
        <input className="wf-input" style={{ marginTop: 8, fontSize: 16 }} value={other} maxLength={200} onChange={(e) => setOther(e.target.value)} placeholder="What's going on?" />
      )}
      <div className="wf-label" style={{ marginTop: 10 }}>There in about</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
        {[10, 20, 30, 45, 60].map((m) => (
          <button key={m} type="button" className={`wf-btn wf-btn-sm ${eta === m ? 'wf-btn-navy' : 'wf-btn-outline'}`} onClick={() => setEta(eta === m ? null : m)}>{m === 60 ? '1 hr+' : `${m} min`}</button>
        ))}
      </div>
      <button className="wf-btn wf-btn-gold" style={{ marginTop: 10 }} disabled={busy || !why} onClick={() => void send()}>Send</button>
    </div>
  );
}

// ── Stepped off site (migration 122) ────────────────────────────────────────
// Fred, 2026-10-14: "he leaves the site, the GPS should show him off site and
// ask a reason: break, lunch, leaving for the day or other, he explains; the
// PM gets that notification". A phone only shares its position while the app
// is open, so this checks while the job is on screen (and the moment it opens).

/** Farther than this from the site, twice in a row, counts as off site. */
const AWAY_MILES = 0.25;
const NEAR_MILES = 0.15;
/** A position this vague (meters) is ignored either way. */
const MAX_ACCURACY_M = 300;

export function useLeftSite(siteLat: number | null, siteLng: number | null, enabled: boolean) {
  const [away, setAway] = useState(false);
  const [quietUntil, setQuietUntil] = useState(0);
  const [backAt, setBackAt] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled || siteLat == null || siteLng == null || typeof navigator === 'undefined' || !navigator.geolocation) return;
    let far = 0, near = 0;
    const id = navigator.geolocation.watchPosition((p) => {
      if (p.coords.accuracy > MAX_ACCURACY_M) return;
      const miles = milesBetween(siteLat, siteLng, p.coords.latitude, p.coords.longitude);
      if (miles > AWAY_MILES) { far += 1; near = 0; } else if (miles < NEAR_MILES) { near += 1; far = 0; }
      if (far >= 2 && Date.now() > quietUntil) setAway(true);
      if (near >= 2) setBackAt(Date.now());
    }, () => { /* no position: nothing to say */ }, { enableHighAccuracy: false, maximumAge: 60_000, timeout: 30_000 });
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled, siteLat, siteLng, quietUntil]);
  return {
    away,
    backAt,
    /** Answered (or "I'm still here"): don't ask again for a while. */
    dismiss: (minutes = 30) => { setAway(false); setQuietUntil(Date.now() + minutes * 60_000); },
  };
}

export const AWAY_REASONS = ['Break', 'Lunch', 'Leaving for the day'];

export function LeftSiteDialog({ onPick, onStillHere }: { onPick: (reason: string, note: string) => void; onStillHere: () => void }) {
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  return (
    <Dialog title="Looks like you left the site" onClose={onStillHere}
      footer={<>
        <button className="wf-btn wf-btn-ghost" onClick={onStillHere}>I&apos;m still on site</button>
        <button className="wf-btn wf-btn-navy" disabled={!reason || (reason === 'Other' && !note.trim())} onClick={() => onPick(reason, note.trim())}>Send</button>
      </>}>
      <p style={{ marginTop: 0 }}>Your phone shows you away from the site. Why?</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {[...AWAY_REASONS, 'Other'].map((r) => (
          <button key={r} type="button" className={`wf-btn ${reason === r ? 'wf-btn-navy' : 'wf-btn-outline'}`} style={{ justifyContent: 'flex-start' }} onClick={() => setReason(r)}>{r}</button>
        ))}
      </div>
      {(reason === 'Other' || reason === 'Break') && (
        <input className="wf-input" style={{ marginTop: 8, fontSize: 16 }} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)}
          placeholder={reason === 'Other' ? "Tell the project manager what's going on" : 'Anything to add (optional)'} />
      )}
      <div className="wf-subtle" style={{ fontSize: 12.5, marginTop: 6 }}>The project manager gets this on the project sheet.</div>
    </Dialog>
  );
}

// ── The tech app and the sheet, linked (migration 124) ──────────────────────
// Fred, 2026-10-14: "I want the tech app and the web URL to be linked". The
// tech opens the same live sheet the project manager has, at their site.

export function SheetLinkButton({ number }: { number: string }) {
  const [busy, setBusy] = useState(false);
  const open = async () => {
    setBusy(true);
    // Open the tab first (phones block a pop-up opened after a wait), then point it at the sheet.
    const w = window.open('', '_blank');
    try {
      const { data } = await createClient().rpc('wf_tech_sheet_link', { p_wo_number: number });
      const r = data as { ok?: boolean; token?: string; site?: string } | null;
      if (!r?.ok || !r.token) { w?.close(); toastError("Couldn't open the project sheet."); return; }
      const url = `/sheet/${r.token}?site=${encodeURIComponent(r.site ?? number)}`;
      if (w) w.location.href = url; else window.location.href = url;
    } catch {
      w?.close();
      toastError('No signal — try again when you have it.');
    } finally { setBusy(false); }
  };
  return (
    <button className="wf-btn wf-btn-ghost wf-btn-sm" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => void open()}>
      Open the project sheet
    </button>
  );
}
