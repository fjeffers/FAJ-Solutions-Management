'use client';
// Support inbox (Fred, 2026-10-03): email to support@fajsolutions.com becomes a
// ticket. The bot (lib/support-triage.ts) suggests a queue, pulls out the
// client, site and contact, and drafts a reply. Nothing moves until Fred acts:
// he picks the queue and the tech and presses Approve, which opens the New job
// form filled in - saving it creates the work order and sends that tech the
// usual assignment email. The reply stays a draft he copies and sends himself.
// Techs on hold can't be picked.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardCopy, ClipboardPaste, Inbox, Mail, RefreshCw, RotateCcw, Sparkles, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { SUPPORT_QUEUES, queueLabel, isSupportQueue, type SupportQueue } from '@/lib/support-queues';
import { toastError, toastInfo, toastSuccess } from '@/lib/toast';
import type { Contractor, WorkOrder } from '@/lib/types';
import { Dialog, Empty, Hero } from '@/components/wf/WfUi';
import { jobFromTicket, ticketSender as sender, ticketWhen as when, type SupportTicket } from '@/lib/support-job';

export type { SupportTicket };

const COLS = 'id, source, from_name, from_email, subject, body, received_at, suggested_queue, suggested_reason, summary, urgent, client_name, site, wo_number, contact_name, contact_phone, job_title, draft_reply, triage_error, status, final_queue, assigned_tech, wo_id, approved_at';

const QUEUE_COLOR: Record<SupportQueue, string> = {
  dispatch: '#1D4ED8', field_issue: '#B91C1C', billing: '#047857', new_work: '#7C3AED', needs_fred: '#B45309', not_a_ticket: '#6B7280',
};

type Tab = 'new' | 'approved' | 'dismissed';


export default function SupportView({ contractors, onMakeJob, onCount }: {
  contractors: Contractor[];
  onMakeJob: (prefill: Partial<WorkOrder>, ticketId: string) => void;
  onCount?: (n: number) => void;
}) {
  const [tickets, setTickets] = useState<SupportTicket[] | null>(null);
  const [tab, setTab] = useState<Tab>('new');
  const [pasteOpen, setPasteOpen] = useState(false);
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await createClient().from('support_tickets').select(COLS).order('received_at', { ascending: false }).limit(300);
    if (error) { toastError(`Couldn't load tickets: ${error.message}`); setTickets([]); return; }
    const rows = (data ?? []) as SupportTicket[];
    setTickets(rows);
    onCount?.(rows.filter((t) => t.status === 'new').length);
  }, [onCount]);
  useEffect(() => { void load(); }, [load]);

  const all = tickets ?? [];
  const shown = useMemo(() => {
    const rows = all.filter((t) => t.status === tab);
    // Waiting tickets: urgent first, then the bot's "not a ticket" pile last.
    if (tab === 'new') return [...rows].sort((a, b) =>
      Number(b.urgent) - Number(a.urgent)
      || Number(a.suggested_queue === 'not_a_ticket') - Number(b.suggested_queue === 'not_a_ticket')
      || b.received_at.localeCompare(a.received_at));
    return rows;
  }, [all, tab]);
  const waiting = all.filter((t) => t.status === 'new');

  const checkNow = async () => {
    setChecking(true);
    try {
      const res = await fetch('/api/import-queue/check-now', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toastError(data.error === 'Gmail not connected'
          ? 'Your Gmail isn’t connected yet, so the bot can’t read support@ on its own. Paste an email for now.'
          : (data.error || 'Check failed'));
      } else {
        toastSuccess(data.imported > 0 ? `Found ${data.imported} new item${data.imported === 1 ? '' : 's'}` : 'Nothing new in support@');
        await load();
      }
    } catch { toastError('Check failed. Try again.'); }
    finally { setChecking(false); }
  };

  return (
    <div className="wf" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Hero
        eyebrow="Support"
        title="Support inbox"
        stats={[
          { value: String(waiting.length), label: 'To approve', onClick: () => setTab('new') },
          { value: String(waiting.filter((t) => t.urgent).length), label: 'Urgent' },
          { value: String(all.filter((t) => t.status === 'approved' && !t.wo_id).length), label: 'Need a job made', onClick: () => setTab('approved') },
        ]}
        actions={<>
          <button className="wf-btn wf-btn-gold" onClick={() => setPasteOpen(true)}><ClipboardPaste size={17} /> Paste an email</button>
          <button className="wf-btn" onClick={() => void checkNow()} disabled={checking}
            style={{ background: 'rgba(255,255,255,0.14)', color: '#fff', borderColor: 'rgba(201,162,75,0.45)' }}>
            <RefreshCw size={16} className={checking ? 'spin' : undefined} /> {checking ? 'Checking…' : 'Check support@'}
          </button>
        </>}
      />

      <div className="wf-filters" role="tablist">
        {(['new', 'approved', 'dismissed'] as Tab[]).map((t) => (
          <button key={t} className="wf-filter" aria-pressed={tab === t} onClick={() => setTab(t)}>
            {t === 'new' ? 'To approve' : t === 'approved' ? 'Approved' : 'Dismissed'} ({all.filter((x) => x.status === t).length})
          </button>
        ))}
      </div>

      {tickets === null ? (
        <div className="wf-subtle">Loading…</div>
      ) : shown.length === 0 ? (
        <Empty icon={<Inbox size={28} />} title={tab === 'new' ? 'Nothing waiting' : 'Nothing here yet'}
          message={tab === 'new' ? 'New mail to support@ shows up here, sorted by the bot, for you to approve.' : undefined} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {shown.map((t) => <TicketCard key={t.id} t={t} contractors={contractors} onChanged={load} onMakeJob={onMakeJob} />)}
        </div>
      )}

      {pasteOpen && <PasteDialog onClose={() => setPasteOpen(false)} onFiled={async () => { setPasteOpen(false); setTab('new'); await load(); }} />}
    </div>
  );
}

function QueueChip({ q, label }: { q: SupportQueue | null; label?: string }) {
  const c = q ? QUEUE_COLOR[q] : QUEUE_COLOR.needs_fred;
  return <span className="wf-chip" style={{ color: c, background: `${c}1A` }}>{label ?? queueLabel(q)}</span>;
}

function TicketCard({ t, contractors, onChanged, onMakeJob }: {
  t: SupportTicket; contractors: Contractor[]; onChanged: () => Promise<void>;
  onMakeJob: (prefill: Partial<WorkOrder>, ticketId: string) => void;
}) {
  const [queue, setQueue] = useState<SupportQueue>(t.final_queue ?? t.suggested_queue ?? 'needs_fred');
  const [tech, setTech] = useState(t.assigned_tech ?? '');
  const [draft, setDraft] = useState(t.draft_reply ?? '');
  const [showEmail, setShowEmail] = useState(false);
  const [showDraft, setShowDraft] = useState(false);
  const [busy, setBusy] = useState(false);
  const db = createClient();
  const available = contractors.filter((c) => !c.on_hold).map((c) => c.name).sort((a, b) => a.localeCompare(b));
  const held = contractors.filter((c) => c.on_hold).map((c) => c.name).sort((a, b) => a.localeCompare(b));

  const update = async (patch: Partial<SupportTicket>, done?: string) => {
    setBusy(true);
    const { error } = await db.from('support_tickets').update(patch).eq('id', t.id);
    setBusy(false);
    if (error) { toastError(`Couldn't save: ${error.message}`); return false; }
    if (done) toastSuccess(done);
    await onChanged();
    return true;
  };

  const approve = async () => {
    if (!tech) { toastError('Pick the tech first.'); return; }
    if (contractors.find((c) => c.name === tech)?.on_hold) { toastError(`${tech} is on hold.`); return; }
    const ok = await update({ status: 'approved', final_queue: queue, assigned_tech: tech, approved_at: new Date().toISOString(), draft_reply: draft || null });
    if (ok) onMakeJob(jobFromTicket({ ...t, draft_reply: draft }, tech), t.id);
  };

  const sortAgain = async () => {
    setBusy(true);
    const res = await fetch('/api/support/retriage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: t.id }) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { toastError(data.error ?? "Couldn't sort it again."); return; }
    if (data.error) toastInfo('The bot still couldn’t sort it. It stays under Needs Fred.');
    else toastSuccess(`Sorted: ${queueLabel(data.queue)}`);
    if (isSupportQueue(data.queue)) setQueue(data.queue);
    await onChanged();
  };

  const copyReply = async () => {
    try { await navigator.clipboard.writeText(draft); toastSuccess('Reply copied. Paste it into your reply in Gmail.'); }
    catch { toastError('Couldn’t copy. Select the text and copy it yourself.'); }
  };

  const decided = t.status !== 'new';
  return (
    <div className="wf-card" style={{ padding: 16, borderLeft: `4px solid ${t.urgent && !decided ? 'var(--wf-danger)' : QUEUE_COLOR[(t.final_queue ?? t.suggested_queue ?? 'needs_fred') as SupportQueue]}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {decided ? <QueueChip q={t.final_queue} /> : <QueueChip q={t.suggested_queue} label={`Bot: ${queueLabel(t.suggested_queue)}`} />}
        {t.urgent && <span className="wf-chip" style={{ color: 'var(--wf-danger)', background: 'rgba(198,40,40,0.1)' }}>Urgent</span>}
        <span className="wf-subtle" style={{ fontSize: 12.5, flex: 1, minWidth: 0, textAlign: 'right' }}>
          {t.source === 'pasted' ? <><ClipboardPaste size={12} style={{ display: 'inline-block', verticalAlign: '-2px' }} /> pasted · </> : <><Mail size={12} style={{ display: 'inline-block', verticalAlign: '-2px' }} /> </>}
          {when(t.received_at)}
        </span>
      </div>
      <div style={{ fontWeight: 600, fontSize: 15.5, marginTop: 8 }}>{t.subject || '(no subject)'}</div>
      <div className="wf-subtle" style={{ fontSize: 13 }}>{sender(t)}{t.from_email && t.from_name ? ` · ${t.from_email}` : ''}</div>
      {t.summary && <div style={{ marginTop: 6, fontSize: 14 }}>{t.summary}</div>}
      {(t.client_name || t.site || t.wo_number || t.contact_phone) && (
        <div className="wf-subtle" style={{ fontSize: 12.5, marginTop: 4 }}>
          {[t.client_name, t.site, t.wo_number ? `mentions #${t.wo_number}` : '', t.contact_phone].filter(Boolean).join(' · ')}
        </div>
      )}
      {!decided && t.suggested_reason && (
        <div style={{ fontSize: 12.5, marginTop: 6, display: 'flex', gap: 6, color: 'var(--wf-subtle)' }}>
          <Sparkles size={13} style={{ flexShrink: 0, marginTop: 2 }} /> <span>{t.suggested_reason}</span>
        </div>
      )}
      {t.triage_error && !decided && (
        <div style={{ fontSize: 12.5, marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--wf-warning)' }}>
          <AlertTriangle size={14} /> The bot couldn&apos;t sort this one.
          <button className="wf-btn wf-btn-outline wf-btn-sm" disabled={busy} onClick={() => void sortAgain()}><RotateCcw size={14} /> Sort again</button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={() => setShowEmail((v) => !v)}>{showEmail ? 'Hide the email' : 'Read the email'}</button>
        {(draft || !decided) && t.suggested_queue !== 'not_a_ticket' && (
          <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={() => setShowDraft((v) => !v)}>{showDraft ? 'Hide the reply' : 'Draft reply'}</button>
        )}
      </div>
      {showEmail && (
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'inherit', fontSize: 13, background: '#F6F4EF', border: '1px solid var(--wf-line)', borderRadius: 10, padding: 12, marginTop: 8, maxHeight: 360, overflowY: 'auto' }}>
          {t.body}
        </pre>
      )}
      {showDraft && (
        <div style={{ marginTop: 8 }}>
          <textarea className="wf-input" rows={8} value={draft} onChange={(e) => setDraft(e.target.value)}
            onBlur={() => { if (draft !== (t.draft_reply ?? '')) void db.from('support_tickets').update({ draft_reply: draft || null }).eq('id', t.id); }}
            placeholder="Write the reply…" />
          <div className="wf-subtle" style={{ fontSize: 12, marginTop: 4 }}>Nothing is sent from here. Copy it into your reply in Gmail and send it yourself.</div>
          <button className="wf-btn wf-btn-outline wf-btn-sm" style={{ marginTop: 6 }} disabled={!draft.trim()} onClick={() => void copyReply()}><ClipboardCopy size={14} /> Copy reply</button>
        </div>
      )}

      {!decided ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, marginTop: 12, alignItems: 'end' }}>
          <label style={{ display: 'block' }}>
            <span className="wf-label" style={{ display: 'block', marginBottom: 4 }}>Queue</span>
            <select className="wf-input" value={queue} onChange={(e) => setQueue(e.target.value as SupportQueue)}>
              {SUPPORT_QUEUES.map((q) => <option key={q.key} value={q.key}>{q.label}</option>)}
            </select>
          </label>
          <label style={{ display: 'block' }}>
            <span className="wf-label" style={{ display: 'block', marginBottom: 4 }}>Tech</span>
            <select className="wf-input" value={tech} onChange={(e) => setTech(e.target.value)}>
              <option value="">Pick a tech…</option>
              {available.map((n) => <option key={n} value={n}>{n}</option>)}
              {held.length > 0 && <optgroup label="On hold">{held.map((n) => <option key={n} value={n} disabled>{n} (on hold)</option>)}</optgroup>}
            </select>
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="wf-btn wf-btn-navy wf-btn-sm" style={{ flex: 1 }} disabled={busy || !tech} onClick={() => void approve()}
              title="Approve and open the job, filled in. Saving it sends the tech the assignment email.">
              <CheckCircle2 size={15} /> Approve
            </button>
            <button className="wf-btn wf-btn-ghost wf-btn-sm" disabled={busy}
              onClick={() => void update({ status: 'dismissed', final_queue: 'not_a_ticket', draft_reply: draft || null }, 'Dismissed.')}
              title="Not a ticket: no job, no email">
              <X size={15} /> Dismiss
            </button>
          </div>
        </div>
      ) : t.status === 'approved' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap', fontSize: 13 }}>
          <CheckCircle2 size={15} color="var(--wf-success)" />
          <span>Approved{t.approved_at ? ` ${when(t.approved_at)}` : ''} · {t.assigned_tech ?? 'no tech'}</span>
          {t.wo_id
            ? <span className="wf-chip" style={{ color: 'var(--wf-success)', background: 'rgba(46,125,50,0.1)' }}>Job made</span>
            : <button className="wf-btn wf-btn-outline wf-btn-sm" disabled={!t.assigned_tech} onClick={() => onMakeJob(jobFromTicket(t, t.assigned_tech ?? ''), t.id)}>Make the job</button>}
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 13 }}>
          <span className="wf-subtle">Dismissed.</span>
          <button className="wf-btn wf-btn-ghost wf-btn-sm" disabled={busy} onClick={() => void update({ status: 'new', final_queue: null }, 'Back in To approve.')}>
            <RotateCcw size={14} /> Restore
          </button>
        </div>
      )}
    </div>
  );
}

function PasteDialog({ onClose, onFiled }: { onClose: () => void; onFiled: () => Promise<void> }) {
  const [raw, setRaw] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/support/from-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ raw }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toastError(data.error ?? "Couldn't make the ticket."); return; }
      toastSuccess(data.ticket ? `Ticket made: ${queueLabel(data.ticket.queue)}` : 'That email is already a ticket.');
      await onFiled();
    } catch { toastError("Couldn't make the ticket. Check your connection."); }
    finally { setBusy(false); }
  };
  return (
    <Dialog title="Paste an email" wide onClose={onClose} footer={<>
      <button className="wf-btn wf-btn-ghost" onClick={onClose}>Cancel</button>
      <button className="wf-btn wf-btn-navy" disabled={busy || !raw.trim()} onClick={() => void send()}>
        <Sparkles size={16} /> {busy ? 'Sorting…' : 'Make the ticket'}
      </button>
    </>}>
      <div className="wf-subtle" style={{ fontSize: 13, marginBottom: 8 }}>
        Paste the whole email, including the From and Subject lines if you have them. The bot sorts it and drafts a reply; nothing is sent.
      </div>
      <textarea className="wf-input" rows={12} value={raw} onChange={(e) => setRaw(e.target.value)} placeholder={'From: Dana Ruiz <dana@example.com>\nSubject: Drive-thru headsets down\n\nHi Fred, …'} />
    </Dialog>
  );
}
