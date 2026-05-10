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
  const [manualWO, setManualWO] = useState(false);

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
          {/* WO selector — toggle between existing and manual */}
          <PF label="Work Order *" icon={<FileText size={14} />}>
            <div style={{ display: 'flex', gap: 0, marginBottom: 8, borderRadius: 8, overflow: 'hidden', border: '1px solid #e0e0e0' }}>
              <button type="button" onClick={() => setManualWO(false)} style={{ flex: 1, padding: '6px 0', fontSize: 11, fontWeight: 700, border: 'none', cursor: 'pointer', background: !manualWO ? 'var(--teal, #0D7377)' : 'white', color: !manualWO ? 'white' : '#888' }}>
                Select Existing
              </button>
              <button type="button" onClick={() => setManualWO(true)} style={{ flex: 1, padding: '6px 0', fontSize: 11, fontWeight: 700, border: 'none', cursor: 'pointer', background: manualWO ? 'var(--teal, #0D7377)' : 'white', color: manualWO ? 'white' : '#888' }}>
                Enter WO# Manually
              </button>
            </div>
            {!manualWO ? (
              <select className="select input" value={form.wo_number ?? ''} onChange={(e) => handleWOChange(e.target.value)} autoFocus>
                <option value="">Select work order</option>
                {sortByWO(workOrders).map((w) => (
                  <option key={w.id} value={w.wo_number}>
                    WO#{.wo_number} — {w.contractor_name} ({fmtMoney(Number(w.total_amount))})
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="input"
                value={form.wo_number ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, wo_number: e.target.value }))}
                placeholder="e.g. 12345 or WO-099"
                autoFocus
              />
            )}
          </PF>

          {/* Contractor selector — shown when entering WO# manually */}
          {manualWO && (
            <PF label="Contractor *" icon={<FileText size={14} />}>
              <select className="select input" value={form.contractor_name ?? ''} onChange={(e) => setForm((f) => ({ ...f, contractor_name: e.target.value }))}>
                <option value="">Select contractor</option>
                {contractors.map((c) => (
                  <option key={c.id} value={c.name}>{c.name}</option>
                ))}
              </select>
            </PF>
          )}