'use client';
import { useState } from 'react';
import { Plus, Search, Edit2, Trash2, ChevronDown } from 'lucide-react';
import { fmtMoney, fmtDate, sortByWO } from '@/lib/utils';
import type { EnrichedWorkOrder } from '@/lib/types';

type Stats = { total: number; paid: number; remaining: number; paidCount: number; partialCount: number; pendingCount: number; jobCount: number };

export default function WorkOrdersView({ workOrders, stats, onAdd, onEdit, onDelete }: { workOrders: EnrichedWorkOrder[]; stats: Stats; onAdd: () => void; onEdit: (w: EnrichedWorkOrder) => void; onDelete: (id: string) => void }) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'paid' | 'partial' | 'pending'>('all');
  const sorted = sortByWO(workOrders);
  const filtered = sorted.filter((w) => {
    const matchSearch = w.wo_number.includes(search) || w.contractor_name.toLowerCase().includes(search.toLowerCase()) || (w.description ?? '').toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || w.status === statusFilter;
    return matchSearch && matchStatus;
  });

  return (
    <div>
      <div style={{ marginBottom: 28 }}>
        <div className="display" style={{ fontSize: 11, color: 'var(--teal)', letterSpacing: 3, marginBottom: 6 }}>WORK ORDERS</div>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 className="serif" style={{ fontSize: 36, fontWeight: 600, margin: 0, lineHeight: 1 }}>Work Orders</h1>
            <p style={{ margin: '6px 0 0', color: '#666', fontSize: 14 }}>{stats.jobCount} jobs · {fmtMoney(stats.remaining)} outstanding</p>
          </div>
          <button className="btn btn-primary" onClick={onAdd}><Plus size={14} /> Add Work Order</button>
        </div>
      </div>
      <div className="glass card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: '1 1 200px' }}>
            <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#aaa' }} />
            <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search work orders..." style={{ paddingLeft: 36 }} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['all', 'paid', 'partial', 'pending'] as const).map((s) => (
              <button key={s} className={`filter-chip ${statusFilter === s ? 'active' : ''}`} onClick={() => setStatusFilter(s)}>{s.charAt(0).toUpperCase() + s.slice(1)}</button>
            ))}
          </div>
        </div>
      </div>
      <div className="glass card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="print-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'rgba(13,115,119,0.05)', borderBottom: '1px solid rgba(13,115,119,0.1)' }}>
              {['WO #', 'Contractor', 'Description', 'Start', 'End', 'Amount', 'Paid', 'Remaining', 'Status', ''].map((h, i) => (
                <th key={h + i} style={{ padding: '12px 16px', textAlign: i >= 5 && i <= 7 ? 'right' : 'left', fontSize: 10, fontWeight: 700, letterSpacing: 1, color: '#888', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((w) => (
              <tr key={w.id} className="row-hover" style={{ borderBottom: '1px solid #f5f5f5' }}>
                <td style={{ padding: '14px 16px', fontWeight: 700, color: 'var(--teal)' }}>{w.wo_number}</td>
                <td style={{ padding: '14px 16px', fontWeight: 600 }}>{w.contractor_name}</td>
                <td style={{ padding: '14px 16px', color: '#666', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.description || '—'}</td>
                <td style={{ padding: '14px 16px', color: '#888', fontSize: 12 }}>{fmtDate(w.start_date)}</td>
                <td style={{ padding: '14px 16px', color: '#888', fontSize: 12 }}>{fmtDate(w.end_date)}</td>
                <td style={{ padding: '14px 16px', textAlign: 'right', fontWeight: 600 }}>{fmtMoney(Number(w.total_amount))}</td>
                <td style={{ padding: '14px 16px', textAlign: 'right', color: '#047857', fontWeight: 600 }}>{fmtMoney(w.paid)}</td>
                <td style={{ padding: '14px 16px', textAlign: 'right', color: w.remaining > 0 ? '#b91c1c' : '#047857', fontWeight: 600 }}>{fmtMoney(w.remaining)}</td>
                <td style={{ padding: '14px 16px' }}><span className={`chip chip-${w.status}`} style={{ fontSize: 10 }}>{w.status}</span></td>
                <td style={{ padding: '14px 16px' }}>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="icon-btn" onClick={() => onEdit(w)}><Edit2 size={14} /></button>
                    <button className="icon-btn" style={{ color: '#b91c1c' }} onClick={() => { if (confirm('Delete this work order?')) onDelete(w.id); }}><Trash2 size={14} /></button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={10} style={{ textAlign: 'center', padding: '32px', color: '#aaa' }}>No work orders found</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
