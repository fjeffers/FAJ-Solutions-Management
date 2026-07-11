'use client';
import { useMemo, useState } from 'react';
import { BookOpen, DollarSign, Wallet, TrendingDown } from 'lucide-react';
import { fmtMoney, fmtDate } from '@/lib/utils';
import type { EnrichedWorkOrder, Payment } from '@/lib/types';

// The whole business in one running register: total billed across all jobs,
// every payment in chronological order, and a balance column that subtracts
// as money goes out — ending at exactly what's still owed today.

export default function LedgerView({
  workOrders,
  payments,
}: {
  workOrders: EnrichedWorkOrder[];
  payments: Payment[];
}) {
  const [contractorFilter, setContractorFilter] = useState('all');

  // Job prices plus mileage reimbursements — the full amount that will go out
  const totalBilled = useMemo(
    () => workOrders.reduce((s, w) => s + w.payout_total, 0),
    [workOrders],
  );

  // Oldest first so the register reads top-to-bottom like a checkbook
  const ledger = useMemo(() => {
    const sorted = [...payments].sort((a, b) => {
      const d = a.payment_date.localeCompare(b.payment_date);
      if (d !== 0) return d;
      return (a.created_at ?? '').localeCompare(b.created_at ?? '');
    });
    let paidSoFar = 0;
    return sorted.map((p) => {
      paidSoFar += Number(p.amount);
      return { ...p, paidSoFar, leftToPay: totalBilled - paidSoFar };
    });
  }, [payments, totalBilled]);

  const totalPaid = ledger.length > 0 ? ledger[ledger.length - 1].paidSoFar : 0;
  const outstanding = totalBilled - totalPaid;

  const contractorNames = useMemo(
    () => Array.from(new Set(payments.map((p) => p.contractor_name))).sort(),
    [payments],
  );
  const visible = contractorFilter === 'all'
    ? ledger
    : ledger.filter((p) => p.contractor_name === contractorFilter);

  const woTitle = (woNumber: string) => workOrders.find((w) => w.wo_number === woNumber)?.title ?? '';

  return (
    <div className="view-inner" style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <div className="display" style={{ fontSize: 11, color: 'var(--teal)', letterSpacing: 3, marginBottom: 6 }}>LEDGER</div>
        <h1 className="serif" style={{ fontSize: 36, fontWeight: 600, margin: 0, lineHeight: 1 }}>Money Ledger</h1>
        <p style={{ margin: '6px 0 0', color: '#666', fontSize: 14 }}>
          Every payout in order — watch the balance come down as you pay
        </p>
      </div>

      {/* The equation: billed − paid = left */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 20 }}>
        <div className="glass card" style={{ padding: '16px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <BookOpen size={14} color="var(--teal)" />
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: '#888', textTransform: 'uppercase' }}>Total Billed — All Jobs</span>
          </div>
          <div style={{ fontSize: 26, fontWeight: 700, color: '#1a1a1a' }}>{fmtMoney(totalBilled)}</div>
          <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>{workOrders.length} work orders · incl. mileage</div>
        </div>
        <div className="glass card" style={{ padding: '16px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <DollarSign size={14} color="#047857" />
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: '#888', textTransform: 'uppercase' }}>Paid Out</span>
          </div>
          <div style={{ fontSize: 26, fontWeight: 700, color: '#047857' }}>− {fmtMoney(totalPaid)}</div>
          <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>{payments.length} payments</div>
        </div>
        <div className="glass card" style={{ padding: '16px 20px', border: outstanding > 0 ? '1.5px solid rgba(185,28,28,0.25)' : '1.5px solid rgba(5,150,105,0.25)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <Wallet size={14} color={outstanding > 0 ? '#b91c1c' : '#047857'} />
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: '#888', textTransform: 'uppercase' }}>Left To Pay</span>
          </div>
          <div style={{ fontSize: 26, fontWeight: 800, color: outstanding > 0 ? '#b91c1c' : '#047857' }}>
            {fmtMoney(Math.max(0, outstanding))}
          </div>
          {outstanding < 0 && (
            <div style={{ fontSize: 11, color: '#b45309', marginTop: 2 }}>
              Paid {fmtMoney(-outstanding)} beyond billed totals (bonuses/extras)
            </div>
          )}
        </div>
      </div>

      {/* Contractor filter */}
      <div className="glass card" style={{ marginBottom: 16, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: '#888', textTransform: 'uppercase' }}>Show</span>
        <button className={'filter-chip ' + (contractorFilter === 'all' ? 'active' : '')} onClick={() => setContractorFilter('all')}>Everyone</button>
        {contractorNames.map((n) => (
          <button key={n} className={'filter-chip ' + (contractorFilter === n ? 'active' : '')} onClick={() => setContractorFilter(contractorFilter === n ? 'all' : n)}>
            {n}
          </button>
        ))}
        <span style={{ fontSize: 11, color: '#aaa', marginLeft: 'auto' }}>
          Balance column always tracks ALL payouts, oldest to newest
        </span>
      </div>

      {/* Register */}
      <div className="glass card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="print-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'rgba(13,115,119,0.05)', borderBottom: '1px solid rgba(13,115,119,0.1)' }}>
                {['Date', 'Paid To', 'Job', 'Method', 'Paid', 'Paid So Far', 'Left To Pay'].map((h, i) => (
                  <th key={h} style={{ padding: '12px 16px', textAlign: i >= 4 ? 'right' : 'left', fontSize: 10, fontWeight: 700, letterSpacing: 1, color: '#888', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Opening line: where the balance starts */}
              <tr style={{ borderBottom: '1px solid #f0f0f0', background: 'rgba(13,115,119,0.03)' }}>
                <td colSpan={5} style={{ padding: '10px 16px', fontSize: 12, fontWeight: 700, color: 'var(--teal)' }}>
                  STARTING BALANCE — total billed across all jobs
                </td>
                <td />
                <td style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 800, color: '#1a1a1a', whiteSpace: 'nowrap' }}>{fmtMoney(totalBilled)}</td>
              </tr>
              {visible.map((p, idx) => (
                <tr key={p.id} style={{ borderBottom: '1px solid #f5f5f5', background: idx % 2 === 1 ? '#fafafa' : undefined }}>
                  <td style={{ padding: '12px 16px', color: '#555', whiteSpace: 'nowrap' }}>{fmtDate(p.payment_date)}</td>
                  <td style={{ padding: '12px 16px', fontWeight: 600 }}>{p.contractor_name}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ fontWeight: 700, color: 'var(--teal)', fontSize: 12 }}>#{p.wo_number}</span>
                    {woTitle(p.wo_number) && (
                      <span style={{ color: '#999', fontSize: 12, marginLeft: 6 }}>{woTitle(p.wo_number).slice(0, 40)}</span>
                    )}
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 12, color: '#666' }}>{p.method}</td>
                  <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 700, color: '#047857', whiteSpace: 'nowrap' }}>− {fmtMoney(Number(p.amount))}</td>
                  <td style={{ padding: '12px 16px', textAlign: 'right', color: '#666', whiteSpace: 'nowrap' }}>{fmtMoney(p.paidSoFar)}</td>
                  <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 700, color: p.leftToPay > 0 ? '#b91c1c' : '#047857', whiteSpace: 'nowrap' }}>
                    {fmtMoney(Math.max(0, p.leftToPay))}
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: 32, color: '#aaa' }}>No payments yet</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr style={{ background: 'rgba(185,28,28,0.05)', borderTop: '2px solid rgba(185,28,28,0.15)' }}>
                <td colSpan={4} style={{ padding: '12px 16px', fontSize: 12, fontWeight: 700, color: '#555' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <TrendingDown size={13} /> TODAY — after {payments.length} payments
                  </span>
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 800, color: '#047857', whiteSpace: 'nowrap' }}>− {fmtMoney(totalPaid)}</td>
                <td />
                <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 800, fontSize: 15, color: outstanding > 0 ? '#b91c1c' : '#047857', whiteSpace: 'nowrap' }}>
                  {fmtMoney(Math.max(0, outstanding))}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
