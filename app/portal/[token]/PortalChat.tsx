'use client';
import { useEffect, useRef, useState } from 'react';

type Message = {
  id: string;
  sender_name: string;
  sender_role: 'admin' | 'contractor';
  content: string;
  created_at: string;
};

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function PortalChat({ token, woNumber }: { token: string; woNumber: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    try {
      const res = await fetch(`/api/portal/messages?token=${encodeURIComponent(token)}&wo_number=${encodeURIComponent(woNumber)}`);
      if (!res.ok) return;
      const data = await res.json();
      setMessages(data.messages ?? []);
    } catch { /* non-blocking */ }
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 10000); // 10s polling — see Phase 7 plan notes
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, woNumber]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  const send = async () => {
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    setDraft('');
    try {
      await fetch('/api/portal/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, wo_number: woNumber, content }),
      });
      await load();
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#0D7377', letterSpacing: 0.5, textTransform: 'uppercase' }}>
        💬 Messages
      </div>
      <div
        ref={listRef}
        style={{
          display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 260, overflowY: 'auto',
          padding: '10px 12px', background: '#f9fafb', borderRadius: 10, border: '1px solid #eee',
        }}
      >
        {messages.length === 0 && (
          <div style={{ fontSize: 12, color: '#bbb', textAlign: 'center', padding: '12px 0' }}>No messages yet.</div>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            style={{
              alignSelf: m.sender_role === 'contractor' ? 'flex-end' : 'flex-start',
              maxWidth: '80%',
              background: m.sender_role === 'contractor' ? '#0D7377' : 'white',
              color: m.sender_role === 'contractor' ? 'white' : '#1a1a1a',
              border: m.sender_role === 'contractor' ? 'none' : '1px solid #e5e7eb',
              borderRadius: 12,
              padding: '8px 12px',
            }}
          >
            {m.sender_role === 'admin' && (
              <div style={{ fontSize: 10, fontWeight: 700, color: '#0D7377', marginBottom: 2 }}>{m.sender_name}</div>
            )}
            <div style={{ fontSize: 13, lineHeight: 1.4, whiteSpace: 'pre-line' }}>{m.content}</div>
            <div style={{ fontSize: 9, opacity: 0.7, marginTop: 3, textAlign: 'right' }}>{fmtTime(m.created_at)}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
          placeholder="Type a message..."
          style={{ flex: 1, padding: '10px 14px', borderRadius: 10, border: '1px solid #ddd', fontSize: 13 }}
        />
        <button
          onClick={send}
          disabled={sending || !draft.trim()}
          style={{
            padding: '10px 18px', borderRadius: 10, border: 'none', background: '#0D7377', color: 'white',
            fontWeight: 700, fontSize: 13, cursor: sending ? 'default' : 'pointer', opacity: sending ? 0.6 : 1,
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}
