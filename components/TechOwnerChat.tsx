'use client';
import { useEffect, useRef, useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import { fetchTechOwnerThread, sendTechOwnerMessage } from '@/lib/tech-portal';
import { toastError } from '@/lib/toast';
import type { TechDirectMessage } from '@/lib/types';

export default function TechOwnerChat({ onRead }: { onRead: () => void }) {
  const [messages, setMessages] = useState<TechDirectMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  const load = async () => {
    try {
      setMessages(await fetchTechOwnerThread());
      onRead();
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Couldn't open the FAJ conversation");
    }
    setLoading(false);
  };
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      if (await sendTechOwnerMessage(body)) {
        setDraft('');
        await load();
      } else toastError("Couldn't send that message.");
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Couldn't send that message");
    }
    setSending(false);
  };

  return (
    <div>
      <div className="glass card" style={{ padding: '12px 14px', marginBottom: 12 }}>
        <div style={{ fontWeight: 750, fontSize: 14 }}>FAJ Solutions</div>
        <div style={{ fontSize: 12, color: '#888' }}>Private conversation with the office</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9, maxHeight: '48vh', minHeight: 180, overflowY: 'auto', paddingRight: 3, marginBottom: 12 }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: '#aaa', fontSize: 13, padding: 20 }}><Loader2 size={18} /> Loading…</div>
        ) : messages.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#aaa', fontSize: 13, padding: '20px 10px' }}>No messages yet. Write directly to the office here.</div>
        ) : messages.map((m) => (
          <div key={m.id} style={{ display: 'flex', justifyContent: m.mine ? 'flex-end' : 'flex-start' }}>
            <div style={{
              maxWidth: '82%', padding: '9px 13px', borderRadius: 14, fontSize: 13.5, lineHeight: 1.5,
              background: m.mine ? 'var(--teal)' : 'white', color: m.mine ? 'white' : '#333',
              border: m.mine ? 'none' : '1px solid #e8e5dd',
            }}>
              {!m.mine && <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--teal)', marginBottom: 3 }}>FAJ SOLUTIONS</div>}
              <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>
              <div style={{ fontSize: 9.5, opacity: .6, marginTop: 4, textAlign: 'right' }}>
                {new Date(m.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </div>
            </div>
          </div>
        ))}
        <div ref={bottom} />
      </div>
      <div style={{ display: 'flex', gap: 7, alignItems: 'flex-end' }}>
        <textarea className="input" rows={2} value={draft} placeholder="Message FAJ Solutions…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
          style={{ flex: 1, resize: 'none' }} />
        <button className="btn btn-primary" onClick={() => void send()} disabled={sending || !draft.trim()}
          aria-label="Send message to FAJ Solutions" style={{ flexShrink: 0, padding: '11px 15px' }}>
          {sending ? <Loader2 size={17} /> : <Send size={17} />}
        </button>
      </div>
    </div>
  );
}
