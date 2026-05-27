'use client';
import { useState, useMemo } from 'react';
import { Printer, ChevronDown } from 'lucide-react';
import { fmtMoney, fmtDate, sortByWO } from '@/lib/utils';
import type { Contractor, EnrichedWorkOrder, Payment } from '@/lib/types';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export default function StatementView({ contractors, workOrders, payments, selected, setSelected }: {
  contractors: Contractor[]; workOrders: EnrichedWorkOrder[]; payments: Payment[];
  selected: string | null; setSelected: (s: string) => void;
}) {
  const now = new Date();
  const [mode, setMode] = useState<'monthly' | 'all-time'>('monthly');
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());

  const name = selected || contractors[0]?.name || '';
  const contractor = contractors.find((c) => c.name === name);

  const allYears = useMemo(() => {
    const ys = new Set(payments.map((p) => new Date(p.payment_date).getFullYear()));
    if (!ys.has(now.getFullYear())) ys.add(now.getFullYear());
    return Array.from(ys).sort((a, b) => b - a);
  }, [payments]);

  const contractorPayments = payments.filter((p) => p.contractor_name === name);
  const filteredPayments = useMemo(() => {
    if (mode === 'all-time') return contractorPayments;
    return contractorPayments.filter((p) => {
      const d = new Date(p.payment_date);
      return d.getMonth() === month && d.getFullYear() === year;
    });
  }, [contractorPayments, mode, month, year]);

  const woNumbers = new Set(filteredPayments.map((p) => p.wo_number));
  const allJobs = sortByWO(workOrders.filter((w) => w.contractor_name === name));
  const displayJobs = mode === 'all-time' ? allJobs : sortByWO(workOrders.filter((w) => w.contractor_name === name && woNumbers.has(w.wo_number)));
  const totalBilled = displayJobs.reduce((s, j) => s + Number(j.total_amount), 0);
  const totalPaid = filteredPayments.reduce((s, p) => s + Number(p.amount), 0);
  const sortedPays = [...filteredPayments].sort((a, b) => new Date(a.payment_date).getTime() - new Date(b.payment_date).getTime());
  const periodLabel = mode === 'all-time' ? 'All Time' : `${MONTHS[month]} ${year}`;

  return (
    <div className="view-inner" style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ marginBottom: 28 }}>
        <div className="display" style={{ fontSize: 11, color: 'var(--teal)', letterSpacing: 3, marginBottom: 6 }}>STATEMENTS</div>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 className="serif" style={{ fontSize: 36, fontWeight: 600, margin: 0, lineHeight: 1 }}>Contractor Statements</h1>
            <p style={{ margin: '6px 0 0', color: '#666', fontSize: 14 }}>Monthly or all-time summaries — printable for your records</p>
          </div>
          <button className="btn btn-gold no-print" onClick={() => window.print()}><Printer size={14} /> Print / Save PDF</button>
        </div>
      </div>

      <div className="glass card no-print" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 200px' }}>
            <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: '#555', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Contractor</label>
            <div style={{ position: 'relative' }}>
              <select className="select input" value={name} onChange={(e) => setSelected(e.target.value)}>
                {contractors.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
              <ChevronDown size={14} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#aaa' }} />
            </div>
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: '#555', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Period</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className={`filter-chip ${mode === 'monthly' ? 'active' : ''}`} onClick={() => setMode('monthly')}>Monthly</button>
              <button className={`filter-chip ${mode === 'all-time' ? 'active' : ''}`} onClick={() => setMode('all-time')}>All Time</button>
            </div>
          </div>
          {mode === 'monthly' && (
            <>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: '#555', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Month</label>
                <select className="select input" value={month} onChange={(e) => setMonth(Number(e.target.value))} style={{ width: 140 }}>
                  {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: '#555', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Year</label>
                <select className="select input" value={year} onChange={(e) => setYear(Number(e.target.value))} style={{ width: 100 }}>
                  {allYears.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            </>
          )}
        </div>
      </div>

      <div style={{ background: 'white', padding: '40px 48px', borderRadius: 16, boxShadow: '0 8px 32px rgba(0,0,0,0.08)', maxWidth: 900, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32, paddingBottom: 24, borderBottom: '2px solid var(--gold)' }}>
          <div>
            <div className="display" style={{ fontSize: 13, color: 'var(--gold)', marginBottom: 4 }}>FAJ SOLUTIONS</div>
            <div style={{ fontSize: 12, color: '#888' }}>fajsolutions@gmail.com</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="serif" style={{ fontSize: 32, fontWeight: 600, color: 'var(--ink)', lineHeight: 1 }}>Payment Statement</div>
            <div style={{ fontSize: 13, color: 'var(--teal)', fontWeight: 700, marginTop: 6 }}>Period: {periodLabel}</div>
            <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>Prepared {fmtDate(new Date().toISOString())}</div>
          </div>
        </div>

        {contractor && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32, marginBottom: 32 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, color: '#aaa', textTransform: 'uppercase', marginBottom: 8 }}>Prepared For</div>
              <div className="serif" style={{ fontSize: 22, fontWeight: 600, marginBottom: 4 }}>{contractor.name}</div>
              {contractor.business_name && <div style={{ fontSize: 13, color: '#555' }}>{contractor.business_name}</div>}
              {contractor.address && <div style={{ fontSize: 13, color: '#666', marginTop: 4 }}>{contractor.address}<br />{[contractor.city, contractor.state, contractor.zip].filter(Boolean).join(', ')}</div>}
              {contractor.phone && <div style={{ fontSize: 13, color: '#666', marginTop: 4 }}>{contractor.phone}</div>}
              {contractor.email && <div style={{ fontSize: 13, color: '#666' }}>{contractor.email}</div>}
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, color: '#aaa', textTransform: 'uppercase', marginBottom: 8 }}>Summary</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <SR label="Total Billed" value={fmtMoney(totalBilled)} />
                <SR label="Total Paid" value={fmtMoney(totalPaid)} accent />
                <div style={{ height: 1, background: '#eee' }} />
                <SR label="Balance" value={fmtMoney(totalBilled - totalPaid)} warning={totalBilled - totalPaid > 0} />
              </div>
            </div>
          </div>
        )}

        {displayJobs.length > 0 && (
          <div style={{ marginBottom: 32 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, color: 'var(--teal)', textTransform: 'uppercase', marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid rgba(201,169,97,0.4)' }}>Work Orders</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #eee' }}>
                  {['WO #', 'Description', 'Start', 'End', 'Amount', 'Status'].map((h, i) => (
                    <th key={h} style={{ padding: '8px 10px', textAlign: i >= 4 ? 'right' : 'left', fontSize: 10, fontWeight: 700, letterSpacing: 1, color: '#aaa', textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayJobs.map((j) => (
                  <tr key={j.id} style={{ borderBottom: '1px solid #f5f5f5' }}>
                    <td style={{ padding: '10px 10px', fontWeight: 700, color: 'var(--teal)' }}>{j.wo_number}</td>
                    <td style={{ padding: '10px 10px', color: '#444' }}>{j.description || '—'}</td>
                    <td style={{ padding: '10px 10px', color: '#777', fontSize: 12 }}>{fmtDate(j.start_date)}</td>
                    <td style={{ padding: '10px 10px', color: '#777', fontSize: 12 }}>{fmtDate(j.end_date)}</td>
                    <td style={{ padding: '10px 10px', textAlign: 'right', fontWeight: 600 }}>{fmtMoney(Number(j.total_amount))}</td>
                    <td style={{ padding: '10px 10px', textAlign: 'right' }}>
                      <span className={`chip chip-${j.payment_status}`} style={{ fontSize: 10 }}>
                        {j.payment_status === 'paid' ? 'Paid' : j.payment_status === 'partial' ? 'Partial' : 'Pending'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, color: 'var(--teal)', textTransform: 'uppercase', marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid rgba(201,169,97,0.4)' }}>
            Payments — {periodLabel}
          </div>
          {sortedPays.length === 0 ? (
            <div style={{ padding: '20px 0', color: '#aaa', fontSize: 13, textAlign: 'center' }}>No payments recorded for this period.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #eee' }}>
                  {['Date', 'WO #', 'Method', 'Notes', 'Amount'].map((h, i) => (
                    <th key={h} style={{ padding: '8px 10px', textAlign: i === 4 ? 'right' : 'left', fontSize: 10, fontWeight: 700, letterSpacing: 1, color: '#aaa', textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedPays.map((p, idx) => (
                  <tr key={p.id} style={{ borderBottom: '1px solid #f5f5f5', background: idx % 2 === 1 ? '#fafafa' : undefined }}>
                    <td style={{ padding: '10px 10px', color: '#555' }}>{fmtDate(p.payment_date)}</td>
                    <td style={{ padding: '10px 10px', fontWeight: 700, color: 'var(--teal)' }}>#{p.wo_number}</td>
                    <td style={{ padding: '10px 10px' }}>
                      <span style={{ padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: p.method === 'Zelle' ? 'rgba(107,45,139,0.12)' : 'rgba(13,115,119,0.08)', color: p.method === 'Zelle' ? '#6B2D8B' : 'var(--teal)' }}>{p.method}</span>
                    </td>
                    <td style={{ padding: '10px 10px', color: '#888', fontSize: 12 }}>{p.notes || '—'}</td>
                    <td style={{ padding: '10px 10px', textAlign: 'right', fontWeight: 700, color: '#047857' }}>{fmtMoney(Number(p.amount))}</td>
                  </tr>
                ))}
                <tr style={{ background: 'rgba(16,185,129,0.06)', fontWeight: 700, borderTop: '2px solid rgba(16,185,129,0.2)' }}>
                  <td colSpan={4} style={{ padding: '12px 10px', textAlign: 'right', fontSize: 12, color: '#555' }}>TOTAL PAID — {periodLabel}</td>
                  <td style={{ padding: '12px 10px', textAlign: 'right', color: '#047857', fontSize: 15 }}>{fmtMoney(totalPaid)}</td>
                </tr>
              </tbody>
            </table>
          )}
        </div>

        <div style={{ textAlign: 'center', marginTop: 40, paddingTop: 20, borderTop: '1px solid rgba(201,169,97,0.3)', fontSize: 11, color: '#aaa', fontStyle: 'italic' }}>
          Prepared by FAJ Solutions for {name} · {periodLabel}<br />
          Please verify all amounts. Contact fajsolutions@gmail.com with any questions.
        </div>
      </div>
    </div>
  );
}

function SR({ label, value, accent, warning }: { label: string; value: string; accent?: boolean; warning?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontSize: 13, color: '#666' }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 700, color: warning ? '#b91c1c' : accent ? '#047857' : 'var(--ink)', fontFamily: 'Cormorant Garamond, serif' }}>{value}</span>
    </div>

  );
}
