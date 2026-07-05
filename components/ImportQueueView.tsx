'use client';
import { useState } from 'react';
import { Mail, CheckCircle2, XCircle, Inbox, LinkIcon, Sheet, Upload } from 'lucide-react';
import { fmtDate, fmtMoney } from '@/lib/utils';
import { toastError, toastSuccess } from '@/lib/toast';
import type { ImportQueueItem, GmailConnection } from '@/lib/types';

const SOURCE_LABELS: Record<string, string> = {
  netview_smartsheet: 'Netview/Smartsheet',
  google_sheets: 'Google Sheets',
  google_docs: 'Google Docs',
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
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
  onImported?: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sheetUrl, setSheetUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const pending = items.filter((i) => i.status === 'pending');
  const reviewed = items.filter((i) => i.status !== 'pending').slice(0, 20);

  const act = async (id: string, fn: (id: string) => Promise<void>) => {
    setBusyId(id);
    try { await fn(id); } finally { setBusyId(null); }
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
        <p style={{ margin: '6px 0 0', color: '#666', fontSize: 14 }}>Dispatch emails, Google Sheets, and Google Docs — parsed and queued for your review</p>
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
                : 'Connect Gmail to automatically import Netview dispatch emails'}
            </div>
          </div>
        </div>
        <a href="/api/integrations/gmail/connect" className="btn btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
          <LinkIcon size={13} /> {connection ? 'Reconnect' : 'Connect Gmail'}
        </a>
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

      <div style={{ marginBottom: 12, fontSize: 11, fontWeight: 700, color: '#888', letterSpacing: 0.5, textTransform: 'uppercase' }}>
        Pending Review ({pending.length})
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
              <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', borderBottom: '1px solid #f5f5f5', fontSize: 13 }}>
                <span>{item.parsed_fields.title}</span>
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
