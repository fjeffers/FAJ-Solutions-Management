'use client';

// Messages on the live project sheet (migration 121). Fred, 2026-10-14: the
// client adds notes under a photo and asks the tech a question; the tech
// answers right away; "No access to the building" shows with a clock running
// until the tech says they're in. Whoever has the link can write (no login);
// they put their name once and this browser remembers it.
import { useCallback, useEffect, useState } from 'react';
import { messageTitle, waitMinutes, type SheetMessage } from '@/lib/project-sheet';

const NAVY = '#0E1B2E';
const SUBTLE = '#5E6470';
const POLL_MS = 8000;
const NAME_KEY = 'faj-sheet-name';

const time = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });

export function useSheetMessages(token: string, initial: SheetMessage[]) {
  const [messages, setMessages] = useState<SheetMessage[]>(initial);
  const [now, setNow] = useState(() => new Date());
  const load = useCallback(async () => {
    try {
      const res = await fetch(`/sheet/${token}/messages`, { cache: 'no-store' });
      const j = (await res.json()) as { ok?: boolean; messages?: SheetMessage[] };
      if (j.ok && Array.isArray(j.messages)) setMessages(j.messages);
    } catch { /* no signal: keep what's showing */ }
    setNow(new Date());
  }, [token]);
  useEffect(() => {
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, POLL_MS);
    return () => window.clearInterval(t);
  }, [load]);
  const send = async (m: { site: string; name: string; body: string; kind: string; to: string; rowRef?: string; parentId?: string }) => {
    const res = await fetch(`/sheet/${token}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(m) });
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !j.ok) return j.error ?? "Couldn't send that. Try again.";
    await load();
    return null;
  };
  return { messages, now, send };
}

function savedName(): string {
  try { return window.localStorage.getItem(NAME_KEY) ?? ''; } catch { return ''; }
}
function saveName(n: string) {
  try { window.localStorage.setItem(NAME_KEY, n); } catch { /* private window: ask again next time */ }
}

/** Write a note, question or message. */
export function Composer({ site, techs, kind: startKind = 'message', to: startTo = '', rowRef, parentId, send, onDone, label }: {
  site: string; techs: string[]; kind?: 'message' | 'question' | 'note'; to?: string; rowRef?: string; parentId?: string;
  send: ReturnType<typeof useSheetMessages>['send']; onDone?: () => void; label?: string;
}) {
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [kind, setKind] = useState(startKind);
  const [to, setTo] = useState(startTo);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setName(savedName()); }, []);
  const go = async () => {
    if (!name.trim()) { setErr('Put your name in first.'); return; }
    if (!body.trim()) return;
    setBusy(true); setErr(null);
    saveName(name.trim());
    const e = await send({ site, name: name.trim(), body: body.trim(), kind, to, rowRef, parentId });
    setBusy(false);
    if (e) { setErr(e); return; }
    setBody('');
    onDone?.();
  };
  return (
    <div className="ps-compose">
      {label && <div style={{ fontWeight: 700, color: NAVY, marginBottom: 6 }}>{label}</div>}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
        {!parentId && (
          <select className="ps-select" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label="What it is">
            <option value="message">Message</option>
            <option value="question">Question for the tech</option>
            {rowRef && <option value="note">Note</option>}
          </select>
        )}
        <select className="ps-select" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Who it is for">
          <option value="">Everyone on site</option>
          {techs.map((t) => <option key={t} value={t}>{t}</option>)}
          <option value="FAJ">FAJ Solutions</option>
        </select>
        <input className="ps-input" style={{ flex: '1 1 140px' }} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Your name" aria-label="Your name" />
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
        <textarea className="ps-input" rows={2} style={{ flex: 1, resize: 'vertical' }} value={body} maxLength={2000}
          onChange={(e) => setBody(e.target.value)} aria-label="Message"
          placeholder={kind === 'question' ? 'e.g. Can you get a different angle of the rack?' : kind === 'note' ? 'Your note on this line' : 'Type a message'} />
        <button className="ps-btn ps-btn-dark" disabled={busy || !body.trim()} onClick={() => void go()}>{busy ? 'Sending…' : 'Send'}</button>
        {onDone && <button className="ps-btn" onClick={onDone}>Cancel</button>}
      </div>
      {err && <div style={{ color: '#B42318', fontSize: 12.5, marginTop: 4 }}>{err}</div>}
    </div>
  );
}

/** One message, with its replies under it and a Reply link. */
export function Bubble({ m, all, now, site, techs, send }: {
  m: SheetMessage; all: SheetMessage[]; now: Date; site: string; techs: string[]; send: ReturnType<typeof useSheetMessages>['send'];
}) {
  const [replying, setReplying] = useState(false);
  const replies = all.filter((x) => x.parentId === m.id);
  const waiting = m.kind === 'issue' && !m.resolvedAt;
  return (
    <div className={`ps-bubble ${m.role}${waiting ? ' waiting' : ''}`}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <b>{m.from}</b>
        <span style={{ color: SUBTLE, fontSize: 12 }}>{time(m.at)} · {messageTitle(m, all)}</span>
      </div>
      {m.kind === 'issue'
        ? m.reason && <div style={{ marginTop: 2 }}>Why: {m.reason}</div>
        : m.kind !== 'resolved' && m.body && <div style={{ whiteSpace: 'pre-wrap', marginTop: 2 }}>{m.body}</div>}
      {m.kind === 'issue' && (
        <div style={{ fontWeight: 700, marginTop: 4, color: waiting ? '#B42318' : '#047857' }}>
          {waiting ? `Waiting without access · ${waitMinutes(m, now)} min` : `Waited ${waitMinutes(m, now)} min without access`}
        </div>
      )}
      {m.kind === 'question' && !m.resolvedAt && <div style={{ color: '#B54708', fontSize: 12, marginTop: 2 }}>Waiting for an answer</div>}
      {replies.length > 0 && (
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {replies.map((r) => <Bubble key={r.id} m={r} all={all} now={now} site={site} techs={techs} send={send} />)}
        </div>
      )}
      {m.kind !== 'resolved' && (replying
        ? <Composer site={site} techs={techs} to={m.role === 'tech' ? m.from : ''} parentId={m.id} send={send} onDone={() => setReplying(false)} />
        : <button className="ps-link ps-noprint" onClick={() => setReplying(true)}>Reply</button>)}
    </div>
  );
}
