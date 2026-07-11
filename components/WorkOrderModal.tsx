'use client';
import { useState, useRef } from 'react';
import {
  X, Hash, User, FileText, Calendar, DollarSign,
  MapPin, Clock, Wrench, ChevronDown, ClipboardList,
  Phone, Mail, HelpCircle, Plus, Paperclip,
  Upload, Camera, FolderOpen, Briefcase, ShieldCheck,
  CreditCard, Trash2, CheckCircle2, Timer, Printer, MessageSquare, Edit2, Package,
} from 'lucide-react';
import type { WorkOrder, Contractor, WorkOrderStatus, QuestionTemplate, CustomQAItem, QuestionFieldType, Payment, SiteContact, DeliverableTemplate, Material, MaterialUsed, MileageLog } from '@/lib/types';
import { materialsUsedCost } from '@/lib/materials-used';
import { mileageReimbursement, totalMiles, DEFAULT_MILEAGE_RATE } from '@/lib/mileage';
import WOTimeLogs from '@/components/WOTimeLogs';
import WorkOrderChatPanel from '@/components/WorkOrderChatPanel';
import {
  ASSIGNMENT_TYPES,
  PAY_TYPES,
  PAYMENT_METHODS,
  SCHEDULE_TYPES,
  SERVICE_TYPES,
  WO_STATUSES,
  WORK_ORDER_PRIORITIES,
  WORK_ORDER_SOURCES,
} from '@/lib/types';
import { fmtMoney, fmtDate } from '@/lib/utils';
import { printSignOffSheet } from '@/lib/signoff';
import { buildNetviewFormUrl } from '@/lib/netview-payroll';
import { createClient } from '@/lib/supabase/client';

type Tab = 'details' | 'marketplace' | 'pay' | 'payments' | 'timelog' | 'site' | 'schedule' | 'scope' | 'contacts' | 'questions' | 'documents' | 'chat' | 'closeout';
const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: 'details',    label: 'Details',    icon: <Hash size={13} /> },
  { key: 'documents',  label: 'Documents',  icon: <FolderOpen size={13} /> },
  { key: 'chat',       label: 'Chat',       icon: <MessageSquare size={13} /> },
  { key: 'marketplace', label: 'Marketplace', icon: <Briefcase size={13} /> },
  { key: 'pay',        label: 'Pay',        icon: <DollarSign size={13} /> },
  { key: 'payments',   label: 'Payments',   icon: <CreditCard size={13} /> },
  { key: 'timelog',    label: 'Time Logs',  icon: <Timer size={13} /> },
  { key: 'site',       label: 'Site',       icon: <MapPin size={13} /> },
  { key: 'schedule',   label: 'Schedule',   icon: <Clock size={13} /> },
  { key: 'scope',      label: 'Scope',      icon: <ClipboardList size={13} /> },
  { key: 'contacts',   label: 'Contacts',   icon: <Phone size={13} /> },
  { key: 'questions',  label: 'Questions',  icon: <HelpCircle size={13} /> },
  { key: 'closeout',   label: 'Closeout',   icon: <Package size={13} /> },
];

function newQAItem(label = '', type: QuestionFieldType = 'text'): CustomQAItem {
  return {
    id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    label,
    type,
    answer: null,
  };
}

const BUILT_IN_QA_PACKETS: {
  id: string;
  name: string;
  detail: string;
  questions: { label: string; type: QuestionFieldType }[];
  requirements: Partial<Pick<WorkOrder, 'signature_required' | 'photo_required' | 'check_in_required' | 'check_out_required'>>;
}[] = [
  {
    id: 'completion-report',
    name: 'Completion Report',
    detail: 'Completion notes, materials, delays, charges, photos, and customer signoff.',
    requirements: {
      signature_required: true,
      photo_required: true,
      check_in_required: true,
      check_out_required: true,
    },
    questions: [
      { label: 'Scope of work completed', type: 'textarea' },
      { label: 'Inventory or inspection notes, including missing or damaged equipment', type: 'textarea' },
      { label: 'Detailed work completed', type: 'textarea' },
      { label: 'Materials used', type: 'textarea' },
      { label: 'Additional charges', type: 'textarea' },
      { label: 'Total time onsite', type: 'text' },
      { label: 'Customer contact name', type: 'text' },
      { label: 'Site or store number', type: 'text' },
      { label: 'PO or SO number', type: 'text' },
      { label: 'Printer test page attached if applicable', type: 'yes_no' },
      { label: 'Port maps, certifications, or reports attached if applicable', type: 'yes_no' },
      { label: 'Installed hardware photos uploaded', type: 'yes_no' },
      { label: 'Completion call details', type: 'textarea' },
      { label: 'Delays or blockers', type: 'textarea' },
      { label: 'Incidental charges and receipt details', type: 'textarea' },
      { label: 'Relevant job notes or onsite interactions', type: 'textarea' },
      { label: 'Installation feedback', type: 'textarea' },
      { label: 'Completion photo', type: 'photo' },
    ],
  },
  {
    id: 'pac-pssa-timesheet',
    name: 'PAC PSSA Timesheet',
    detail: 'Hyatt House teardown counts, technician, arrival, and onsite confirmation.',
    requirements: {
      signature_required: true,
      check_in_required: true,
      check_out_required: true,
    },
    questions: [
      { label: 'Technician name', type: 'text' },
      { label: 'Dispatch date', type: 'text' },
      { label: 'Arrival time', type: 'text' },
      { label: 'Site point of contact', type: 'text' },
      { label: 'Actual count - laptops', type: 'number' },
      { label: 'Actual count - laptop power adapters', type: 'number' },
      { label: 'Actual count - Cradlepoint router', type: 'number' },
      { label: 'Actual count - mice', type: 'number' },
      { label: 'Any missing or damaged items', type: 'textarea' },
      { label: 'Teardown complete', type: 'yes_no' },
      { label: 'Site left clean and secured', type: 'yes_no' },
      { label: 'Final site photo', type: 'photo' },
    ],
  },
];

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
  nextWoNumber?: string;
  prefill?: Partial<WorkOrder>;
  contractors: Contractor[];
  questionTemplates: QuestionTemplate[];
  deliverableTemplates?: DeliverableTemplate[];
  payments?: Payment[];
  onSave: (w: Partial<WorkOrder>) => void;
  onClose: () => void;
  onSaveTemplate?: (name: string, questions: CustomQAItem[]) => Promise<void>;
  onUploadDoc?: (file: File) => Promise<string | null>;
  onSavePayment?: (p: Partial<Payment>) => Promise<void>;
  onDeletePayment?: (id: string) => Promise<void>;
  onEditPayment?: (p: Payment) => void;
  materials?: Material[];
};

export default function WorkOrderModal({ item, nextWoNumber, prefill, contractors, questionTemplates, deliverableTemplates = [], payments = [], onSave, onClose, onSaveTemplate, onUploadDoc, onSavePayment, onDeletePayment, onEditPayment, materials = [] }: Props) {
  const [tab, setTab] = useState<Tab>('details');
  const [docUploading, setDocUploading] = useState(false);
  const [docUploadError, setDocUploadError] = useState<string | null>(null);
  const docFileRef = useRef<HTMLInputElement>(null);
  const photoFileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<Partial<WorkOrder>>({
    wo_number:       item?.wo_number       ?? nextWoNumber ?? '',
    title:           item?.title           ?? '',
    contractor_name: item?.contractor_name ?? '',
    // Normalize legacy lowercase 'netview' (written by the email importer pre-fix)
    // so the Source dropdown matches its 'NetView' option.
    source_platform: item?.source_platform?.toLowerCase() === 'netview' ? 'NetView' : (item?.source_platform ?? 'Internal'),
    external_wo_id:  item?.external_wo_id  ?? '',
    customer_name:   item?.customer_name   ?? '',
    project_name:    item?.project_name    ?? '',
    client_reference: item?.client_reference ?? '',
    buyer_company:   item?.buyer_company   ?? '',
    assignment_type: item?.assignment_type ?? 'Internal',
    priority:        item?.priority        ?? 'Normal',
    wo_status:       item?.wo_status       ?? 'Open',
    pay_type:        item?.pay_type        ?? 'Fixed',
    total_amount:    item?.total_amount    ?? 0,
    hourly_rate:     item?.hourly_rate     ?? null,
    hours_worked:    item?.hours_worked    ?? null,
    per_device_rate: item?.per_device_rate ?? null,
    device_count:    item?.device_count    ?? null,
    blended_base:    item?.blended_base    ?? null,
    expense_budget:  item?.expense_budget  ?? null,
    travel_amount:   item?.travel_amount   ?? null,
    bonus_amount:    item?.bonus_amount    ?? null,
    site_name:       item?.site_name       ?? '',
    site_address:    item?.site_address    ?? '',
    site_city:       item?.site_city       ?? '',
    site_state:      item?.site_state      ?? '',
    site_zip:        item?.site_zip        ?? '',
    schedule_type:   item?.schedule_type   ?? 'Exact Time',
    start_date:      item?.start_date      ?? '',
    start_time:      item?.start_time      ?? '',
    end_date:        item?.end_date        ?? '',
    end_time:        item?.end_time        ?? '',
    time_zone:       item?.time_zone       ?? '',
    description:     item?.description     ?? '',
    deliverables:    item?.deliverables    ?? '',
    deliverable_instructions: item?.deliverable_instructions ?? '',
    tools_required:  item?.tools_required  ?? '',
    parts_materials: item?.parts_materials ?? '',
    access_instructions: item?.access_instructions ?? '',
    parking_instructions: item?.parking_instructions ?? '',
    check_in_required: item?.check_in_required ?? true,
    check_out_required: item?.check_out_required ?? true,
    signature_required: item?.signature_required ?? false,
    photo_required:  item?.photo_required  ?? false,
    service_type:    item?.service_type    ?? '',
    required_skills: item?.required_skills ?? '',
    poc_name:        item?.poc_name        ?? '',
    poc_phone:       item?.poc_phone       ?? '',
    poc_email:       item?.poc_email       ?? '',
    support_contact: item?.support_contact ?? '',
    attachment_url:  item?.attachment_url  ?? null,
    // AI-generated prefill values (see WorkOrdersView's "Generate with AI") only apply in
    // create mode, and only override the specific fields they set — everything else above
    // keeps its normal default.
    ...(!item ? prefill : {}),
  });
  const [customQA, setCustomQA] = useState<CustomQAItem[]>(() => item?.custom_qa ?? []);

  // ── Multi-contacts ─────────────────────────────────────────────────────────
  const [contacts, setContacts] = useState<SiteContact[]>(() => item?.contacts ?? []);
  const addContact = () => setContacts((cs) => [
    ...cs,
    { id: crypto.randomUUID(), label: '', name: '', phone: '', email: '' },
  ]);
  const removeContact = (id: string) => setContacts((cs) => cs.filter((c) => c.id !== id));
  const updateContact = (id: string, field: keyof SiteContact, value: string) =>
    setContacts((cs) => cs.map((c) => c.id === id ? { ...c, [field]: value } : c));
  const [docUrls, setDocUrls] = useState<string[]>(() => item?.doc_urls ?? []);
  const docImgCount = docUrls.filter(u => /\.(png|jpe?g|gif|webp)/i.test(u)).length;
  const docFileCount = docUrls.length - docImgCount;
  const hasDocFiles = docUrls.length > 0;

  // ── Multi-contractor ───────────────────────────────────────────────────────
  const [contractorNames, setContractorNames] = useState<string[]>(() => {
    if (item?.contractor_names && item.contractor_names.length > 0) return item.contractor_names;
    if (item?.contractor_name) return [item.contractor_name];
    return [];
  });
  const [contractorToAdd, setContractorToAdd] = useState<string>('');
  // Lead tech: who is responsible for deliverables / closeout
  const [leadContractorName, setLeadContractorName] = useState<string | null>(
    () => item?.lead_contractor_name ?? null
  );
  // Per-tech pay split (migration-029). Only meaningful with 2+ contractors.
  const [contractorPay, setContractorPay] = useState<Record<string, number>>(
    () => item?.contractor_pay ?? {}
  );
  const setTechPay = (name: string, amount: number) =>
    setContractorPay((cp) => ({ ...cp, [name]: amount }));

  // ── Closeout: materials used ──────────────────────────────────────────────
  const [materialsUsed, setMaterialsUsed] = useState<MaterialUsed[]>(() => item?.materials_used ?? []);
  const addUsedRow = (material_id: string | null) => {
    const inv = material_id ? materials.find((m) => m.id === material_id) : null;
    setMaterialsUsed((rows) => [...rows, {
      id: `mu-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      material_id,
      name: inv?.name ?? '',
      quantity: 1,
      unit_cost: inv?.unit_cost ?? null,
    }]);
  };
  const updateUsedRow = (id: string, patch: Partial<MaterialUsed>) =>
    setMaterialsUsed((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeUsedRow = (id: string) =>
    setMaterialsUsed((rows) => rows.filter((r) => r.id !== id));

  // ── Closeout: mileage ─────────────────────────────────────────────────────
  const [mileageLogs, setMileageLogs] = useState<MileageLog[]>(() => item?.mileage_logs ?? []);
  const addMileageRow = () =>
    setMileageLogs((rows) => [...rows, {
      id: `ml-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      contractor_name: contractorNames[0] ?? '',
      miles: 0,
      rate: DEFAULT_MILEAGE_RATE,
      note: null,
    }]);
  const updateMileageRow = (id: string, patch: Partial<MileageLog>) =>
    setMileageLogs((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeMileageRow = (id: string) =>
    setMileageLogs((rows) => rows.filter((r) => r.id !== id));

  // ── Payments tab state ────────────────────────────────────────────────────
  const [showPayForm, setShowPayForm] = useState(false);
  const [payLoading, setPayLoading] = useState(false);
  const defaultNewPay = (): Partial<Payment> => ({
    wo_number: item?.wo_number ?? '',
    contractor_name: item?.contractor_name ?? '',
    payment_date: new Date().toISOString().split('T')[0],
    amount: 0,
    method: 'Check',
    notes: '',
  });
  const [newPay, setNewPay] = useState<Partial<Payment>>(defaultNewPay);

  const set = (k: keyof WorkOrder, v: string | number | boolean | null) =>
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

  const applyBuiltInPacket = (packetId: string) => {
    const packet = BUILT_IN_QA_PACKETS.find((p) => p.id === packetId);
    if (!packet) return;
    setCustomQA(packet.questions.map((q) => newQAItem(q.label, q.type)));
    setForm((current) => ({
      ...current,
      ...packet.requirements,
    }));
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
  const canSave = !!(form.wo_number?.trim() && (contractorNames.length > 0 || contractorToAdd.trim()));

  const addContractor = () => {
    const name = contractorToAdd.trim();
    if (!name || contractorNames.includes(name)) return;
    const next = [...contractorNames, name];
    setContractorNames(next);
    setContractorToAdd('');
    if (next.length === 1) set('contractor_name', name);
  };

  const removeContractor = (name: string) => {
    const next = contractorNames.filter((n) => n !== name);
    setContractorNames(next);
    set('contractor_name', next[0] ?? '');
    // If the lead is removed, reset to first remaining (or null if none)
    if (leadContractorName === name) setLeadContractorName(next[0] ?? null);
    setContractorPay((cp) => {
      const { [name]: _removed, ...rest } = cp;
      return rest;
    });
  };

  // Resolved lead: explicit choice, else first contractor
  const resolvedLead = leadContractorName ?? contractorNames[0] ?? null;

  // Derived payment totals for this WO (must come after `computed`).
  // Match by WO number only so payments to every tech on a multi-tech job count.
  const woPayments = payments.filter((p) => p.wo_number === item?.wo_number);
  const totalPaid   = woPayments.reduce((s, p) => s + Number(p.amount), 0);
  // Payout includes logged mileage so "remaining" here matches Payables
  const woTotal     = (computed > 0 ? computed : Number(form.total_amount) || 0) + mileageReimbursement(mileageLogs);
  const woRemaining = Math.max(0, woTotal - totalPaid);

  const handleSave = () => {
    if (!canSave) return;
    // Auto-add any contractor still pending in the dropdown (user selected but didn't click "+ Add")
    let finalNames = [...contractorNames];
    const pending = contractorToAdd.trim();
    if (pending && !contractorNames.includes(pending)) {
      finalNames = [...contractorNames, pending];
      setContractorNames(finalNames);
      setContractorToAdd('');
    }
    const payload: Partial<WorkOrder> = {
      ...form,
      contractor_name:  finalNames[0] ?? form.contractor_name ?? '',
      contractor_names: finalNames.length > 0 ? finalNames : null,
      // Only persist lead when 2+ contractors; for single contractor it's implicit
      lead_contractor_name: finalNames.length >= 2
        ? (leadContractorName ?? finalNames[0] ?? null)
        : null,
      // Persist the pay split only when 2+ techs and at least one amount entered;
      // keep only entries for techs still on the WO.
      contractor_pay: (() => {
        if (finalNames.length < 2) return null;
        const pruned: Record<string, number> = {};
        for (const n of finalNames) {
          const amt = Number(contractorPay[n]) || 0;
          if (amt > 0) pruned[n] = amt;
        }
        return Object.keys(pruned).length > 0 ? pruned : null;
      })(),
      // Closeout materials (migration-031) — drop unnamed rows
      materials_used: materialsUsed.filter((r) => r.name.trim() !== ''),
      // Mileage (migration-032) — drop zero-mile rows
      mileage_logs: mileageLogs.filter((r) => (Number(r.miles) || 0) > 0),
      total_amount:    form.pay_type === 'Fixed' ? Number(form.total_amount) : computed,
      external_wo_id:  form.external_wo_id  || null,
      customer_name:   form.customer_name   || null,
      project_name:    form.project_name    || null,
      client_reference: form.client_reference || null,
      buyer_company:   form.buyer_company   || null,
      expense_budget:  form.expense_budget  ?? null,
      travel_amount:   form.travel_amount   ?? null,
      bonus_amount:    form.bonus_amount    ?? null,
      time_zone:       form.time_zone       || null,
      deliverable_instructions: form.deliverable_instructions || null,
      tools_required:  form.tools_required  || null,
      parts_materials: form.parts_materials || null,
      access_instructions: form.access_instructions || null,
      parking_instructions: form.parking_instructions || null,
      poc_name:        form.poc_name        || null,
      poc_phone:       form.poc_phone       || null,
      poc_email:       form.poc_email       || null,
      support_contact: form.support_contact || null,
      custom_qa:       customQA.filter((q) => q.label.trim()),
      attachment_url:  form.attachment_url  || null,
      doc_urls:        docUrls,
      contacts:        contacts.filter((c) => c.name.trim() || c.phone.trim() || c.email.trim()),
    };
    onSave({ ...item, ...payload });
  };

  const statusStyle = STATUS_COLORS[form.wo_status as WorkOrderStatus] ?? STATUS_COLORS['Open'];

  return (
    <div className="modal-overlay">
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720 }}>
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
        <div style={{ display: 'flex', gap: 2, marginBottom: 24, borderBottom: '1px solid #eee', overflowX: 'auto', flexWrap: 'nowrap' }}>
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '9px 12px', border: 'none', background: 'none', cursor: 'pointer',
              fontFamily: 'Lato, sans-serif', fontWeight: 700, fontSize: 11,
              color: tab === t.key ? 'var(--teal)' : '#999',
              borderBottom: tab === t.key ? '2px solid var(--teal)' : '2px solid transparent',
              marginBottom: -1, transition: 'all 0.2s', whiteSpace: 'nowrap', flexShrink: 0,
            }}>
              {t.icon} {t.label}
              {t.key === 'documents' && docUrls.length > 0 && (
                <span style={{
                  background: 'var(--teal)', color: 'white', borderRadius: 999,
                  fontSize: 9, fontWeight: 800, padding: '1px 5px', lineHeight: 1.6,
                  marginLeft: 2,
                }}>{docUrls.length}</span>
              )}
            </button>
          ))}
        </div>

        {/* ── DETAILS TAB ── */}
        {tab === 'details' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 16 }}>
              <PF label="WO # *" icon={<Hash size={13} />}>
                <input className="input" value={form.wo_number ?? ''} onChange={(e) => set('wo_number', e.target.value)} placeholder="e.g. 1001" autoFocus />
                {!item && nextWoNumber && (
                  <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 3 }}>Auto-suggested: #{nextWoNumber}</div>
                )}
              </PF>
              <PF label="Job Title" icon={<FileText size={13} />}>
                <input className="input" value={form.title ?? ''} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Network cable installation" />
              </PF>
            </div>
            <PF label="Contractors *" icon={<User size={13} />}>
              {/* Chip list */}
              {contractorNames.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                  {contractorNames.map((name) => {
                    const isLead = name === resolvedLead;
                    const isMulti = contractorNames.length >= 2;
                    return (
                      <div key={name} style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '6px 10px', borderRadius: 10,
                        background: isLead ? 'rgba(13,115,119,0.08)' : 'rgba(0,0,0,0.04)',
                        border: isLead ? '1px solid rgba(13,115,119,0.25)' : '1px solid rgba(0,0,0,0.1)',
                      }}>
                        {/* Lead radio — only show when 2+ contractors */}
                        {isMulti && (
                          <button
                            onClick={() => setLeadContractorName(name)}
                            title={isLead ? 'Lead tech' : 'Set as lead tech'}
                            style={{
                              width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                              border: isLead ? '2px solid var(--teal)' : '2px solid #ccc',
                              background: isLead ? 'var(--teal)' : 'white',
                              cursor: 'pointer', padding: 0, display: 'flex',
                              alignItems: 'center', justifyContent: 'center',
                            }}
                          >
                            {isLead && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'white', display: 'block' }} />}
                          </button>
                        )}

                        {/* Name */}
                        <span style={{
                          flex: 1, fontSize: 13, fontWeight: 700,
                          color: isLead ? 'var(--teal)' : '#555',
                        }}>
                          {name}
                        </span>

                        {/* Role badge */}
                        {isMulti ? (
                          <span style={{
                            fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
                            padding: '2px 7px', borderRadius: 999,
                            background: isLead ? 'rgba(13,115,119,0.15)' : 'rgba(0,0,0,0.08)',
                            color: isLead ? 'var(--teal)' : '#888',
                          }}>
                            {isLead ? 'LEAD' : 'ASSISTANT'}
                          </span>
                        ) : (
                          <span style={{ fontSize: 10, color: '#aaa', fontWeight: 600 }}>PRIMARY</span>
                        )}

                        {/* Per-tech pay — only when 2+ contractors */}
                        {isMulti && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                            <span style={{ fontSize: 12, color: '#888', fontWeight: 700 }}>$</span>
                            <input
                              className="input"
                              type="number"
                              min="0"
                              step="0.01"
                              value={contractorPay[name] ?? ''}
                              onChange={(e) => setTechPay(name, e.target.value === '' ? 0 : Number(e.target.value))}
                              placeholder="0.00"
                              title={`How much ${name} gets paid on this WO`}
                              style={{ width: 90, fontSize: 12, padding: '5px 8px', textAlign: 'right' }}
                            />
                          </div>
                        )}

                        {/* Remove */}
                        <button onClick={() => removeContractor(name)} style={{
                          background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                          display: 'flex', alignItems: 'center', color: '#aaa', opacity: 0.7,
                          flexShrink: 0,
                        }}>
                          <X size={12} />
                        </button>
                      </div>
                    );
                  })}
                  {/* Helper hint + pay-split summary when multi-contractor */}
                  {contractorNames.length >= 2 && (() => {
                    const assigned = contractorNames.reduce((s, n) => s + (Number(contractorPay[n]) || 0), 0);
                    const woAmount = computed > 0 ? computed : Number(form.total_amount) || 0;
                    const matches = Math.abs(assigned - woAmount) < 0.01;
                    return (
                      <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingLeft: 2, flexWrap: 'wrap' }}>
                          <span style={{
                            fontSize: 11, fontWeight: 700,
                            color: assigned === 0 ? '#9ca3af' : matches ? '#047857' : '#b45309',
                          }}>
                            {assigned === 0
                              ? 'No pay split set — full amount goes to the primary tech'
                              : `Split assigned: ${fmtMoney(assigned)} of ${fmtMoney(woAmount)}${matches ? ' ✓' : ''}`}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              const even = Math.floor((woAmount / contractorNames.length) * 100) / 100;
                              const next: Record<string, number> = {};
                              contractorNames.forEach((n, i) => {
                                // First tech absorbs the rounding remainder so the split always sums to the total
                                next[n] = i === 0 ? Math.round((woAmount - even * (contractorNames.length - 1)) * 100) / 100 : even;
                              });
                              setContractorPay(next);
                            }}
                            style={{
                              fontSize: 11, fontWeight: 700, color: 'var(--teal)', background: 'rgba(13,115,119,0.08)',
                              border: '1px solid rgba(13,115,119,0.2)', borderRadius: 6, padding: '3px 10px', cursor: 'pointer',
                            }}
                          >
                            Split evenly
                          </button>
                        </div>
                        <div style={{ fontSize: 11, color: '#9ca3af', paddingLeft: 2 }}>
                          🔵 Lead tech handles deliverables, photos & closeout. Assistant tech checks in/out only.
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}
              {/* Add dropdown */}
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <select className="select input" value={contractorToAdd}
                    onChange={(e) => setContractorToAdd(e.target.value)}
                    style={{ paddingRight: 32 }}>
                    <option value="">
                      {contractorNames.length === 0 ? 'Select contractor' : 'Add another tech…'}
                    </option>
                    {contractors
                      .filter((c) => !contractorNames.includes(c.name))
                      .map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                  </select>
                  <ChevronDown size={13} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#aaa' }} />
                </div>
                <button onClick={addContractor} disabled={!contractorToAdd} style={{
                  padding: '0 14px', borderRadius: 8, border: 'none', cursor: contractorToAdd ? 'pointer' : 'not-allowed',
                  background: contractorToAdd ? 'var(--teal)' : '#ddd', color: '#fff',
                  fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', gap: 4,
                  opacity: contractorToAdd ? 1 : 0.5,
                }}>
                  <Plus size={13} /> Add
                </button>
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

            {/* ── Documents quick-access banner ── */}
            <button
              type="button"
              onClick={() => setTab('documents')}
              style={{
                width: '100%', padding: '12px 16px', borderRadius: 10, cursor: 'pointer',
                background: hasDocFiles ? 'rgba(13,115,119,0.07)' : 'rgba(0,0,0,0.03)',
                border: hasDocFiles ? '1.5px solid rgba(13,115,119,0.25)' : '1.5px solid rgba(0,0,0,0.08)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                fontFamily: 'Lato, sans-serif', transition: 'background 0.15s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <FolderOpen size={16} color={hasDocFiles ? 'var(--teal)' : '#bbb'} />
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: hasDocFiles ? 'var(--teal)' : '#aaa' }}>
                    {hasDocFiles ? `${docUrls.length} document${docUrls.length === 1 ? '' : 's'} attached` : 'No documents attached'}
                  </div>
                  {hasDocFiles && (
                    <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>
                      {docImgCount} photo{docImgCount !== 1 ? 's' : ''}, {docFileCount} file{docFileCount !== 1 ? 's' : ''}
                    </div>
                  )}
                </div>
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--teal)' }}>
                View Documents
              </div>
            </button>
          </div>
        )}

        {/* ── MARKETPLACE TAB ── */}
        {tab === 'marketplace' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <PF label="Source" icon={<Briefcase size={13} />}>
                <div style={{ position: 'relative' }}>
                  <select className="select input" value={form.source_platform ?? 'Internal'} onChange={(e) => set('source_platform', e.target.value)}>
                    {WORK_ORDER_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <ChevronDown size={13} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#aaa' }} />
                </div>
              </PF>
              <PF label="External WO / Assignment ID" icon={<Hash size={13} />}>
                <input className="input" value={form.external_wo_id ?? ''} onChange={(e) => set('external_wo_id', e.target.value)} placeholder="e.g. FN-123456, WM-98765" />
              </PF>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <PF label="Customer / Client">
                <input className="input" value={form.customer_name ?? ''} onChange={(e) => set('customer_name', e.target.value)} placeholder="End customer or client" />
              </PF>
              <PF label="Buyer / MSP">
                <input className="input" value={form.buyer_company ?? ''} onChange={(e) => set('buyer_company', e.target.value)} placeholder="Buyer, MSP, or dispatch company" />
              </PF>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <PF label="Project / Campaign">
                <input className="input" value={form.project_name ?? ''} onChange={(e) => set('project_name', e.target.value)} placeholder="Rollout, refresh, service call..." />
              </PF>
              <PF label="Client Reference">
                <input className="input" value={form.client_reference ?? ''} onChange={(e) => set('client_reference', e.target.value)} placeholder="Ticket, PO, store, or billing code" />
              </PF>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <PF label="Assignment Type">
                <div style={{ position: 'relative' }}>
                  <select className="select input" value={form.assignment_type ?? 'Internal'} onChange={(e) => set('assignment_type', e.target.value)}>
                    {ASSIGNMENT_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <ChevronDown size={13} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#aaa' }} />
                </div>
              </PF>
              <PF label="Priority" icon={<ShieldCheck size={13} />}>
                <div style={{ position: 'relative' }}>
                  <select className="select input" value={form.priority ?? 'Normal'} onChange={(e) => set('priority', e.target.value)}>
                    {WORK_ORDER_PRIORITIES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <ChevronDown size={13} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#aaa' }} />
                </div>
              </PF>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
              <RequirementToggle label="Check-in required" checked={!!form.check_in_required} onChange={(v) => set('check_in_required', v)} />
              <RequirementToggle label="Check-out required" checked={!!form.check_out_required} onChange={(v) => set('check_out_required', v)} />
              <RequirementToggle label="Signature required" checked={!!form.signature_required} onChange={(v) => set('signature_required', v)} />
              <RequirementToggle label="Photos required" checked={!!form.photo_required} onChange={(v) => set('photo_required', v)} />
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

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              <PF label="Expense Budget">
                <MoneyInput value={form.expense_budget} onChange={(v) => set('expense_budget', v)} />
              </PF>
              <PF label="Travel Amount">
                <MoneyInput value={form.travel_amount} onChange={(v) => set('travel_amount', v)} />
              </PF>
              <PF label="Bonus Amount">
                <MoneyInput value={form.bonus_amount} onChange={(v) => set('bonus_amount', v)} />
              </PF>
            </div>

            {form.source_platform?.toLowerCase() === 'netview' && item && (
              <NetviewSubmitButton wo={item} contractors={contractors} />
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <iframe
                  key={[form.site_address, form.site_city, form.site_state, form.site_zip].join(',')}
                  src={`https://maps.google.com/maps?q=${encodeURIComponent([form.site_address, form.site_city, form.site_state, form.site_zip].filter(Boolean).join(', '))}&output=embed&z=15`}
                  width="100%"
                  height="200"
                  style={{ border: 'none', borderRadius: 8 }}
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  title="Address map preview"
                />
                <a
                  href={`https://maps.google.com/?q=${encodeURIComponent([form.site_address, form.site_city, form.site_state, form.site_zip].filter(Boolean).join(', '))}`}
                  target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: 12, color: 'var(--teal)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <MapPin size={12} /> Open in Google Maps →
                </a>
              </div>
            )}
          </div>
        )}

        {/* ── SCHEDULE TAB ── */}
        {tab === 'schedule' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ padding: '12px 16px', background: 'rgba(13,115,119,0.05)', borderRadius: 10, fontSize: 12, color: '#666' }}>
              Set the date and time window for when the work should be performed.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <PF label="Schedule Type">
                <div style={{ position: 'relative' }}>
                  <select className="select input" value={form.schedule_type ?? 'Exact Time'} onChange={(e) => set('schedule_type', e.target.value)}>
                    {SCHEDULE_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <ChevronDown size={13} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#aaa' }} />
                </div>
              </PF>
              <PF label="Time Zone">
                <input className="input" value={form.time_zone ?? ''} onChange={(e) => set('time_zone', e.target.value)} placeholder="e.g. America/New_York" />
              </PF>
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

            {/* Service Description / SOW */}
            <PF label="Service Description / Scope of Work" icon={<FileText size={13} />}>
              <textarea className="input" rows={4} value={form.description ?? ''} onChange={(e) => set('description', e.target.value)} placeholder="Describe the work to be performed..." />
            </PF>

            {/* Deliverables + Closeout in one card */}
            <div style={{ border: '1.5px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ padding: '8px 12px', background: '#f9fafb', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 6 }}>
                <ClipboardList size={13} style={{ color: 'var(--teal, #0D7377)' }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: 0.4 }}>Deliverables &amp; Closeout Instructions</span>
              </div>
              <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280' }}>Deliverables</div>
                    {deliverableTemplates.length > 0 && (
                      <div style={{ position: 'relative' }}>
                        <select
                          className="input"
                          style={{ fontSize: 11, padding: '3px 8px', height: 'auto', cursor: 'pointer', color: 'var(--teal)', fontWeight: 600 }}
                          value=""
                          onChange={(e) => {
                            const t = deliverableTemplates.find((dt) => dt.id === e.target.value);
                            if (t) set('deliverables', t.items.join('\n'));
                          }}
                        >
                          <option value="" disabled>Apply template…</option>
                          {deliverableTemplates.map((t) => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                  <textarea className="input" rows={4} value={form.deliverables ?? ''} onChange={(e) => set('deliverables', e.target.value)} placeholder={"One item per line:\nInstall 24-port patch panel\nLabel all cables\nTest all drops"} />
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', marginBottom: 4 }}>Closeout / Deliverable Instructions</div>
                  <textarea className="input" rows={3} value={form.deliverable_instructions ?? ''} onChange={(e) => set('deliverable_instructions', e.target.value)} placeholder="Photos, serials, test results, notes, signoff requirements..." />
                </div>
              </div>
            </div>

            {/* Tools + Parts in one card */}
            <div style={{ border: '1.5px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ padding: '8px 12px', background: '#f9fafb', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Wrench size={13} style={{ color: 'var(--teal, #0D7377)' }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: 0.4 }}>Tools &amp; Materials</span>
              </div>
              <div style={{ padding: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', marginBottom: 4 }}>Tools Required</div>
                  <textarea className="input" rows={3} value={form.tools_required ?? ''} onChange={(e) => set('tools_required', e.target.value)} placeholder="Ladder, toner, laptop, PPE..." />
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', marginBottom: 4 }}>Parts / Materials</div>
                  <textarea className="input" rows={3} value={form.parts_materials ?? ''} onChange={(e) => set('parts_materials', e.target.value)} placeholder="Parts provided, bring materials, pickup notes..." />
                </div>
              </div>
            </div>

            {/* Access + Parking */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <PF label="Access Instructions">
                <textarea className="input" rows={3} value={form.access_instructions ?? ''} onChange={(e) => set('access_instructions', e.target.value)} placeholder="Badge, lockbox, store manager, check-in desk..." />
              </PF>
              <PF label="Parking / Site Notes">
                <textarea className="input" rows={3} value={form.parking_instructions ?? ''} onChange={(e) => set('parking_instructions', e.target.value)} placeholder="Loading dock, paid parking, rear entrance..." />
              </PF>
            </div>

            {/* Service Type + Required Skills */}
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
              Add all site contacts. Contractors will see this info in their portal.
            </div>

            {contacts.length === 0 && (
              <div style={{ textAlign: 'center', padding: '24px 0', color: '#aaa', fontSize: 13 }}>
                No contacts yet — click "Add Contact" to get started.
              </div>
            )}

            {contacts.map((c, i) => (
              <div key={c.id} style={{
                border: '1px solid #e5e5e5',
                borderRadius: 10,
                padding: '14px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                background: '#fafafa',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--teal)', letterSpacing: 1, textTransform: 'uppercase' }}>
                    Contact {i + 1}
                  </span>
                  <button
                    className="icon-btn"
                    onClick={() => removeContact(c.id)}
                    style={{ color: '#b91c1c' }}
                    title="Remove contact"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <PF label="Role / Label">
                    <input
                      className="input"
                      value={c.label}
                      onChange={(e) => updateContact(c.id, 'label', e.target.value)}
                      placeholder="e.g. Site Manager, NOC, Security"
                    />
                  </PF>
                  <PF label="Name" icon={<User size={13} />}>
                    <input
                      className="input"
                      value={c.name}
                      onChange={(e) => updateContact(c.id, 'name', e.target.value)}
                      placeholder="Full name"
                    />
                  </PF>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <PF label="Phone" icon={<Phone size={13} />}>
                    <input
                      className="input"
                      value={c.phone}
                      onChange={(e) => updateContact(c.id, 'phone', e.target.value)}
                      placeholder="(555) 000-0000"
                    />
                  </PF>
                  <PF label="Email" icon={<Mail size={13} />}>
                    <input
                      className="input"
                      value={c.email}
                      onChange={(e) => updateContact(c.id, 'email', e.target.value)}
                      placeholder="contact@example.com"
                    />
                  </PF>
                </div>
              </div>
            ))}

            <button
              className="btn btn-ghost"
              onClick={addContact}
              style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}
            >
              <Plus size={14} /> Add Contact
            </button>
          </div>
        )}

        {/* ── QUESTIONS TAB ── */}
        {tab === 'questions' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Built-in packets */}
            <div style={{ padding: '12px 16px', background: 'rgba(13,115,119,0.05)', borderRadius: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#555', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8 }}>
                Built-in Paperwork
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
                {BUILT_IN_QA_PACKETS.map((packet) => (
                  <button
                    key={packet.id}
                    onClick={() => applyBuiltInPacket(packet.id)}
                    style={{
                      padding: '12px 14px',
                      borderRadius: 10,
                      border: '1.5px solid rgba(13,115,119,0.22)',
                      background: 'white',
                      cursor: 'pointer',
                      textAlign: 'left',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 5,
                    }}
                  >
                    <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--teal)', display: 'flex', alignItems: 'center', gap: 7 }}>
                      <FileText size={14} /> {packet.name}
                    </span>
                    <span style={{ fontSize: 11, color: '#667085', lineHeight: 1.45 }}>{packet.detail}</span>
                    <span style={{ fontSize: 10, color: '#98a2b3', fontWeight: 700 }}>{packet.questions.length} questions</span>
                  </button>
                ))}
              </div>
            </div>

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

            {/* ── Contractor Responses (read-only) ── */}
            {customQA.some((q) => q.answer !== null && q.answer !== undefined && String(q.answer).trim() !== '') && (
              <div style={{ padding: '14px 16px', background: 'rgba(16,185,129,0.05)', borderRadius: 10, border: '1.5px solid rgba(16,185,129,0.25)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#047857', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 12 }}>
                  ✓ Contractor Responses
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {customQA.filter((q) => q.answer !== null && q.answer !== undefined && String(q.answer).trim() !== '').map((q) => (
                    <div key={q.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: 0.3 }}>{q.label}</div>
                      {(q.type === 'photo' || q.type === 'document' || q.type === 'signature') && String(q.answer).startsWith('http') ? (
                        /\.(png|jpe?g|gif|webp)(\?|$)/i.test(String(q.answer)) || q.type === 'photo' || q.type === 'signature' ? (
                          <a href={String(q.answer)} target="_blank" rel="noopener noreferrer">
                            <img src={String(q.answer)} alt={q.label} style={{ maxWidth: 200, maxHeight: 140, borderRadius: 6, border: '1px solid #e5e7eb', objectFit: 'cover' }} />
                          </a>
                        ) : (
                          <a href={String(q.answer)} target="_blank" rel="noopener noreferrer"
                            style={{ fontSize: 13, color: '#1565c0', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                            📎 View Uploaded File
                          </a>
                        )
                      ) : (
                        <div style={{ fontSize: 14, color: '#1a1a1a', background: 'white', padding: '8px 12px', borderRadius: 8, border: '1px solid #e5e7eb', lineHeight: 1.5 }}>
                          {String(q.answer)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Q list — question definitions editor */}
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
                      <option value="document">Document Upload</option>
                      <option value="signature">Signature</option>
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

        {/* ── CLOSEOUT TAB ── */}
        {tab === 'closeout' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Materials used on this job</div>
              <div style={{ fontSize: 12, color: '#888', lineHeight: 1.5 }}>
                Add anything used that wasn&apos;t already on site — pick from your inventory (stock is deducted
                automatically when you save) or add an item you bought for the job.
              </div>
            </div>

            {/* Add controls */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ position: 'relative', flex: '1 1 240px' }}>
                <select
                  className="select input"
                  value=""
                  onChange={(e) => { if (e.target.value) addUsedRow(e.target.value); }}
                  style={{ fontSize: 12 }}
                >
                  <option value="">+ Add from inventory…</option>
                  {materials.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.stock_quantity} {m.unit || 'each'} in stock{m.unit_cost ? ` · ${fmtMoney(m.unit_cost)}` : ''})
                    </option>
                  ))}
                </select>
                <ChevronDown size={11} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#aaa' }} />
              </div>
              <button type="button" className="btn btn-ghost" onClick={() => addUsedRow(null)} style={{ fontSize: 12 }}>
                <Plus size={13} /> Other item (bought for job)
              </button>
            </div>

            {/* Rows */}
            {materialsUsed.length === 0 ? (
              <div style={{ padding: '28px 16px', textAlign: 'center', color: '#aaa', fontSize: 13, border: '1.5px dashed #e5e7eb', borderRadius: 10 }}>
                Nothing added yet
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {materialsUsed.map((r) => (
                  <div key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 10px', borderRadius: 10, background: r.material_id ? 'rgba(13,115,119,0.04)' : 'rgba(245,158,11,0.05)', border: '1px solid rgba(0,0,0,0.08)', flexWrap: 'wrap' }}>
                    <span style={{
                      fontSize: 9, fontWeight: 800, letterSpacing: 0.5, padding: '2px 7px', borderRadius: 999, flexShrink: 0,
                      background: r.material_id ? 'rgba(13,115,119,0.12)' : 'rgba(245,158,11,0.15)',
                      color: r.material_id ? 'var(--teal)' : '#92400e',
                    }}>
                      {r.material_id ? 'STOCK' : 'EXTRA'}
                    </span>
                    <input
                      className="input"
                      value={r.name}
                      readOnly={!!r.material_id}
                      placeholder="Item name (e.g. wall anchors from Home Depot)"
                      onChange={(e) => updateUsedRow(r.id, { name: e.target.value })}
                      style={{ flex: '2 1 180px', fontSize: 13, padding: '7px 10px', background: r.material_id ? 'transparent' : undefined, border: r.material_id ? 'none' : undefined, fontWeight: 600 }}
                    />
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#888' }}>
                      Qty
                      <input
                        className="input" type="number" min="0" step="1"
                        value={r.quantity || ''}
                        onChange={(e) => updateUsedRow(r.id, { quantity: Number(e.target.value) })}
                        style={{ width: 64, fontSize: 12, padding: '6px 8px', textAlign: 'right' }}
                      />
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#888' }}>
                      $ each
                      <input
                        className="input" type="number" min="0" step="0.01"
                        value={r.unit_cost ?? ''}
                        placeholder="0.00"
                        onChange={(e) => updateUsedRow(r.id, { unit_cost: e.target.value === '' ? null : Number(e.target.value) })}
                        style={{ width: 80, fontSize: 12, padding: '6px 8px', textAlign: 'right' }}
                      />
                    </label>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#333', minWidth: 70, textAlign: 'right' }}>
                      {fmtMoney((Number(r.quantity) || 0) * (Number(r.unit_cost) || 0))}
                    </span>
                    <button type="button" onClick={() => removeUsedRow(r.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#aaa', padding: 4, flexShrink: 0 }}>
                      <X size={13} />
                    </button>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, alignItems: 'center', padding: '4px 10px' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#888', letterSpacing: 0.5, textTransform: 'uppercase' }}>Materials cost</span>
                  <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--teal)' }}>{fmtMoney(materialsUsedCost(materialsUsed))}</span>
                </div>
              </div>
            )}

            <div style={{ fontSize: 11, color: '#9ca3af' }}>
              Changes apply when you save the work order. Removing a stock row (or lowering its quantity) puts the units back in inventory.
            </div>

            {/* ── Mileage ── */}
            <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 16, marginTop: 4 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Mileage</div>
              <div style={{ fontSize: 12, color: '#888', lineHeight: 1.5, marginBottom: 12 }}>
                Log miles driven for this job — per tech, with a per-mile rate you can adjust
                (defaults to ${DEFAULT_MILEAGE_RATE.toFixed(2)}/mi).
              </div>

              {mileageLogs.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
                  {mileageLogs.map((r) => (
                    <div key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 10px', borderRadius: 10, background: 'rgba(13,115,119,0.04)', border: '1px solid rgba(0,0,0,0.08)', flexWrap: 'wrap' }}>
                      <div style={{ position: 'relative', flex: '1 1 140px' }}>
                        <select
                          className="select input"
                          value={r.contractor_name}
                          onChange={(e) => updateMileageRow(r.id, { contractor_name: e.target.value })}
                          style={{ fontSize: 12, padding: '6px 8px' }}
                        >
                          {contractorNames.map((n) => <option key={n} value={n}>{n}</option>)}
                          {r.contractor_name && !contractorNames.includes(r.contractor_name) && (
                            <option value={r.contractor_name}>{r.contractor_name}</option>
                          )}
                        </select>
                      </div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#888' }}>
                        Miles
                        <input
                          className="input" type="number" min="0" step="0.1"
                          value={r.miles || ''}
                          onChange={(e) => updateMileageRow(r.id, { miles: Number(e.target.value) })}
                          style={{ width: 72, fontSize: 12, padding: '6px 8px', textAlign: 'right' }}
                        />
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#888' }}>
                        $/mi
                        <input
                          className="input" type="number" min="0" step="0.01"
                          value={r.rate ?? ''}
                          onChange={(e) => updateMileageRow(r.id, { rate: Number(e.target.value) })}
                          style={{ width: 66, fontSize: 12, padding: '6px 8px', textAlign: 'right' }}
                        />
                      </label>
                      <input
                        className="input"
                        value={r.note ?? ''}
                        placeholder="Note (e.g. round trip)"
                        onChange={(e) => updateMileageRow(r.id, { note: e.target.value || null })}
                        style={{ flex: '1 1 130px', fontSize: 12, padding: '6px 8px' }}
                      />
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#333', minWidth: 64, textAlign: 'right' }}>
                        {fmtMoney((Number(r.miles) || 0) * (Number(r.rate) || 0))}
                      </span>
                      <button type="button" onClick={() => removeMileageRow(r.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#aaa', padding: 4, flexShrink: 0 }}>
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <button type="button" className="btn btn-ghost" onClick={addMileageRow} style={{ fontSize: 12 }}>
                  <Plus size={13} /> Add mileage
                </button>
                {mileageLogs.length > 0 && (
                  <span style={{ fontSize: 12, color: '#555' }}>
                    <strong>{totalMiles(mileageLogs).toLocaleString()}</strong> miles ·{' '}
                    <strong style={{ color: 'var(--teal)' }}>{fmtMoney(mileageReimbursement(mileageLogs))}</strong> reimbursement
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── PAYMENTS TAB ── */}
        {tab === 'payments' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* Summary tiles */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              <SummaryTile label="Total" value={fmtMoney(woTotal)} color="#1a1a1a" />
              <SummaryTile label="Paid" value={fmtMoney(totalPaid)} color="#047857" />
              <SummaryTile label="Remaining" value={fmtMoney(woRemaining)} color={woRemaining > 0 ? '#b91c1c' : '#047857'} />
            </div>

            {/* Payment history */}
            {woPayments.length === 0 && !showPayForm && (
              <div style={{ textAlign: 'center', padding: '24px 0', color: '#aaa', fontSize: 13 }}>
                No payments recorded for this work order yet.
              </div>
            )}

            {woPayments.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {woPayments.map((p) => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderRadius: 10, background: '#fafafa', border: '1.5px solid #e5e7eb', gap: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
                      <CheckCircle2 size={16} color="#047857" />
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 15, color: '#047857' }}>{fmtMoney(Number(p.amount))}</div>
                        <div style={{ fontSize: 11, color: '#888' }}>
                          {fmtDate(p.payment_date)} · {p.method}
                          {contractorNames.length >= 2 && p.contractor_name && <span> · to <strong>{p.contractor_name}</strong></span>}
                          {p.notes && <span> · {p.notes}</span>}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                      {onEditPayment && (
                        <button
                          title="Edit payment"
                          onClick={() => onEditPayment(p)}
                          style={{ padding: 6, border: 'none', background: 'none', cursor: 'pointer', color: '#aaa' }}
                        >
                          <Edit2 size={14} />
                        </button>
                      )}
                      {onDeletePayment && (
                        <button
                          title="Delete payment"
                          onClick={async () => {
                            if (!confirm('Delete this payment?')) return;
                            await onDeletePayment(p.id);
                          }}
                          style={{ padding: 6, border: 'none', background: 'none', cursor: 'pointer', color: '#ccc' }}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Inline log-payment form */}
            {showPayForm ? (
              <div style={{ padding: '16px 18px', borderRadius: 12, border: '1.5px solid rgba(13,115,119,0.25)', background: 'rgba(13,115,119,0.03)' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--teal)', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 14 }}>
                  Log Payment
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                  <PF label="Date *" icon={<Calendar size={13} />}>
                    <input
                      className="input"
                      type="date"
                      value={newPay.payment_date ?? ''}
                      onChange={(e) => setNewPay((p) => ({ ...p, payment_date: e.target.value }))}
                    />
                  </PF>
                  <PF label="Amount *" icon={<DollarSign size={13} />}>
                    <input
                      className="input"
                      type="number"
                      step="0.01"
                      min="0"
                      value={newPay.amount || ''}
                      placeholder={woRemaining > 0 ? String(woRemaining) : '0.00'}
                      onChange={(e) => setNewPay((p) => ({ ...p, amount: Number(e.target.value) }))}
                    />
                  </PF>
                </div>
                {contractorNames.length >= 2 && (
                  <div style={{ marginBottom: 12 }}>
                    <PF label="Pay To *" icon={<User size={13} />}>
                      <div style={{ position: 'relative' }}>
                        <select
                          className="select input"
                          value={newPay.contractor_name || item?.contractor_name || ''}
                          onChange={(e) => setNewPay((p) => ({ ...p, contractor_name: e.target.value }))}
                        >
                          {contractorNames.map((n) => (
                            <option key={n} value={n}>
                              {n}{contractorPay[n] ? ` — ${fmtMoney(contractorPay[n])} on this WO` : ''}
                            </option>
                          ))}
                        </select>
                        <ChevronDown size={11} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#aaa' }} />
                      </div>
                    </PF>
                  </div>
                )}
                <div style={{ marginBottom: 12 }}>
                  <PF label="Method" icon={<CreditCard size={13} />}>
                    <div style={{ position: 'relative' }}>
                      <select
                        className="select input"
                        value={newPay.method ?? 'Check'}
                        onChange={(e) => setNewPay((p) => ({ ...p, method: e.target.value }))}
                      >
                        {PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}
                      </select>
                      <ChevronDown size={11} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#aaa' }} />
                    </div>
                  </PF>
                </div>
                <div style={{ marginBottom: 16 }}>
                  <PF label="Notes">
                    <input
                      className="input"
                      value={newPay.notes ?? ''}
                      onChange={(e) => setNewPay((p) => ({ ...p, notes: e.target.value }))}
                      placeholder="Optional note..."
                    />
                  </PF>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-ghost" onClick={() => { setShowPayForm(false); setNewPay(defaultNewPay()); }} style={{ flex: 1, justifyContent: 'center' }}>
                    Cancel
                  </button>
                  <button
                    className="btn btn-primary"
                    disabled={payLoading || !newPay.amount || Number(newPay.amount) <= 0 || !newPay.payment_date}
                    style={{ flex: 2, justifyContent: 'center', opacity: (!newPay.amount || Number(newPay.amount) <= 0 || !newPay.payment_date) ? 0.5 : 1 }}
                    onClick={async () => {
                      if (!onSavePayment || !newPay.amount || Number(newPay.amount) <= 0 || !newPay.payment_date) return;
                      setPayLoading(true);
                      await onSavePayment({
                        ...newPay,
                        wo_number: item?.wo_number ?? '',
                        contractor_name: newPay.contractor_name || item?.contractor_name || '',
                      });
                      setPayLoading(false);
                      setShowPayForm(false);
                      setNewPay(defaultNewPay());
                    }}
                  >
                    {payLoading ? 'Saving…' : 'Record Payment'}
                  </button>
                </div>
              </div>
            ) : (
              onSavePayment && (
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    setNewPay((p) => ({ ...p, amount: woRemaining > 0 ? woRemaining : 0 }));
                    setShowPayForm(true);
                  }}
                  style={{ alignSelf: 'flex-start' }}
                >
                  <Plus size={14} /> Log Payment
                </button>
              )
            )}
          </div>
        )}

        {/* ── TIME LOGS TAB ── */}
        {tab === 'timelog' && (
          <WOTimeLogs woId={item?.id} />
        )}

        {/* ── CHAT TAB ── */}
        {tab === 'chat' && (
          <WorkOrderChatPanel woNumber={item?.wo_number} />
        )}

        {/* ── DOCUMENTS TAB ── */}
        {tab === 'documents' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* ── Sign-Off Sheet ── */}
            <div style={{ border: '1.5px solid rgba(13,115,119,0.25)', borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ padding: '10px 14px', background: 'rgba(13,115,119,0.06)', borderBottom: '1px solid rgba(13,115,119,0.12)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Printer size={14} style={{ color: 'var(--teal, #0D7377)' }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: 0.4 }}>Client Sign-Off Sheet</span>
              </div>
              <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.5 }}>
                  Print a sign-off sheet for the client to review and sign.<br />
                  Includes WO details, scope, deliverables checklist, and signature lines.
                </div>
                <button
                  className="btn btn-ghost"
                  style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, whiteSpace: 'nowrap' }}
                  disabled={!item}
                  onClick={() => item && printSignOffSheet(item)}
                >
                  <Printer size={14} />
                  Print Sign-Off Sheet
                </button>
              </div>
            </div>

            {/* ── Section 1: Vendor Paperwork (single, from template) ── */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#b8944a', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 }}>
                Vendor Paperwork
              </div>
              {form.attachment_url ? (
                <div style={{ border: '1.5px solid rgba(201,169,97,0.3)', borderRadius: 10, overflow: 'hidden' }}>
                  <div style={{ padding: '10px 14px', background: 'rgba(201,169,97,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#b8944a' }}>Attached</span>
                    <button onClick={() => set('attachment_url', null)} style={{ padding: 4, border: 'none', background: 'none', cursor: 'pointer', color: '#aaa', display: 'flex' }}>
                      <X size={13} />
                    </button>
                  </div>
                  {/\.(png|jpe?g|gif|webp)(\?|$)/i.test(form.attachment_url) ? (
                    <div style={{ position: 'relative' }}>
                      <img src={form.attachment_url} alt="Vendor attachment" style={{ width: '100%', maxHeight: 160, objectFit: 'cover', display: 'block' }} />
                      <a href={form.attachment_url} target="_blank" rel="noopener noreferrer"
                        style={{ position: 'absolute', bottom: 8, right: 8, padding: '4px 10px', background: 'rgba(0,0,0,0.55)', color: 'white', borderRadius: 6, fontSize: 11, fontWeight: 700, textDecoration: 'none' }}>
                        Full size →
                      </a>
                    </div>
                  ) : (
                    <a href={form.attachment_url} target="_blank" rel="noopener noreferrer"
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', textDecoration: 'none', color: '#1565c0' }}>
                      <Paperclip size={15} color="#b8944a" />
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{form.attachment_url.split('/').pop()?.split('?')[0] ?? 'vendor-doc'}</span>
                    </a>
                  )}
                </div>
              ) : (
                <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(201,169,97,0.05)', border: '1.5px dashed rgba(201,169,97,0.3)', fontSize: 12, color: '#aaa' }}>
                  No vendor paperwork attached. Load from a template on the Questions tab.
                </div>
              )}
            </div>

            {/* ── Section 2: Admin Documents & Photos ── */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--teal)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 }}>
                Admin Documents & Photos ({docUrls.length})
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
                  if (url) setDocUrls((prev) => [...prev, url]);
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
                  if (url) setDocUrls((prev) => [...prev, url]);
                  else setDocUploadError('Upload failed — try again');
                  setDocUploading(false);
                  if (photoFileRef.current) photoFileRef.current.value = '';
                }}
              />

              {/* Upload buttons */}
              {onUploadDoc && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
                  <button
                    type="button"
                    onClick={() => docFileRef.current?.click()}
                    disabled={docUploading}
                    style={{
                      padding: '16px 12px', border: '2px dashed rgba(13,115,119,0.35)', borderRadius: 10,
                      background: 'rgba(13,115,119,0.04)', cursor: docUploading ? 'not-allowed' : 'pointer',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                      color: 'var(--teal)', fontFamily: 'Lato, sans-serif', opacity: docUploading ? 0.6 : 1,
                    }}
                  >
                    <Upload size={20} color="var(--teal)" />
                    <span style={{ fontSize: 12, fontWeight: 700 }}>{docUploading ? 'Uploading…' : 'Upload Document'}</span>
                    <span style={{ fontSize: 10, color: '#aaa' }}>PDF, Word, Excel, Image</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => photoFileRef.current?.click()}
                    disabled={docUploading}
                    style={{
                      padding: '16px 12px', border: '2px dashed rgba(201,169,97,0.4)', borderRadius: 10,
                      background: 'rgba(201,169,97,0.05)', cursor: docUploading ? 'not-allowed' : 'pointer',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                      color: '#b8944a', fontFamily: 'Lato, sans-serif', opacity: docUploading ? 0.6 : 1,
                    }}
                  >
                    <Camera size={20} color="#b8944a" />
                    <span style={{ fontSize: 12, fontWeight: 700 }}>{docUploading ? 'Uploading…' : 'Take / Add Photo'}</span>
                    <span style={{ fontSize: 10, color: '#aaa' }}>Camera or gallery</span>
                  </button>
                </div>
              )}

              {docUploadError && (
                <div style={{ fontSize: 12, color: '#b91c1c', padding: '8px 12px', background: 'rgba(239,68,68,0.08)', borderRadius: 8, marginBottom: 10 }}>
                  {docUploadError}
                </div>
              )}

              {/* Gallery */}
              {docUrls.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '20px 0', color: '#b0bec5', fontSize: 12 }}>
                  No documents uploaded yet. Use the buttons above to add files or photos.
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10 }}>
                  {docUrls.map((url, i) => {
                    const isImage = /\.(png|jpe?g|gif|webp)(\?|$)/i.test(url);
                    const filename = url.split('/').pop()?.split('?')[0] ?? `file-${i + 1}`;
                    return (
                      <div key={url} style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', border: '1.5px solid #e5e7eb', background: '#fafafa' }}>
                        {isImage ? (
                          <a href={url} target="_blank" rel="noopener noreferrer">
                            <img src={url} alt={filename} style={{ width: '100%', height: 90, objectFit: 'cover', display: 'block' }} />
                          </a>
                        ) : (
                          <a href={url} target="_blank" rel="noopener noreferrer"
                            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 90, textDecoration: 'none', gap: 6 }}>
                            <Paperclip size={22} color="#b8944a" />
                            <span style={{ fontSize: 10, color: '#666', textAlign: 'center', padding: '0 6px', wordBreak: 'break-all' }}>
                              {filename.length > 20 ? filename.slice(0, 18) + '…' : filename}
                            </span>
                          </a>
                        )}
                        <button
                          onClick={() => setDocUrls((prev) => prev.filter((u) => u !== url))}
                          style={{
                            position: 'absolute', top: 4, right: 4,
                            width: 20, height: 20, borderRadius: '50%',
                            background: 'rgba(0,0,0,0.55)', border: 'none', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: 'white',
                          }}
                        >
                          <X size={11} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
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

function NetviewSubmitButton({ wo, contractors }: { wo: WorkOrder; contractors: Contractor[] }) {
  const [loading, setLoading] = useState(false);

  const openForm = async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      const contractor = contractors.find((c) => c.name === wo.contractor_name) ?? null;
      window.open(buildNetviewFormUrl(wo, contractor, user?.email ?? ''), '_blank');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '14px 16px', borderRadius: 10, background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.15)' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#1D4ED8', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6 }}>Netview Payroll</div>
      <div style={{ fontSize: 12, color: '#555', marginBottom: 10, lineHeight: 1.5 }}>
        Opens Netview&apos;s vendor payment form pre-filled from this work order. Review and submit it yourself —
        the full invoice must still be emailed to Payroll@TeamNetview.com per Netview&apos;s own instructions.
      </div>
      <button type="button" className="btn btn-ghost" disabled={loading} onClick={openForm} style={{ fontSize: 12 }}>
        {loading ? 'Opening…' : 'Submit to Netview'}
      </button>
    </div>
  );
}

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

function MoneyInput({ value, onChange }: { value: number | null | undefined; onChange: (value: number | null) => void }) {
  return (
    <div style={{ position: 'relative' }}>
      <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#aaa', fontSize: 14 }}>$</span>
      <input
        className="input"
        type="number"
        step="0.01"
        min="0"
        style={{ paddingLeft: 24 }}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
        placeholder="0.00"
      />
    </div>
  );
}

function RequirementToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, background: checked ? 'rgba(13,115,119,0.07)' : '#fafafa', border: `1.5px solid ${checked ? 'rgba(13,115,119,0.22)' : '#e5e7eb'}`, cursor: 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span style={{ fontSize: 12, color: checked ? 'var(--teal)' : '#555', fontWeight: 700 }}>{label}</span>
    </label>
  );
}

function SummaryTile({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ padding: '14px 16px', borderRadius: 10, background: '#fafafa', border: '1.5px solid #e5e7eb', textAlign: 'center' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color, fontFamily: 'Lato, sans-serif' }}>{value}</div>
    </div>
  );
}
