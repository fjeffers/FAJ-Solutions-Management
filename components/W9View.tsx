'use client';
import { useEffect, useState } from 'react';
import { CheckCircle, XCircle, Mail, Edit2, FileCheck2, Upload } from 'lucide-react';
import type { Contractor } from '@/lib/types';

export default function W9View({ contractors, onEdit }: { contractors: Contractor[]; onEdit: (c: Contractor) => void }) {
  const received = contractors.filter((c) => c.w9_received);
  const missing = contractors.filter((c) => !c.w9_received);
  const [companyW9, setCompanyW9] = useState<{ onFile: boolean; url: string | null }>({ onFile: false, url: null });
  const [clientEmail, setClientEmail] = useState('');
  const [companyMsg, setCompanyMsg] = useState('');
  const [shareUrl, setShareUrl] = useState('');
  const [busy, setBusy] = useState(false);

  const loadCompanyW9 = () => fetch('/api/owner/company-w9').then((r) => r.json()).then((data) => setCompanyW9(data)).catch(() => {});
  useEffect(() => { void loadCompanyW9(); }, []);

  const uploadCompanyW9 = async (file?: File) => {
    if (!file || busy) return;
    setBusy(true);
    setCompanyMsg('Saving securely…');
    setShareUrl('');
    try {
      const form = new FormData();
      form.set('file', file);
      const response = await fetch('/api/owner/company-w9', { method: 'POST', body: form });
      const body = await response.json().catch(() => ({}));
      setCompanyMsg(response.ok ? 'Company W-9 saved.' : body.error ?? 'Could not save the W-9.');
      if (response.ok) void loadCompanyW9();
    } catch {
      setCompanyMsg('Could not reach the server. Try the upload again.');
    } finally {
      setBusy(false);
    }
  };

  const sendCompanyW9 = async () => {
    if (!clientEmail.trim() || busy) return;
    setBusy(true);
    setCompanyMsg('Sending secure link…');
    setShareUrl('');
    try {
      const response = await fetch('/api/owner/company-w9', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: clientEmail }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok) {
        setClientEmail('');
        setCompanyMsg('W-9 sent. The secure link expires in 7 days.');
      } else if (body.url) {
        const copied = await navigator.clipboard.writeText(body.url).then(() => true, () => false);
        setShareUrl(body.url);
        setCompanyMsg(copied ? `${body.error} Secure link copied instead.` : `${body.error} Use the secure link below.`);
      } else {
        setCompanyMsg(body.error ?? 'Could not send the W-9.');
      }
    } catch {
      setCompanyMsg('Could not reach the server. Try sending again.');
    } finally {
      setBusy(false);
    }
  };

  const sendRequest = (c: Contractor) => {
    const email = c.email || '';
    const subject = encodeURIComponent('W-9 Request — FAJ Solutions');
    const body = encodeURIComponent(
      `Hi ${c.name},\n\nPlease complete and return a W-9 form at your earliest convenience.\n\nYou can download the blank W-9 form here:\nhttps://www.irs.gov/pub/irs-pdf/fw9.pdf\n\nPlease return the completed form to fajsolutions@gmail.com.\n\nThank you,\nFAJ Solutions`
    );
    window.open(`mailto:${email}?subject=${subject}&body=${body}`, '_blank');
  };

  return (
    <div className="view-inner" style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ marginBottom: 28 }}>
        <div className="display" style={{ fontSize: 11, color: 'var(--teal)', letterSpacing: 3, marginBottom: 6 }}>COMPLIANCE</div>
        <h1 className="serif" style={{ fontSize: 36, fontWeight: 600, margin: 0, lineHeight: 1 }}>W-9 Manager</h1>
        <p style={{ margin: '6px 0 0', color: '#666', fontSize: 14 }}>Track W-9 status and send requests to contractors</p>
      </div>

      <div className="glass card" style={{ marginBottom: 24, borderLeft: `3px solid ${companyW9.onFile ? '#047857' : '#b45309'}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <FileCheck2 size={22} color={companyW9.onFile ? '#047857' : '#b45309'} />
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontWeight: 800 }}>FAJ Solutions company W-9</div>
            <div style={{ fontSize: 12, color: '#777' }}>{companyW9.onFile ? 'Stored privately and ready to send to clients.' : 'Upload the completed company W-9 PDF once, then reuse it.'}</div>
          </div>
          {companyW9.url && <a className="btn btn-ghost" href={companyW9.url} target="_blank" rel="noreferrer">Open</a>}
          <label className="btn btn-primary" style={{ cursor: busy ? 'wait' : 'pointer' }}><Upload size={13} /> {companyW9.onFile ? 'Replace' : 'Upload PDF'}<input type="file" accept="application/pdf" hidden disabled={busy} onChange={(e) => { const file = e.target.files?.[0]; e.currentTarget.value = ''; void uploadCompanyW9(file); }} /></label>
        </div>
        {companyW9.onFile && (
          <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
            <input className="input" type="email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} placeholder="client@example.com" style={{ flex: 1, minWidth: 220 }} />
            <button className="btn btn-primary" disabled={busy || !clientEmail.trim()} onClick={() => void sendCompanyW9()}><Mail size={13} /> Send secure W-9</button>
          </div>
        )}
        {companyMsg && <div style={{ marginTop: 10, fontSize: 12, fontWeight: 650 }}>{companyMsg}</div>}
        {shareUrl && <a className="btn btn-ghost" style={{ marginTop: 10 }} href={shareUrl} target="_blank" rel="noreferrer">Open secure link</a>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
        <div className="glass card" style={{ textAlign: 'center' }}>
          <div className="stat-label">Total Contractors</div>
          <div className="stat-value">{contractors.length}</div>
        </div>
        <div className="glass card" style={{ textAlign: 'center', background: 'rgba(16,185,129,0.06)' }}>
          <div className="stat-label">W-9 On File</div>
          <div className="stat-value" style={{ color: '#047857' }}>{received.length}</div>
        </div>
        <div className="glass card" style={{ textAlign: 'center', background: missing.length > 0 ? 'rgba(239,68,68,0.06)' : undefined }}>
          <div className="stat-label">W-9 Missing</div>
          <div className="stat-value" style={{ color: missing.length > 0 ? '#b91c1c' : '#047857' }}>{missing.length}</div>
        </div>
      </div>

      {missing.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1.5, color: '#b91c1c', textTransform: 'uppercase', marginBottom: 12 }}>Missing W-9</div>
          <div style={{ display: 'grid', gap: 10 }}>
            {missing.map((c) => (
              <div key={c.id} className="glass card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, borderLeft: '3px solid #b91c1c' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <XCircle size={20} color="#b91c1c" />
                  <div>
                    <div style={{ fontWeight: 700 }}>{c.name}</div>
                    <div style={{ fontSize: 12, color: '#888' }}>{c.email || 'No email on file'}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {c.email && <button className="btn btn-ghost" style={{ padding: '6px 12px', fontSize: 11 }} onClick={() => sendRequest(c)}><Mail size={12} /> Request W-9</button>}
                  <button className="btn btn-primary" style={{ padding: '6px 12px', fontSize: 11 }} onClick={() => onEdit(c)}><Edit2 size={12} /> Enter W-9</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {received.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1.5, color: '#047857', textTransform: 'uppercase', marginBottom: 12 }}>W-9 On File</div>
          <div style={{ display: 'grid', gap: 10 }}>
            {received.map((c) => (
              <div key={c.id} className="glass card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, borderLeft: '3px solid #047857' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <CheckCircle size={20} color="#047857" />
                  <div>
                    <div style={{ fontWeight: 700 }}>{c.name}</div>
                    <div style={{ fontSize: 12, color: '#888' }}>
                      {c.tax_id ? `${c.tax_id_type}: ${c.tax_id}` : 'Tax ID not entered'}
                      {c.entity_type ? ` · ${c.entity_type}` : ''}
                    </div>
                  </div>
                </div>
                <button className="icon-btn" onClick={() => onEdit(c)}><Edit2 size={15} /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {contractors.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: '#aaa' }}>No contractors yet — add one to get started</div>
      )}
    </div>
  );
}
