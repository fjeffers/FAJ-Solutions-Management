'use client';
import { useState } from 'react';
import { X, User, Phone, Mail, FileText, Building2, Hash, MapPin, CheckCircle2, Smartphone } from 'lucide-react';
import type { Contractor, EntityType } from '@/lib/types';
import { ENTITY_TYPES } from '@/lib/types';

type Props = { item: Contractor | null; onSave: (c: Partial<Contractor>) => void; onClose: () => void; };

export default function ContractorModal({ item, onSave, onClose }: Props) {
  const [tab, setTab] = useState<'contact' | 'w9'>('contact');
  const [form, setForm] = useState<Partial<Contractor>>({
    name: item?.name ?? '', phone: item?.phone ?? '', email: item?.email ?? '',
    zelle_phone: item?.zelle_phone ?? '', notes: item?.notes ?? '',
    business_name: item?.business_name ?? '', entity_type: item?.entity_type ?? null,
    tax_id: item?.tax_id ?? '', tax_id_type: item?.tax_id_type ?? 'SSN',
    address: item?.address ?? '', city: item?.city ?? '', state: item?.state ?? '',
    zip: item?.zip ?? '', w9_received: item?.w9_received ?? false,
  });
  const set = (k: keyof Contractor, v: string | boolean | null) => setForm((f) => ({ ...f, [k]: v }));
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name?.trim()) return;
    onSave({ ...item, ...form });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <div className="display" style={{ fontSize: 11, color: 'var(--teal)', letterSpacing: 2, marginBottom: 4 }}>{item ? 'EDIT' : 'NEW'} CONTRACTOR</div>
            <h2 className="serif" style={{ fontSize: 26, margin: 0, fontWeight: 600 }}>{item ? item.name : 'Add Contractor'}</h2>
          </div>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 24, borderBottom: '1px solid #eee' }}>
          {(['contact', 'w9'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} style={{ padding: '10px 20px', border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'Lato, sans-serif', fontWeight: 700, fontSize: 13, color: tab === t ? 'var(--teal)' : '#999', borderBottom: tab === t ? '2px solid var(--teal)' : '2px solid transparent', marginBottom: -1, transition: 'all 0.2s' }}>
              {t === 'contact' ? 'Contact Info' : 'W-9 / Tax Info'}
            </button>
          ))}
        </div>
        <form onSubmit={handleSubmit}>
          {tab === 'contact' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <MF label="Full Name *" icon={<User size={14} />}><input className="input" value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} placeholder="e.g. John Smith" required autoFocus /></MF>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <MF label="Phone" icon={<Phone size={14} />}><input className="input" value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} placeholder="(555) 000-0000" type="tel" /></MF>
                <MF label="Email" icon={<Mail size={14} />}><input className="input" value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} placeholder="contractor@email.com" type="email" /></MF>
              </div>
              <MF label="Zelle Phone / Email" icon={<Smartphone size={14} />}>
                <input className="input" value={form.zelle_phone ?? ''} onChange={(e) => set('zelle_phone', e.target.value)} placeholder="Phone or email used for Zelle" />
                <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>Used to pre-fill Zelle when sending payments</div>
              </MF>
              <MF label="Notes" icon={<FileText size={14} />}><textarea className="input" value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} placeholder="Any notes..." rows={3} /></MF>
            </div>
          )}
          {tab === 'w9' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div onClick={() => set('w9_received', !form.w9_received)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 10, cursor: 'pointer', userSelect: 'none', background: form.w9_received ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.08)', border: `1px solid ${form.w9_received ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.2)'}` }}>
                <CheckCircle2 size={20} color={form.w9_received ? '#047857' : '#b91c1c'} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: form.w9_received ? '#047857' : '#b91c1c' }}>{form.w9_received ? 'W-9 Received' : 'W-9 Not Yet Received'}</div>
                  <div style={{ fontSize: 11, color: '#888' }}>Click to toggle status</div>
                </div>
              </div>
              <MF label="Business / Company Name" icon={<Building2 size={14} />}><input className="input" value={form.business_name ?? ''} onChange={(e) => set('business_name', e.target.value)} placeholder="If different from personal name" /></MF>
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
                <MF label="Tax ID" icon={<Hash size={14} />}><input className="input" value={form.tax_id ?? ''} onChange={(e) => set('tax_id', e.target.value)} placeholder={form.tax_id_type === 'EIN' ? 'XX-XXXXXXX' : 'XXX-XX-XXXX'} /></MF>
              </div>
              <MF label="Street Address" icon={<MapPin size={14} />}><input className="input" value={form.address ?? ''} onChange={(e) => set('address', e.target.value)} placeholder="123 Main St" /></MF>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
                <MF label="City"><input className="input" value={form.city ?? ''} onChange={(e) => set('city', e.target.value)} placeholder="City" /></MF>
                <MF label="State"><input className="input" value={form.state ?? ''} onChange={(e) => set('state', e.target.value.toUpperCase())} placeholder="FL" maxLength={2} /></MF>
                <MF label="ZIP"><input className="input" value={form.zip ?? ''} onChange={(e) => set('zip', e.target.value)} placeholder="00000" maxLength={10} /></MF>
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, marginTop: 28 }}>
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
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: '#555', marginBottom: 6, letterSpacing: 0.5, textTransform: 'uppercase' }}>{icon} {label}</label>
      {children}
    </div>
  );
}
