'use client';
// One inbox on Home: unread tech and client messages, new job emails, and work orders waiting in Import
// (lib/one-inbox.ts). A message opens its job and counts as read; the rest open their screen.
import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Inbox, Mail, MessageSquare, FileDown, User } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { whenShort, type InboxMessage } from '@/lib/messages-inbox';
import { KIND_LABEL, oneInbox, type InboxImport, type InboxTicket, type OneItem } from '@/lib/one-inbox';

const ICON = { tech: MessageSquare, client: User, email: Mail, import: FileDown } as const;
const SHOW = 6;

export default function OneInbox({ jobs, imports, onOpenJob, onGo, onTechRead }: {
  jobs: { id: string; wo_number: string }[];
  imports: InboxImport[];
  onOpenJob: (woId: string) => void;
  onGo: (view: string) => void;
  /** Tech messages just marked read, for the number on the left menu. */
  onTechRead: (n: number) => void;
}) {
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [tickets, setTickets] = useState<InboxTicket[]>([]);
  const [all, setAll] = useState(false);
  useEffect(() => {
    const db = createClient();
    const load = async () => {
      // A month back: older unread messages were dealt with some other way.
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const [m, t] = await Promise.all([
        db.from('work_order_messages').select('id, work_order_id, sender_name, sender_role, content, read_at, created_at')
          .in('sender_role', ['contractor', 'client']).is('read_at', null).gte('created_at', since).order('created_at', { ascending: false }).limit(300),
        db.from('support_tickets').select('id, from_name, from_email, subject, summary, received_at, urgent')
          .eq('status', 'new').order('received_at', { ascending: false }).limit(100),
      ]);
      if (!m.error) setMessages((m.data ?? []) as InboxMessage[]);
      if (!t.error) setTickets((t.data ?? []) as InboxTicket[]);
    };
    const first = setTimeout(() => void load(), 0);
    const channel = db.channel('home-one-inbox')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_order_messages' }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_tickets' }, () => { void load(); })
      .subscribe();
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => { clearTimeout(first); window.removeEventListener('focus', onFocus); void db.removeChannel(channel); };
  }, []);
  const byNumber = useMemo(() => new Map(jobs.map((j) => [j.wo_number, j.id])), [jobs]);
  const items = useMemo(() => oneInbox({ messages, tickets, imports, jobs: byNumber }), [messages, tickets, imports, byNumber]);

  const open = (i: OneItem) => {
    if (i.kind !== 'tech' && i.kind !== 'client') { onGo(i.view); return; }
    const wo = messages.find((m) => `m:${m.id}` === i.key)?.work_order_id;
    const read = messages.filter((m) => m.work_order_id === wo && m.sender_role === (i.kind === 'client' ? 'client' : 'contractor'));
    if (read.length) {
      const ids = new Set(read.map((m) => m.id));
      setMessages((ms) => ms.filter((m) => !ids.has(m.id)));
      void createClient().from('work_order_messages').update({ read_at: new Date().toISOString() }).in('id', [...ids])
        .then(({ error }) => { if (!error && i.kind === 'tech') onTechRead(read.length); });
    }
    if (i.woId) onOpenJob(i.woId); else onGo('messages');
  };

  if (items.length === 0) return null;
  const shown = all ? items : items.slice(0, SHOW);
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
        <h2 className="serif" style={{ fontSize: 21, fontWeight: 600, margin: 0, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Inbox size={19} /> Inbox <span style={{ fontSize: 13, fontWeight: 400, color: '#8a8578' }}>({items.length})</span>
        </h2>
        {items.length > SHOW && (
          <button className="wf-btn wf-btn-outline wf-btn-sm" onClick={() => setAll((v) => !v)}>
            {all ? 'Show less' : `Show all ${items.length}`}
          </button>
        )}
      </div>
      <div style={{ display: 'grid', gap: 7 }}>
        {shown.map((i) => {
          const Icon = ICON[i.kind];
          return (
            <button key={i.key} onClick={() => open(i)} style={{
              display: 'flex', alignItems: 'center', gap: 11, textAlign: 'left', cursor: 'pointer', padding: '11px 14px',
              borderRadius: 13, background: 'white', border: `1px solid ${i.urgent ? 'rgba(185,28,28,0.35)' : '#eae5d8'}`,
              boxShadow: '0 1px 6px rgba(0,0,0,0.03)',
            }}>
              <span style={{ width: 32, height: 32, borderRadius: 9, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(14,27,46,0.08)' }}>
                <Icon size={16} color={i.urgent ? '#B91C1C' : 'var(--teal)'} />
              </span>
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 13.5, fontWeight: 700 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.who}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#8a8578', flexShrink: 0 }}>{KIND_LABEL[i.kind]}{i.urgent ? ' · Urgent' : ''} · {whenShort(i.at)}</span>
                </span>
                <span style={{ display: 'block', fontSize: 12.5, color: '#555', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.text}</span>
              </span>
              <ChevronRight size={16} color="#c9c3b4" style={{ flexShrink: 0 }} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
