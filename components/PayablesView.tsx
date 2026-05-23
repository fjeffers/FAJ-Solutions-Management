'use client';
import { useMemo } from 'react';
import { DollarSign, Landmark, Smartphone, Plus } from 'lucide-react';
import { fmtMoney } from '@/lib/utils';
import type { EnrichedWorkOrder, Contractor } from '@/lib/types';

const PAYMENT_STATUS_META: Record<string, { bg: string; color: string; label: string }> = {
  pending: { bg: 'rgba(245,158,11,0.12)', color: '#b45309', label: 'Unpaid'  },
  partial: { bg: 'rgba(99,102,241,0.12)', color: '#4338ca', label: 'Partial' },
  paid:    { bg: 'rgba(5,150,105,0.15)',  color: '#065f46', label: 'Paid'    },
};

export default function PayablesView({
  workOrders,
  contractors,
  onPay,
  onQuickPay,
}: {
  workOrders: EnrichedWorkOrder[];
  contractors: Contractor[];
  onPay: (w: EnrichedWorkOrder) => void;
  onQuickPay: () => void;
}) {
  const groups = useMemo(() => {
    const openWOs = workOrders.filter((w) => w.remaining > 0);
    const map = new Map<string, EnrichedWorkOrder[]>();
    for (const w of openWOs) {
      map.set(w.contractor_name, [...(map.get(w.contractor_name) ?? []), w]);
    }
    return Array.from(map.entries())
      .map(([name, wos]) => ({
        name,
        wos,
        total: wos.reduce((s, w) => s + w.remaining, 0),
        contractor: contractors.find((c) => c.name === name) ?? null,
      }))
      .sort((a, b) => b.total - a.total);
  }, [workOrders, contractors]);

  const grandTotal = groups.reduce((s, g) => s + g.total, 0);

  return (
    <div style={{ padding: '28px 32px', maxWidth: 960, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <div className="display" style={{ fontSize: 11, color: 'var(--teal)', letterSpacing: 3, marginBottom: 6 }}>PAYABLES</div>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 className="serif" style={{ fontSize: 36, fontWeight: 600, margin: 0, lineHeight: 1 }}>Payables</h1>
            <p style={{ margin: '6px 0 0', color: '#666', fontSize: 14 }}>
              {groups.length} contractor{groups.length !== 1 ? 's' : ''} Â·{" "}
              <span style={{ color: '#b91c1c', fontWeight: 600 }}>{fmtMoney(grandTotal)} total outstanding</span>
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button className="btn btn-primary" onClick={onQuickPay}>
              <Plus size={14} /> Quick Pay
            </button>
            {/* Grand total tile */}
            <div style={{ padding: '12px 20px', borderRadius: 10, background: 'rgba(185,28,28,0.06)', border: '1.5px solid rgba(185,28,28,0.15)', textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: '#b91c1c', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Total Owed</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: '#b91c1c', fontFamily: 'Lato, sans-serif' }}>{fmtMoney(grandTotal)}</div>
            </div>
          </div>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="glass card" style={{ textAlign: 'center', padding: '56px 24px', color: '#aaa' }}>
          All contractors are paid up â no outstanding balances.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {groups.map((g) => (
            <ContractorGroup key={g.name} {...g} onPay={onPay} />
          ))}
        </div>
      )}
    </div>
  );
}

function ContractorGroup({
  name, wos, total, contractor, onPay,
}: {
  name: string;
  wos: EnrichedWorkOrder[];
  total: number;
  contractor: Contractor | null;
  onPay: (w: EnrichedWorkOrder) => void;
}) {
  const hasBanking = !!(contractor?.routing_number && contractor?.account_number);
  const hasZelle   = !!contractor?.zelle_phone;

  return (
    <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e5e7eb', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
      {/* Contractor header */}
      <div style={{ padding: '14px 20px', background: 'rgba(13,115,119,0.04)', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 16, color: '#1a1a1a' }}>{name}</div>
          {hasBanking && (
            <div style={{ fontSize: 12, color: '#555', marginTop: 3, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Landmark size={11} color="var(--teal)" />
              <span style={{ fontWeight: 600, color: 'var(--teal)' }}>Direct Deposit</span>
              {contractor?.bank_name && <span>Â· {contractor.bank_name}</span>}
              <span>Â· {contractor?.account_type ?? 'checking'} Â··Â·Â·Â· {contractor?.account_number?.slice(-4)}</span>
              <span>Â» RTN {contractor?.routing_number}</span>
            </div>
          )}
          {!hasBanking && hasZelle && (
            <div style={{ fontSize: 12, color: '#6B2D8B', marginTop: 3, display: 'flex', alignItems: 'center', gap: 5 }}>
              <Smartphone size={11} /> Zelle: {contractor?.zelle_phone}
            </div>
          )}
          {!hasBanking && !hasZelle && (
            <div style={{ fontSize: 12, color: '#aaa', marginTop: 3 }}>No payment info on file</div>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: '#aaa', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700 }}>Total Owed</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#b91c1c', fontFamily: 'Lato, sans-serif' }}>{fmtMoney(total)}</div>
        </div>
      </div>

      {/* WO rows */}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: '#fafafa', borderBottom: '1px solid #f0f0f0' }}>
            <th style={TH('left')}>WO #</th>
            <th style={TH('left')}>Title</th>
            <th style={TH('left')}>Status</th>
            <th style={TH('right')}>Total</th>
            <th style={TH('right')}>Paid</th>
            <th style={TH('right')}>Remaining</th>
            <th style={TH('left')} />
          </tr>
        </thead>
        <tbody>
          {wos.map((w) => {
            const pm = PAYMENT_STATUS_META[w.payment_status] ?? PAYMENT_STATUS_META['pending'];
            return (
              <tr key={w.id} style={{ borderBottom: '1px solid #f5f5f5' }}>
                <td style={{ padding: '12px 16px', fontWeight: 700, color: 'var(--teal)', whiteSpace: 'nowrap' }}>
                  #{w.wo_number}
                </td>
                <td style={{ padding: '12px 16px', color: '#555' }}>
                  {w.title || <span style={{ color: '#ccc' }}>â</span>}
                </td>
                <td style={{ padding: '12px 16px' }}>
                  <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: pm.bg, color: pm.color, whiteSpace: 'nowrap' }}>
                    {pm.label}
                  </span>
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'right', color: '#555' }}>
                  {fmtMoney(Number(w.total_amount))}
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'right', color: '#047857', fontWeight: 600 }}>
                  {fmtMoney(w.paid)}
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 700, color: '#b91c1c' }}>
                  {fmtMoney(w.remaining)}
                </td>
                <td style={{ padding: '12px 16px' }}>
                  <button
                    onClick={() => onPay(w)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 5,
                      padding: '7px 16px', borderRadius: 8, border: 'none',
                      cursor: 'pointer', background: 'var(--teal)', color: 'white',
                      fontFamily: 'Lato, sans-serif', fontSize: 12, fontWeight: 700,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <DollarSign size={12} /> Pay
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr style={{ background: 'rgba(185,28,28,0.04)', borderTop: '2px solid rgba(185,28,28,0.15)' }}>
            <td colSpan={5} style={{ padding: '10px 16px', textAlign: 'right', fontSize: 12, fontWeight: 700, color: '#888' }}>
              SUBTOTAL
            </td>
            <td style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 800, color: '#b91c1c', fontSize: 15 }}>
              {fmtMoney(total)}
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function TH(align: 'left' | 'right'): React.CSSProperties {
  return {
    padding: '10px 16px',
    textAlign: align,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 1,
    color: '#888',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
  };
}
