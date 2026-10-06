'use client';
import { useState } from 'react';
import {
  X, User, Phone, Mail, FileText, Building2, Hash, MapPin,
  CheckCircle2, Smartphone, Landmark, Eye, EyeOff,
} from 'lucide-react';
import type { Contractor, EntityType } from '@/lib/types';
import { ENTITY_TYPES } from '@/lib/types';
import { backdropClose } from '@/lib/backdrop';
import { asValues } from '@/lib/custom-fields';
import CustomFieldInputs from '@/components/CustomFieldInputs';

type Tab = 'contact' | 'w9' | 'banking';

type Props = { item: Contractor | null; onSave: (c: Partial<Contractor>) => void; onClose: () => void; };

export default function ContractorModal({ item, onSave, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('contact');
  const [showAcct, setShowAcct] = useState(false);
  const [form, setForm] = useState<Partial<Contractor>>({
    // Fred's own fields (Settings -> Custom fields); saved by saveContractor.
    custom:              asValues(item?.custom),
    name:                item?.name                ?? '',
    phone:               item?.phone               ?? '',
    email:               item?.email               ?? '',
    zelle_phone:         item?.zelle_phone         ?? '',
    notes:               item?.notes               ?? '',
    business_name:       item?.business_name       ?? '',
    entity_type:         item?.entity_type         ?? null,
    tax_id:              item?.tax_id              ?? '',
    tax_id_type:         item?.tax_id_type         ?? 'SSN',
    address:             item?.address             ?? '',
    city:                item?.city                ?? '',
    state:               item?.state               ?? '',
    zip:                 item?.zip                 ?? '',
    w9_received:         item?.w9_received         ?? false,
    on_hold:             item?.on_hold             ?? false,
    bank_name:           item?.bank_name           ?? '',
    account_holder_name: item?.account_holder_name ?? '',
    routing_number:      item?.routing_number      ?? '',
    account_number:      item?.account_number      ?? '',
    account_type:        item?.account_type        ?? 'checking',
  });

  const set = (k: keyof Contractor, v: string | boolean | null) =>
    setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name?.trim()) return;
    onSave({ ...item, ...form });
  };

  const hasBanking = !!(item?.routing_number || item?.account_number);

  const TABS: { key: Tab; label: string }[] = [
    { key: 'contact', label: 'Contact Info' },
    { key: 'w9',      label: 'W-9 / Tax Info' },
    { key: 'banking', label: hasBanking ? 'Direct Deposit ✓' : 'Direct Deposit' },
  ];

  return (
    <div className="modal-overlay" {...backdropClose(onClose)}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <div className="display" style={{ fontSize: 11, color: 'var(--teal)', letterSpacing: 2, marginBottom: 4 }}>
              {item ? 'EDIT' : 'NEW'} CONTRACTOR
            </div>
            <h2 className="serif" style={{ fontSize: 26, margin: 0, fontWeight: 600 }}>
              {item ? item.name : 'Add Contractor'}
            </h2>
          </div>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 24, borderBottom: '1px solid #eee' }}>
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              padding: '10px 20px', border: 'none', background: 'none', cursor: 'pointer',
              fontFamily: 'Inter, sans-serif', fontWeight: 700, fontSize: 13,
              color: tab === t.key ? 'var(--teal)' : '#999',
              borderBottom: tab === t.key ? '2px solid var(--teal)' : '2px solid transparent',
              marginBottom: -1, transition: 'all 0.2s',
            }}>
              {t.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit}>
          {/* ── Contact ── */}
          {tab === 'contact' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Fred, 2026-10-03: "the new techs — put a hold on them for now". */}
              <label style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, cursor: 'pointer',
                background: form.on_hold ? 'rgba(180,83,9,0.08)' : 'rgba(14,27,46,0.03)',
                border: `1px solid ${form.on_hold ? 'rgba(180,83,9,0.3)' : 'rgba(14,27,46,0.08)'}`,
              }}>
                <input type="checkbox" checked={!!form.on_hold} onChange={(e) => set('on_hold', e.target.checked)} style={{ width: 18, height: 18 }} />
                <span>
                  <span style={{ display: 'block', fontWeight: 700, fontSize: 14, color: form.on_hold ? '#b45309' : undefined }}>
                    {form.on_hold ? 'On hold' : 'Can be sent work'}
                  </span>
                  <span style={{ display: 'block', fontSize: 11, color: '#888' }}>
                    On hold: can&apos;t be picked for a ticket or a job and gets no job emails until you release them.
                  </span>
                </span>
              </label>
              <MF label="Full Name *" icon={<User size={14} />}>
                <input className="input" value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} placeholder="e.g. John Smith" required autoFocus />
              </MF>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <MF label="Phone" icon={<Phone size={14} />}>
                  <input className="input" value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} placeholder="(555) 000-0000" type="tel" />
                </MF>
                <MF label="Email" icon={<Mail size={14} />}>
                  <input className="input" value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} placeholder="contractor@email.com" type="email" />
                </MF>
              </div>
              <MF label="Zelle Phone / Email" icon={<Smartphone size={14} />}>
                <input className="input" value={form.zelle_phone ?? ''} onChange={(e) => set('zelle_phone', e.target.value)} placeholder="Phone or email used for Zelle" />
                <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>Used to pre-fill Zelle when sending payments</div>
              </MF>
              <MF label="Notes" icon={<FileText size={14} />}>
                <textarea className="input" value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} placeholder="Any notes..." rows={3} />
              </MF>
            </div>
          )}

          {/* ── W-9 / Tax ── */}
          {tab === 'w9' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div onClick={() => set('w9_received', !form.w9_received)} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px',
                borderRadius: 10, cursor: 'pointer', userSelect: 'none',
                background: form.w9_received ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.08)',
                border: `1px solid ${form.w9_received ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.2)'}`,
              }}>
                <CheckCircle2 size={20} color={form.w9_received ? '#047857' : '#b91c1c'} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: form.w9_received ? '#047857' : '#b91c1c' }}>
                    {form.w9_received ? 'W-9 Received' : 'W-9 Not Yet Received'}
                  </div>
                  <div style={{ fontSize: 11, color: '#888' }}>Click to toggle status</div>
                </div>
              </div>
              <MF label="Business / Company Name" icon={<Building2 size={14} />}>
                <input className="input" value={form.business_name ?? ''} onChange={(e) => set('business_name', e.target.value)} placeholder="If different from personal name" />
              </MF>
              <MF label="Entity Type" icon={<Building2 size={14} />}>
                <select className="select input" value={form.entity_type ?? ''} onChange={(e) => set('entity_type', (e.target.value as EntityType) || null)}>
                  <option value="">Select entity type</option>
                  {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </MF>
              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12 }}>
                <MF label="ID Type" icon={<Hash size={14} />}>
                  <select className="select input" value={form.tax_id_type ?? 'SSN'} onChange={(e) => set('tax_id_type', e.target.value as 'SSN' | 'EIN')}>
                    <option value="SSN">SSN</option>
                    <option value="EIN">EIN</option>
                  </select>
                </MF>
                <MF label="Tax ID" icon={<Hash size={14} />}>
                  <input className="input" value={form.tax_id ?? ''} onChange={(e) => set('tax_id', e.target.value)} placeholder={form.tax_id_type === 'EIN' ? 'XX-XXXXXXX' : 'XXX-XX-XXXX'} />
                </MF>
              </div>
              <MF label="Street Address" icon={<MapPin size={14} />}>
                <input className="input" value={form.address ?? ''} onChange={(e) => set('address', e.target.value)} placeholder="123 Main St" />
              </MF>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
                <MF label="City"><input className="input" value={form.city ?? ''} onChange={(e) => set('city', e.target.value)} placeholder="City" /></MF>
                <MF label="State"><input className="input" value={form.state ?? ''} onChange={(e) => set('state', e.target.value.toUpperCase())} placeholder="FL" maxLength={2} /></MF>
                <MF label="ZIP"><input className="input" value={form.zip ?? ''} onChange={(e) => set('zip', e.target.value)} placeholder="00000" maxLength={10} /></MF>
              </div>
            </div>
          )}

          {/* ── Banking / Direct Deposit ── */}
          {tab === 'banking' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ padding: '12px 16px', background: 'rgba(14,27,46,0.05)', borderRadius: 10, fontSize: 12, color: '#666', lineHeight: 1.5 }}>
                <strong>For reference only</strong> — store banking details to track Direct Deposit payments. FAJ Solutions does not process ACH transfers directly.
              </div>

              <MF label="Bank Name" icon={<Landmark size={14} />}>
                <input className="input" value={form.bank_name ?? ''} onChange={(e) => set('bank_name', e.target.value)} placeholder="e.g. Chase, Wells Fargo, Bank of America" />
              </MF>

              <MF label="Account Holder Name" icon={<User size={14} />}>
                <input className="input" value={form.account_holder_name ?? ''} onChange={(e) => set('account_holder_name', e.target.value)} placeholder="Name as it appears on the account" />
              </MF>

              <MF label="Account Type" icon={<Landmark size={14} />}>
                <div style={{ display: 'flex', gap: 8 }}>
                  {(['checking', 'savings'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => set('account_type', t)}
                      style={{
                        flex: 1, padding: '10px', borderRadius: 8, border: 'none', cursor: 'pointer',
                        fontFamily: 'Inter, sans-serif', fontWeight: 700, fontSize: 13,
                        background: form.account_type === t ? 'var(--teal)' : 'rgba(14,27,46,0.07)',
                        color: form.account_type === t ? 'white' : 'var(--teal)',
                        textTransform: 'capitalize',
                      }}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </MF>

              <MF label="Routing Number (ABA)" icon={<Hash size={14} />}>
                <input
                  className="input"
                  value={form.routing_number ?? ''}
                  onChange={(e) => set('routing_number', e.target.value.replace(/\D/g, '').slice(0, 9))}
                  placeholder="9-digit routing number"
                  inputMode="numeric"
                  maxLength={9}
                />
                {form.routing_number && form.routing_number.length !== 9 && (
                  <div style={{ fontSize: 11, color: '#b45309', marginTop: 4 }}>Routing numbers are exactly 9 digits</div>
                )}
              </MF>

              <MF label="Account Number" icon={<Hash size={14} />}>
                <div style={{ position: 'relative' }}>
                  <input
                    className="input"
                    type={showAcct ? 'text' : 'password'}
                    value={form.account_number ?? ''}
                    onChange={(e) => set('account_number', e.target.value.replace(/\D/g, ''))}
                    placeholder="Account number"
                    inputMode="numeric"
                    style={{ paddingRight: 44 }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowAcct((v) => !v)}
                    style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#aaa', display: 'flex' }}
                  >
                    {showAcct ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                {form.account_number && !showAcct && (
                  <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
                    ···· {form.account_number.slice(-4)}
                  </div>
                )}
              </MF>

              {/* Summary card if fully filled */}
              {form.routing_number?.length === 9 && form.account_number && (
                <div style={{ padding: '14px 16px', borderRadius: 10, background: 'rgba(14,27,46,0.06)', border: '1.5px solid rgba(14,27,46,0.2)' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--teal)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>Direct Deposit Summary</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 13 }}>
                    <div><span style={{ color: '#888' }}>Bank:</span> {form.bank_name || '—'}</div>
                    <div><span style={{ color: '#888' }}>Type:</span> <span style={{ textTransform: 'capitalize' }}>{form.account_type}</span></div>
                    <div><span style={{ color: '#888' }}>Routing:</span> {form.routing_number}</div>
                    <div><span style={{ color: '#888' }}>Account:</span> ···· {form.account_number.slice(-4)}</div>
                  </div>
                </div>
              )}
            </div>
          )}

          <CustomFieldInputs target="techs" values={asValues(form.custom)} onChange={(v) => setForm((f) => ({ ...f, custom: v }))} />

          <div className="save-bar">
            <button type="button" className="btn btn-ghost" onClick={onClose} style={{ flex: 1, justifyContent: 'center' }}>Cancel</button>
            <button type="submit" className="btn btn-primary" style={{ flex: 2, justifyContent: 'center' }}>{item ? 'Save Changes' : 'Add Contractor'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function MF({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: '#555', marginBottom: 6, letterSpacing: 0.5, textTransform: 'uppercase' }}>
        {icon} {label}
      </label>
      {children}
    </div>
  );
}
