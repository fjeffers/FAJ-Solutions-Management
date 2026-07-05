'use client';
import { useState, useMemo } from 'react';
import { Plus, Search, Edit2, Trash2, TrendingUp, DollarSign, Users, CreditCard, RefreshCw, CheckCircle2 } from 'lucide-react';
import { fmtMoney, fmtDate } from '@/lib/utils';
import type { Payment, WorkOrder } from '@/lib/types';
import WOPaymentHistoryModal from './WOPaymentHistoryModal';

const MC: Record<string, { bg: string; color: string }> = {
  Zelle: { bg: 'rgba(107,45,139,0.12)', color: '#6B2D8B' },
  'Direct Deposit': { bg: 'rgba(5,150,105,0.12)', color: '#059669' },
  Check: { bg: 'rgba(217,119,6,0.12)', color: '#B45309' },
  Cash: { bg: 'rgba(16,185,129,0.1)', color: '#047857' },
  Venmo: { bg: 'rgba(0,156,235,0.1)', color: '#0284C7' },
};
const mc = (m: string) => MC[m] ?? { bg: 'rgba(13,115,119,0.08)', color: 'var(--teal)' };

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{ height: 4, borderRadius: 999, background: '#f0f0f0', overflow: 'hidden' }}>
      <div style={{ height: '100%', width: pct + '%', background: color, borderRadius: 999 }} />
    </div>
  );
}

export default function PaymentsView({ payments, workOrders, onAdd, onEdit, onDelete, qboConnected = false, onSyncPayment }: {
  payments: Payment[]; workOrders: WorkOrder[];
  onAdd: () => void; onEdit: (p: Payment) => void; onDelete: (id: string) => void;
  qboConnected?: boolean; onSyncPayment?: (id: string) => Promise<void>;
}) {
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [methodFilter, setMethodFilter] = useState('all');
  const [contractorFilter, setContractorFilter] = useState('all');
  const [viewingWO, setViewingWO] = useState<WorkOrder | null>(null);

  const woMap = useMemo(() => {
    const m = new Map<string, WorkOrder>();
    workOrders.forEach((w) => m.set(w.wo_number, w));
    return m;
  }, [workOrders]);

  const allTotal = payments.reduce((s, p) => s + Number(p.amount), 0);
  const methods = ['all', ...Array.from(new Set(payments.map((p) => p.method)))];

  const byContractor = useMemo(() => {
    const m = new Map<string, number>();
    payments.forEach((p) => m.set(p.contractor_name, (m.get(p.contractor_name) ?? 0) + Number(p.amount)));
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [payments]);

  const byMethod = useMemo(() => {
    const m = new Map<string, number>();
    payments.forEach((p) => m.set(p.method, (m.get(p.method) ?? 0) + Number(p.amount)));
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [payments]);

  const filtered = payments.filter((p) => {
    const s = search.toLowerCase();
    const wo = woMap.get(p.wo_number);
    const matchSearch =
      p.contractor_name.toLowerCase().includes(s) || p.wo_number.includes(s) ||
      (p.notes ?? '').toLowerCase().includes(s) || (wo?.title ?? '').toLowerCase().includes(s) ||
      (wo?.site_name ?? '').toLowerCase().includes(s) || (wo?.site_city ?? '').toLowerCase().includes(s);
    const matchMethod = methodFilter === 'all' || p.method === methodFilter;
    const matchContractor = contractorFilter === 'all' || p.contractor_name === contractorFilter;
    return matchSearch && matchMethod && matchContractor;
  });

  const totalShown = filtered.reduce((s, p) => s + Number(p.amount), 0);
  const uniqueWOs = new Set(payments.map((p) => p.wo_number)).size;
  const top = byContractor[0];
  const topM = byMethod[0];

  return (
    <div className="view-inner" style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <div className="display" style={{ fontSize: 11, color: 'var(--teal)', letterSpacing: 3, marginBottom: 6 }}>PAYMENTS</div>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 className="serif" style={{ fontSize: 36, fontWeight: 600, margin: 0, lineHeight: 1 }}>Payments</h1>
            <p style={{ margin: '6px 0 0', color: '#666', fontSize: 14 }}>{payments.length} payments &middot; {fmtMoney(allTotal)} total paid</p>
          </div>
          <button className="btn btn-primary" onClick={onAdd}><Plus size={14} /> Log Payment</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 20 }}>
        <div className="glass card" style={{ padding: '16px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <DollarSign size={14} color="var(--teal)" />
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: '#888', textTransform: 'uppercase' }}>Total Paid</span>
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#047857' }}>{fmtMoney(allTotal)}</div>
        </div>
        <div className="glass card" style={{ padding: '16px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <TrendingUp size={14} color="var(--teal)" />
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: '#888', textTransform: 'uppercase' }}>Payments</span>
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#1a1a1a' }}>{payments.length}</div>
          <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>across {uniqueWOs} work orders</div>
        </div>
        <div className="glass card" style={{ padding: '16px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <Users size={14} color="var(--teal)" />
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: '#888', textTransform: 'uppercase' }}>Top Contractor</span>
          </div>
          {top ? (
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{top[0]}</div>
              <div style={{ fontSize: 13, color: '#047857', fontWeight: 600 }}>{fmtMoney(top[1])}</div>
            </div>
          ) : <div style={{ color: '#aaa', fontSize: 13 }}>--</div>}
        </div>
        <div className="glass card" style={{ padding: '16px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <CreditCard size={14} color="var(--teal)" />
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: '#888', textTransform: 'uppercase' }}>Top Method</span>
          </div>
          {topM ? (
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1a1a' }}>{topM[0]}</div>
              <div style={{ fontSize: 13, color: '#047857', fontWeight: 600 }}>{fmtMoney(topM[1])}</div>
            </div>
          ) : <div style={{ color: '#aaa', fontSize: 13 }}>--</div>}
        </div>
      </div>

      {payments.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, marginBottom: 20 }}>
          <div className="glass card" style={{ padding: '16px 20px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: '#888', textTransform: 'uppercase', marginBottom: 12 }}>By Contractor</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {byContractor.map(([name, total]) => (
                <div key={name}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: contractorFilter === name ? 'var(--teal)' : '#333', cursor: 'pointer' }}
                      onClick={() => setContractorFilter(contractorFilter === name ? 'all' : name)}>{name}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#047857' }}>{fmtMoney(total)}</span>
                  </div>
                  <Bar pct={allTotal > 0 ? (total / allTotal) * 100 : 0} color="var(--teal)" />
                </div>
              ))}
            </div>
          </div>
          <div className="glass card" style={{ padding: '16px 20px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: '#888', textTransform: 'uppercase', marginBottom: 12 }}>By Payment Method</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {byMethod.map(([method, total]) => (
                <div key={method}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#333' }}>{method}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#047857' }}>{fmtMoney(total)}</span>
                  </div>
                  <Bar pct={allTotal > 0 ? (total / allTotal) * 100 : 0} color={mc(method).color} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="glass card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: '1 1 200px' }}>
            <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#aaa' }} />
            <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search contractor, WO#, job title, site, notes..." style={{ paddingLeft: 36 }} />
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {methods.map((m) => (
              <button key={m} className={'filter-chip ' + (methodFilter === m ? 'active' : '')} onClick={() => setMethodFilter(methodFilter === m && m !== 'all' ? 'all' : m)}>
                {m === 'all' ? 'All Methods' : m}
              </button>
            ))}
          </div>
        </div>
        {contractorFilter !== 'all' && (
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: '#666' }}>Filtered:</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--teal)', background: 'rgba(13,115,119,0.08)', padding: '2px 10px', borderRadius: 999 }}>{contractorFilter}</span>
            <button style={{ fontSize: 11, color: '#b91c1c', cursor: 'pointer', background: 'none', border: 'none', padding: 0 }} onClick={() => setContractorFilter('all')}>x Clear</button>
          </div>
        )}
      </div>

      <div className="glass card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="print-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'rgba(13,115,119,0.05)', borderBottom: '1px solid rgba(13,115,119,0.1)' }}>
              {['Date', 'Contractor', 'Job / WO', 'Method', 'Notes / Purpose', 'Amount', ''].map((h, i) => (
                <th key={h + i} style={{ padding: '12px 16px', textAlign: i === 5 ? 'right' : 'left', fontSize: 10, fontWeight: 700, letterSpacing: 1, color: '#888', textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((p, idx) => {
              const wo = woMap.get(p.wo_number);
              const c = mc(p.method);
              const loc = [wo?.site_name, wo?.site_city, wo?.site_state].filter(Boolean).join(', ');
              const fallback = wo?.description ? (wo.description.length > 60 ? wo.description.slice(0, 60) + '...' : wo.description) : null;
              return (
                <tr key={p.id} style={{ borderBottom: '1px solid #f5f5f5', background: idx % 2 === 1 ? '#fafafa' : undefined }}>
                  <td style={{ padding: '14px 16px', color: '#555', whiteSpace: 'nowrap' }}>{fmtDate(p.payment_date)}</td>
                  <td style={{ padding: '14px 16px', fontWeight: 600 }}>{p.contractor_name}</td>
                  <td style={{ padding: '14px 16px' }}>
                    <button
                      type="button"
                      onClick={() => wo && setViewingWO(wo)}
                      style={{ fontWeight: 700, color: 'var(--teal)', fontSize: 12, background: 'none', border: 'none', cursor: wo ? 'pointer' : 'default', padding: 0, textDecoration: wo ? 'underline' : 'none', textUnderlineOffset: 3 }}>
                      #{p.wo_number}
                    </button>
                    {wo?.title && <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a', marginTop: 1 }}>{wo.title}</div>}
                    {loc && <div style={{ fontSize: 11, color: '#aaa', marginTop: 1 }}>{loc}</div>}
                  </td>
                  <td style={{ padding: '14px 16px' }}>
                    <span style={{ padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: c.bg, color: c.color }}>{p.method}</span>
                  </td>
                  <td style={{ padding: '14px 16px', fontSize: 12, maxWidth: 220 }}>
                    {p.notes
                      ? <span style={{ color: '#444' }}>{p.notes}</span>
                      : fallback
                        ? <span style={{ color: '#aaa', fontStyle: 'italic' }}>{fallback}</span>
                        : <span style={{ color: '#ccc' }}>--</span>}
                  </td>
                  <td style={{ padding: '14px 16px', textAlign: 'right', fontWeight: 700, color: '#047857', whiteSpace: 'nowrap' }}>{fmtMoney(Number(p.amount))}</td>
                  <td style={{ padding: '14px 16px' }}>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      {qboConnected && onSyncPayment && (
                        p.qbo_synced_at ? (
                          <span title="Synced to QuickBooks" style={{ color: '#047857', display: 'flex' }}><CheckCircle2 size={14} /></span>
                        ) : (
                          <button
                            className="icon-btn"
                            title="Sync to QuickBooks"
                            disabled={syncingId === p.id}
                            onClick={async () => {
                              setSyncingId(p.id);
                              try { await onSyncPayment(p.id); } finally { setSyncingId(null); }
                            }}
                          >
                            <RefreshCw size={14} className={syncingId === p.id ? 'spin' : ''} />
                          </button>
                        )
                      )}
                      <button className="icon-btn" onClick={() => onEdit(p)}><Edit2 size={14} /></button>
                      <button className="icon-btn" style={{ color: '#b91c1c' }} onClick={() => { if (confirm('Delete this payment?')) onDelete(p.id); }}><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length > 0 && (
              <tr style={{ background: 'rgba(16,185,129,0.06)', fontWeight: 700, borderTop: '2px solid rgba(16,185,129,0.2)' }}>
                <td colSpan={5} style={{ padding: '12px 16px', textAlign: 'right', fontSize: 12, color: '#555' }}>
                  {filtered.length < payments.length ? filtered.length + ' of ' + payments.length + ' payments shown' : filtered.length + ' payments'}
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'right', color: '#047857', fontSize: 15 }}>{fmtMoney(totalShown)}</td>
                <td />
              </tr>
            )}
            {filtered.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', padding: '32px', color: '#aaa' }}>No payments found</td></tr>}
          </tbody>
        </table>
      </div>

      {viewingWO && (
        <WOPaymentHistoryModal
          wo={viewingWO}
          payments={payments}
          onClose={() => setViewingWO(null)}
        />
      )}
    </div>
  );
}
