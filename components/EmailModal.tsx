'use client';
import { useState } from 'react';
import { X, Send, CheckCircle2, Loader2, Mail } from 'lucide-react';

export type EmailType = 'work_order' | 'payment_confirmation' | 'w9_request' | 'accountant_summary';
export type EmailPayload = {
  type: EmailType;
  to: string;
  subject: string;
  data: Record<string, unknown>;
};

export default function EmailModal({ payload, onClose }: { payload: EmailPayload; onClose: () => void }) {
  const [to, setTo] = useState(payload.to);
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState(payload.subject);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSend = async () => {
    const recipients = to.split(',').map((e) => e.trim()).filter(Boolean);
    if (!recipients.length) { setError('Please enter at least one email address.'); return; }
    setSending(true);
    setError(null);

    const dataWithNote = note.trim() ? { ...payload.data, note: note.trim() } : payload.data;
    const ccList = cc.split(',').map((e) => e.trim()).filter(Boolean);

    try {
      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: payload.type,
          to: recipients.join(','),
          subject,
          data: dataWithNote,
          cc: ccList.length ? ccList : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error ?? 'Send failed');
      setSent(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to send email');
    } finally {
      setSending(false);
    }
  };

  const titleMap: Record<EmailType, string> = {
    work_order: 'Send Work Order',
    payment_confirmation: 'Send Payment Confirmation',
    w9_request: 'Send W-9 Request',
    accountant_summary: 'Send Accountant Summary',
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <div className="display" style={{ fontSize: 10, color: 'var(--teal)', letterSpacing: 2, marginBottom: 4 }}>SEND EMAIL</div>
            <h2 className="serif" style={{ fontSize: 22, margin: 0, fontWeight: 600 }}>{titleMap[payload.type]}</h2>
          </div>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>

        {sent ? (
          <div style={{ textAlign: 'center', padding: '32px 0' }}>
            <CheckCircle2 size={44} color="var(--teal)" style={{ marginBottom: 12 }} />
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--teal)' }}>Email Sent!</div>
            <p style={{ fontSize: 13, color: '#666', marginTop: 8 }}>The email was sent to {to}</p>
            <button className="btn btn-primary" onClick={onClose} style={{ marginTop: 20 }}>Close</button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <EF label="To *" icon={<Mail size={13} />}>
              <input className="input" value={to} onChange={(e) => setTo(e.target.value)} placeholder="contractor@email.com" />
            </EF>
            <EF label="CC (optional — comma separated)">
              <input className="input" value={cc} onChange={(e) => setCc(e.target.value)} placeholder="admin@example.com, ops@example.com" />
            </EF>
            <EF label="Subject">
              <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} />
            </EF>
            {(payload.type === 'work_order' || payload.type === 'w9_request') && (
              <EF label="Note (optional)">
                <textarea
                  className="input"
                  rows={3}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Any additional message to include in the email…"
                />
              </EF>
            )}
            {error && (
              <div style={{ fontSize: 12, color: '#b91c1c', padding: '8px 12px', background: 'rgba(239,68,68,0.08)', borderRadius: 8 }}>
                {error}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 8, borderTop: '1px solid #eee' }}>
              <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={handleSend}
                disabled={sending || !to.trim()}
                style={{ opacity: sending || !to.trim() ? 0.6 : 1 }}
              >
                {sending
                  ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Sending…</>
                  : <><Send size={14} /> Send Email</>}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function EF({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <label style={{
        display: 'flex', alignItems: 'center', gap: 5,
        fontSize: 11, fontWeight: 700, color: '#555',
        marginBottom: 6, letterSpacing: 0.5, textTransform: 'uppercase',
      }}>
        {icon}{label}
      </label>
      {children}
    </div>
  );
}
