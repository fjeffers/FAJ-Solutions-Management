'use client';
import { useEffect, useRef, useState } from 'react';
import { Send, MessageSquare, ChevronLeft, Loader2, Building2, Users } from 'lucide-react';
import { fetchTechMessages, sendTechMessage, jobLocation } from '@/lib/tech-portal';
import { toastError } from '@/lib/toast';
import TechDirectChat from '@/components/TechDirectChat';
import type { TechJob, TechMessage } from '@/lib/types';

/**
 * A tech messaging the office about a job.
 *
 * Threads are per work order and shared with the token portal, so a message
 * sent here and one sent from an emailed portal link are the same conversation
 * — the office does not end up with two places to look.
 *
 * Only active jobs are listed: once a job is approved or paid it is closed, and
 * a closed job is not a thing to still be arranging.
 */
export default function TechChat({ jobs, onRead }: { jobs: TechJob[]; onRead: () => void }) {
  const [mode, setMode] = useState<'office' | 'techs'>('office');
  const [openJob, setOpenJob] = useState<TechJob | null>(null);

  return (
    <div>
      <div style={{ display: 'flex', gap: 4, background: '#f4f1ea', borderRadius: 999, padding: 3, marginBottom: 16 }}>
        <ModeBtn active={mode === 'office'} onClick={() => { setMode('office'); setOpenJob(null); }}
          icon={<Building2 size={13} />} label="Job messages" />
        <ModeBtn active={mode === 'techs'} onClick={() => setMode('techs')}
          icon={<Users size={13} />} label="Other techs" />
      </div>
      {mode === 'techs'
        ? <TechDirectChat onRead={onRead} />
        : <OfficeChat jobs={jobs} openJob={openJob} setOpenJob={setOpenJob} />}
    </div>
  );
}

function ModeBtn({ active, onClick, icon, label }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        padding: '8px 12px', borderRadius: 999, border: 'none', cursor: 'pointer',
        fontSize: 12.5, fontWeight: 700,
        background: active ? 'white' : 'transparent',
        color: active ? 'var(--teal)' : '#8a8578',
        boxShadow: active ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
      }}
    >{icon} {label}</button>
  );
}

function OfficeChat({ jobs, openJob, setOpenJob }: {
  jobs: TechJob[];
  openJob: TechJob | null;
  setOpenJob: (j: TechJob | null) => void;
}) {
  if (jobs.length === 0) {
    return (
      <div className="glass card" style={{ textAlign: 'center', padding: '30px 20px', color: '#aaa', fontSize: 13 }}>
        <MessageSquare size={22} color="#ddd" style={{ marginBottom: 7 }} />
        <div>No active jobs to message about.</div>
        <div style={{ fontSize: 12, marginTop: 5 }}>A thread opens for each job you&apos;re assigned.</div>
      </div>
    );
  }

  if (openJob) return <Thread job={openJob} onBack={() => setOpenJob(null)} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      {jobs.map((j) => (
        <button
          key={j.id} onClick={() => setOpenJob(j)}
          className="glass card"
          style={{
            padding: 14, textAlign: 'left', cursor: 'pointer', border: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>
              {j.title || j.customer_name || `WO ${j.wo_number}`}
            </div>
            <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
              WO {j.wo_number}{jobLocation(j) ? ` · ${jobLocation(j)}` : ''}
            </div>
          </div>
          <MessageSquare size={16} color="var(--teal)" style={{ flexShrink: 0 }} />
        </button>
      ))}
    </div>
  );
}

function Thread({ job, onBack }: { job: TechJob; onBack: () => void }) {
  const [messages, setMessages] = useState<TechMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  const load = async () => {
    try {
      setMessages(await fetchTechMessages(job.wo_number ?? ''));
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Couldn't load messages");
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.wo_number]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const send = async () => {
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    try {
      const ok = await sendTechMessage(job.wo_number ?? '', body);
      if (ok) { setDraft(''); await load(); }
      else toastError("Couldn't send that message.");
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Couldn't send that message");
    }
    setSending(false);
  };

  return (
    <div>
      <button
        onClick={onBack}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--teal)', fontSize: 13, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5, marginBottom: 12, padding: 0 }}
      ><ChevronLeft size={15} /> All jobs</button>

      <div className="glass card" style={{ padding: '12px 14px', marginBottom: 12 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{job.title || job.customer_name}</div>
        <div style={{ fontSize: 12, color: '#888' }}>WO {job.wo_number}</div>
      </div>

      <div style={{
        display: 'flex', flexDirection: 'column', gap: 9,
        maxHeight: '48vh', overflowY: 'auto', paddingRight: 3, marginBottom: 12,
      }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: '#aaa', fontSize: 13, padding: 20 }}>
            <Loader2 size={18} /> Loading…
          </div>
        ) : messages.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#aaa', fontSize: 13, padding: '20px 10px' }}>
            No messages yet. Ask anything about this job here.
          </div>
        ) : (
          messages.map((m) => {
            const mine = m.sender_role === 'contractor';
            return (
              <div key={m.id} style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
                <div style={{
                  maxWidth: '82%', padding: '9px 13px', borderRadius: 14,
                  background: mine ? 'var(--teal)' : 'white',
                  color: mine ? 'white' : '#333',
                  border: mine ? 'none' : '1px solid #e8e5dd',
                  fontSize: 13.5, lineHeight: 1.5,
                }}>
                  {!mine && (
                    <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.6, color: 'var(--teal)', marginBottom: 3, textTransform: 'uppercase' }}>
                      {m.sender_name}
                    </div>
                  )}
                  <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>
                  <div style={{ fontSize: 9.5, opacity: 0.6, marginTop: 4, textAlign: 'right' }}>
                    {new Date(m.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottom} />
      </div>

      <div style={{ display: 'flex', gap: 7, alignItems: 'flex-end' }}>
        <textarea
          className="input" rows={2} value={draft} placeholder="Write a message…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          style={{ flex: 1, resize: 'none' }}
        />
        <button
          className="btn btn-primary" onClick={send} disabled={sending || !draft.trim()}
          style={{ flexShrink: 0, padding: '11px 15px' }}
        ><Send size={15} /></button>
      </div>
    </div>
  );
}
