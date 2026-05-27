'use client';
import { useState } from 'react';
import { Plus, Search, Edit2, Trash2, CheckCircle, XCircle, ChevronRight } from 'lucide-react';
import { fmtMoney } from '@/lib/utils';
import type { Contractor, EnrichedWorkOrder, Payment } from '@/lib/types';
import ContractorDetailView from './ContractorDetailView';

export default function ContractorsView({
  contractors, workOrders, payments, onAdd, onEdit, onDelete, onViewStatement, onAddJob, onAddPayment, onEditPayment,
}: {
  contractors: Contractor[];
  workOrders: EnrichedWorkOrder[];
  payments: Payment[];
  onAdd: () => void;
  onEdit: (c: Contractor) => void;
  onDelete: (id: string) => void;
  onViewStatement: (name: string) => void;
  onAddJob: (prefill?: { contractor_name: string }) => void;
  onAddPayment: (prefill?: { contractor_name: string; wo_number?: string }) => void;
  onEditPayment: (p: Payment) => void;
}) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Contractor | null>(null);

  const filtered = contractors.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()));

  if (selected) {
    return (
      <ContractorDetailView
        contractor={selected}
        workOrders={workOrders}
        payments={payments}
        onBack={() => setSelected(null)}
        onAddJob={(prefill) => { setSelected(null); onAddJob(prefill); }}
        onAddPayment={(prefill) => { setSelected(null); onAddPayment(prefill); }}
        onEditPayment={(p) => { setSelected(null); onEditPayment(p); }}
      />
    );
  }

  return (
    <div className="view-inner" style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ marginBottom: 28 }}>
        <div className="display" style={{ fontSize: 11, color: 'var(--teal)', letterSpacing: 3, marginBottom: 6 }}>DIRECTORY</div>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 className="serif" style={{ fontSize: 36, fontWeight: 600, margin: 0, lineHeight: 1 }}>Contractors</h1>
            <p style={{ margin: '6px 0 0', color: '#666', fontSize: 14 }}>{contractors.length} contractor{contractors.length !== 1 ? 's' : ''} — click a card to view details</p>
          </div>
          <button className="btn btn-primary" onClick={onAdd}><Plus size={15} /> Add Contractor</button>
        </div>
      </div>

      <div style={{ position: 'relative', marginBottom: 20, maxWidth: 360 }}>
        <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#aaa' }} />
        <input className="input" style={{ paddingLeft: 36 }} placeholder="Search contractors…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {filtered.map((c) => {
          const jobs = workOrders.filter((w) => w.contractor_name === c.name);
          const totalBilled = jobs.reduce((s, w) => s + Number(w.total_amount), 0);
          const totalPaid = payments.filter((p) => p.contractor_name === c.name).reduce((s, p) => s + Number(p.amount), 0);
          const balance = totalBilled - totalPaid;
          return (
            <div key={c.id} className="glass card" style={{ cursor: 'pointer', transition: 'box-shadow 0.15s, transform 0.12s', border: '1px solid #e8ecf0' }}
              onClick={() => setSelected(c)}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 18px rgba(13,115,119,0.12)'; (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = ''; (e.currentTarget as HTMLElement).style.transform = ''; }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(13,115,119,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 800, color: 'var(--teal)', flexShrink: 0 }}>
                      {c.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 16 }}>{c.name}</div>
                      {c.business_name && <div style={{ fontSize: 12, color: '#888', marginTop: 1 }}>{c.business_name}</div>}
                    </div>
                  </div>
                  {(c.phone || c.email) && (
                    <div style={{ display: 'flex', gap: 16, marginTop: 8, marginLeft: 50 }}>
                      {c.phone && <span style={{ fontSize: 12, color: '#888' }}>{c.phone}</span>}
                      {c.email && <span style={{ fontSize: 12, color: '#888' }}>{c.email}</span>}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Stat label="Jobs" value={String(jobs.length)} color="var(--teal)" />
                  <Stat label="Billed" value={fmtMoney(totalBilled)} />
                  <Stat label="Paid" value={fmtMoney(totalPaid)} color="#047857" />
                  <Stat label="Balance" value={fmtMoney(balance)} color={balance > 0 ? '#b91c1c' : '#047857'} />
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 11, color: '#aaa', fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 2 }}>W-9</div>
                    {c.w9_received ? <CheckCircle size={18} color="#047857" /> : <XCircle size={18} color="#b91c1c" />}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
                  <button className="icon-btn" onClick={() => onEdit(c)}><Edit2 size={14} /></button>
                  <button className="icon-btn" style={{ color: '#b91c1c' }}
                    onClick={() => { if (confirm('Delete ' + c.name + '?')) onDelete(c.id); }}>
                    <Trash2 size={14} />
                  </button>
                  <ChevronRight size={16} color="#ccc" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="glass card" style={{ textAlign: 'center', padding: '48px 24px', color: '#aaa' }}>
          {search ? 'No contractors match your search.' : 'No contractors yet — add your first one.'}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 11, color: '#aaa', fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: color ?? '#1a1a1a' }}>{value}</div>
    </div>
  );
}
