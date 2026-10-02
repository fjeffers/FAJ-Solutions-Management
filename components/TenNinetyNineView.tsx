'use client';
import { useMemo } from 'react';
import { Printer, AlertTriangle, CheckCircle } from 'lucide-react';
import { fmtMoney } from '@/lib/utils';
import { form1099Threshold, needs1099 as overThreshold, thresholdNeedsCheck } from '@/lib/tax1099';
import type { Contractor, Payment } from '@/lib/types';

export default function TenNinetyNineView({ contractors, payments, year, setYear }: { contractors: Contractor[]; payments: Payment[]; year: number; setYear: (y: number) => void }) {
  const allYears = useMemo(() => {
    const ys = new Set(payments.map((p) => new Date(p.payment_date).getFullYear()));
    if (!ys.has(new Date().getFullYear())) ys.add(new Date().getFullYear());
    return Array.from(ys).sort((a, b) => b - a);
  }, [payments]);

  const rows = useMemo(() => {
    const yearPayments = payments.filter((p) => new Date(p.payment_date).getFullYear() === year);
    return contractors.map((c) => {
      const paid = yearPayments.filter((p) => p.contractor_name === c.name).reduce((s, p) => s + Number(p.amount), 0);
      return { ...c, paid, needs1099: overThreshold(paid, year) };
    }).filter((r) => r.paid > 0).sort((a, b) => b.paid - a.paid);
  }, [contractors, payments, year]);

  const needs1099 = rows.filter((r) => r.needs1099);
  const threshold = form1099Threshold(year);
  const total = rows.reduce((s, r) => s + r.paid, 0);

  return (
    <div className="view-inner" style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ marginBottom: 28 }}>
        <div className="display" style={{ fontSize: 11, color: 'var(--teal)', letterSpacing: 3, marginBottom: 6 }}>TAX DOCUMENTS</div>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 className="serif" style={{ fontSize: 36, fontWeight: 600, margin: 0, lineHeight: 1 }}>1099 Summary</h1>
            <p style={{ margin: '6px 0 0', color: '#666', fontSize: 14 }}>
              Contractors paid {fmtMoney(threshold)} or more in {year} need a 1099-NEC
              {year >= 2026 ? ' (the line rose from $600 to $2,000 for 2026 payments)' : ''}
              {thresholdNeedsCheck(year) ? '. Confirm the inflation-adjusted amount with your accountant.' : ''}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <select className="select input" value={year} onChange={(e) => setYear(Number(e.target.value))} style={{ width: 100 }}>
              {allYears.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <button className="btn btn-gold no-print" onClick={() => window.print()}><Printer size={14} /> Print / PDF</button>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
        <div className="glass card" style={{ textAlign: 'center' }}>
          <div className="stat-label">Total Paid {year}</div>
          <div className="stat-value">{fmtMoney(total)}</div>
        </div>
        <div className="glass card" style={{ textAlign: 'center', background: needs1099.length > 0 ? 'rgba(239,68,68,0.06)' : undefined }}>
          <div className="stat-label">Need 1099-NEC</div>
          <div className="stat-value" style={{ color: needs1099.length > 0 ? '#b91c1c' : '#047857' }}>{needs1099.length}</div>
        </div>
        <div className="glass card" style={{ textAlign: 'center' }}>
          <div className="stat-label">Contractors Paid</div>
          <div className="stat-value">{rows.length}</div>
        </div>
      </div>

      {needs1099.length > 0 && (
        <div style={{ padding: '12px 16px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
          <AlertTriangle size={16} color="#b91c1c" />
          <span><strong>{needs1099.length} contractor{needs1099.length !== 1 ? 's' : ''}</strong> paid {fmtMoney(threshold)} or more in {year} — 1099-NEC forms required by January 31, {year + 1}.</span>
        </div>
      )}

      <div className="glass card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="print-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'rgba(14,27,46,0.05)', borderBottom: '1px solid rgba(14,27,46,0.1)' }}>
              {['Contractor', 'Business Name', 'Tax ID', 'Entity', 'Total Paid', 'W-9', '1099 Required'].map((h, i) => (
                <th key={h} style={{ padding: '12px 16px', textAlign: i >= 4 ? 'right' : 'left', fontSize: 10, fontWeight: 700, letterSpacing: 1, color: '#888', textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="row-hover" style={{ borderBottom: '1px solid #f5f5f5', background: r.needs1099 ? 'rgba(239,68,68,0.02)' : undefined }}>
                <td style={{ padding: '14px 16px', fontWeight: 700 }}>{r.name}</td>
                <td style={{ padding: '14px 16px', color: '#666' }}>{r.business_name || '—'}</td>
                <td style={{ padding: '14px 16px', color: '#666', fontFamily: 'monospace' }}>{r.tax_id ? `${r.tax_id_type}: ${r.tax_id}` : <span style={{ color: '#b91c1c' }}>Missing</span>}</td>
                <td style={{ padding: '14px 16px', color: '#666' }}>{r.entity_type || '—'}</td>
                <td style={{ padding: '14px 16px', textAlign: 'right', fontWeight: 700, color: r.needs1099 ? '#b91c1c' : '#047857' }}>{fmtMoney(r.paid)}</td>
                <td style={{ padding: '14px 16px', textAlign: 'right' }}>{r.w9_received ? <CheckCircle size={16} color="#047857" /> : <AlertTriangle size={16} color="#b91c1c" />}</td>
                <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                  {r.needs1099 ? <span style={{ background: 'rgba(239,68,68,0.12)', color: '#b91c1c', padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>YES</span>
                    : <span style={{ background: 'rgba(16,185,129,0.12)', color: '#047857', padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>NO</span>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', padding: '32px', color: '#aaa' }}>No payments recorded for {year}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
