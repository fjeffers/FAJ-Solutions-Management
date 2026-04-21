'use client';
import { useState, useRef } from 'react';
import {
  X, Hash, User, FileText, Calendar, DollarSign,
  MapPin, Clock, Wrench, ChevronDown, ClipboardList,
  Phone, Mail, HelpCircle, Plus, Trash2, Paperclip,
  Upload, Camera, FolderOpen,
} from 'lucide-react';
import type { WorkOrder, Contractor, PayType, WorkOrderStatus, QuestionTemplate, CustomQAItem, QuestionFieldType } from '@/lib/types';
import { PAY_TYPES, WO_STATUSES, SERVICE_TYPES } from '@/lib/types';
import { fmtMoney } from '@/lib/utils';

type Tab = 'details' | 'pay' | 'site' | 'schedule' | 'scope' | 'contacts' | 'questions' | 'documents';
const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: 'details',   label: 'Details',   icon: <Hash size={13} /> },
  { key: 'pay',       label: 'Pay',       icon: <DollarSign size={13} /> },
  { key: 'site',      label: 'Site',      icon: <MapPin size={13} /> },
  { key: 'schedule',  label: 'Schedule',  icon: <Clock size={13} /> },
  { key: 'scope',     label: 'Scope',     icon: <ClipboardList size={13} /> },
  { key: 'contacts',  label: 'Contacts',  icon: <Phone size={13} /> },
  { key: 'questions', label: 'Questions', icon: <HelpCircle size={13} /> },
  { key: 'documents', label: 'Documents', icon: <FolderOpen size={13} /> },
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
  onSaveTemplate?: (name: string, questions: CustomQAItem[]) => Promise<void>;
  onUploadDoc?: (file: File) => Promise<string | null>;
};

export default function WorkOrderModal({ item, contractors, questionTemplates, onSave, onClose, onSaveTemplate, onUploadDoc }: Props) {
  const [tab, setTab] = useState<Tab>('details');
  const [docUploading, setDocUploading] = useState(false);
  const [docUploadError, setDocUploadError] = useState<string | null>(null);
  const docFileRef = useRef<HTMLInputElement>(null);
  const photoFileRef = useRef<HTMLInputElement>(null);
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
    attachment_url:  item?.attachment_url  ?? null,
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
    // Copy the template's vendor attachment to the work order
    if (tpl.attachment_url) set('attachment_url', tpl.attachment_url);
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
      attachment_url:  form.attachment_url  || null,
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
              <textarea className="input" rows={5} value={form.deliverables ?? ''} onChange={(e) => set('deliverables', e.target.value)} placeholder={"One item per line:\nInstall 24-port patch panel\nLabel all cables\nTest all drops"} />
            </PF>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <PF label="Service Type" icon={<Wrench size={13} />}>
                <div style={{ position: 'relative' }}>
                  <select className="select input" value={form.service_type ?? ''} onChange={(e) => set('service_type', e.target.value)}>
                    <option value="">Select type</option>
                    {SERVICE_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <ChevronDown size={11} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#aaa' }} />
                </div>
              </PF>
              <PF label="Required Skills">
                <input className="input" value={form.required_skills ?? ''} onChange={(e) => set('required_skills', e.target.value)} placeholder="e.g. Cat6, fiber, CCTV" />
              </PF>
            </div>
          </div>
        )}

        {/* ── CONTACTS TAB ── */}
        {tab === 'contacts' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ padding: '12px 16px', background: 'rgba(13,115,119,0.05)', borderRadius: 10, fontSize: 12, color: '#666' }}>
              Point of contact at the job site. Contractors will see this info in their portal.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <PF label="POC Name" icon={<User size={13} />}>
                <input className="input" value={form.poc_name ?? ''} onChange={(e) => set('poc_name', e.target.value)} placeholder="e.g. Lisa Roak-Tincani" />
              </PF>
              <PF label="POC Phone" icon={<Phone size={13} />}>
                <input className="input" value={form.poc_phone ?? ''} onChange={(e) => set('poc_phone', e.target.value)} placeholder="(555) 000-0000" />
              </PF>
            </div>
            <PF label="POC Email" icon={<Mail size={13} />}>
              <input className="input" value={form.poc_email ?? ''} onChange={(e) => set('poc_email', e.target.value)} placeholder="poc@client.com" />
            </PF>
            <PF label="Support / Dispatch Contact">
              <input className="input" value={form.support_contact ?? ''} onChange={(e) => set('support_contact', e.target.value)} placeholder="e.g. NOC: 1-800-555-0100" />
            </PF>
          </div>
        )}

        {/* ── QUESTIONS TAB ── */}
        {tab === 'questions' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Template picker */}
            {questionTemplates.length > 0 && (
              <div style={{ padding: '12px 16px', background: 'rgba(13,115,119,0.05)', borderRadius: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#555', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8 }}>
                  Load from Template
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {questionTemplates.map((tpl) => (
                    <button
                      key={tpl.id}
                      onClick={() => applyTemplate(tpl.id)}
                      style={{
                        padding: '6px 14px', borderRadius: 20, border: '1.5px solid rgba(13,115,119,0.3)',
                        background: 'white', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                        color: 'var(--teal)', display: 'flex', alignItems: 'center', gap: 6,
                      }}
                    >
                      {tpl.attachment_url && <Paperclip size={11} />}
                      {tpl.name}
                      <span style={{ fontSize: 10, color: '#aaa' }}>({tpl.questions.length})</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Vendor attachment (from template or WO) */}
            {form.attachment_url && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, background: 'rgba(201,169,97,0.08)', border: '1.5px solid rgba(201,169,97,0.2)' }}>
                <Paperclip size={13} color="#b8944a" />
                <a href={form.attachment_url} target="_blank" rel="noopener noreferrer"
                  style={{ flex: 1, fontSize: 13, color: '#b8944a', fontWeight: 600, textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  Vendor Paperwork attached
                </a>
                <button onClick={() => set('attachment_url', null)} style={{ padding: 4, border: 'none', background: 'none', cursor: 'pointer', color: '#aaa' }}>
                  <X size={13} />
                </button>
              </div>
            )}

            {/* Q list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {customQA.map((q, i) => (
                <div key={q.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '10px 14px', borderRadius: 10, background: '#fafafa', border: '1.5px solid #e5e7eb' }}>
                  <input
                    className="input"
                    value={q.label}
                    onChange={(e) => updateQALabel(q.id, e.target.value)}
                    placeholder={`Question ${i + 1} label`}
                    style={{ flex: 1, fontSize: 13 }}
                  />
                  <div style={{ position: 'relative' }}>
                    <select
                      className="select input"
                      value={q.type}
                      onChange={(e) => updateQAType(q.id, e.target.value as QuestionFieldType)}
                      style={{ fontSize: 12, width: 130 }}
                    >
                      <option value="text">Short Text</option>
                      <option value="textarea">Long Text</option>
                      <option value="number">Number</option>
                      <option value="yes_no">Yes / No</option>
                      <option value="photo">Photo</option>
                    </select>
                    <ChevronDown size={11} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#aaa' }} />
                  </div>
                  <button onClick={() => removeQA(q.id)} style={{ padding: 6, border: 'none', background: 'none', cursor: 'pointer', color: '#ccc' }}>
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>

            <button onClick={addCustomQuestion} className="btn btn-ghost" style={{ alignSelf: 'flex-start', fontSize: 12, padding: '7px 14px' }}>
              <Plus size={13} /> Add Question
            </button>

            {/* Save as Template row */}
            {customQA.filter((q) => q.label.trim()).length > 0 && onSaveTemplate && (
              <SaveAsTemplateRow questions={customQA} onSaveTemplate={onSaveTemplate} />
            )}
          </div>
        )}

        {/* ── DOCUMENTS TAB ── */}
        {tab === 'documents' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ padding: '12px 16px', background: 'rgba(13,115,119,0.05)', borderRadius: 10, fontSize: 12, color: '#666' }}>
              Attach documents, photos, or vendor paperwork. Contractors will see and can download these in their portal.
            </div>

            {/* Hidden file inputs */}
            <input
              ref={docFileRef}
              type="file"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.gif,.webp"
              style={{ display: 'none' }}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file || !onUploadDoc) return;
                setDocUploading(true);
                setDocUploadError(null);
                const url = await onUploadDoc(file);
                if (url) set('attachment_url', url);
                else setDocUploadError('Upload failed — try again');
                setDocUploading(false);
                if (docFileRef.current) docFileRef.current.value = '';
              }}
            />
            <input
              ref={photoFileRef}
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: 'none' }}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file || !onUploadDoc) return;
                setDocUploading(true);
                setDocUploadError(null);
                const url = await onUploadDoc(file);
                if (url) set('attachment_url', url);
                else setDocUploadError('Upload failed — try again');
                setDocUploading(false);
                if (photoFileRef.current) photoFileRef.current.value = '';
              }}
            />

            {/* Upload buttons */}
            {onUploadDoc && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <button
                  type="button"
                  onClick={() => docFileRef.current?.click()}
                  disabled={docUploading}
                  style={{
                    padding: '18px 12px', border: '2px dashed rgba(13,115,119,0.35)', borderRadius: 12,
                    background: 'rgba(13,115,119,0.04)', cursor: docUploading ? 'not-allowed' : 'pointer',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                    color: 'var(--teal)', fontFamily: 'Lato, sans-serif',
                    opacity: docUploading ? 0.6 : 1,
                  }}
                >
                  <Upload size={22} color="var(--teal)" />
                  <span style={{ fontSize: 12, fontWeight: 700 }}>{docUploading ? 'Uploading…' : 'Upload Document'}</span>
                  <span style={{ fontSize: 10, color: '#aaa' }}>PDF, Word, Excel, Image</span>
                </button>
                <button
                  type="button"
                  onClick={() => photoFileRef.current?.click()}
                  disabled={docUploading}
                  style={{
                    padding: '18px 12px', border: '2px dashed rgba(201,169,97,0.4)', borderRadius: 12,
                    background: 'rgba(201,169,97,0.05)', cursor: docUploading ? 'not-allowed' : 'pointer',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                    color: '#b8944a', fontFamily: 'Lato, sans-serif',
                    opacity: docUploading ? 0.6 : 1,
                  }}
                >
                  <Camera size={22} color="#b8944a" />
                  <span style={{ fontSize: 12, fontWeight: 700 }}>{docUploading ? 'Uploading…' : 'Take / Add Photo'}</span>
                  <span style={{ fontSize: 10, color: '#aaa' }}>Opens camera or gallery</span>
                </button>
              </div>
            )}

            {docUploadError && (
              <div style={{ fontSize: 12, color: '#b91c1c', padding: '8px 12px', background: 'rgba(239,68,68,0.08)', borderRadius: 8 }}>
                {docUploadError}
              </div>
            )}

            {/* Current attachment */}
            {form.attachment_url ? (
              <div style={{ border: '1.5px solid rgba(201,169,97,0.3)', borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ padding: '10px 14px', background: 'rgba(201,169,97,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#b8944a', textTransform: 'uppercase', letterSpacing: 0.5 }}>Attached Document</span>
                  <button onClick={() => set('attachment_url', null)} style={{ padding: 4, border: 'none', background: 'none', cursor: 'pointer', color: '#aaa', display: 'flex', alignItems: 'center' }}>
                    <X size={14} />
                  </button>
                </div>
                {/* Image preview or doc link */}
                {/\.(png|jpe?g|gif|webp)(\?|$)/i.test(form.attachment_url) ? (
                  <div style={{ position: 'relative' }}>
                    <img src={form.attachment_url} alt="Attachment" style={{ width: '100%', maxHeight: 220, objectFit: 'cover', display: 'block' }} />
                    <a href={form.attachment_url} target="_blank" rel="noopener noreferrer"
                      style={{ position: 'absolute', bottom: 8, right: 8, padding: '4px 10px', background: 'rgba(0,0,0,0.55)', color: 'white', borderRadius: 6, fontSize: 11, fontWeight: 700, textDecoration: 'none' }}>
                      Open full size →
                    </a>
                  </div>
                ) : (
                  <div style={{ padding: '14px' }}>
                    <a href={form.attachment_url} target="_blank" rel="noopener noreferrer"
                      style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: '#1565c0' }}>
                      <Paperclip size={16} color="#b8944a" />
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700 }}>View / Download Document</div>
                        <div style={{ fontSize: 11, color: '#aaa', marginTop: 2, wordBreak: 'break-all' }}>
                          {form.attachment_url.split('/').pop()?.split('?')[0] ?? 'document'}
                        </div>
                      </div>
                    </a>
                  </div>
                )}
                {onUploadDoc && (
                  <div style={{ padding: '10px 14px', borderTop: '1px solid rgba(201,169,97,0.15)' }}>
                    <button
                      type="button"
                      onClick={() => docFileRef.current?.click()}
                      disabled={docUploading}
                      style={{ fontSize: 12, color: 'var(--teal)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, padding: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Upload size={12} /> Replace with new file
                    </button>
                  </div>
                )}
              </div>
            ) : !onUploadDoc ? (
              <div style={{ padding: '10px 14px' }}>
                <PF label="Document URL" icon={<Paperclip size={13} />}>
                  <input className="input" value={form.attachment_url ?? ''} onChange={(e) => set('attachment_url', e.target.value || null)} placeholder="https://..." />
                </PF>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '24px 0', color: '#b0bec5', fontSize: 13 }}>
                No document attached yet. Use the buttons above to upload.
              </div>
            )}
          </div>
        )}

        {/* ── FOOTER ── */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 20, marginTop: 8, borderTop: '1px solid #eee' }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={!canSave}
            style={{ opacity: canSave ? 1 : 0.5 }}
          >
            {item ? 'Save Changes' : 'Create Work Order'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Save as Template Row ─────────────────────────────────────────────────────

function SaveAsTemplateRow({
  questions,
  onSaveTemplate,
}: {
  questions: CustomQAItem[];
  onSaveTemplate: (name: string, questions: CustomQAItem[]) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    await onSaveTemplate(name.trim(), questions);
    setSaving(false);
    setSaved(true);
    setName('');
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <div style={{ padding: '14px 16px', borderRadius: 10, background: 'rgba(13,115,119,0.05)', border: '1.5px dashed rgba(13,115,119,0.2)' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#555', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 10 }}>
        Save as Template
      </div>
      {saved ? (
        <div style={{ fontSize: 13, color: 'var(--teal)', fontWeight: 600 }}>✓ Template saved!</div>
      ) : (
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Template name (e.g. AT&T Jobs)"
            style={{ flex: 1, fontSize: 13 }}
          />
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={!name.trim() || saving}
            style={{ opacity: name.trim() && !saving ? 1 : 0.5, whiteSpace: 'nowrap', fontSize: 12 }}
          >
            {saving ? 'Saving...' : 'Save Template'}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Field Pair helper ────────────────────────────────────────────────────────

function PF({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, color: '#555', marginBottom: 6, letterSpacing: 0.5, textTransform: 'uppercase' }}>
        {icon}{label}
      </label>
      {children}
    </div>
  );
}

function TotalPreview({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ padding: '12px 16px', borderRadius: 10, background: 'rgba(13,115,119,0.06)', border: '1.5px solid rgba(13,115,119,0.15)', textAlign: 'right' }}>
      <div style={{ fontSize: 11, color: '#888', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--teal)' }}>{fmtMoney(value)}</div>
    </div>
  );
}
