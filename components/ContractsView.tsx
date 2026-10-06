'use client';
import { useMemo, useState } from 'react';
import {
  Edit2, Trash2, X, FileCheck2, Share2, Printer, ArrowRight, ClipboardList, FileSignature,
} from 'lucide-react';
import { fmtMoney, fmtDate } from '@/lib/utils';
import { contractStage, DEFAULT_CLAUSES } from '@/lib/contracts';
import { createClient } from '@/lib/supabase/client';
import { toastError, toastSuccess } from '@/lib/toast';
import type { Contract, ContractStatus } from '@/lib/types';
import { CONTRACT_STATUSES } from '@/lib/types';
import { backdropClose } from '@/lib/backdrop';

const STATUS_META: Record<ContractStatus, { label: string; color: string; bg: string }> = {
  draft:    { label: 'Draft',    color: '#666',    bg: 'rgba(0,0,0,0.06)' },
  sent:     { label: 'Sent',     color: '#1D4ED8', bg: 'rgba(59,130,246,0.12)' },
  signed:   { label: 'Signed',   color: '#047857', bg: 'rgba(16,185,129,0.12)' },
  declined: { label: 'Declined', color: '#b91c1c', bg: 'rgba(239,68,68,0.12)' },
  void:     { label: 'Void',     color: '#999',    bg: 'rgba(0,0,0,0.04)' },
};

/** The full chain, drawn on the card. A contract is the last link. */
function Chain({ c }: { c: Contract }) {
  const step = (label: string, done: boolean) => (
    <span style={{
      fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase',
      color: done ? '#047857' : '#c4c4c4',
    }}>{label}</span>
  );
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      {step('Survey', !!c.survey_id)}
      <ArrowRight size={10} color={c.quote_id ? '#047857' : '#ddd'} />
      {step('Quote', !!c.quote_id)}
      <ArrowRight size={10} color={c.signed_at ? '#047857' : '#ddd'} />
      {step('Contract', !!c.signed_at)}
    </div>
  );
}

export default function ContractsView({
  contracts, onSave, onDelete, onOpenQuote, onOpenSurvey,
}: {
  contracts: Contract[];
  onSave: (c: Partial<Contract>) => Promise<void>;
  onDelete: (id: string) => void;
  onOpenQuote: (quoteId: string) => void;
  onOpenSurvey: (surveyId: string) => void;
}) {
  const [editing, setEditing] = useState<Contract | null>(null);
  const supabase = createClient();

  const sorted = useMemo(
    () => [...contracts].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [contracts],
  );

  // Money on paper but not yet signed — the number worth chasing.
  const outstanding = useMemo(
    () => contracts.filter((c) => !c.signed_at && c.status !== 'void' && c.status !== 'declined')
      .reduce((sum, c) => sum + Number(c.total || 0), 0),
    [contracts],
  );

  const share = async (c: Contract) => {
    const { data } = await supabase.from('contracts').select('share_token').eq('id', c.id).single();
    let token = (data?.share_token as string | null) ?? null;
    if (!token) {
      token = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '');
      const { error } = await supabase.from('contracts')
        .update({ share_token: token, updated_at: new Date().toISOString() }).eq('id', c.id);
      if (error) { toastError(`Couldn't create share link: ${error.message}`); return; }
    }
    const url = `${window.location.origin}/contract/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      toastSuccess('Contract link copied — send it to your client to sign');
    } catch {
      window.prompt('Copy this contract link:', url);
    }
  };

  return (
    <div className="view-inner" style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="display" style={{ fontSize: 11, color: 'var(--teal)', letterSpacing: 3, marginBottom: 6 }}>AGREEMENTS</div>
          <h1 className="serif" style={{ fontSize: 36, fontWeight: 600, margin: 0, lineHeight: 1 }}>Contracts</h1>
          <p style={{ margin: '6px 0 0', color: '#666', fontSize: 14 }}>
            {contracts.length} contract{contracts.length !== 1 ? 's' : ''}
            {outstanding > 0 && <> · <strong style={{ color: 'var(--teal)' }}>{fmtMoney(outstanding)}</strong> out for signature</>}
          </p>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="glass card" style={{ textAlign: 'center', padding: '56px 24px', color: '#aaa' }}>
          <FileCheck2 size={28} color="#ddd" style={{ marginBottom: 8 }} />
          <div>No contracts yet.</div>
          <div style={{ fontSize: 12, marginTop: 6 }}>
            Accept a quote and build its contract from the Quotes tab — the scope and the money come across with it.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {sorted.map((c) => {
            const sm = STATUS_META[c.status] ?? STATUS_META.draft;
            const stage = contractStage(c);
            return (
              <div key={c.id} className="glass card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 240 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--teal)' }}>{c.contract_number}</span>
                    <span style={{ padding: '2px 9px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: sm.bg, color: sm.color }}>{sm.label}</span>
                    {stage === 'signed' && c.signed_at && (
                      <span style={{ fontSize: 11, color: '#047857' }}>signed {fmtDate(c.signed_at)}</span>
                    )}
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{c.title || c.client_name || 'Untitled'}</div>
                  <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                    {c.client_name}{c.site_name ? ` · ${c.site_name}` : ''} · {fmtDate(c.created_at)}
                  </div>
                  <div style={{ marginTop: 7 }}><Chain c={c} /></div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--teal)' }}>{fmtMoney(c.total)}</div>
                    {c.deposit_amount != null && (
                      <div style={{ fontSize: 10, color: '#aaa' }}>{fmtMoney(c.deposit_amount)} deposit</div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button title="Share with client to sign" onClick={() => share(c)} style={{ ...ICON_BTN, color: 'var(--teal)' }}><Share2 size={15} /></button>
                    <button title="Print" onClick={() => window.print()} style={ICON_BTN}><Printer size={15} /></button>
                    {c.survey_id && (
                      <button title="Open the survey behind it" onClick={() => onOpenSurvey(c.survey_id!)} style={{ ...ICON_BTN, color: '#7c3aed' }}><ClipboardList size={15} /></button>
                    )}
                    {c.quote_id && (
                      <button title="Open the quote" onClick={() => onOpenQuote(c.quote_id!)} style={{ ...ICON_BTN, color: '#1D4ED8' }}><FileSignature size={15} /></button>
                    )}
                    <button title="Edit" onClick={() => setEditing(c)} style={ICON_BTN}><Edit2 size={15} /></button>
                    <button
                      title="Delete"
                      onClick={() => { if (confirm(`Delete contract ${c.contract_number}? The quote and survey are kept.`)) onDelete(c.id); }}
                      style={{ ...ICON_BTN, color: '#b91c1c' }}
                    ><Trash2 size={15} /></button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <ContractModal
          item={editing}
          onSave={async (c) => { await onSave(c); setEditing(null); }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

const ICON_BTN: React.CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', padding: 6, color: '#888' };

/** Every clause is editable per job — the defaults are a starting point. */
const CLAUSES: { key: keyof Contract; label: string; rows: number }[] = [
  { key: 'scope_of_work',  label: 'Scope of Work',        rows: 5 },
  { key: 'deliverables',   label: 'Deliverables',         rows: 2 },
  { key: 'schedule_terms', label: 'Schedule',             rows: 2 },
  { key: 'price_terms',    label: 'Price',                rows: 2 },
  { key: 'payment_terms',  label: 'Payment Terms',        rows: 2 },
  { key: 'change_orders',  label: 'Change Orders',        rows: 3 },
  { key: 'warranty',       label: 'Warranty',             rows: 3 },
  { key: 'exclusions',     label: 'Exclusions',           rows: 3 },
  { key: 'access_safety',  label: 'Access & Safety',      rows: 3 },
  { key: 'insurance',      label: 'Insurance',            rows: 2 },
  { key: 'termination',    label: 'Termination',          rows: 2 },
  { key: 'governing_law',  label: 'Governing Law',        rows: 2 },
];

function ContractModal({
  item, onSave, onClose,
}: {
  item: Contract;
  onSave: (c: Partial<Contract>) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<Contract>({ ...item });
  const set = <K extends keyof Contract>(k: K, v: Contract[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }} {...backdropClose(onClose)}>
      <div className="glass card modal-solid" style={{ width: 760, maxWidth: '95vw', maxHeight: '92vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{form.contract_number}</div>
            <div style={{ fontSize: 11, color: '#999' }}>{form.client_name}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999' }}><X size={18} /></button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
            <Field label="Title"><input className="input" value={form.title ?? ''} onChange={(e) => set('title', e.target.value)} /></Field>
            <Field label="Status">
              <select className="select input" value={form.status} onChange={(e) => set('status', e.target.value as ContractStatus)}>
                {CONTRACT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
              </select>
            </Field>
            <Field label="Total"><input className="input" type="number" step="0.01" value={form.total} onChange={(e) => set('total', Number(e.target.value))} /></Field>
            <Field label="Deposit"><input className="input" type="number" step="0.01" value={form.deposit_amount ?? ''} onChange={(e) => set('deposit_amount', e.target.value === '' ? null : Number(e.target.value))} /></Field>
          </div>

          {CLAUSES.map(({ key, label, rows }) => (
            <Field key={String(key)} label={label}>
              <textarea
                className="input" rows={rows}
                value={(form[key] as string | null) ?? ''}
                onChange={(e) => set(key, e.target.value as Contract[typeof key])}
              />
            </Field>
          ))}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Provider Signatory"><input className="input" value={form.provider_signatory ?? ''} onChange={(e) => set('provider_signatory', e.target.value)} /></Field>
            <Field label="Client Signatory"><input className="input" value={form.client_signatory ?? ''} onChange={(e) => set('client_signatory', e.target.value)} /></Field>
          </div>

          <div style={{ background: 'rgba(245,158,11,0.08)', color: '#92400e', borderRadius: 10, padding: '11px 13px', fontSize: 12, lineHeight: 1.5 }}>
            These clauses are a starting point written in plain language, not legal advice.
            Have a lawyer review the wording before you rely on it — especially liability,
            warranty and termination.
          </div>
        </div>

        <div className="save-bar">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSave(form)}>Save Contract</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: '#555', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  );
}
