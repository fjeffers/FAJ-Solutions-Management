'use client';
// The owner's Messages screen (Fred, 2026-10-05: "add message under
// scheduled"): every conversation with techs in one place, newest first, with
// a reply box — the same thread the tech sees in their portal and on the job
// page. Techs messaging each other are under "Between techs", read-only.
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ChevronRight, MessageSquare, MessageSquarePlus, Users } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import WorkOrderChatPanel from '@/components/WorkOrderChatPanel';
import { PrimioBar } from '@/components/wf/PrimioScreens';
import { Empty } from '@/components/wf/WfUi';
import {
  buildDmThreads, buildJobThreads, fromTech, unreadFromTechs, whenShort,
  type InboxJob, type InboxMessage, type TechDm,
} from '@/lib/messages-inbox';
import type { Contractor, WorkOrder } from '@/lib/types';

type Tab = 'jobs' | 'techs';

export default function MessagesView({ workOrders, contractors, onOpenJob, onCount }: {
  workOrders: WorkOrder[];
  contractors: Contractor[];
  onOpenJob: (id: string) => void;
  /** Tech messages not yet read — the number on the left menu. */
  onCount: (n: number) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [tab, setTab] = useState<Tab>('jobs');
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [dms, setDms] = useState<TechDm[]>([]);
  const [loading, setLoading] = useState(true);
  const [openWo, setOpenWo] = useState<string | null>(null);
  const [openDm, setOpenDm] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  const jobs: InboxJob[] = useMemo(() => workOrders.map((w) => ({
    id: w.id, wo_number: w.wo_number, title: w.title ?? null, archived: !!w.archived_at,
    techs: (w.contractor_names?.length ? w.contractor_names : [w.contractor_name]).filter((n): n is string => !!n && !!n.trim()),
  })), [workOrders]);
  const threads = useMemo(() => buildJobThreads(messages, jobs), [messages, jobs]);
  const nameOf = useMemo(() => {
    const m = new Map(contractors.map((c) => [c.id, c.name]));
    return (id: string) => m.get(id) ?? 'A tech';
  }, [contractors]);
  const dmThreads = useMemo(() => buildDmThreads(dms, nameOf), [dms, nameOf]);

  const load = async () => {
    const [m, d] = await Promise.all([
      supabase.from('work_order_messages')
        .select('id, work_order_id, sender_name, sender_role, content, read_at, created_at')
        .order('created_at', { ascending: false }).limit(2000),
      supabase.from('contractor_messages')
        .select('id, from_id, to_id, content, created_at')
        .order('created_at', { ascending: false }).limit(2000),
    ]);
    const list = (m.data ?? []) as InboxMessage[];
    setMessages(list);
    setDms((d.data ?? []) as TechDm[]);
    onCount(unreadFromTechs(list));
    setLoading(false);
  };

  useEffect(() => {
    void load();
    const channel = supabase
      .channel('owner-messages-inbox')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'work_order_messages' }, () => { void load(); })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'contractor_messages' }, () => { void load(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once; the channel keeps it current
  }, []);

  // Opening a job's thread marks the tech's messages in it as read.
  useEffect(() => {
    if (!openWo) return;
    const waiting = messages.filter((m) => m.work_order_id === openWo && fromTech(m) && !m.read_at);
    if (waiting.length === 0) return;
    const now = new Date().toISOString();
    void supabase.from('work_order_messages').update({ read_at: now })
      .in('id', waiting.map((m) => m.id))
      .then(({ error }) => {
        if (error) return;
        const ids = new Set(waiting.map((m) => m.id));
        const next = messages.map((m) => (ids.has(m.id) ? { ...m, read_at: now } : m));
        setMessages(next);
        onCount(unreadFromTechs(next));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openWo, messages]);

  const unread = unreadFromTechs(messages);
  const thread = threads.find((t) => t.woNumber === openWo) ?? null;
  const openJob = thread?.job ?? jobs.find((j) => j.wo_number === openWo) ?? null;
  const dm = dmThreads.find((t) => t.key === openDm) ?? null;
  const showingThread = tab === 'jobs' ? !!openWo : !!dm;

  // Jobs Fred can start a conversation on: open ones with a tech, newest first.
  const startable = jobs.filter((j) => !j.archived && j.techs.length > 0)
    .sort((a, b) => b.wo_number.localeCompare(a.wo_number));

  const rowStyle = (active: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '12px 14px', border: 'none',
    borderTop: '1px solid var(--wf-line)', background: active ? 'rgba(201,162,75,0.12)' : 'transparent',
    font: 'inherit', color: 'inherit', textAlign: 'left', cursor: 'pointer',
  });

  const list = tab === 'jobs' ? (
    threads.length === 0 ? (
      <Empty icon={<MessageSquare size={28} />} title="No messages yet"
        message="When a tech writes about a job, it shows here. To start one, press New message." />
    ) : threads.map((t) => {
      const who = fromTech(t.last) ? t.last.sender_name : 'You';
      return (
        <button key={t.woNumber} style={rowStyle(t.woNumber === openWo)} onClick={() => { setOpenWo(t.woNumber); setPicking(false); }}>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
              <span className="wf-p-title" style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: t.unread ? 800 : 600 }}>
                #{t.woNumber}{t.job?.title ? ` · ${t.job.title}` : ''}
              </span>
              <span className="wf-p-small wf-subtle" style={{ flexShrink: 0 }}>{whenShort(t.last.created_at)}</span>
            </span>
            <span className="wf-p-small" style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: t.unread ? 'var(--wf-text)' : 'var(--wf-subtle)' }}>
              <strong>{who}:</strong> {t.last.content}
            </span>
          </span>
          {t.unread > 0 && (
            <span style={{ background: 'var(--wf-gold)', color: 'var(--wf-gold-ink)', borderRadius: 999, fontSize: 11, fontWeight: 800, padding: '1px 8px' }}>{t.unread}</span>
          )}
          <ChevronRight size={18} color="var(--wf-subtle)" />
        </button>
      );
    })
  ) : (
    dmThreads.length === 0 ? (
      <Empty icon={<Users size={28} />} title="No messages between techs"
        message="When techs message each other in their portal, you can read it here." />
    ) : dmThreads.map((t) => (
      <button key={t.key} style={rowStyle(t.key === openDm)} onClick={() => setOpenDm(t.key)}>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
            <span className="wf-p-title" style={{ flex: 1, minWidth: 0 }}>{t.names[0]} &amp; {t.names[1]}</span>
            <span className="wf-p-small wf-subtle">{whenShort(t.last.created_at)}</span>
          </span>
          <span className="wf-p-small wf-subtle" style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            <strong>{nameOf(t.last.from_id)}:</strong> {t.last.content}
          </span>
        </span>
        <ChevronRight size={18} color="var(--wf-subtle)" />
      </button>
    ))
  );

  const back = (
    <button className="wf-btn wf-btn-ghost wf-btn-sm wf-msg-back" onClick={() => { setOpenWo(null); setOpenDm(null); }}>
      <ArrowLeft size={16} /> All messages
    </button>
  );

  const threadPane = tab === 'jobs' ? (
    openWo ? (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 14 }}>
        {back}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="wf-p-title">#{openWo}{openJob?.title ? ` · ${openJob.title}` : ''}</div>
            <div className="wf-p-small wf-subtle">
              {openJob ? (openJob.techs.length ? openJob.techs.join(', ') : 'No tech on this job yet') : 'This job is no longer in the app'}
            </div>
          </div>
          {openJob && (
            <button className="wf-btn wf-btn-outline wf-btn-sm" onClick={() => onOpenJob(openJob.id)}>Open job <ChevronRight size={15} /></button>
          )}
        </div>
        <WorkOrderChatPanel woNumber={openWo} />
      </div>
    ) : (
      <div className="wf-msg-placeholder"><Empty icon={<MessageSquare size={28} />} title="Pick a conversation" message="Or press New message to write to the tech on any job." /></div>
    )
  ) : dm ? (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 14 }}>
      {back}
      <div>
        <div className="wf-p-title">{dm.names[0]} &amp; {dm.names[1]}</div>
        <div className="wf-p-small wf-subtle">Between techs. You can read it; only they can write here. Their portal tells them you can see it.</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 420, overflowY: 'auto', padding: '12px 14px', background: '#f9fafb', borderRadius: 10, border: '1px solid #eee' }}>
        {dm.messages.map((m) => (
          <div key={m.id} style={{ alignSelf: m.from_id === dm.messages[0].from_id ? 'flex-start' : 'flex-end', maxWidth: '75%', background: 'white', border: '1px solid #e5e7eb', borderRadius: 12, padding: '8px 12px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#0E1B2E', marginBottom: 2 }}>{nameOf(m.from_id)}</div>
            <div style={{ fontSize: 13, lineHeight: 1.4, whiteSpace: 'pre-line' }}>{m.content}</div>
            <div style={{ fontSize: 9, opacity: 0.7, marginTop: 3, textAlign: 'right' }}>{new Date(m.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
          </div>
        ))}
      </div>
    </div>
  ) : (
    <div className="wf-msg-placeholder"><Empty icon={<Users size={28} />} title="Pick a conversation" /></div>
  );

  return (
    <div className="wf" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PrimioBar title="Messages" right={
        <button className="wf-btn wf-btn-gold wf-btn-sm" onClick={() => { setTab('jobs'); setOpenWo(null); setPicking(true); }}>
          <MessageSquarePlus size={16} /> New message
        </button>
      } />

      <div style={{ display: 'flex', gap: 4, background: 'var(--wf-card)', border: '1px solid var(--wf-line)', borderRadius: 999, padding: 3, alignSelf: 'flex-start' }}>
        {(['jobs', 'techs'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} aria-pressed={tab === t}
            style={{ border: 'none', borderRadius: 999, padding: '7px 14px', font: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer',
              background: tab === t ? 'var(--wf-navy)' : 'transparent', color: tab === t ? 'white' : 'var(--wf-text)' }}>
            {t === 'jobs' ? <>With techs{unread > 0 ? ` (${unread})` : ''}</> : 'Between techs'}
          </button>
        ))}
      </div>

      {picking && tab === 'jobs' && (
        <div className="wf-card" style={{ padding: 14, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <label htmlFor="msg-new-job" className="wf-p-title" style={{ flexShrink: 0 }}>Message the tech on</label>
          <select id="msg-new-job" className="wf-input" defaultValue="" style={{ flex: '1 1 260px' }}
            onChange={(e) => { if (e.target.value) { setOpenWo(e.target.value); setPicking(false); } }}>
            <option value="" disabled>Pick a job…</option>
            {startable.map((j) => (
              <option key={j.id} value={j.wo_number}>#{j.wo_number}{j.title ? ` · ${j.title}` : ''} — {j.techs.join(', ')}</option>
            ))}
          </select>
          <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={() => setPicking(false)}>Cancel</button>
          {startable.length === 0 && <div className="wf-p-small wf-subtle" style={{ width: '100%' }}>No open job has a tech on it yet.</div>}
        </div>
      )}

      {loading ? (
        <div className="wf-p-small wf-subtle" style={{ padding: 20 }}>Loading messages…</div>
      ) : (
        <div className={`wf-msg-grid ${showingThread ? 'wf-msg-open' : ''}`}>
          <section className="wf-card wf-msg-list" style={{ overflow: 'hidden', alignSelf: 'start' }}>{list}</section>
          <section className="wf-card wf-msg-thread" style={{ overflow: 'hidden', alignSelf: 'start' }}>{threadPane}</section>
        </div>
      )}
    </div>
  );
}
