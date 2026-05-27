'use client';
import { CheckCircle, XCircle, Mail, Edit2 } from 'lucide-react';
import type { Contractor } from '@/lib/types';

export default function W9View({ contractors, onEdit }: { contractors: Contractor[]; onEdit: (c: Contractor) => void }) {
  const received = contractors.filter((c) => c.w9_received);
  const missing = contractors.filter((c) => !c.w9_received);

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
