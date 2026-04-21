'use client';
import { useState } from 'react';
import { Plus, Search, Edit2, Trash2, FileText, CheckCircle, XCircle, Send } from 'lucide-react';
import { fmtMoney } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import type { Contractor, EnrichedWorkOrder } from '@/lib/types';

export default function ContractorsView({ contractors, workOrders, onAdd, onEdit, onDelete, onViewStatement }: {
  contractors: Contractor[]; workOrders: EnrichedWorkOrder[];
  onAdd: () => void; onEdit: (c: Contractor) => void; onDelete: (id: string) => void; onViewStatement: (name: string) => void;
}) {
  const supabase = createClient();
  const [search, setSearch] = useState('');
  const [inviting, setInviting] = useState<string | null>(null);
  const [inviteSent, setInviteSent] = useState<string | null>(null);
  const filtered = contractors.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()));

  const handleInvite = async (c: Contractor) => {
    if (!c.email) { alert('This contractor has no email on file. Add their email first.'); return; }
    setInviting(c.id);
    const origin = window.location.origin;
    const { error } = await supabase.auth.signInWithOtp({
      email: c.email,
      options: { emailRedirectTo: `${origin}/contractor` },
    });
    setInviting(null);
    if (error) { alert(`Failed to send invite: ${error.message}`); return; }
    setInviteSent(c.id);
    setTimeout(() => setInviteSent(null), 4000);
  };

  return (
    <div>
      <div style={{ marginBottom: 28 }}>
        <div className="display" style={{ fontSize: 11, color: 'var(--teal)', letterSpacing: 3, marginBottom: 6 }}>DIRECTORY</div>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 className="serif" style={{ fontSize: 36, fontWeight: 600, margin: 0, lineHeight: 1 }}>Contractors</h1>
            <p style={{ margin: '6px 0 0', color: '#666', fontSize: 14 }}>{contractors.length} contractor{contractors.length !== 1 ? 's' : ''} on file</p>
          </div>
          <button className="btn btn-primary" onClick={onAdd}><Plus size={14} /> Add Contractor</button>
        </div>
      </div>
      <div className="glass card" style={{ marginBottom: 20 }}>
        <div style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#aaa' }} />
          <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search contractors..." style={{ paddingLeft: 36 }} />
        </div>
      </div>
      <div style={{ display: 'grid', gap: 12 }}>
        {filtered.map((c) => {
          const jobs = workOrders.filter((w) => w.contractor_name === c.name);
          const totalBilled = jobs.reduce((s, j) => s + Number(j.total_amount), 0);
          const totalPaid = jobs.reduce((s, j) => s + j.paid, 0);
          return (
            <div key={c.id} className="glass card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, flex: 1 }}>
                <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'linear-gradient(135deg, var(--teal) 0%, var(--teal-dark) 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: 18, fontFamily: "'Cormorant Garamond', serif", flexShrink: 0 }}>
                  {c.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>{c.name}</div>
                  {c.business_name && <div style={{ fontSize: 12, color: '#888' }}>{c.business_name}</div>}
                  <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                    {c.phone && <span style={{ fontSize: 12, color: '#666' }}>{c.phone}</span>}
                    {c.email && <span style={{ fontSize: 12, color: '#666' }}>{c.email}</span>}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: '#aaa', fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>Jobs</div>
                  <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--teal)' }}>{jobs.length}</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: '#aaa', fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>Billed</div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{fmtMoney(totalBilled)}</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: '#aaa', fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>Paid</div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: '#047857' }}>{fmtMoney(totalPaid)}</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: '#aaa', fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>W-9</div>
                  {c.w9_received ? <CheckCircle size={18} color="#047857" /> : <XCircle size={18} color="#b91c1c" />}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-ghost" style={{ padding: '6px 12px', fontSize: 11 }} onClick={() => onViewStatement(c.name)}><FileText size={12} /> Statement</button>
                  <button
                    className="btn btn-ghost"
                    style={{ padding: '6px 12px', fontSize: 11, color: inviteSent === c.id ? '#047857' : undefined }}
                    onClick={() => handleInvite(c)}
                    disabled={inviting === c.id}
                    title={c.email ? `Send portal invite to ${c.email}` : 'No email on file'}
                  >
                    <Send size={12} />
                    {inviting === c.id ? 'Sending...' : inviteSent === c.id ? '✓ Sent!' : 'Invite'}
                  </button>
                  <button className="icon-btn" onClick={() => onEdit(c)}><Edit2 size={15} /></button>
                  <button className="icon-btn" style={{ color: '#b91c1c' }} onClick={() => { if (confirm(`Delete ${c.name}?`)) onDelete(c.id); }}><Trash2 size={15} /></button>
                </div>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && <div style={{ textAlign: 'center', padding: '40px 0', color: '#aaa' }}>No contractors found</div>}
      </div>
    </div>
  );
}