'use client';
import { useState } from 'react';
import {
  X, Hash, User, FileText, Calendar, DollarSign,
  MapPin, Clock, Wrench, ChevronDown, ClipboardList,
  Phone, Mail, HelpCircle, Plus, Trash2,
} from 'lucide-react';
import type { WorkOrder, Contractor, PayType, WorkOrderStatus, QuestionTemplate, CustomQAItem, QuestionFieldType } from '@/lib/types';
import { PAY_TYPES, WO_STATUSES, SERVICE_TYPES } from '@/lib/types';
import { fmtMoney } from '@/lib/utils';

type Tab = 'details' | 'pay' | 'site' | 'schedule' | 'scope' | 'contacts' | 'questions';
const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: 'details',   label: 'Details',   icon: <Hash size={13} /> },
  { key: 'pay',       label: 'Pay',       icon: <DollarSign size={13} /> },
  { key: 'site',      label: 'Site',      icon: <MapPin size={13} /> },
  { key: 'schedule',  label: 'Schedule',  icon: <Clock size={13} /> },
  { key: 'scope',     label: 'Scope',     icon: <ClipboardList size={13} /> },
  { key: 'contacts',  label: 'Contacts',  icon: <Phone size={13} /> },
  { key: 'questions', label: 'Questions', icon: <HelpCircle size={13} /> },
];

function newQAItem(label = '', type: QuestionFieldType = 'text'): CustomQAItem {
  return {
    id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    label,
    type,
    answer: null,
  };
}

const STATUS_COLORS: Record<WorkOrderStatus, { bg: string; color: string }> = {
  'Open':        { bg: 'rgba(13,115,119,0.1)',   color: 'var(--teal)' },
  'Assigned':    { bg: 'rgba(201,169,97,0.15)',   color: '#b8944a' },
  'In Progress': { bg: 'rgba(245,158,11,0.15)',   color: '#b45309' },
  'Work Done':   { bg: 'rgba(99,102,241,0.12)',   color: '#4338ca' },
  'Approved':    { bg: 'rgba(16,185,129,0.12)',   color: '#047857' },
  'Paid':        { bg: 'rgba(16,185,129,0.2)',    color: '#047857' },
};

function calcTotal(f: Partial<WorkOrder>): number {
  switch (f.pay_type) {
    case 'Hourly':    return (Number(f.hourly_rate) || 0) * (Number(f.hours_worked) || 0);
    case 'Per Device': return (Number(f.per_device_rate) || 0) * (Number(f.device_count) || 0);
    case 'Blended':   return (Number(f.blended_base) || 0) + (Number(f.hourly_rate) || 0) * (Number(f.hours_worked) || 0);
    default:          return Number(f.total_amount) || 0;
  }
}

type Props = {
  item: WorkOrder | null;
  contractors: Contractor[];
  questionTemplates: QuestionTemplate[];
  onSave: (w: Partial<WorkOrder>) => void;
  onClose: () => void;
};

export default function WorkOrderModal({ item, contractors, questionTemplates, onSave, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('details');
  const [form, setForm] = useState<Partial<WorkOrder>>({
    wo_number:       item?.wo_number       ?? '',
    title:           item?.title           ?? '',
    contractor_name: item?.contractor_name ?? '',
    wo_status:       item?.wo_status       ?? 'Open',
    pay_type:        item?.pay_type        ?? 'Fixed',
    total_amount:    item?.total_amount    ?? 0,
    hourly_rate:     item?.hourly_rate     ?? null,
    hours_worked:    item?.hours_worked    ?? null,
    per_device_rate: item?.per_device_rate ?? null,
    device_count:    item?.device_count    ?? null,
    blended_base:    item?.blended_base    ?? null,
    site_name:       item?.site_name       ?? '',
    site_address:    item?.site_address    ?? '',
    site_city:       item?.site_city       ?? '',
    site_state:      item?.site_state      ?? '',
    site_zip:        item?.site_zip        ?? '',
    start_date:      item?.start_date      ?? '',
    start_time:      item?.start_time      ?? '',
    end_date:        item?.end_date        ?? '',
    end_time:        item?.end_time        ?? '',
    description:     item?.description     ?? '',
    deliverables:    item?.deliverables    ?? '',
    service_type:    item?.service_type    ?? '',
    required_skills: item?.required_skills ?? '',
    poc_name:        item?.poc_name        ?? '',
    poc_phone:       item?.poc_phone       ?? '',
    poc_email:       item?.poc_email       ?? '',
    support_contact: item?.support_contact ?? '',
  });
  const [customQA, setCustomQA] = useState<CustomQAItem[]>(() => item?.custom_qa ?? []);

  const set = (k: keyof WorkOrder, v: string | number | null) =>
    setForm((f) => ({ ...f, [k]: v }));

  const applyTemplate = (templateId: string) => {
    const tpl = questionTemplates.find((t) => t.id === templateId);
    if (!tpl) return;
    setCustomQA(tpl.questions.map((q) => ({
      id: `${q.id}-${Date.now()}`,
      label: q.label,
      type: q.type,
      answer: null,
    })));
  };

  const addCustomQuestion = () =>
    setCustomQA((q) => [...q, newQAItem()]);

  const updateQALabel = (id: string, label: string) =>
    setCustomQA((qs) => qs.map((q) => q.id === id ? { ...q, label } : q));

  const updateQAType = (id: string, type: QuestionFieldType) =>
    setCustomQA((qs) => qs.map((q) => q.id === id ? { ...q, type } : q));

  const removeQA = (id: string) =>
    setCustomQA((qs) => qs.filter((q) => q.id !== id));

  const computed = calcTotal(form);
  const canSave = !!(form.wo_number?.trim() && form.contractor_name?.trim());

  const handleSave = () => {
    if (!canSave) return;
    const payload: Partial<WorkOrder> = {
      ...form,
      total_amount:    form.pay_type === 'Fixed' ? Number(form.total_amount) : computed,
      poc_name:        form.poc_name        || null,
      poc_phone:       form.poc_phone       || null,
      poc_email:       form.poc_email       || null,
      support_contact: form.support_contact || null,
      custom_qa:       customQA.filter((q) => q.label.trim()),
    };
    onSave({ ...item, ...payload });
  };

  const statusStyle = STATUS_COLORS[form.wo_status as WorkOrderStatus] ?? STATUS_COLORS['Open'];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 660 }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <div className="display" style={{ fontSize: 10, color: 'var(--teal)', letterSpacing: 2, marginBottom: 4 }}>
              {item ? 'EDIT' : 'NEW'} WORK ORDER
            </div>
            <h2 className="serif" style={{ fontSize: 24, margin: 0, fontWeight: 600 }}>
              {form.title || (item ? `WO #${item.wo_number}` : 'New Work Order')}
            </h2>
            {form.wo_number && (
              <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>WO #{form.wo_number}</div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Live status badge */}
            <span style={{
              padding: '5px 12px', borderRadius: 999, fontSize: 11, fontWeight: 700,
              background: statusStyle.bg, color: statusStyle.color,
            }}>
              {form.wo_status || 'Open'}
            </span>
            <button className="icon-btn" onClick={onClose}><X size={18} /></button>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 2, marginBottom: 24, borderBottom: '1px solid #eee' }}>
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '9px 16px', border: 'none', background: 'none', cursor: 'pointer',
              fontFamily: 'Lato, sans-serif', fontWeight: 700, fontSize: 12,
              color: tab === t.key ? 'var(--teal)' : '#999',
              borderBottom: tab === t.key ? '2px solid var(--teal)' : '2px solid transparent',
              marginBottom: -1, transition: 'all 0.2s',
            }}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* ── DETAILS TAB ── */}
        {tab === 'details' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 16 }}>
              <PF label="WO # *" icon={<Hash size={13} />}>
                <input className="input" value={form.wo_number ?? ''} onChange={(e) => set('wo_number', e.target.value)} placeholder="e.g. 1001" autoFocus />
              </PF>
              <PF label="Job Title" icon={<FileText size={13} />}>
                <input className="input" value={form.title ?? ''} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Network cable installation" />
              </PF>
            </div>
            <PF label="Contractor *" icon={<User size={13} />}>
              <div style={{ position: 'relative' }}>
                <select className="select input" value={form.contractor_name ?? ''} onChange={(e) => set('contractor_name', e.target.value)}>
                  <option value="">Select contractor</option>
                  {contractors.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
                <ChevronDown size={13} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#aaa' }} />
              </div>
            </PF>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <PF label="Service Type" icon={<Wrench size={13} />}>
                <div style={{ position: 'relative' }}>
                  <select className="select input" value={form.service_type ?? ''} onChange={(e) => set('service_type', e.target.value)}>
                    <option value="">Select type</option>
                    {SERVICE_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <ChevronDown size={13} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#aaa' }} />
                </div>
              </PF>
              <PF label="Status" icon={<ClipboardList size={13} />}>
                <div style={{ position: 'relative' }}>
                  <select className="select input" value={form.wo_status ?? 'Open'} onChange={(e) => set('wo_status', e.target.value as WorkOrderStatus)}
                    style={{ color: statusStyle.color, fontWeight: 700 }}>
                    {WO_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <ChevronDown size={13} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#aaa' }} />
                </div>
              </PF>
            </div>
          </div>
        )}

        {/* ── PAY TAB ── */}
        {tab === 'pay' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Pay type selector */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#555', marginBottom: 10, letterSpacing: 0.5, textTransform: 'uppercase' }}>Pay Type</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
                {PAY_TYPES.map((pt) => (
                  <button key={pt} type="button" onClick={() => set('pay_type', pt)} style={{
                    padding: '12px 8px', borderRadius: 10, border: 'none', cursor: 'pointer',
                    fontFamily: 'Lato, sans-serif', fontWeight: 700, fontSize: 12,
                    background: form.pay_type === pt ? 'var(--teal)' : 'rgba(13,115,119,0.06)',
                    color: form.pay_type === pt ? 'white' : 'var(--teal)',
                    boxShadow: form.pay_type === pt ? '0 4px 12px rgba(13,115,119,0.3)' : 'none',
                    transition: 'all 0.2s',
                  }}>{pt}</button>
                ))}
              </div>
            </div>

            {/* Fixed */}
            {form.pay_type === 'Fixed' && (
              <PF label="Total Amount *" icon={<DollarSign size={13} />}>
                <input className="input" type="number" step="0.01" min="0"
                  value={form.total_amount ?? ''}
                  onChange={(e) => set('total_amount', Number(e.target.value))}
                  placeholder="0.00" />
              </PF>
            )}

            {/* Hourly */}
            {form.pay_type === 'Hourly' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <PF label="Hourly Rate" icon={<DollarSign size={13} />}>
                    <div style={{ position: 'relative' }}>
                      <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#aaa', fontSize: 14 }}>$</span>
                      <input className="input" type="number" step="0.01" min="0" style={{ paddingLeft: 24 }}
                        value={form.hourly_rate ?? ''}
                        onChange={(e) => set('hourly_rate', e.target.value ? Number(e.target.value) : null)}
                        placeholder="0.00" />
                    </div>
                  </PF>
                  <PF label="Hours Worked" icon={<Clock size={13} />}>
                    <input className="input" type="number" step="0.25" min="0"
                      value={form.hours_worked ?? ''}
                      onChange={(e) => set('hours_worked', e.target.value ? Number(e.target.value) : null)}
                      placeholder="0.00" />
                  </PF>
                </div>
                <TotalPreview label="Total (Rate × Hours)" value={computed} />
              </div>
            )}

            {/* Per Device */}
            {form.pay_type === 'Per Device' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <PF label="Rate Per Device" icon={<DollarSign size={13} />}>
                    <div style={{ position: 'relative' }}>
                      <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#aaa', fontSize: 14 }}>$</span>
                      <input className="input" type="number" step="0.01" min="0" style={{ paddingLeft: 24 }}
                        value={form.per_device_rate ?? ''}
                        onChange={(e) => set('per_device_rate', e.target.value ? Number(e.target.value) : null)}
                        placeholder="0.00" />
                    </div>
                  </PF>
                  <PF label="Device / Unit Count" icon={<Hash size={13} />}>
                    <input className="input" type="number" step="1" min="0"
                      value={form.device_count ?? ''}
                      onChange={(e) => set('device_count', e.target.value ? Number(e.target.value) : null)}
                      placeholder="0" />
                  </PF>
                </div>
                <TotalPreview label="Total (Rate × Devices)" value={computed} />
              </div>
            )}

            {/* Blended */}
            {form.pay_type === 'Blended' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <PF label="Fixed Base Amount" icon={<DollarSign size={13} />}>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#aaa', fontSize: 14 }}>$</span>
                    <input className="input" type="number" step="0.01" min="0" style={{ paddingLeft: 24 }}
                      value={form.blended_base ?? ''}
                      onChange={(e) => set('blended_base', e.target.value ? Number(e.target.value) : null)}
                      placeholder="0.00" />
                  </div>
                </PF>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <PF label="Overtime Hourly Rate" icon={<DollarSign size={13} />}>
                    <div style={{ position: 'relative' }}>
                      <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#aaa', fontSize: 14 }}>$</span>
                      <input className="input" type="number" step="0.01" min="0" style={{ paddingLeft: 24 }}
                        value={form.hourly_rate ?? ''}
                        onChange={(e) => set('hourly_rate', e.target.value ? Number(e.target.value) : null)}
                        placeholder="0.00" />
                    </div>
                  </PF>
                  <PF label="Overtime Hours" icon={<Clock size={13} />}>
                    <input className="input" type="number" step="0.25" min="0"
                      value={form.hours_worked ?? ''}
                      onChange={(e) => set('hours_worked', e.target.value ? Number(e.target.value) : null)}
                      placeholder="0.00" />
                  </PF>
                </div>
                <TotalPreview label="Total (Base + Overtime)" value={computed} />
              </div>
            )}
          </div>
        )}

        {/* ── SITE TAB ── */}
        {tab === 'site' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <PF label="Site Name" icon={<MapPin size={13} />}>
              <input className="input" value={form.site_name ?? ''} onChange={(e) => set('site_name', e.target.value)} placeholder="e.g. Walmart #4521, Eastgate Mall" />
            </PF>
            <PF label="Street Address" icon={<MapPin size={13} />}>
              <input className="input" value={form.site_address ?? ''} onChange={(e) => set('site_address', e.target.value)} placeholder="123 Main St" />
            </PF>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 80px 100px', gap: 12 }}>
              <PF label="City">
                <input className="input" value={form.site_city ?? ''} onChange={(e) => set('site_city', e.target.value)} placeholder="City" />
              </PF>
              <PF label="State">
                <input className="input" value={form.site_state ?? ''} onChange={(e) => set('site_state', e.target.value.toUpperCase())} placeholder="PA" maxLength={2} />
              </PF>
              <PF label="ZIP">
                <input className="input" value={form.site_zip ?? ''} onChange={(e) => set('site_zip', e.target.value)} placeholder="00000" maxLength={10} />
              </PF>
            </div>
            {form.site_address && form.site_city && (
              <a
                href={`https://maps.google.com/?q=${encodeURIComponent([form.site_address, form.site_city, form.site_state, form.site_zip].filter(Boolean).join(', '))}`}
                target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 12, color: 'var(--teal)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <MapPin size={12} /> Open in Google Maps →
              </a>
            )}
          </div>
        )}

        {/* ── SCHEDULE TAB ── */}
        {tab === 'schedule' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ padding: '12px 16px', background: 'rgba(13,115,119,0.05)', borderRadius: 10, fontSize: 12, color: '#666' }}>
              Set the date and time window for when the work should be performed.
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--teal)', letterSpacing: 1, marginBottom: 10, textTransform: 'uppercase' }}>Start</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: 16 }}>
                <PF label="Date" icon={<Calendar size={13} />}>
                  <input className="input" type="date" value={form.start_date ?? ''} onChange={(e) => set('start_date', e.target.value)} />
                </PF>
                <PF label="Time" icon={<Clock size={13} />}>
                  <input className="input" type="time" value={form.start_time ?? ''} onChange={(e) => set('start_time', e.target.value)} />
                </PF>
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#b45309', letterSpacing: 1, marginBottom: 10, textTransform: 'uppercase' }}>End / Deadline</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: 16 }}>
                <PF label="Date" icon={<Calendar size={13} />}>
                  <input className="input" type="date" value={form.end_date ?? ''} onChange={(e) => set('end_date', e.target.value)} />
                </PF>
                <PF label="Time" icon={<Clock size={13} />}>
                  <input className="input" type="time" value={form.end_time ?? ''} onChange={(e) => set('end_time', e.target.value)} />
                </PF>
              </div>
            </div>
          </div>
        )}

        {/* ── SCOPE TAB ── */}
        {tab === 'scope' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <PF label="Scope of Work / Description" icon={<FileText size={13} />}>
              <textarea className="input" rows={3} value={form.description ?? ''} onChange={(e) => set('description', e.target.value)} placeholder="Describe the work to be performed..." />
            </PF>
            <PF label="Deliverables" icon={<ClipboardList size={13} />}>
              <textarea className="input" rows={5} value={form.deliverables ?? ''} onChange={(e) => set('deliverables', e.target.value)} placeholder={"One item per line:\nInstall 24-port patch panel\nLabel all cables\nTest all connections\nClean up workspace"} />
              <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>Enter one deliverable per line — each becomes a checklist item.</div>
            </PF>
            <PF label="Required Skills / Certifications" icon={<Wrench size={13} />}>
              <input className="input" value={form.required_skills ?? ''} onChange={(e) => set('required_skills', e.target.value)} placeholder="e.g. BICSI, OSHA 10, Network+, Fiber Splice" />
              <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>Comma-separated list of required skills or certifications.</div>
            </PF>
          </div>
        )}

        {/* ── CONTACTS TAB ── */}
        {tab === 'contacts