'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CalendarDays, Check, CheckCheck, ChevronRight, Loader2, MessageSquare, Search, Send, ShieldCheck, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { todayEastern } from '@/lib/assistant';
import { requestLabel, roleLabel, threadMessages, unreadMessages, type MessagingAdapter, type MessagingSnapshot, type TeamMessage } from '@/lib/team-messaging';
import './team-messenger.css';

const dateLabel = (date: string) => new Date(`${date.slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const initials = (name: string) => name.split(/\s+/).slice(0, 2).map((n) => n[0]).join('');

export default function TeamMessenger({ adapter: supplied }: { adapter?: MessagingAdapter }) {
  const adapter = useMemo<MessagingAdapter>(() => supplied ?? (() => {
    const rpc = async <T,>(name: string, args?: Record<string, unknown>): Promise<T> => {
      const { data, error } = await createClient().rpc(name, args);
      if (error) throw new Error(error.code === 'PGRST202' ? 'Team messaging is not enabled yet. Apply database migration 157 to connect it.' : error.message);
      return data as T;
    };
    return {
      load: () => rpc<MessagingSnapshot>('messaging_snapshot'),
      send: (peer, content, job, date) => rpc<void>('messaging_send', { p_peer: peer, p_content: content, p_job: job, p_date: date }),
      read: (peer) => rpc<void>('messaging_read', { p_peer: peer }),
      respond: (id, status, note) => rpc<void>('messaging_respond', { p_id: id, p_status: status, p_note: note }),
    };
  })(), [supplied]);
  const [snapshot, setSnapshot] = useState<MessagingSnapshot | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'unread' | 'requests'>('all');
  const [draft, setDraft] = useState('');
  const [requesting, setRequesting] = useState(false);
  const [job, setJob] = useState('');
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const bottom = useRef<HTMLDivElement>(null);
  const activePeer = useRef<string | null>(null);
  activePeer.current = selected;
  const refresh = useCallback(async () => {
    const next = await adapter.load();
    const peer = activePeer.current;
    if (peer && unreadMessages(next.messages, peer)) {
      await adapter.read(peer);
      next.messages = next.messages.map((m) => m.peer_id === peer && !m.mine ? { ...m, read_at: new Date().toISOString() } : m);
    }
    setSnapshot(next);
    if (!supplied) window.dispatchEvent(new Event('team-messages-changed'));
  }, [adapter, supplied]);
  useEffect(() => {
    let mounted = true;
    const load = () => { if (document.visibilityState === 'visible') void refresh().catch((e: Error) => { if (mounted) setError(e.message || 'Could not refresh messages.'); }); };
    load();
    const timer = setInterval(load, 10000);
    window.addEventListener('focus', load);
    return () => { mounted = false; clearInterval(timer); window.removeEventListener('focus', load); };
  }, [refresh]);
  useEffect(() => { if (selected) void refresh().catch((e: Error) => setError(e.message)); }, [selected, refresh]);
  const messages = snapshot ? threadMessages(snapshot.messages, selected ?? '') : [];
  const pendingCount = snapshot?.messages.filter((m) => m.availability === 'pending').length ?? 0;
  const responseVersion = messages.map((m) => m.availability).join(',');
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [messages.length, responseVersion]);
  const contact = snapshot?.contacts.find((c) => c.id === selected);
  const isTech = snapshot?.me.role === 'technician';
  const contacts = (snapshot?.contacts ?? []).filter((c) => {
    if (!`${c.name} ${roleLabel(c.role)}`.toLowerCase().includes(search.toLowerCase())) return false;
    if (filter === 'unread') return unreadMessages(snapshot!.messages, c.id) > 0;
    if (filter === 'requests') return snapshot!.messages.some((m) => m.peer_id === c.id && m.availability === 'pending');
    return true;
  }).sort((a, b) => {
    const lastA = threadMessages(snapshot!.messages, a.id).at(-1)?.created_at ?? '';
    const lastB = threadMessages(snapshot!.messages, b.id).at(-1)?.created_at ?? '';
    return lastB.localeCompare(lastA) || a.name.localeCompare(b.name);
  });

  const send = async () => {
    if (!contact || busy || !draft.trim() || (requesting && (!job || !date))) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await adapter.send(contact.id, draft.trim(), requesting ? job : null, requesting ? date : null);
      setDraft(''); setRequesting(false); setJob(''); setDate('');
      setNotice(requesting ? 'Availability request sent. This does not assign the work order.' : 'Message sent.');
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not send. Your draft has been kept.'); }
    finally { setBusy(false); }
  };
  const respond = async (id: string, status: 'available' | 'unavailable', note: string) => {
    setBusy(true); setError('');
    try { await adapter.respond(id, status, note); setNotice('Your availability reply was sent.'); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not send your reply.'); }
    finally { setBusy(false); }
  };

  return <section className="tm" aria-label="Team messaging">
    <header className="tm-heading"><div><div className="tm-eyebrow">PEOPLE & COORDINATION</div><h1>Team messenger<span className="tm-live">In-app</span></h1><p>Good work starts with a conversation.</p></div><div className="tm-stat"><CalendarDays size={19} /><span><b>{pendingCount}</b> awaiting availability</span></div></header>
    {error && <div className="tm-error" role="alert">{error} <button onClick={() => { setError(''); void refresh().catch((e: Error) => setError(e.message)); }}>Retry</button></div>}
    <div className="tm-sr" role="status">{notice}</div>
    {!snapshot ? <div className="tm-loading"><Loader2 size={22} />{error ? 'Messaging could not be loaded.' : 'Opening your conversations…'}</div> : <div className={`tm-shell ${selected ? 'tm-open' : ''}`}>
      <aside className="tm-sidebar"><div className="tm-sidebar-top"><h2>Conversations <span>{snapshot.contacts.length}</span></h2><label className="tm-search"><Search size={16} /><input aria-label="Search people" placeholder="Search people…" value={search} onChange={(e) => setSearch(e.target.value)} /></label><div className="tm-filters">{(['all', 'unread', 'requests'] as const).map((f) => <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f === 'all' ? 'All people' : f === 'unread' ? 'Unread' : 'Requests'}</button>)}</div></div>
        <div className="tm-contacts">{contacts.map((c) => {
          const thread = threadMessages(snapshot.messages, c.id); const last = thread.at(-1); const unread = unreadMessages(snapshot.messages, c.id);
          return <button key={c.id} className={`tm-contact ${selected === c.id ? 'tm-selected' : ''}`} onClick={() => { setSelected(c.id); setDraft(''); setRequesting(false); setJob(''); setDate(''); setNotice(''); }}><span className={`tm-avatar tm-${c.role}`}>{initials(c.name)}</span><span className="tm-contact-copy"><span className="tm-contact-name">{c.name}{unread > 0 && <span className="tm-unread">{unread}</span>}</span><span className="tm-role">{roleLabel(c.role)}</span><span className="tm-preview">{last ? `${last.mine ? 'You: ' : ''}${last.availability ? `${requestLabel(last.availability)} · ` : ''}${last.content}` : c.connected ? 'Start a conversation' : 'Portal login needed'}</span></span><ChevronRight size={14} /></button>;
        })}{contacts.length === 0 && <p className="tm-no-results">No people match this view.</p>}</div>
        <div className="tm-sidebar-foot"><ShieldCheck size={15} /><span>Individual conversations.<br />Only you and your contact.</span></div>
      </aside>
      <div className="tm-conversation">{!contact ? <div className="tm-welcome"><div className="tm-welcome-icon"><MessageSquare size={32} /></div><h2>A direct line to your team</h2><p>Choose a person to send a message{isTech ? ' or reply to a work-order availability request.' : ' or check their availability for a work order.'}</p><span><ShieldCheck size={14} /> Private, one-to-one conversations</span></div> : <>
        <header className="tm-thread-head"><button className="tm-back" aria-label="Back to conversations" onClick={() => setSelected(null)}><ArrowLeft size={20} /></button><span className={`tm-avatar tm-${contact.role}`}>{initials(contact.name)}</span><div><h2>{contact.name}</h2><span className="tm-role">{roleLabel(contact.role)} · {contact.connected ? 'FAJ Solutions' : 'Portal login needed'}</span></div>{!isTech && <button className="tm-request-btn" onClick={() => { setRequesting((v) => !v); setNotice(''); }} disabled={!contact.connected}><CalendarDays size={16} /> Request availability</button>}</header>
        <div className="tm-history" aria-label={`Conversation with ${contact.name}`}><div className="tm-history-note"><ShieldCheck size={13} /> Your conversation with {contact.name.split(' ')[0]}</div>{messages.length === 0 && <div className="tm-start-note">Say hello to {contact.name.split(' ')[0]}. Your conversation starts here.</div>}{messages.map((m) => <article key={m.id} className={`tm-message ${m.mine ? 'tm-mine' : ''}`}><div className="tm-message-author">{m.mine ? 'You' : m.sender_name}<time dateTime={m.created_at}>{new Date(m.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time></div><div className="tm-bubble">{m.availability && <AvailabilityCard message={m} canRespond={!!isTech && !m.mine} busy={busy} onRespond={respond} />}<p>{m.content}</p></div>{m.mine && <div className="tm-read">{m.read_at ? <CheckCheck size={13} /> : <Check size={13} />}{m.read_at ? 'Read' : 'Sent'}</div>}</article>)}<div ref={bottom} /></div>
        <div className="tm-compose">{requesting && <div className="tm-request-form"><div className="tm-form-title"><CalendarDays size={17} /><b>Check work-order availability</b><button aria-label="Cancel availability request" onClick={() => setRequesting(false)}><X size={17} /></button></div><div className="tm-form-fields"><label>Work order<select aria-label="Work order" value={job} onChange={(e) => { setJob(e.target.value); setDate(snapshot.jobs.find((j) => j.id === e.target.value)?.date?.slice(0, 10) ?? ''); }}><option value="">Choose a work order…</option>{snapshot.jobs.map((j) => <option key={j.id} value={j.id}>WO {j.number} · {j.title || 'Work order'}</option>)}</select></label><label>Proposed date<input aria-label="Proposed date" type="date" min={todayEastern()} value={date} onChange={(e) => setDate(e.target.value)} /></label></div><p>This asks about availability only. It does not assign or schedule the job.</p></div>}
          {!contact.connected && <p className="tm-connection-note">This technician needs an active portal login before you can message them.</p>}
          <form onSubmit={(e) => { e.preventDefault(); void send(); }}><textarea aria-label="Message" placeholder={requesting ? 'Add details about the work, start time, or what to bring…' : `Message ${contact.name.split(' ')[0]}…`} value={draft} maxLength={4000} rows={2} disabled={!contact.connected || busy} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} /><div className="tm-compose-bottom"><span>Enter to send · Shift + Enter for a new line</span><button className="tm-send" type="submit" disabled={busy || !contact.connected || !draft.trim() || (requesting && (!job || !date || date < todayEastern()))}>{busy ? <Loader2 size={16} /> : <Send size={16} />}{requesting ? 'Send request' : 'Send message'}</button></div></form>
        </div>
      </>}</div>
    </div>}
    <footer className="tm-footer"><span>FAJ SOLUTIONS</span><span>Less back-and-forth. More work moving forward.</span></footer>
  </section>;
}

function AvailabilityCard({ message: m, canRespond, busy, onRespond }: { message: TeamMessage; canRespond: boolean; busy: boolean; onRespond: (id: string, status: 'available' | 'unavailable', note: string) => Promise<void> }) {
  const [note, setNote] = useState('');
  return <div className={`tm-availability tm-status-${m.availability}`}><div className="tm-availability-title"><CalendarDays size={17} /> AVAILABILITY REQUEST</div><h3>WO {m.job_number} · {m.job_title || 'Work order'}</h3>{m.job_place && <p>{m.job_place}</p>}<div className="tm-date">{m.proposed_date && dateLabel(m.proposed_date)}</div><span className="tm-status">{m.availability !== 'pending' && <Check size={13} />}{requestLabel(m.availability)}</span>{m.response_note && <p className="tm-response-note">Reply: {m.response_note}</p>}{canRespond && m.availability === 'pending' && <div className="tm-reply"><label>Reply note (optional)<input aria-label={`Reply note for WO ${m.job_number}`} maxLength={1000} placeholder="For example, available after 9 AM" value={note} onChange={(e) => setNote(e.target.value)} /></label><div><button disabled={busy} onClick={() => void onRespond(m.id, 'available', note)}><Check size={15} /> Available</button><button disabled={busy} onClick={() => void onRespond(m.id, 'unavailable', note)}><X size={15} /> Unavailable</button></div></div>}<small>Availability only — not a job assignment.</small></div>;
}
