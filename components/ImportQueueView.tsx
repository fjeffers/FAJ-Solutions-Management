'use client';
import { useState } from 'react';
import { Mail, CheckCircle2, XCircle, Inbox, LinkIcon, Sheet, Upload, RefreshCw, ClipboardPaste } from 'lucide-react';
import { fmtDate, fmtMoney } from '@/lib/utils';
import { toastError, toastSuccess } from '@/lib/toast';
import type { ImportQueueItem, GmailConnection } from '@/lib/types';
import ScheduleUpload from './ScheduleUpload';

const SOURCE_LABELS: Record<string, string> = {
  netview_smartsheet: 'Netview/Smartsheet',
  field_nation: 'FieldNation',
  google_sheets: 'Google Sheets',
  google_docs: 'Google Docs',
  client_schedule: "Client's weekly schedule",
};

export default function ImportQueueView({
  items,
  connection,
  onApprove,
  onReject,
  onImported,
}: {
  items: ImportQueueItem[];
  connection: GmailConnection | null;
  onApprove: (id: string, opts?: { silent?: boolean }) => Promise<boolean | void>;
  onReject: (id: string) => Promise<void>;
  onImported?: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sheetUrl, setSheetUrl] = useState('');
  const [pastedEmail, setPastedEmail] = useState('');
  const [pasting, setPasting] = useState(false);
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  const [importing, setImporting] = useState(false);
  const [checking, setChecking] = useState(false);
  const pending = items.filter((i) => i.status === 'pending');
  const reviewed = items.filter((i) => i.status !== 'pending').slice(0, 20);
  const approvedCount = items.filter((i) => i.status === 'approved').length;
  const rejectedCount = items.filter((i) => i.status === 'rejected').length;
  const pendingValue = pending.reduce((s, i) => s + Number(i.parsed_fields.total_amount ?? 0), 0);

  const act = async (id: string, fn: (id: string) => Promise<boolean | void>) => {
    setBusyId(id);
    try { await fn(id); } finally { setBusyId(null); }
  };

  const checkNow = async () => {
    setChecking(true);
    try {
      const res = await fetch('/api/import-queue/check-now', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toastError(data.error || 'Check failed');
      } else {
        toastSuccess(data.imported > 0 ? `Found ${data.imported} new work order${data.imported === 1 ? '' : 's'}` : 'No new work orders — you\'re caught up');
        onImported?.();
      }
    } catch {
      toastError('Check failed — try again');
    } finally {
      setChecking(false);
    }
  };

  // Paste an email (or drop the .eml) — the manual door into the same queue,
  // for while the Gmail connection is unavailable.
  const importEmail = async (payload: { raw?: string; file?: File }) => {
    setPasting(true);
    try {
      let res: Response;
      if (payload.file) {
        const fd = new FormData();
        fd.append('file', payload.file);
        res = await fetch('/api/import-queue/from-email', { method: 'POST', body: fd });
      } else {
        res = await fetch('/api/import-queue/from-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ raw: payload.raw ?? '' }),
        });
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toastError(data.error || 'Could not read that email');
        return;
      }
      // One email routinely covers many sites, so report the count — and say
      // plainly when some were already queued rather than implying all landed.
      const { found = 0, added = 0, duplicates = 0 } = data;
      if (added === 0) {
        toastSuccess(`All ${found} already in the queue — nothing added`);
      } else {
        const site = added === 1 ? 'site' : 'sites';
        toastSuccess(
          `${added} ${site} added for review`
          + (duplicates ? ` (${duplicates} already queued)` : '')
          + (data.matched === 'generic' ? ' — check the details before approving' : ''),
        );
      }
      setPastedEmail('');
      onImported?.();
    } catch {
      toastError('Could not read that email');
    } finally {
      setPasting(false);
    }
  };

  // Approve every queued job, one at a time.
  //
  // Sequential on purpose: each approval reads the highest existing work order
  // number to pick the next one, so running these in parallel would hand the
  // same number to several jobs. A go-back list is routinely 18 sites, which is
  // 18 clicks otherwise.
  const approveAll = async () => {
    const queue = [...pending];
    if (queue.length === 0) return;
    if (!confirm(`Create ${queue.length} work order${queue.length === 1 ? '' : 's'}?

Each one also opens a site visit at that address.`)) return;

    setBulk({ done: 0, total: queue.length });
    const failed: string[] = [];
    for (const [i, item] of queue.entries()) {
      // silent: one toast and one refresh at the end, not per job.
      const ok = await onApprove(item.id, { silent: true }).catch(() => false);
      if (!ok) {
        failed.push(item.parsed_fields.title || item.parsed_fields.client_reference || 'a job');
      }
      setBulk({ done: i + 1, total: queue.length });
    }
    setBulk(null);

    const made = queue.length - failed.length;
    if (failed.length === 0) {
      toastSuccess(`Created ${made} work order${made === 1 ? '' : 's'}`);
    } else {
      // Name what didn't land rather than reporting a clean success.
      toastError(`Created ${made} of ${queue.length} — ${failed.length} failed: ${failed.slice(0, 3).join(', ')}`);
    }
    onImported?.();
  };

  const importSheet = async () => {
    if (!sheetUrl.trim()) return;
    setImporting(true);
    try {
      const res = await fetch('/api/import-queue/from-sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: sheetUrl.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toastError(data.error || 'Import failed');
      } else {
        toastSuccess(
          data.imported > 0
            ? `Imported ${data.imported} row${data.imported === 1 ? '' : 's'} for review${data.skipped ? ` (${data.skipped} already imported)` : ''}`
            : 'Everything in that file was already imported',
        );
        setSheetUrl('');
        onImported?.();
      }
    } catch {
      toastError('Import failed — check your connection');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="view-inner" style={{ maxWidth: 900, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <div className="display" style={{ fontSize: 11, color: 'var(--teal)', letterSpacing: 3, marginBottom: 6 }}>IMPORT</div>
        <h1 className="serif" style={{ fontSize: 36, fontWeight: 600, margin: 0, lineHeight: 1 }}>Imports</h1>
        <p style={{ margin: '6px 0 0', color: '#666', fontSize: 14 }}>Dispatch emails (Netview + FieldNation routed jobs), Google Sheets, and Google Docs — parsed and queued for your review</p>
      </div>

      {/* At-a-glance import stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'Pending Review', value: String(pending.length), color: pending.length > 0 ? '#b45309' : '#047857' },
          { label: 'Pending Value', value: pendingValue > 0 ? fmtMoney(pendingValue) : '—', color: 'var(--teal)' },
          { label: 'Approved → WOs', value: String(approvedCount), color: '#047857' },
          { label: 'Rejected', value: String(rejectedCount), color: '#6b7280' },
        ].map((t) => (
          <div key={t.label} className="glass card" style={{ padding: '12px 16px' }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: '#999' }}>{t.label}</div>
            <div style={{ fontSize: 21, fontWeight: 800, color: t.color, fontVariantNumeric: 'tabular-nums' }}>{t.value}</div>
          </div>
        ))}
      </div>

      <div className="glass card" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Mail size={18} color={connection ? '#047857' : '#aaa'} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 13 }}>
              {connection ? `Connected as ${connection.connected_email}` : 'Gmail not connected'}
            </div>
            <div style={{ fontSize: 11, color: '#999' }}>
              {connection
                ? connection.last_polled_at ? `Last checked ${fmtDate(connection.last_polled_at)}` : 'Not checked yet'
                : 'Connect Gmail to automatically import Netview + FieldNation dispatch emails'}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {connection && (
            <button
              className="btn btn-ghost"
              onClick={checkNow}
              disabled={checking}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              title="Automatic checks only run once a day on your current plan — click this for an on-demand check"
            >
              <RefreshCw size={13} className={checking ? 'spin' : ''} /> {checking ? 'Checking…' : 'Check Now'}
            </button>
          )}
          <a href="/api/integrations/gmail/connect" className="btn btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
            <LinkIcon size={13} /> {connection ? 'Reconnect' : 'Connect Gmail'}
          </a>
        </div>
      </div>

      <ScheduleUpload onApprove={onApprove} onImported={onImported} />

      <div className="glass card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <ClipboardPaste size={18} color="#0E1B2E" />
          <div style={{ fontWeight: 700, fontSize: 13 }}>Paste an email</div>
        </div>
        <div style={{ fontSize: 11, color: '#999', marginBottom: 10, lineHeight: 1.5 }}>
          Copy the whole email — headers and all — and paste it here, or drop in a saved
          .eml file. Netview and FieldNation dispatches are read automatically; anything
          else gets whatever can be found (site ID, ticket number, date) and you fill in
          the rest. Nothing becomes a work order until you approve it below.
        </div>
        <textarea
          className="input"
          value={pastedEmail}
          onChange={(e) => setPastedEmail(e.target.value)}
          placeholder={`From: dispatch@…
Subject: NETVIEW DISPATCH FOR …

Site ID: 9531
Ticket Number: FLN5092
…`}
          rows={5}
          style={{ width: '100%', fontSize: 12.5, fontFamily: 'ui-monospace, monospace', marginBottom: 8 }}
        />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            className="btn btn-primary"
            onClick={() => importEmail({ raw: pastedEmail })}
            disabled={pasting || !pastedEmail.trim()}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, opacity: pasting || !pastedEmail.trim() ? 0.6 : 1 }}
          >
            <Upload size={13} /> {pasting ? 'Reading…' : 'Add for review'}
          </button>
          <label className="btn btn-ghost" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <Mail size={13} /> Upload .eml
            <input
              type="file"
              accept=".eml,.txt,.msg,message/rfc822,text/plain"
              disabled={pasting}
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importEmail({ file: f });
                e.target.value = '';
              }}
            />
          </label>
        </div>
      </div>

      <div className="glass card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <Sheet size={18} color="#047857" />
          <div style={{ fontWeight: 700, fontSize: 13 }}>Import from Google Sheets or Docs</div>
        </div>
        <div style={{ fontSize: 11, color: '#999', marginBottom: 10, lineHeight: 1.5 }}>
          Paste a share link (set to &quot;Anyone with the link can view&quot;). Sheet columns like Title, Customer,
          Description, Date, Work Order, Site ID, and Amount are recognized automatically; each row lands below
          for your approval. A Doc comes in as a single work order draft.
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            className="input"
            value={sheetUrl}
            onChange={(e) => setSheetUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') importSheet(); }}
            placeholder="https://docs.google.com/spreadsheets/d/…"
            style={{ flex: 1, minWidth: 220, fontSize: 13 }}
          />
          <button
            className="btn btn-primary"
            onClick={importSheet}
            disabled={importing || !sheetUrl.trim()}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, opacity: importing || !sheetUrl.trim() ? 0.6 : 1 }}
          >
            <Upload size={13} /> {importing ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>

      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#888', letterSpacing: 0.5, textTransform: 'uppercase' }}>
          Pending Review ({pending.length})
        </div>
        <div style={{ flex: 1 }} />
        {pending.length > 1 && (
          <button
            className="btn btn-primary"
            onClick={approveAll}
            disabled={bulk !== null || busyId !== null}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, opacity: bulk ? 0.7 : 1 }}
          >
            <CheckCircle2 size={13} />
            {bulk ? `Creating ${bulk.done} of ${bulk.total}…` : `Approve all ${pending.length}`}
          </button>
        )}
      </div>

      {pending.length === 0 ? (
        <div className="glass card" style={{ textAlign: 'center', padding: '48px 24px', color: '#aaa', marginBottom: 24 }}>
          <Inbox size={26} color="#ddd" style={{ marginBottom: 8 }} />
          <div>Nothing waiting for review.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
          {pending.map((item) => (
            <div key={item.id} className="glass card">
              <div style={{ fontSize: 11, color: '#999', marginBottom: 6 }}>
                {fmtDate(item.created_at)} · {SOURCE_LABELS[item.source] ?? item.source}
              </div>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{item.parsed_fields.title}</div>
              <div style={{ fontSize: 13, color: '#555', marginBottom: 8, whiteSpace: 'pre-line' }}>{item.parsed_fields.description}</div>
              <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#888', marginBottom: 12, flexWrap: 'wrap' }}>
                <span>Customer: <strong>{item.parsed_fields.customer_name || '—'}</strong></span>
                <span>Site ID: <strong>{item.parsed_fields.client_reference || '—'}</strong></span>
                <span>Ticket: <strong>{item.parsed_fields.external_wo_id || '—'}</strong></span>
                {item.parsed_fields.start_date && <span>Date: <strong>{item.parsed_fields.start_date}</strong></span>}
                {typeof item.parsed_fields.total_amount === 'number' && item.parsed_fields.total_amount > 0 && (
                  <span>Amount: <strong>{fmtMoney(item.parsed_fields.total_amount)}</strong></span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn btn-primary"
                  disabled={busyId === item.id}
                  onClick={() => act(item.id, onApprove)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  <CheckCircle2 size={13} /> Approve &amp; Create WO
                </button>
                <button
                  className="btn btn-ghost"
                  disabled={busyId === item.id}
                  onClick={() => act(item.id, onReject)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#b91c1c' }}
                >
                  <XCircle size={13} /> Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {reviewed.length > 0 && (
        <>
          <div style={{ marginBottom: 12, fontSize: 11, fontWeight: 700, color: '#888', letterSpacing: 0.5, textTransform: 'uppercase' }}>
            Recently Reviewed
          </div>
          <div className="glass card" style={{ padding: 0, overflow: 'hidden' }}>
            {reviewed.map((item) => (
              <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: '1px solid #f5f5f5', fontSize: 13, flexWrap: 'wrap' }}>
                <span style={{ flex: 1, minWidth: 180 }}>
                  <b>{item.parsed_fields.title}</b>
                  <span style={{ color: '#999', fontSize: 12 }}>
                    {item.parsed_fields.customer_name ? ` · ${item.parsed_fields.customer_name}` : ''}
                    {item.parsed_fields.client_reference ? ` · Site ${item.parsed_fields.client_reference}` : ''}
                    {` · ${fmtDate(item.created_at)}`}
                  </span>
                </span>
                {typeof item.parsed_fields.total_amount === 'number' && item.parsed_fields.total_amount > 0 && (
                  <span style={{ fontWeight: 700, fontSize: 12 }}>{fmtMoney(item.parsed_fields.total_amount)}</span>
                )}
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '2px 9px', borderRadius: 20,
                  background: item.status === 'approved' ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
                  color: item.status === 'approved' ? '#047857' : '#b91c1c',
                }}>
                  {item.status}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
