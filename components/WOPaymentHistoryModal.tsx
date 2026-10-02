'use client';
import { X, CreditCard, DollarSign, TrendingDown, CheckCircle2 } from 'lucide-react';
import { fmtMoney } from '@/lib/utils';
import type { Payment, WorkOrder } from '@/lib/types';
import { backdropClose } from '@/lib/backdrop';

type Props = {
  wo: WorkOrder;
  payments: Payment[];
  onClose: () => void;
};

export default function WOPaymentHistoryModal({ wo, payments, onClose }: Props) {
  const woPayments = payments
    .filter((p) => p.wo_number === wo.wo_number)
    .sort((a, b) => new Date(b.payment_date).getTime() - new Date(a.payment_date).getTime());

  const totalPaid = woPayments.reduce((sum, p) => sum + Number(p.amount), 0);
  const woTotal = Number(wo.total_amount ?? 0);
  const remaining = woTotal > 0 ? woTotal - totalPaid : null;
  const paidOff = remaining !== null && remaining <= 0;

  return (
    <div className="modal-overlay" {...backdropClose(onClose)}>
      <div className="modal-content" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <div className="display" style={{ fontSize: 11, color: 'var(--teal)', letterSpacing: 2, marginBottom: 4 }}>
              WORK ORDER #{wo.wo_number}
            </div>
            <h2 className="serif" style={{ fontSize: 22, margin: 0, fontWeight: 600 }}>
              Payment History
            </h2>
            <div style={{ fontSize: 13, color: '#888', marginTop: 4 }}>{wo.contractor_name}</div>
          </div>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>

        {/* Summary bar */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          {woTotal > 0 && (
            <div style={{ flex: 1, minWidth: 110, padding: '12px 16px', borderRadius: 10, background: '#f8f8f8', border: '1px solid #eee' }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: '#aaa', marginBottom: 4 }}>WO Total</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: '#333' }}>{fmtMoney(woTotal)}</div>
            </div>
          )}
          <div style={{ flex: 1, minWidth: 110, padding: '12px 16px', borderRadius: 10, background: totalPaid > 0 ? 'rgba(180,83,9,0.07)' : '#f8f8f8', border: '1px solid ' + (totalPaid > 0 ? 'rgba(180,83,9,0.15)' : '#eee') }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: '#aaa', marginBottom: 4 }}>
              Total Paid
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, color: totalPaid > 0 ? '#b45309' : '#333' }}>{fmtMoney(totalPaid)}</div>
            <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>{woPayments.length} payment{woPayments.length !== 1 ? 's' : ''}</div>
          </div>
          {remaining !== null && (
            <div style={{ flex: 1, minWidth: 110, padding: '12px 16px', borderRadius: 10,
              background: paidOff ? 'rgba(5,150,105,0.07)' : 'rgba(220,38,38,0.05)',
              border: '1px solid ' + (paidOff ? 'rgba(5,150,105,0.2)' : 'rgba(220,38,38,0.15)') }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: '#aaa', marginBottom: 4 }}>
                Remaining
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                {paidOff && <CheckCircle2 size={15} color="#059669" />}
                <span style={{ fontSize: 18, fontWeight: 800, color: paidOff ? '#059669' : '#dc2626' }}>
                  {paidOff ? 'Paid in full' : fmtMoney(remaining)}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Payment list */}
        {woPayments.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px 0', color: '#bbb' }}>
            <DollarSign size={32} style={{ marginBottom: 8, opacity: 0.3 }} />
            <div style={{ fontSize: 14 }}>No payments recorded for this work order.</div>
          </div>
        ) : (
          <div style={{ borderRadius: 10, border: '1px solid #eee', overflow: 'hidden' }}>
            {/* Column headers */}
            <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr auto auto', gap: 0,
              padding: '8px 14px', background: '#f7f7f7', borderBottom: '1px solid #eee' }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: '#aaa' }}>Date</span>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: '#aaa' }}>Notes / Purpose</span>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: '#aaa', textAlign: 'center', minWidth: 72 }}>Method</span>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: '#aaa', textAlign: 'right', minWidth: 80 }}>Amount</span>
            </div>

            {woPayments.map((p, i) => (
              <div key={p.id ?? i} style={{ display: 'grid', gridTemplateColumns: '110px 1fr auto auto', gap: 0,
                padding: '11px 14px', borderBottom: i < woPayments.length - 1 ? '1px solid #f2f2f2' : undefined,
                background: i % 2 === 0 ? 'white' : '#fafafa', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: '#555' }}>{p.payment_date}</span>
                <span style={{ fontSize: 12, color: p.notes ? '#444' : '#ccc', fontStyle: p.notes ? 'normal' : 'italic',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 12 }}>
                  {p.notes || 'No notes'}
                </span>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, padding: '3px 9px', borderRadius: 99, textAlign: 'center',
                  background: p.method === 'Zelle' ? 'rgba(107,45,139,0.1)' : p.method === 'Direct Deposit' ? 'rgba(5,150,105,0.1)' : 'rgba(14,27,46,0.1)',
                  color: p.method === 'Zelle' ? '#6B2D8B' : p.method === 'Direct Deposit' ? '#059669' : 'var(--teal, #0E1B2E)',
                  minWidth: 72, marginRight: 12 }}>
                  {p.method ?? 'Check'}
                </span>
                <span style={{ fontSize: 14, fontWeight: 700, color: '#222', textAlign: 'right', minWidth: 80 }}>
                  {fmtMoney(Number(p.amount))}
                </span>
              </div>
            ))}

            {/* Totals row */}
            <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr auto auto', gap: 0,
              padding: '10px 14px', background: 'rgba(14,27,46,0.06)', borderTop: '2px solid rgba(14,27,46,0.15)' }}>
              <span></span>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Total Paid
              </span>
              <span style={{ marginRight: 12 }}></span>
              <span style={{ fontSize: 15, fontWeight: 800, color: '#222', textAlign: 'right', minWidth: 80 }}>
                {fmtMoney(totalPaid)}
              </span>
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20, paddingTop: 16, borderTop: '1px solid #f0f0f0' }}>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
