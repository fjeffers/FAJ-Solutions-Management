'use client';
import { useMemo } from 'react';
import { DollarSign, Landmark, Smartphone, Plus, AlertTriangle } from 'lucide-react';
import { fmtMoney, contractorOwedOnWO } from '@/lib/utils';
import type { EnrichedWorkOrder, Contractor, Payment } from '@/lib/types';

// One contractor's slice of a work order: their share of the pay, what they've
// been paid so far on it, and what's still owed to them.
type PayableRow = EnrichedWorkOrder & { share: number; sharePaid: number; shareRemaining: number };

const PAYMENT_STATUS_META: Record<string, { bg: string; color: string; label: string }> = {
  pending: { bg: 'rgba(245,158,11,0.12)', color: '#b45309', label: 'Unpaid'  },
  partial: { bg: 'rgba(99,102,241,0.12)', color: '#4338ca', label: 'Partial' },
  paid:    { bg: 'rgba(5,150,105,0.15)',  color: '#065f46', label: 'Paid'    },
};

export default function PayablesView({
  workOrders,
  contractors,
  payments,
  onPay,
  onQuickPay,
  onEditWO,
}: {
  workOrders: EnrichedWorkOrder[];
  contractors: Contractor[];
  payments: Payment[];
  onPay: (w: EnrichedWorkOrder) => void;
  onQuickPay: () => void;
  /** Opens the work order editor — where a tech and their pay get set. */
  onEditWO: (w: EnrichedWorkOrder) => void;
}) {
  // Jobs that cannot be paid as they stand. Two distinct faults, and the
  // difference matters: one hides the money entirely, the other overstates it.
  //
  //  · no tech   — nobody's name on it, so it never reaches a payables row and
  //                the amount is invisible here.
  //  · no split  — contractor_pay is empty, so woTechPayTotal falls back to
  //                "the tech gets the whole client price". That is the legacy
  //                rule for old rows, and on a job with a real margin it
  //                overstates what is owed by exactly the profit.
  const needsSetup = useMemo(() => {
    const rows = workOrders
      .filter((w) => !w.archived_at)
      .map((w) => {
        const names = (w.contractor_names && w.contractor_names.length > 0)
          ? w.contractor_names
          : (w.contractor_name ? [w.contractor_name] : []);
        const hasTech = names.some((n) => n && n.trim() !== '');
        const hasSplit = Boolean(w.contractor_pay && Object.keys(w.contractor_pay).length > 0);
        if (hasTech && hasSplit) return null;
        return { wo: w, hasTech, hasSplit };
      })
      .filter((r): r is { wo: EnrichedWorkOrder; hasTech: boolean; hasSplit: boolean } => r !== null);
    return {
      rows,
      noTech: rows.filter((r) => !r.hasTech),
      noSplit: rows.filter((r) => r.hasTech && !r.hasSplit),
      hiddenMoney: rows.filter((r) => !r.hasTech)
        .reduce((s, r) => s + Number(r.wo.total_amount ?? 0), 0),
    };
  }, [workOrders]);
  const groups = useMemo(() => {
    // Break each WO into per-tech rows so multi-tech jobs show what each tech
    // is owed (their share from contractor_pay), not just the primary.
    const map = new Map<string, PayableRow[]>();
    for (const w of workOrders) {
      const names = (w.contractor_names && w.contractor_names.length > 0)
        ? w.contractor_names
        : (w.contractor_name ? [w.contractor_name] : []);
      for (const name of names) {
        const share = contractorOwedOnWO(w, name);
        if (share <= 0) continue;
        const sharePaid = payments
          .filter((p) => p.wo_number === w.wo_number && p.contractor_name === name)
          .reduce((s, p) => s + Number(p.amount), 0);
        const shareRemaining = Math.max(0, share - sharePaid);
        if (shareRemaining <= 0) continue;
        map.set(name, [...(map.get(name) ?? []), { ...w, share, sharePaid, shareRemaining }]);
      }
    }
    return Array.from(map.entries())
      .map(([name, wos]) => ({
        name,
        wos,
        total: wos.reduce((s, w) => s + w.shareRemaining, 0),
        contractor: contractors.find((c) => c.name === name) ?? null,
      }))
      .sort((a, b) => b.total - a.total);
  }, [workOrders, contractors, payments]);

  const grandTotal = groups.reduce((s, g) => s + g.total, 0);

  return (
    <div className="view-inner" style={{ maxWidth: 960, margin: '0 auto' }}>
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

      {/* Jobs blocking a clean payroll run. Shown before the payable list
          because the total above is wrong until these are dealt with, and a
          number that looks finished is worse than one that admits it isn't. */}
      {needsSetup.rows.length > 0 && (
        <div className="glass card" style={{ marginBottom: 20, border: '1.5px solid rgba(180,83,9,0.3)', background: 'rgba(245,158,11,0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <AlertTriangle size={16} color="#b45309" />
            <div style={{ fontWeight: 800, fontSize: 15, color: '#b45309' }}>
              {needsSetup.rows.length} job{needsSetup.rows.length !== 1 ? 's' : ''} can’t be paid correctly yet
            </div>
          </div>
          <div style={{ fontSize: 13, color: '#7c5308', lineHeight: 1.6, marginBottom: 12 }}>
            {needsSetup.noTech.length > 0 && (
              <div>
                <b>{needsSetup.noTech.length} with no tech assigned</b> — {fmtMoney(needsSetup.hiddenMoney)} of
                work that no one can be paid for. These do not appear in the total above.
              </div>
            )}
            {needsSetup.noSplit.length > 0 && (
              <div>
                <b>{needsSetup.noSplit.length} with no tech pay set</b> — these currently assume the tech
                gets the <b>full client price</b>, so the amount owed is overstated by whatever your margin is.
              </div>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
            {needsSetup.rows.slice(0, 40).map(({ wo, hasTech }) => (
              <div key={wo.id} style={{
                display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                background: '#fff', border: '1px solid #eee', borderRadius: 8, padding: '8px 11px',
              }}>
                <span style={{ fontWeight: 700, fontSize: 13, minWidth: 90 }}>WO#{wo.wo_number}</span>
                <span style={{ fontSize: 12.5, color: '#666', flex: 1, minWidth: 120 }}>
                  {wo.site_name || wo.title || wo.customer_name || '—'}
                </span>
                <span style={{ fontSize: 12.5, fontWeight: 700 }}>{fmtMoney(Number(wo.total_amount ?? 0))}</span>
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 20,
                  background: hasTech ? 'rgba(99,102,241,0.12)' : 'rgba(185,28,28,0.1)',
                  color: hasTech ? '#4338ca' : '#b91c1c',
                }}>
                  {hasTech ? 'set tech pay' : 'no tech'}
                </span>
                <button className="btn btn-ghost" style={{ fontSize: 12, padding: '5px 10px' }}
                  onClick={() => onEditWO(wo)}>
                  Fix
                </button>
              </div>
            ))}
            {needsSetup.rows.length > 40 && (
              <div style={{ fontSize: 12, color: '#999', padding: '4px 2px' }}>
                …and {needsSetup.rows.length - 40} more.
              </div>
            )}
          </div>
        </div>
      )}

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
  wos: PayableRow[];
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
            const status = w.sharePaid <= 0 ? 'pending' : 'partial';
            const pm = PAYMENT_STATUS_META[status];
            const isSplit = !!(w.contractor_names && w.contractor_names.length >= 2);
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
                  {isSplit && (
                    <span style={{ marginLeft: 6, padding: '3px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: 'rgba(13,115,119,0.1)', color: 'var(--teal)', whiteSpace: 'nowrap' }}>
                      their share
                    </span>
                  )}
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'right', color: '#555' }}>
                  {fmtMoney(w.share)}
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'right', color: '#047857', fontWeight: 600 }}>
                  {fmtMoney(w.sharePaid)}
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 700, color: '#b91c1c' }}>
                  {fmtMoney(w.shareRemaining)}
                </td>
                <td style={{ padding: '12px 16px' }}>
                  <button
                    onClick={() => onPay({ ...w, contractor_name: name, remaining: w.shareRemaining })}
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
