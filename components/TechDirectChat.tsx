'use client';
import { useEffect, useRef, useState } from 'react';
import { Send, Users, Loader2, ChevronDown } from 'lucide-react';
import { fetchTechDirectory, fetchTechDmThread, sendTechDm } from '@/lib/tech-portal';
import { toastError } from '@/lib/toast';
import type { TechDirectMessage, TechDirectoryEntry } from '@/lib/types';

/**
 * Tech-to-tech messaging: pick a name from the dropdown and talk.
 *
 * The roster is names only — no phone numbers, no emails, no pay. A tech needs
 * to know who exists in order to pick someone; handing out everyone's contact
 * details would be a data leak wearing a feature's clothes.
 *
 * These threads are visible to Fred, and the footer says so. A tech should not
 * have to guess whether the boss can read it.
 */
export default function TechDirectChat({ onRead }: { onRead: () => void }) {
  const [people, setPeople] = useState<TechDirectoryEntry[]>([]);
  const [otherId, setOtherId] = useState('');
  const [messages, setMessages] = useState<TechDirectMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [sending, setSending] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      try {
        setPeople(await fetchTechDirectory());
      } catch (e) {
        toastError(e instanceof Error ? e.message : "Couldn't load the tech list");
      }
      setLoading(false);
    })();
  }, []);

  const openThread = async (id: string) => {
    setOtherId(id);
    setMessages([]);
    if (!id) return;
    setLoadingThread(true);
    try {
      setMessages(await fetchTechDmThread(id));
      // Opening cleared unread on the server; refresh the badges here too.
      setPeople(await fetchTechDirectory());
      onRead();
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Couldn't open that conversation");
    }
    setLoadingThread(false);
  };

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const send = async () => {
    const body = draft.trim();
    if (!body || !otherId) return;
    setSending(true);
    try {
      if (await sendTechDm(otherId, body)) {
        setDraft('');
        setMessages(await fetchTechDmThread(otherId));
      } else {
        toastError("Couldn't send that message.");
      }
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Couldn't send that message");
    }
    setSending(false);
  };

  if (loading) {
    return <div style={{ textAlign: 'center', color: '#aaa', fontSize: 13, padding: 24 }}><Loader2 size={18} /> Loading…</div>;
  }

  if (people.length === 0) {
    return (
      <div className="glass card" style={{ textAlign: 'center', padding: '30px 20px', color: '#aaa', fontSize: 13 }}>
        <Users size={22} color="#ddd" style={{ marginBottom: 7 }} />
        <div>No other techs to message yet.</div>
      </div>
    );
  }

  const selected = people.find((p) => p.id === otherId);

  return (
    <div>
      <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: '#555', textTransform: 'uppercase', display: 'block', marginBottom: 5 }}>
        Message a tech
      </label>
      <div style={{ position: 'relative', marginBottom: 14 }}>
        <select
          className="select input" value={otherId}
          onChange={(e) => openThread(e.target.value)}
          style={{ paddingRight: 34 }}
        >
          <option value="">Choose someone…</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}{p.unread > 0 ? `  (${p.unread} new)` : ''}
            </option>
          ))}
        </select>
        <ChevronDown size={15} color="#999" style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
      </div>

      {!otherId ? (
        <div className="glass card" style={{ textAlign: 'center', padding: '26px 20px', color: '#aaa', fontSize: 13 }}>
          <Users size={20} color="#ddd" style={{ marginBottom: 6 }} />
          <div>Pick a name above to start.</div>
        </div>
      ) : (
        <>
          <div style={{
            display: 'flex', flexDirection: 'column', gap: 9,
            maxHeight: '44vh', overflowY: 'auto', paddingRight: 3, marginBottom: 12,
          }}>
            {loadingThread ? (
              <div style={{ textAlign: 'center', color: '#aaa', fontSize: 13, padding: 20 }}>
                <Loader2 size={18} /> Loading…
              </div>
            ) : messages.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#aaa', fontSize: 13, padding: '20px 10px' }}>
                No messages with {selected?.name} yet.
              </div>
            ) : (
              messages.map((m) => (
                <div key={m.id} style={{ display: 'flex', justifyContent: m.mine ? 'flex-end' : 'flex-start' }}>
                  <div style={{
                    maxWidth: '82%', padding: '9px 13px', borderRadius: 14,
                    background: m.mine ? 'var(--teal)' : 'white',
                    color: m.mine ? 'white' : '#333',
                    border: m.mine ? 'none' : '1px solid #e8e5dd',
                    fontSize: 13.5, lineHeight: 1.5,
                  }}>
                    {!m.mine && (
                      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.6, color: 'var(--teal)', marginBottom: 3, textTransform: 'uppercase' }}>
                        {selected?.name}
                      </div>
                    )}
                    <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>
                    <div style={{ fontSize: 9.5, opacity: 0.6, marginTop: 4, textAlign: 'right' }}>
                      {new Date(m.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              ))
            )}
            <div ref={bottom} />
          </div>

          <div style={{ display: 'flex', gap: 7, alignItems: 'flex-end' }}>
            <textarea
              className="input" rows={2} value={draft}
              placeholder={`Message ${selected?.name ?? ''}…`}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              style={{ flex: 1, resize: 'none' }}
            />
            <button
              className="btn btn-primary" onClick={send} disabled={sending || !draft.trim()}
              style={{ flexShrink: 0, padding: '11px 15px' }}
            ><Send size={15} /></button>
          </div>
        </>
      )}

      <div style={{ fontSize: 11, color: '#aaa', marginTop: 12, lineHeight: 1.5 }}>
        Messages between techs are part of the job record and can be seen by the office.
      </div>
    </div>
  );
}
