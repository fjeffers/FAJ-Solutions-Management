'use client';
import { useState } from 'react';
import {
  X, CreditCard, Calendar, DollarSign, FileText,
  ExternalLink, CheckCircle2, Smartphone, Landmark,
} from 'lucide-react';
import { fmtMoney, sortByWO } from '@/lib/utils';
import type { Payment, WorkOrder, Contractor } from '@/lib/types';
import { PAYMENT_METHODS } from '@/lib/types';

type Props = {
  item: Payment | null;
  workOrders: WorkOrder[];
  contractors?: Contractor[];
  prefill?: Partial<Payment>;
  onSave: (p: Partial<Payment>) => void;
  onClose: () => void;
};

export default function PaymentModal({ item, workOrders, contractors = [], prefill, onSave, onClose }: Props) {
  const defaultForm: Partial<Payment> = {
    wo_number: '', contractor_name: '',
    payment_date: new Date().toISOString().split('T')[0],
    amount: 0, method: 'Check', notes: '',
  };
  const [form, setForm] = useState<Partial<Payment>>(item ?? prefill ?? defaultForm);
  const [zelleStep, setZelleStep] = useState<'idle' | 'ready' | 'confirmed'>('idle');

  const handleWOChange = (wo: string) => {
    const found = workOrders.find((w) => w.wo_number === wo);
    setForm((f) => ({ ...f, wo_number: wo, contractor_name: found?.contractor_name ?? f.contractor_name ?? '' }));
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

  const canSave = !!(form.wo_number && form.amount && Number(form.amount) > 0 && form.payment_date);
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
          {/* WO selector */}
          <PF label="Work Order *" icon={<FileText size={14} />}>
            <select className="select input" value={form.wo_number ?? ''} onChange={(e) => handleWOChange(e.target.value)} autoFocus>
              <option value="">Select work order</option>
              {sortByWO(workOrders).map((w) => (
                <option key={w.id} value={w.wo_number}>
                  WO#{w.wo_number} — {w.contractor_name} ({fmtMoney(Number(w.total_amount))})
                </option>
              ))}
            </select>
          </PF>

          {/* Contractor chip */}
          {form.contractor_name && (
            <div style={{ padding: '10px 14px', background: 'rgba(13,115,119,0.06)', border: '1px solid rgba(13,115,119,0.15)', borderRadius: 10, fontSize: 13, color: 'var(--teal)', fontWeight: 600 }}>
              Contractor: {form.contractor_name}
            </div>
          )}

          {/* Date + Amount */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <PF label="Date *" icon={<Calendar size={14} />}>
              <input className="input" type="date" value={form.payment_date ?? ''} onChange={(e) => setForm((f) => ({ ...f, payment_date: e.target.value }))} />
            </PF>
            <PF label="Amount *" icon={<DollarSign size={14} />}>
              <input className="input" type="number" step="0.01" min="0" value={form.amount ?? ''} onChange={(e) => setForm((f) => ({ ...f, amount: Number(e.target.value) }))} placeholder="0.00" />
            </PF>
          </div>

          {/* Method */}
          <PF label="Payment Method" icon={<CreditCard size={14} />}>
            <select
              className="select input"
              value={form.method ?? 'Check'}
              onChange={(e) => { setForm((f) => ({ ...f, method: e.target.value })); setZelleStep('idle'); }}
            >
              {PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}
            </select>
          </PF>

          {/* ── Zelle card ── */}
          {isZelle && (
            <div style={{ borderRadius: 14, overflow: 'hidden', border: '1px solid rgba(107,45,139,0.2)' }}>
              <div style={{ background: 'linear-gradient(135deg, #6B2D8B 0%, #4a1f62 100%)', padding: '16px 20px', color: 'white' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                  <Smartphone size={18} />
                  <span style={{ fontWeight: 700, fontSize: 14 }}>Send via Zelle</span>
                </div>
                {zelleTarget
                  ? <div style={{ fontSize: 13, opacity: 0.85 }}>Sending to: <strong>{zelleTarget}</strong>{form.amount ? <span> · <strong>{fmtMoney(Number(form.amount))}</strong></span> : null}</div>
                  : <div style={{ fontSize: 13, opacity: 0.75 }}>No Zelle info on file — add it to the contractor profile</div>
                }
              </div>
              <div style={{ background: 'rgba(107,45,139,0.04)', padding: '14px 20px' }}>
                {zelleStep === 'idle' && (
                  <button type="button" className="btn btn-zelle" onClick={launchZelle} style={{ width: '100%', justifyContent: 'center' }}>
                    <ExternalLink size={14} /> Open Zelle App
                  </button>
                )}
                {zelleStep === 'ready' && (
                  <div>
                    <div style={{ fontSize: 13, color: '#555', marginBottom: 10 }}>Zelle opened — did you complete the payment?</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button type="button" className="btn btn-primary" onClick={() => setZelleStep('confirmed')} style={{ flex: 1, justifyContent: 'center' }}>
                        <CheckCircle2 size={14} /> Yes, Payment Sent
                      </button>
                      <button type="button" className="btn btn-ghost" onClick={() => setZelleStep('idle')} style={{ justifyContent: 'center' }}>Not yet</button>
                    </div>
                  </div>
                )}
                {zelleStep === 'confirmed' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#047857', fontWeight: 700, fontSize: 14 }}>
                    <CheckCircle2 size={18} /> Zelle payment confirmed — save below to record it
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Direct Deposit card ── */}
          {isDirectDeposit && (
            <div style={{ borderRadius: 14, overflow: 'hidden', border: '1px solid rgba(13,115,119,0.2)' }}>
              <div style={{ background: 'linear-gradient(135deg, #0D7377 0%, #0a5a5d 100%)', padding: '16px 20px', color: 'white' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                  <Landmark size={18} />
                  <span style={{ fontWeight: 700, fontSize: 14 }}>Direct Deposit / ACH</span>
                </div>
                {hasBanking ? (
                  <div style={{ fontSize: 13, opacity: 0.9 }}>
                    Transfer <strong>{form.amount ? fmtMoney(Number(form.amount)) : '—'}</strong> to the account below
                  </div>
                ) : (
                  <div style={{ fontSize: 13, opacity: 0.75 }}>No banking info on file for this contractor</div>
                )}
              </div>
              {hasBanking && (
                <div style={{ background: 'rgba(13,115,119,0.04)', padding: '16px 20px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 13 }}>
                    <InfoRow label="Bank" value={contractor?.bank_name ?? '—'} />
                    <InfoRow label="Account Type" value={contractor?.account_type ?? 'checking'} capitalize />
                    <InfoRow label="Account Holder" value={contractor?.account_holder_name ?? contractor?.name ?? '—'} />
                    <InfoRow label="Account #" value={`···· ${contractor?.account_number?.slice(-4)}`} />
                    <InfoRow label="Routing # (ABA)" value={contractor?.routing_number ?? '—'} mono />
                  </div>
                  <div style={{ marginTop: 12, fontSize: 11, color: '#888' }}>
                    Copy routing and account numbers to your bank's ACH / wire transfer form.
                  </div>
                </div>
              )}
              {!hasBanking && (
                <div style={{ padding: '14px 20px', fontSize: 13, color: '#888' }}>
                  Add banking info in the contractor profile to see account details here.
                </div>
              )}
            </div>
          )}

          {/* Notes */}
          <PF label="Notes" icon={<FileText size={14} />}>
            <input className="input" value={form.notes ?? ''} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Optional note..." />
          </PF>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 28 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} style={{ flex: 1, justifyContent: 'center' }}>Cancel</button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => canSave && onSave(form)}
            disabled={!canSave || (isZelle && zelleStep === 'ready')}
            style={{ flex: 2, justifyContent: 'center' }}
          >
            {item ? 'Save Changes' : 'Record Payment'}
          </button>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value, capitalize, mono }: { label: string; value: string; capitalize?: boolean; mono?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>{label}</div>
      <div style={{ fontWeight: 600, color: '#1a1a1a', textTransform: capitalize ? 'capitalize' : undefined, fontFamily: mono ? 'monospace' : undefined }}>
        {value}
      </div>
    </div>
  );
}

function PF({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: '#555', marginBottom: 6, letterSpacing: 0.5, textTransform: 'uppercase' }}>
        {icon} {label}
      </label>
      {children}
    </div>
  );
}
