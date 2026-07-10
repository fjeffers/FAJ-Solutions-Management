'use client';
import { useState } from 'react';
import {
  X, CreditCard, Calendar, DollarSign, FileText,
  ExternalLink, CheckCircle2, Smartphone, Landmark,
} from 'lucide-react';
import { fmtMoney, sortByWO, contractorShareOfWO } from '@/lib/utils';
import type { Payment, WorkOrder, Contractor } from '@/lib/types';
import { PAYMENT_METHODS } from '@/lib/types';

function techsOnWO(w: WorkOrder): string[] {
  return (w.contractor_names && w.contractor_names.length > 0)
    ? w.contractor_names
    : (w.contractor_name ? [w.contractor_name] : []);
}

// A contractor's usual way of getting paid, from their profile
function preferredMethod(c: Contractor | undefined): string {
  if (c?.routing_number && c?.account_number) return 'Direct Deposit';
  if (c?.zelle_phone) return 'Zelle';
  return 'Check';
}

type Props = {
  item: Payment | null;
  workOrders: WorkOrder[];
  contractors?: Contractor[];
  payments?: Payment[];
  prefill?: Partial<Payment>;
  onSave: (p: Partial<Payment>) => void;
  onClose: () => void;
};

export default function PaymentModal({ item, workOrders, contractors = [], payments = [], prefill, onSave, onClose }: Props) {
  const defaultForm: Partial<Payment> = {
    wo_number: '', contractor_name: '',
    payment_date: new Date().toISOString().split('T')[0],
    amount: 0, method: 'Check', notes: '',
  };
  const [form, setForm] = useState<Partial<Payment>>(item ?? prefill ?? defaultForm);
  const [zelleStep, setZelleStep] = useState<'idle' | 'ready' | 'confirmed'>('idle');
  const [manualWO, setManualWO] = useState(false);

  // Payment history for the selected WO (excluding the current item being edited)
  const selectedWO = workOrders.find((w) => w.wo_number === form.wo_number);
  const priorPayments = payments
    .filter((p) => p.wo_number === form.wo_number && p.id !== item?.id)
    .sort((a, b) => new Date(b.payment_date).getTime() - new Date(a.payment_date).getTime());
  const totalPaid = priorPayments.reduce((sum, p) => sum + Number(p.amount), 0);
  const woTotal = Number(selectedWO?.total_amount ?? 0);
  const remaining = woTotal > 0 ? woTotal - totalPaid : null;

  // What this tech is still owed on a WO (their split share minus payments to them)
  const techRemaining = (w: WorkOrder, tech: string): number => {
    const share = contractorShareOfWO(w, tech);
    const paid = payments
      .filter((p) => p.wo_number === w.wo_number && p.contractor_name === tech && p.id !== item?.id)
      .reduce((s, p) => s + Number(p.amount), 0);
    return Math.max(0, share - paid);
  };

  const handleTechChange = (name: string) => {
    const c = contractors.find((x) => x.name === name);
    setForm((f) => ({
      ...f,
      contractor_name: name,
      // New payments default to how this tech usually gets paid; edits keep the recorded method
      method: item ? f.method : preferredMethod(c),
    }));
    setZelleStep('idle');
  };

  const handleWOChange = (wo: string) => {
    const found = workOrders.find((w) => w.wo_number === wo);
    setForm((f) => {
      // Don't clobber a tech the user already picked; fill from the WO only when empty
      const contractor_name = f.contractor_name || found?.contractor_name || '';
      let amount = f.amount;
      // New payment with no amount yet: prefill what this tech is still owed on the job
      if (!item && found && contractor_name && (!amount || Number(amount) === 0)) {
        const rem = techRemaining(found, contractor_name);
        if (rem > 0) amount = rem;
      }
      return { ...f, wo_number: wo, contractor_name, amount };
    });
  };

  const contractor = contractors.find((c) => c.name === form.contractor_name);
  const zelleTarget = contractor?.zelle_phone || contractor?.phone || contractor?.email;
  const hasBanking = !!(contractor?.routing_number && contractor?.account_number);

  const launchZelle = () => {
    if (zelleTarget) {
      const encoded = encodeURIComponent(zelleTarget);
      window.location.href = `zelle://send?token=${encoded}&amount=${form.amount ?? 0}`;
      setTimeout(() => { window.open('https://www.zellepay.com', '_blank'); }, 1500);
    } else {
      window.open('https://www.zellepay.com', '_blank');
    }
    setZelleStep('ready');
  };

  const canSave = !!(form.wo_number && form.contractor_name && form.amount && Number(form.amount) > 0 && form.payment_date);
  const isZelle = form.method === 'Zelle';
  const isDirectDeposit = form.method === 'Direct Deposit';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <div className="display" style={{ fontSize: 11, color: 'var(--teal)', letterSpacing: 2, marginBottom: 4 }}>
              {item ? 'EDIT' : 'LOG'} PAYMENT
            </div>
            <h2 className="serif" style={{ fontSize: 26, margin: 0, fontWeight: 600 }}>
              {item ? 'Edit Payment' : 'Record a Payment'}
            </h2>
          </div>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Who — first, so the job list below narrows to their work */}
          <PF label="Paid To *" icon={<FileText size={14} />}>
            <select className="select input" value={form.contractor_name ?? ''}
              onChange={(e) => handleTechChange(e.target.value)} autoFocus>
              <option value="">Select tech</option>
              {contractors.map((c) => (
                <option key={c.id} value={c.name}>{c.name}</option>
              ))}
              {form.contractor_name && !contractors.some((c) => c.name === form.contractor_name) && (
                <option value={form.contractor_name}>{form.contractor_name}</option>
              )}
            </select>
          </PF>

          {/* WO selector */}
          <PF label="Work Order *" icon={<FileText size={14} />}>
            <div style={{ display: 'flex', gap: 0, marginBottom: 8, borderRadius: 8, overflow: 'hidden', border: '1px solid #e0e0e0' }}>
              <button type="button" onClick={() => setManualWO(false)}
                style={{ flex: 1, padding: '6px 0', fontSize: 11, fontWeight: 700, border: 'none', cursor: 'pointer',
                  background: !manualWO ? 'var(--teal, #0D7377)' : 'white', color: !manualWO ? 'white' : '#888' }}>
                Select Existing
              </button>
              <button type="button" onClick={() => setManualWO(true)}
                style={{ flex: 1, padding: '6px 0', fontSize: 11, fontWeight: 700, border: 'none', cursor: 'pointer',
                  background: manualWO ? 'var(--teal, #0D7377)' : 'white', color: manualWO ? 'white' : '#888' }}>
                Enter WO# Manually
              </button>
            </div>
            {!manualWO ? (
              <select className="select input" value={form.wo_number ?? ''} onChange={(e) => handleWOChange(e.target.value)}>
                <option value="">Select work order</option>
                {(() => {
                  const tech = form.contractor_name;
                  const mine = tech ? sortByWO(workOrders.filter((w) => techsOnWO(w).includes(tech))) : [];
                  const rest = sortByWO(workOrders.filter((w) => !mine.some((m) => m.id === w.id)));
                  const label = (w: WorkOrder) => `WO#${w.wo_number}${w.title ? ` — ${w.title}` : ` — ${w.contractor_name}`}`;
                  if (!tech) {
                    return rest.map((w) => (
                      <option key={w.id} value={w.wo_number}>{label(w)} ({fmtMoney(Number(w.total_amount))})</option>
                    ));
                  }
                  return [
                    <optgroup key="mine" label={`${tech}'s jobs`}>
                      {mine.map((w) => {
                        const rem = techRemaining(w, tech);
                        return (
                          <option key={w.id} value={w.wo_number}>
                            {label(w)} {rem > 0 ? `(owed ${fmtMoney(rem)})` : '(paid up)'}
                          </option>
                        );
                      })}
                    </optgroup>,
                    <optgroup key="rest" label="Other work orders">
                      {rest.map((w) => (
                        <option key={w.id} value={w.wo_number}>{label(w)} ({fmtMoney(Number(w.total_amount))})</option>
                      ))}
                    </optgroup>,
                  ];
                })()}
              </select>
            ) : (
              <input className="input" value={form.wo_number ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, wo_number: e.target.value }))}
                placeholder="e.g. 12345 or WO-099" autoFocus />
            )}
          </PF>

          {/* Prior payments panel — shown when a WO is selected */}
          {form.wo_number && (
            <div style={{ borderRadius: 12, border: '1.5px solid rgba(13,115,119,0.2)', background: 'rgba(13,115,119,0.04)', overflow: 'hidden' }}>
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px',
                borderBottom: priorPayments.length > 0 ? '1px solid rgba(13,115,119,0.12)' : undefined }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <CreditCard size={13} color="var(--teal, #0D7377)" />
                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--teal, #0D7377)' }}>
                    Payment History — WO#{form.wo_number}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                  {woTotal > 0 && (
                    <span style={{ fontSize: 11, color: '#888' }}>
                      WO Total: <strong style={{ color: '#333' }}>{fmtMoney(woTotal)}</strong>
                    </span>
                  )}
                  <span style={{ fontSize: 11, color: '#888' }}>
                    Paid: <strong style={{ color: totalPaid > 0 ? '#b45309' : '#333' }}>{fmtMoney(totalPaid)}</strong>
                  </span>
                  {remaining !== null && (
                    <span style={{ fontSize: 11, color: '#888' }}>
                      Remaining: <strong style={{ color: remaining <= 0 ? '#059669' : '#dc2626' }}>{fmtMoney(remaining)}</strong>
                    </span>
                  )}
                </div>
              </div>
              {/* Rows */}
              {priorPayments.length === 0 ? (
                <div style={{ padding: '10px 14px', fontSize: 12, color: '#aaa', fontStyle: 'italic' }}>
                  No payments recorded for this work order yet.
                </div>
              ) : (
                <div>
                  {priorPayments.map((p, i) => (
                    <div key={p.id ?? i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '8px 14px',
                      borderBottom: i < priorPayments.length - 1 ? '1px solid rgba(0,0,0,0.05)' : undefined,
                      background: i % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.015)' }}>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flex: 1 }}>
                        <span style={{ fontSize: 11, color: '#888', minWidth: 78 }}>{p.payment_date}</span>
                        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, padding: '2px 7px', borderRadius: 99,
                          background: p.method === 'Zelle' ? 'rgba(107,45,139,0.12)' : 'rgba(13,115,119,0.1)',
                          color: p.method === 'Zelle' ? '#6B2D8B' : 'var(--teal, #0D7377)' }}>
                          {p.method ?? 'Check'}
                        </span>
                        {p.notes && (
                          <span style={{ fontSize: 11, color: '#666', fontStyle: 'italic', overflow: 'hidden',
                            textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>
                            {p.notes}
                          </span>
                        )}
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#333', minWidth: 64, textAlign: 'right' }}>
                        {fmtMoney(Number(p.amount))}
                      </span>
                    </div>
                  ))}
                  {/* Totals row */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '8px 14px', background: 'rgba(13,115,119,0.07)', borderTop: '1.5px solid rgba(13,115,119,0.15)' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#555', letterSpacing: 0.5, textTransform: 'uppercase' }}>
                      Total Paid ({priorPayments.length} payment{priorPayments.length !== 1 ? 's' : ''})
                    </span>
                    <span style={{ fontSize: 14, fontWeight: 800, color: '#333' }}>{fmtMoney(totalPaid)}</span>
                  </div>
                </div>
              )}
            </div>
          )}


          {/* Date */}
          <PF label="Payment Date *" icon={<Calendar size={14} />}>
            <input className="input" type="date" value={form.payment_date ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, payment_date: e.target.value }))} />
          </PF>

          {/* Amount */}
          <PF label="Amount *" icon={<DollarSign size={14} />}>
            <input className="input" type="number" min="0" step="0.01" value={form.amount ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, amount: Number(e.target.value) }))} placeholder="0.00" />
          </PF>

          {/* Payment method */}
          <PF label="Payment Method" icon={<CreditCard size={14} />}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {PAYMENT_METHODS.map((m) => (
                <button key={m} type="button"
                  className={'filter-chip ' + (form.method === m ? 'active' : '')}
                  onClick={() => { setForm((f) => ({ ...f, method: m })); setZelleStep('idle'); }}>
                  {m}
                </button>
              ))}
            </div>
          </PF>

          {/* Notes */}
          <PF label="Notes / Purpose" icon={<FileText size={14} />}>
            <input className="input" value={form.notes ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="What was this payment for?" />
          </PF>

          {/* Zelle flow — only when recording a new payment; edits don't re-send money */}
          {isZelle && !item && (
            <div style={{ padding: '14px 16px', borderRadius: 10, background: 'rgba(107,45,139,0.07)', border: '1.5px solid rgba(107,45,139,0.18)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <Smartphone size={14} color="#6B2D8B" />
                <span style={{ fontSize: 13, fontWeight: 700, color: '#6B2D8B' }}>Zelle Payment</span>
              </div>
              {zelleTarget && (
                <div style={{ fontSize: 12, color: '#888', marginBottom: 10 }}>
                  Send to: <strong style={{ color: '#6B2D8B' }}>{zelleTarget}</strong>
                  {form.amount ? ` · ${fmtMoney(Number(form.amount))}` : ''}
                </div>
              )}
              {zelleStep === 'idle' && (
                <button type="button" className="btn btn-primary"
                  style={{ background: '#6B2D8B', width: '100%', justifyContent: 'center', gap: 6 }}
                  onClick={launchZelle}>
                  <ExternalLink size={13} /> Open Zelle App
                </button>
              )}
              {zelleStep === 'ready' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontSize: 12, color: '#666' }}>Did you complete the Zelle payment?</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" className="btn btn-primary"
                      style={{ flex: 1, background: '#047857', justifyContent: 'center', gap: 5 }}
                      onClick={() => setZelleStep('confirmed')}>
                      <CheckCircle2 size={13} /> Yes, paid
                    </button>
                    <button type="button" className="btn btn-ghost" style={{ flex: 1 }}
                      onClick={() => setZelleStep('idle')}>
                      Not yet
                    </button>
                  </div>
                </div>
              )}
              {zelleStep === 'confirmed' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#047857', fontSize: 13, fontWeight: 700 }}>
                  <CheckCircle2 size={15} /> Zelle payment confirmed — click Save to record.
                </div>
              )}
            </div>
          )}

          {/* Direct Deposit info */}
          {isDirectDeposit && hasBanking && (
            <div style={{ padding: '12px 16px', borderRadius: 10, background: 'rgba(5,150,105,0.06)', border: '1.5px solid rgba(5,150,105,0.18)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <Landmark size={14} color="#059669" />
                <span style={{ fontSize: 12, fontWeight: 700, color: '#059669' }}>Banking info on file</span>
              </div>
              <div style={{ fontSize: 12, color: '#555', display: 'flex', flexWrap: 'wrap', gap: 16 }}>
                {contractor?.bank_name && <span>Bank: <strong>{contractor.bank_name}</strong></span>}
                <span>Account: <strong>····{contractor?.account_number?.slice(-4)}</strong></span>
                <span>Routing: <strong>{contractor?.routing_number}</strong></span>
                <span>Type: <strong>{contractor?.account_type ?? 'checking'}</strong></span>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24, paddingTop: 16, borderTop: '1px solid #f0f0f0' }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary"
            // The Zelle send-first gate only applies when recording a NEW payment —
            // editing an already-recorded one must always be savable.
            disabled={!canSave || (!item && isZelle && zelleStep === 'idle' && !!zelleTarget)}
            onClick={() => canSave && onSave(form)}>
            {item ? 'Save Changes' : 'Record Payment'}
          </button>
        </div>
      </div>
    </div>
  );
}

function PF({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700,
        letterSpacing: 0.5, textTransform: 'uppercase', color: '#888', marginBottom: 6 }}>
        {icon}{label}
      </label>
      {children}
    </div>
  );
}
