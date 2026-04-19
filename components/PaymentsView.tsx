'use client';
import { useState } from 'react';
import { Plus, Search, Edit2, Trash2 } from 'lucide-react';
import { fmtMoney, fmtDate } from '@/lib/utils';
import type { Payment, WorkOrder } from '@/lib/types';

export default function PaymentsView({ payments, workOrders, onAdd, onEdit, onDelete }: { payments: Payment[]; workOrders: WorkOrder[]; onAdd: () => void; onEdit: (p: Payment) => void; onDelete: (id: string) => void }) {
  const [search, setSearch] = useState('');
  const [methodFilter, setMethodFilter] = useState('all');
  const methods = ['all', ...Array.from(new Set(payments.map((p) => p.method)))];
  const filtered = payments.filter((p) => {
    const s = search.toLowerCase();
    const matchSearch = p.contractor_name.toLowerCase().includes(s) || p.wo_number.includes(s) || (p.notes ?? '').toLowerCase().includes(s);
    const matchMethod = methodFilter === 'all' || p.method === methodFilter;
    return matchSearch && matchMethod;
  });
  const totalShown = filtered.reduce((s, p) => s + Number(p.amount), 0);

  return (
    <div>
      <div style={{ marginBottom: 28 }}>
        <div className="display" style={{ fontSize: 11, color: 'var(--teal)', letterSpacing: 3, marginBottom: 6 }}>PAYMENTS</div>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 className="serif" style={{ fontSize: 36, fontWeight: 600, margin: 0, lineHeight: 1 }}>Payments</h1>
            <p style={{ margin: '6px 0 0', color: '#666', fontSize: 14 }}>{payments.length} payments · {fmtMoney(payments.reduce((s, p) => s + Number(p.amount), 0))} total</p>
          </div>
          <button className="btn btn-primary" onClick={onAdd}><Plus size={14} /> Log Payment</button>
        </div>
      </div>
      <div className="glass card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: '1 1 200px' }}>
            <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#aaa' }} />
            <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search payments..." style={{ paddingLeft: 36 }} />
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {methods.map((m) => (
              <button key={m} className={`filter-chip ${methodFilter === m ? 'active' : ''}`} onClick={() => setMethodFilter(m)}>{m === 'all' ? 'All Methods' : m}</button>
            ))}
          </div>
        </div>
      </div>
      <div className="glass card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="print-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'rgba(13,115,119,0.05)', borderBottom: '1px solid rgba(13,115,119,0.1)' }}>
              {['Date', 'Contractor', 'WO #', 'Method', 'Notes', 'Amount', ''].map((h, i) => (
                <th key={h + i} style={{ padding: '12px 16px', textAlign: i === 5 ? 'right' : 'left', fontSize: 10, fontWeight: 700, letterSpacing: 1, color: '#888', textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((p, idx) => (
              <tr key={p.id} style={{ borderBottom: '1px solid #f5f5f5', background: idx % 2 === 1 ? '#fafafa' : undefined }}>
                <td style={{ padding: '14px 16px', color: '#555' }}>{fmtDate(p.payment_date)}</td>
                <td style={{ padding: '14px 16px', fontWeight: 600 }}>{p.contractor_name}</td>
                <td style={{ padding: '14px 16px', fontWeight: 700, color: 'var(--teal)' }}>#{p.wo_number}</td>
                <td style={{ padding: '14px 16px' }}>
                  <span style={{ padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: p.method === 'Zelle' ? 'rgba(107,45,139,0.12)' : 'rgba(13,115,119,0.08)', color: p.method === 'Zelle' ? '#6B2D8B' : 'var(--teal)' }}>{p.method}</span>
                </td>
                <td style={{ padding: '14px 16px', color: '#888', fontSize: 12 }}>{p.notes || '—'}</td>
                <td style={{ padding: '14px 16px', textAlign: 'right', fontWeight: 700, color: '#047857' }}>{fmtMoney(Number(p.amount))}</td>
                <td style={{ padding: '14px 16px' }}>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="icon-btn" onClick={() => onEdit(p)}><Edit2 size={14} /></button>
                    <button className="icon-btn" style={{ color: '#b91c1c' }} onClick={() => { if (confirm('Delete this payment?')) onDelete(p.id); }}><Trash2 size={14} /></button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length > 0 && (
              <tr style={{ background: 'rgba(16,185,129,0.06)', fontWeight: 700, borderTop: '2px solid rgba(16,185,129,0.2)' }}>
                <td colSpan={5} style={{ padding: '12px 16px', textAlign: 'right', fontSize: 12, color: '#555' }}>TOTAL SHOWN</td>
                <td style={{ padding: '12px 16px', textAlign: 'right', color: '#047857', fontSize: 15 }}>{fmtMoney(totalShown)}</td>
                <td />
              </tr>
            )}
            {filtered.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', padding: '32px', color: '#aaa' }}>No payments found</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
