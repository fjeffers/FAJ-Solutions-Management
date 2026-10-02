'use client';
import { useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { WorkOrderMessage } from '@/lib/types';

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function WorkOrderChatPanel({ woNumber }: { woNumber: string | undefined }) {
  const supabase = createClient();
  const [messages, setMessages] = useState<WorkOrderMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    if (!woNumber) return;
    const { data } = await supabase
      .from('work_order_messages')
      .select('*')
      .eq('work_order_id', woNumber)
      .order('created_at', { ascending: true });
    if (data) setMessages(data as WorkOrderMessage[]);
  };

  useEffect(() => {
    load();
    // Realtime on the authenticated admin side (see Phase 7 plan — portal side uses polling instead).
    if (!woNumber) return;
    const channel = supabase
      .channel(`wo-messages-${woNumber}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'work_order_messages', filter: `work_order_id=eq.${woNumber}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [woNumber]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  const send = async () => {
    const content = draft.trim();
    if (!content || sending || !woNumber) return;
    setSending(true);
    setDraft('');
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from('work_order_messages').insert({
      user_id: user?.id,
      work_order_id: woNumber,
      sender_email: user?.email ?? null,
      sender_name: 'FAJ Solutions',
      sender_role: 'admin',
      content,
    });
    await load();
    setSending(false);
  };

  if (!woNumber) {
    return <div style={{ color: '#aaa', fontSize: 13, textAlign: 'center', padding: '40px 0' }}>Save the work order first to start a conversation.</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div
        ref={listRef}
        style={{
          display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 360, minHeight: 200, overflowY: 'auto',
          padding: '12px 14px', background: '#f9fafb', borderRadius: 10, border: '1px solid #eee',
        }}
      >
        {messages.length === 0 && (
          <div style={{ fontSize: 12, color: '#bbb', textAlign: 'center', padding: '20px 0' }}>No messages yet. Say hello to the contractor.</div>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            style={{
              alignSelf: m.sender_role === 'admin' ? 'flex-end' : 'flex-start',
              maxWidth: '75%',
              background: m.sender_role === 'admin' ? '#0E1B2E' : 'white',
              color: m.sender_role === 'admin' ? 'white' : '#1a1a1a',
              border: m.sender_role === 'admin' ? 'none' : '1px solid #e5e7eb',
              borderRadius: 12,
              padding: '8px 12px',
            }}
          >
            {m.sender_role === 'contractor' && (
              <div style={{ fontSize: 10, fontWeight: 700, color: '#0E1B2E', marginBottom: 2 }}>{m.sender_name}</div>
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
          placeholder="Message the contractor..."
          className="input"
          style={{ flex: 1 }}
        />
        <button className="btn btn-primary" onClick={send} disabled={sending || !draft.trim()}>
          <Send size={13} /> Send
        </button>
      </div>
    </div>
  );
}
