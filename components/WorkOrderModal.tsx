'use client';
import { useState, useRef, useEffect } from 'react';
import {
  X, Hash, User, FileText, Calendar, DollarSign,
  MapPin, Clock, Wrench, ChevronDown, ClipboardList,
  Phone, Mail, HelpCircle, Plus, Paperclip,
  Upload, Camera, FolderOpen, Briefcase, ShieldCheck,
  CreditCard, Trash2, CheckCircle2, Timer, Printer, MessageSquare, Edit2, Package, Layers,
  Link2,
  ClipboardPaste,
} from 'lucide-react';
import { linkLabel, parseClientLinks } from '@/lib/client-links';
import { parseTrackerRow } from '@/lib/tracker-row';
import { fullAddress } from '@/lib/site-info';
import { tabsInUse, type WoTab } from '@/lib/wo-tabs';
import { woNextStep, WO_STEPS, type WoNextAction } from '@/lib/wo-next-step';
import { listFor } from '@/lib/closeout';
import JobLogReport from '@/components/JobLogReport';
import './work-order-editor.css';
import type { EnrichedWorkOrder, WorkOrder, Contractor, WorkOrderStatus, QuestionTemplate, CustomQAItem, QuestionFieldType, Payment, SiteContact, DeliverableTemplate, Material, MaterialUsed, MaterialKit, MileageLog, PayAddon, PayAddonKind, WoTask } from '@/lib/types';
import { materialsUsedCost } from '@/lib/materials-used';
import { kitToMaterialsUsed, materialsUsedToKitItems, kitCost } from '@/lib/material-kits';
import { mileageReimbursement, totalMiles, DEFAULT_MILEAGE_RATE, mileageForTech } from '@/lib/mileage';
import { roundTripMiles } from '@/lib/driving';
import { toastError, toastSuccess } from '@/lib/toast';
import WOTimeLogs from '@/components/WOTimeLogs';
import { JobDays } from '@/components/HoursView';
import { HOURS_SAVE_ALL } from '@/lib/hours-look';
import WorkOrderChatPanel from '@/components/WorkOrderChatPanel';
import {
  PAY_TYPES,
  PAYMENT_METHODS,
  WO_STATUSES,
} from '@/lib/types';
import { fmtMoney, fmtDate, billableExtras, clientPaidMaterials, materialsReimbursement, materialsForTech, payAddonsTotal, PAY_ADDON_KINDS, payAddonAmount, billableAddons, seedPayLines } from '@/lib/utils';
import { printSignOffSheet } from '@/lib/signoff';
import { buildNetviewFormUrl } from '@/lib/netview-payroll';
import { choicesFor } from '@/lib/app-lists';
import { asValues } from '@/lib/custom-fields';
import CustomFieldInputs from '@/components/CustomFieldInputs';
import { StartAsksEditor } from '@/components/CaptureEditor';
import { parseStartAsks, type StartAsk } from '@/lib/checkin';
import { useJobTemplates } from '@/components/useJobTemplates';
import { CAPTURE_ITEMS, parseCapture, templateOf, toggleItem, type CaptureItem } from '@/lib/capture';
import { createClient } from '@/lib/supabase/client';
import AddressCheck from '@/components/AddressCheck';

type Tab = WoTab;
const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: 'details',    label: 'Details',    icon: <Hash size={13} /> },
  { key: 'site',       label: 'Location',   icon: <MapPin size={13} /> },
  { key: 'contacts',   label: 'Contacts',   icon: <Phone size={13} /> },
  { key: 'scope',      label: 'Scope',      icon: <ClipboardList size={13} /> },
  { key: 'questions',  label: 'Questions',  icon: <HelpCircle size={13} /> },
  { key: 'documents',  label: 'Documents',  icon: <FolderOpen size={13} /> },
  { key: 'marketplace', label: 'Marketplace', icon: <Briefcase size={13} /> },
  { key: 'pay',        label: 'Pay',        icon: <DollarSign size={13} /> },
  { key: 'payments',   label: 'Payments',   icon: <CreditCard size={13} /> },
  { key: 'timelog',    label: 'Time Logs',  icon: <Timer size={13} /> },
  { key: 'closeout',   label: 'Closeout',   icon: <Package size={13} /> },
  { key: 'chat',       label: 'Chat',       icon: <MessageSquare size={13} /> },
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
  'Open':        { bg: 'rgba(14,27,46,0.1)',   color: 'var(--teal)' },
  'Assigned':    { bg: 'rgba(201,162,75,0.15)',   color: '#b8944a' },
  'In Progress': { bg: 'rgba(245,158,11,0.15)',   color: '#b45309' },
  'Work Done':   { bg: 'rgba(99,102,241,0.12)',   color: '#4338ca' },
  'Approved':    { bg: 'rgba(16,185,129,0.12)',   color: '#047857' },
  'Paid':        { bg: 'rgba(16,185,129,0.2)',    color: '#047857' },
  'On Hold':     { bg: 'rgba(107,114,128,0.15)',  color: '#4b5563' },
};

/**
 * What the client is billed.
 *
 * Travel, client-bought materials and other charges are added on top of the
 * labour. They used not to be: saving an hourly job recomputed the total as
 * hours x rate, so a $168.70 visit silently became $110 and the travel was
 * gone. A fixed-price job is whatever was typed, extras included.
 */
/**
 * What the client is billed: the sum of the lines marked as theirs.
 *
 * Rate and hours used to be fields here, with travel and expenses in three
 * more beside them. They are all lines now, so this adds up one list rather
 * than juggling a pay type against five columns. A fixed-price job is still
 * whatever was typed.
 */
function calcTotal(f: Partial<WorkOrder>, addons: PayAddon[]): number {
  if (addons.length > 0) return billableAddons(addons);
  // Nothing on the list yet — keep whatever the job already carried, so opening
  // an older work order and closing it cannot zero its price.
  return Math.round((Number(f.total_amount) || 0) * 100) / 100;
}

type Props = {
  item: WorkOrder | null;
  nextWoNumber?: string;
  prefill?: Partial<WorkOrder>;
  contractors: Contractor[];
  questionTemplates: QuestionTemplate[];
  deliverableTemplates?: DeliverableTemplate[];
  /** A live invoice already bills this job (the next-step strip's Invoiced step). */
  invoiced?: boolean;
  payments?: Payment[];
  onSave: (w: Partial<WorkOrder>) => void;
  onClose: () => void;
  /** Delete this saved job (asks first, inside the window). */
  onDelete?: () => void;
  onSaveTemplate?: (name: string, questions: CustomQAItem[]) => Promise<void>;
  onUploadDoc?: (file: File) => Promise<string | null>;
  onSavePayment?: (p: Partial<Payment>) => Promise<void>;
  onDeletePayment?: (id: string) => Promise<void>;
  onEditPayment?: (p: Payment) => void;
  materials?: Material[];
  kits?: MaterialKit[];
  onSaveKit?: (k: Partial<MaterialKit>) => Promise<void>;
};

export default function WorkOrderModal({ item, nextWoNumber, prefill, contractors, questionTemplates, deliverableTemplates = [], invoiced = false, payments = [], onSave, onClose, onDelete, onSaveTemplate, onUploadDoc, onSavePayment, onDeletePayment, onEditPayment, materials = [], kits = [], onSaveKit }: Props) {
  const [tab, setTab] = useState<Tab>('details');
  const [askDelete, setAskDelete] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const techCardRef = useRef<HTMLElement>(null);
  const [docUploading, setDocUploading] = useState(false);
  const [docUploadError, setDocUploadError] = useState<string | null>(null);
  const docFileRef = useRef<HTMLInputElement>(null);
  const photoFileRef = useRef<HTMLInputElement>(null);
  // What the tech records (lib/capture.ts). A new job starts blank and the
  // office ticks what it needs (Fred, 2026-10-18: "All work order need to start
  // the same way blank"). null (a job made before) still asks for everything.
  const [capture, setCapture] = useState<CaptureItem[] | null>(() =>
    item?.id ? parseCapture(item?.capture) : (parseCapture(item?.capture ?? prefill?.capture) ?? []));
  // What else to ask at check-in (lib/checkin.ts).
  const [startAsks, setStartAsks] = useState<StartAsk[]>(() => parseStartAsks(item?.start_asks ?? (!item ? prefill?.start_asks : undefined)));
  // The client's links, one per line (lib/client-links.ts, migration 130).
  // A job made with Generate with AI starts with the links it found.
  const [linksText, setLinksText] = useState(() => (item?.client_links ?? (!item ? prefill?.client_links : null) ?? []).join('\n'));
  // Which link opens on site (the client's Teams meeting) and which at check-out
  // (the client's checkout form). Migration 133; Fred, 2026-10-18.
  const [checkinLink, setCheckinLink] = useState(() => item?.checkin_link ?? (!item ? prefill?.checkin_link : null) ?? '');
  const [checkoutLink, setCheckoutLink] = useState(() => item?.checkout_link ?? (!item ? prefill?.checkout_link : null) ?? '');
  // Which link is the survey and which takes the documents (Fred, 2026-10-25: "a deliverable
  // like like how we have a check and out like and one for survey and one doe documents").
  const [surveyLink, setSurveyLink] = useState(() => item?.survey_link ?? (!item ? prefill?.survey_link : null) ?? '');
  const [deliverableLink, setDeliverableLink] = useState(() => item?.deliverable_link ?? (!item ? prefill?.deliverable_link : null) ?? '');
  const { templates: jobTemplates } = useJobTemplates();
  const [form, setForm] = useState<Partial<WorkOrder>>({
    wo_number:       item?.wo_number       ?? nextWoNumber ?? '',
    title:           item?.title           ?? '',
    // Fred's own fields (Settings -> Custom fields); saved by saveWorkOrder.
    custom:          asValues(item?.custom ?? prefill?.custom),
    contractor_name: item?.contractor_name ?? '',
    // Normalize legacy lowercase 'netview' (written by the email importer pre-fix)
    // so the Source dropdown matches its 'NetView' option.
    source_platform: item?.source_platform?.toLowerCase() === 'netview' ? 'NetView' : (item?.source_platform ?? 'Internal'),
    external_wo_id:  item?.external_wo_id  ?? '',
    customer_name:   item?.customer_name   ?? '',
    project_name:    item?.project_name    ?? '',
    is_project:      item?.is_project      ?? false,
    client_reference: item?.client_reference ?? '',
    client_status:   item?.client_status   ?? '',
    client_program:  item?.client_program  ?? '',
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
    // The miles as saved: 0 is "no mileage charge" (Pay removed), so the job doesn't work them
    // out again when it opens. Never read in before, so every saved job looked new to that
    // check and Pay came back (Fred, 2026-10-25: "but the pay still is popping up").
    billable_miles:  item?.billable_miles  ?? null,
    billable_travel: item?.billable_travel ?? null,
    // AI-generated prefill values (see WorkOrdersView's "Generate with AI") only apply in
    // create mode, and only override the specific fields they set — everything else above
    // keeps its normal default.
    ...(!item ? prefill : {}),
  });
  const [customQA, setCustomQA] = useState<CustomQAItem[]>(() => item?.custom_qa ?? (!item ? prefill?.custom_qa : null) ?? []);

  // ── Tech checklist (wo_tasks) ───────────────────────────────────────────────
  // What techs tick off in their portal and WorkFlow. Filled by "Generate with
  // AI" or typed here (Fred, 2026-10-02). Existing ticks are kept as they are.
  const [tasks, setTasks] = useState<WoTask[]>(() => item?.wo_tasks ?? (!item ? prefill?.wo_tasks : null) ?? []);
  const [newTask, setNewTask] = useState('');
  const [newTaskCat, setNewTaskCat] = useState<WoTask['category']>('On Site');
  const addTask = () => {
    const label = newTask.trim();
    if (!label) return;
    setTasks((ts) => [...ts, { id: crypto.randomUUID(), category: newTaskCat, label, completed: false, completed_at: null }]);
    setNewTask('');
  };

  // ── Multi-contacts ─────────────────────────────────────────────────────────
  const [contacts, setContacts] = useState<SiteContact[]>(() => item?.contacts ?? (!item ? prefill?.contacts : null) ?? []);
  const addContact = () => setContacts((cs) => [
    ...cs,
    { id: crypto.randomUUID(), label: '', name: '', phone: '', email: '' },
  ]);
  const removeContact = (id: string) => setContacts((cs) => cs.filter((c) => c.id !== id));
  const updateContact = (id: string, field: keyof SiteContact, value: string) =>
    setContacts((cs) => cs.map((c) => c.id === id ? { ...c, [field]: value } : c));
  const [docUrls, setDocUrls] = useState<string[]>(() => item?.doc_urls ?? []);

  // ── Multi-contractor ───────────────────────────────────────────────────────
  const [contractorNames, setContractorNames] = useState<string[]>(() => {
    if (item?.contractor_names && item.contractor_names.length > 0) return item.contractor_names;
    if (item?.contractor_name) return [item.contractor_name];
    // A new job from an approved support ticket arrives with its tech picked.
    if (!item && prefill?.contractor_names?.length) return prefill.contractor_names;
    return [];
  });
  const [contractorToAdd, setContractorToAdd] = useState<string>('');
  // Lead tech: who is responsible for deliverables / closeout
  const [leadContractorName, setLeadContractorName] = useState<string | null>(
    () => item?.lead_contractor_name ?? null
  );
  // Per-tech pay split (migration-029). Only meaningful with 2+ contractors.
  /**
   * The pay is labour plus a list, and labour is a line like anything else.
   *
   * Older jobs start from seedPayLines (lib/utils): their price becomes a
   * Labour line and their billed travel comes over as it was, so opening a job
   * and pressing Save changes no money. (Seeding them here as paid-to-tech
   * lines, as this used to, would have changed the price on save.)
   */
  const [payAddons, setPayAddons] = useState<PayAddon[]>(() => (item ? seedPayLines(item) : []));
  const addPayAddon = (kind: PayAddonKind) => {
    const meta = PAY_ADDON_KINDS.find((k) => k.kind === kind)!;
    setPayAddons((rows) => [...rows, {
      id: `pa-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      kind, label: meta.label, amount: 0,
      qty: meta.metered ? 1 : null,
      rate: meta.metered ? (kind === 'mileage' ? billRate : null) : null,
      deduct: meta.deduct,
      // A charge is billed to the client by default and paid back to the tech
      // only when it is money they laid out. Deductions are never billed on.
      bill_client: !meta.deduct,
      pay_tech: meta.deduct || meta.kind === 'materials' || meta.kind === 'mileage',
      contractor_name: null,
    }]);
  };
  const updatePayAddon = (id: string, patch: Partial<PayAddon>) =>
    setPayAddons((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removePayAddon = (id: string) => setPayAddons((rows) => rows.filter((r) => r.id !== id));

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
      // Bought for the job = someone is out of pocket, so it comes back by
      // default. Stock off the van was already paid for by the business.
      reimburse: material_id === null,
      client_pays: false,
    }]);
  };
  const updateUsedRow = (id: string, patch: Partial<MaterialUsed>) =>
    setMaterialsUsed((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeUsedRow = (id: string) =>
    setMaterialsUsed((rows) => rows.filter((r) => r.id !== id));

  // -- Closeout: kits -------------------------------------------------------
  // A saved recipe of materials, dropped in whole. Stock rows still only move
  // inventory when the work order is saved, exactly as a hand-added row does.
  const addKit = (kitId: string) => {
    const kit = kits.find((k) => k.id === kitId);
    if (!kit) return;
    const rows = kitToMaterialsUsed(kit.items, materials);
    if (rows.length === 0) { toastError(kit.name + ' has nothing in it yet'); return; }
    setMaterialsUsed((prev) => [...prev, ...rows]);
    toastSuccess(kit.name + ' added — ' + rows.length + ' line' + (rows.length === 1 ? '' : 's') + ', ' + fmtMoney(kitCost(kit.items)) + '. Adjust quantities, then Save.');
  };

  const saveAsKit = async () => {
    if (!onSaveKit) return;
    const items = materialsUsedToKitItems(materialsUsed);
    if (items.length === 0) { toastError('Add some materials first'); return; }
    const name = window.prompt('Name this kit, so you can add the same list to the next job:', '');
    if (!name || !name.trim()) return;
    await onSaveKit({ name: name.trim(), description: null, items });
  };

  // ── Closeout: receipt → materials ─────────────────────────────────────────
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receiptText, setReceiptText] = useState('');
  const [receiptBusy, setReceiptBusy] = useState(false);
  const importReceipt = async (payload: { file?: File; text?: string }) => {
    setReceiptBusy(true);
    try {
      let res: Response;
      if (payload.file) {
        const fd = new FormData();
        fd.append('file', payload.file);
        res = await fetch('/api/materials/from-receipt', { method: 'POST', body: fd });
      } else {
        res = await fetch('/api/materials/from-receipt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: payload.text ?? '' }),
        });
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toastError(data.error || 'Could not read that receipt'); return; }
      const items: { name: string; quantity: number; unit_cost: number }[] = data.items ?? [];
      setMaterialsUsed((rows) => [
        ...rows,
        ...items.map((it) => ({
          id: `mu-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          material_id: null,
          name: data.vendor ? `${it.name} (${data.vendor})` : it.name,
          quantity: it.quantity,
          unit_cost: it.unit_cost,
        })),
      ]);
      const total = items.reduce((s, it) => s + it.quantity * it.unit_cost, 0);
      toastSuccess(`${items.length} item${items.length === 1 ? '' : 's'} added — ${fmtMoney(total)}${data.vendor ? ` from ${data.vendor}` : ''}. Review, then Save.`);
      setReceiptText('');
      setReceiptOpen(false);
    } catch {
      toastError('Could not read that receipt — check your connection');
    } finally {
      setReceiptBusy(false);
    }
  };

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

  // Mileage calculator: real road miles, home base → this WO's site → home,
  // using the same engine as the Site Log (Nominatim + OSRM, both free).
  const [calcingMiles, setCalcingMiles] = useState(false);
  /**
   * The mileage rate to bill the client, from settings rather than a constant.
   *
   * The work order used to charge a hard-coded $0.70/mi while the Site Log used
   * the rate in settings and the client statement bills $0.50 — three different
   * numbers for one thing. This reads the same setting the rest of the app does.
   */
  const [billRate, setBillRate] = useState<number>(DEFAULT_MILEAGE_RATE);
  useEffect(() => {
    void (async () => {
      const sb = createClient();
      const { data } = await sb.from('user_settings').select('mileage_rate').maybeSingle();
      if (data?.mileage_rate != null) setBillRate(Number(data.mileage_rate));
    })();
  }, []);

  /**
   * Work out the round trip and fill in the CLIENT's travel charge.
   *
   * Reimbursing the tech is a separate decision — the mileage rows below are
   * still his to add — so this fills the billable side only.
   */
  /** Pay taken off this job: mileage is not worked out for it again. */
  const milesOff = useRef(false);
  const autoCalcBillableMiles = async (silent = false) => {
    const dest = [form.site_address, form.site_city, form.site_state, form.site_zip].filter(Boolean).join(', ');
    if (!dest) {
      if (!silent) toastError('Add a site address first (Site tab) so there is somewhere to route to.');
      return;
    }
    const sb = createClient();
    const { data: s } = await sb.from('user_settings').select('home_base_address').maybeSingle();
    const home = (s?.home_base_address as string | null) ?? '';
    if (!home) {
      if (!silent) toastError('Set your Home Base on the Site Log first — round trips start and end there.');
      return;
    }
    setCalcingMiles(true);
    const mi = await roundTripMiles(home, dest);
    setCalcingMiles(false);
    // Pay was taken off while the trip was being worked out: leave it off.
    if (silent && milesOff.current) return;
    if (mi == null) {
      if (!silent) toastError("Couldn't route that address — check street, city and state on the Site tab.");
      return;
    }
    const amount = Math.round(mi * billRate * 100) / 100;
    setForm((f) => ({ ...f, billable_miles: mi }));
    // One mileage line, updated in place — calculating twice must not leave two.
    setPayAddons((rows) => {
      const existing = rows.find((r) => r.kind === 'mileage');
      const label = `Mileage — ${mi} mi × $${billRate.toFixed(2)}`;
      if (existing) return rows.map((r) => (r.id === existing.id ? { ...r, label, amount } : r));
      return [...rows, {
        id: `pa-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        kind: 'mileage' as PayAddonKind, label, amount, deduct: false,
        bill_client: true, pay_tech: false, contractor_name: null,
      }];
    });
    if (!silent) toastSuccess(`${mi} miles round trip — ${fmtMoney(amount)} at $${billRate.toFixed(2)}/mi`);
  };

  /**
   * Do it without being asked, once, when a job has an address and no travel
   * recorded. Fred's question was why this was not automatic: it never was, and
   * the manual button was buried in the Mileage section and filled the tech's
   * reimbursement instead of the client's charge.
   */
  const autoTried = useRef(false);
  useEffect(() => {
    if (autoTried.current) return;
    const hasAddress = !!(form.site_address || form.site_zip);
    const noTravelYet = !payAddons.some((a) => a.kind === 'mileage') && !form.billable_travel;
    // Only for a job whose miles were never worked out. 0 is no mileage charge (left off in Generate
    // with AI's "Build this job?", lib/ai-needs.ts, or Pay removed); miles worked out once and the
    // line since taken off stay off (Fred, 2026-10-24: "every time I take out pay, it comes right back").
    const workedOut = form.billable_miles != null;
    if (!hasAddress || !noTravelYet || workedOut || milesOff.current) return;
    autoTried.current = true;
    void autoCalcBillableMiles(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.site_address, form.site_zip]);

  const autoCalcMiles = async () => {
    const dest = [form.site_address, form.site_city, form.site_state, form.site_zip].filter(Boolean).join(', ');
    if (!dest) { toastError('Add a site address first (Site tab) so there\'s somewhere to route to.'); return; }
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: s } = await supabase.from('user_settings').select('home_base_address').maybeSingle();
    let home = (s?.home_base_address as string | null) ?? '';
    if (!home) {
      const entered = window.prompt('Home base address (round trips start and end here — saved for next time):', '');
      if (!entered?.trim()) return;
      home = entered.trim();
      await supabase.from('user_settings').upsert({ user_id: user.id, home_base_address: home, updated_at: new Date().toISOString() });
    }
    setCalcingMiles(true);
    const mi = await roundTripMiles(home, dest);
    setCalcingMiles(false);
    if (mi == null) { toastError("Couldn't route that address — check street, city, and state on the Site tab."); return; }
    setMileageLogs((rows) => {
      // Fill the first empty row before adding a new one
      const target = rows.find((r) => !(Number(r.miles) > 0));
      if (target) return rows.map((r) => (r.id === target.id ? { ...r, miles: mi, note: r.note ?? 'round trip (calculated)' } : r));
      return [...rows, {
        id: `ml-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        contractor_name: contractorNames[0] ?? '',
        miles: mi,
        rate: DEFAULT_MILEAGE_RATE,
        note: 'round trip (calculated)',
      }];
    });
    toastSuccess(`${mi} miles round trip, home base to site`);
  };

  // ── Payments tab state ────────────────────────────────────────────────────
  const [showPayForm, setShowPayForm] = useState(false);
  const [payLoading, setPayLoading] = useState(false);
  const defaultNewPay = (): Partial<Payment> => ({
    wo_number: item?.wo_number ?? '',
    contractor_name: item?.contractor_name ?? '',
    payment_date: new Date().toISOString().split('T')[0],
    amount: 0,
    method: 'Zelle',
    notes: '',
  });
  const [newPay, setNewPay] = useState<Partial<Payment>>(defaultNewPay);

  const set = (k: keyof WorkOrder, v: string | number | boolean | null) =>
    setForm((f) => ({ ...f, [k]: v }));

  // A row pasted from the client's tracker (lib/tracker-row.ts): fills what it has, keeps the rest.
  const [trackerRow, setTrackerRow] = useState('');
  const fillFromTracker = () => {
    const r = parseTrackerRow(trackerRow);
    if (!r) { toastError("That doesn't look like a tracker row. Copy the whole row (it starts with the ticket, like LDS-1103) and paste it again."); return; }
    const { contractor_names: techs, client_links: links, checkout_link: form_, ...fields } = r;
    // An existing job keeps its own title and status; a new one takes the tracker's.
    const keep = item ? ['title', 'wo_status', 'description'] : [];
    // A new address drops the old map pin, so saving looks the new one up and the map moves with it.
    setForm((f) => ({ ...f, ...Object.fromEntries(Object.entries(fields).filter(([k, v]) => v != null && v !== '' && !keep.includes(k))),
      ...(fields.site_address && fields.site_address !== f.site_address ? { site_lat: undefined, site_lng: undefined } : {}) }));
    if (techs?.length) setContractorNames((now) => [...new Set([...now, ...techs])]);
    if (links?.length) setLinksText((now) => [...new Set([...parseClientLinks(now), ...links])].join('\n'));
    if (form_) setCheckoutLink(form_);
    // The tracker's Google Drive folder is where the documents go (a folder, not a file in Drive).
    const folder = links?.find((l) => /^https:\/\/drive\.google\.com\/drive\/(u\/\d+\/)?folders\//i.test(l));
    if (folder) setDeliverableLink((now) => now || folder);
    setTrackerRow('');
    toastSuccess(`Filled in ${r.external_wo_id}: site ${r.client_reference ?? '?'}${techs?.length ? `, ${techs.join(' and ')}` : ''}. Check it, then Save.`);
  };
  // A row copied from the client's tracker fills the job in; nothing is saved until Save
  // (Fred, 2026-10-24: "just add these features to the market place ticket number site number etc").
  // On the Marketplace tab, and on Details for a new job, so a pasted row is the first step.
  const trackerBox = (
    <section className="woe-card">
      <h3><ClipboardPaste size={15} /> Paste a row from the client&apos;s tracker</h3>
      <div style={{ fontSize: 12.5, color: '#6b7280', margin: '0 0 6px' }}>
        Copy the job&apos;s row from the LDS / NetView sheet and paste it here: the ticket and site numbers, dates, address, techs, links and status fill in below. Check them, then Save.
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <textarea className="input" rows={2} value={trackerRow} onChange={(e) => setTrackerRow(e.target.value)} style={{ flex: '1 1 320px' }}
          placeholder={'LDS-1103\t5333202\t10/26/2026\t8:00 AM\t10/30/2026\tPending Tech Assignment\t…'} aria-label="Tracker row" />
        <button type="button" className="btn btn-primary" disabled={!trackerRow.trim()} onClick={fillFromTracker}>Fill in</button>
      </div>
    </section>
  );
  // Typing in an address field drops a position picked with Check address; saving looks it up again.
  const setAddr = (k: 'site_address' | 'site_city' | 'site_state' | 'site_zip', v: string) =>
    setForm((f) => ({ ...f, [k]: v, ...(f[k] !== v && f.site_lat !== undefined ? { site_lat: undefined, site_lng: undefined } : {}) }));

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

  const computed = calcTotal(form, payAddons);
  // A job only needs its number to save. No tech yet is normal — it sits in
  // Dispatch's "Needs a tech" column (Fred, 2026-10-05: "cant edit work
  // orders" — Save stayed greyed out on every job without a tech, about 30
  // of them, with nothing saying why).
  const canSave = !!form.wo_number?.trim();

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

  // Which tabs show (Fred, 2026-10-18: start blank, add what's needed).
  const [addedTabs, setAddedTabs] = useState<Tab[]>([]);
  const inUse = tabsInUse({
    saved: !!item?.id, status: form.wo_status, checkedIn: !!item?.checked_in_at,
    techs: contractorNames.length, docs: docUrls.length, attachment: form.attachment_url,
    client: { customer: form.customer_name, buyer: form.buyer_company, externalId: form.external_wo_id, reference: form.client_reference,
      project: form.project_name, isProject: form.is_project, platform: form.source_platform },
    pay: contractorPay, payLines: payAddons.filter((l) => Number(l.amount) > 0).length, payments: woPayments.length,
    site: [form.site_name, form.site_address, form.site_city, form.site_state, form.site_zip],
    scope: [form.access_instructions, form.parking_instructions, form.deliverable_instructions, form.deliverables, form.parts_materials,
      form.required_skills, form.tools_required],
    tasks: tasks.length, contacts: contacts.length, poc: [form.poc_name, form.poc_phone, form.poc_email],
    questions: customQA.length, materials: materialsUsed.length, closeout: item?.closeout,
  });
  // Sections taken off this job with their × (Fred, 2026-10-24: "i only can add not remove i need to
  // remove things like marketplace or pay if needed"). + Add brings one back.
  const [removedTabs, setRemovedTabs] = useState<Tab[]>([]);
  const shownTabs = TABS.filter((t) => !removedTabs.includes(t.key) && (inUse.includes(t.key) || addedTabs.includes(t.key) || t.key === tab));
  const hiddenTabs = TABS.filter((t) => !shownTabs.includes(t));
  // One page in job order (Fred, 2026-10-31: "work order as one page, in job order"): every section this
  // job uses is on the page; the chips jump to it. Chat loads only when opened, so it stays a toggle.
  const onPage = (k: Tab) => k !== 'chat' && shownTabs.some((t) => t.key === k);
  const goSection = (k: Tab) => {
    setTab(k);
    setTimeout(() => document.getElementById(`woe-sec-${k}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };
  /** What removing a section clears, for the sections whose fields can simply be emptied. */
  const clearTab: Partial<Record<Tab, { what: string; clear: () => void }>> = {
    marketplace: { what: 'the client, buyer, ticket #, site #, project and status', clear: () => setForm((f) => ({
      ...f, customer_name: '', buyer_company: '', external_wo_id: '', client_reference: '', project_name: '', is_project: false,
      source_platform: 'Internal', client_status: '', client_program: '' })) },
    pay: { what: 'the price, the tech pay and the pay add-ons, mileage included', clear: () => {
      setContractorPay({});
      setPayAddons([]);
      // And the price, which the Labour line is rebuilt from when the job opens, with 0 miles so mileage
      // isn't worked out again. Otherwise Pay comes straight back (lib/utils.ts seedPayLines).
      setForm((f) => ({ ...f, total_amount: 0, billable_miles: 0 }));
      milesOff.current = true;
    } },
    site: { what: 'the site name and address', clear: () => setForm((f) => ({
      ...f, site_name: '', site_address: '', site_city: '', site_state: '', site_zip: '', site_lat: undefined, site_lng: undefined })) },
    scope: { what: 'the access, parking, tools, parts, deliverables and the checklist', clear: () => {
      setForm((f) => ({ ...f, access_instructions: '', parking_instructions: '', deliverable_instructions: '', deliverables: '', parts_materials: '', required_skills: '', tools_required: '' }));
      setTasks([]);
    } },
    contacts: { what: 'the contacts', clear: () => { setContacts([]); setForm((f) => ({ ...f, poc_name: '', poc_phone: '', poc_email: '' })); } },
    questions: { what: 'the questions', clear: () => setCustomQA([]) },
  };
  const removeTab = (k: Tab, label: string) => {
    const c = clearTab[k];
    if (c && inUse.includes(k) && !window.confirm(`Remove ${label} from this job? ${c.what[0].toUpperCase()}${c.what.slice(1)} will be cleared when you save.`)) return;
    c?.clear();
    setAddedTabs((a) => a.filter((x) => x !== k));
    setRemovedTabs((r) => (r.includes(k) ? r : [...r, k]));
    if (tab === k) setTab('details');
  };
  const totalPaid   = woPayments.reduce((s, p) => s + Number(p.amount), 0);
  // What actually goes out: tech pay when set (client price otherwise) plus mileage
  const assignedTechPay = contractorNames.reduce((s, n) => s + (Number(contractorPay[n]) || 0), 0);
  const woTotal     = (assignedTechPay > 0 ? assignedTechPay : (computed > 0 ? computed : Number(form.total_amount) || 0)) + mileageReimbursement(mileageLogs);
  const woRemaining = Math.max(0, woTotal - totalPaid);

  const handleSave = () => {
    if (!canSave) return;
    // Hours typed on the Time Logs tab and not saved yet are saved with the work order.
    window.dispatchEvent(new Event(HOURS_SAVE_ALL));
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
      // Persist tech pay when at least one amount is entered (single tech or split);
      // keep only entries for techs still on the WO. Null = legacy "tech gets full price".
      contractor_pay: (() => {
        const pruned: Record<string, number> = {};
        for (const n of finalNames) {
          const amt = Number(contractorPay[n]) || 0;
          if (amt > 0) pruned[n] = amt;
        }
        return Object.keys(pruned).length > 0 ? pruned : null;
      })(),
      // Closeout materials (migration-031) — drop unnamed rows
      materials_used: materialsUsed.filter((r) => r.name.trim() !== ''),
      // One list holds everything that is not labour. The three billable_*
      // columns are left alone rather than rewritten: they still carry work
      // orders raised before the rebuild, and billableExtras only reads them
      // when a job has no add-ons.
      pay_addons:         payAddons.filter((a) => Number(a.amount) !== 0),
      // 0 is kept: no mileage charge, so the job doesn't work one out again when it opens.
      billable_miles:     form.billable_miles == null ? null : Number(form.billable_miles) || 0,
      // Mileage (migration-032) — drop zero-mile rows
      mileage_logs: mileageLogs.filter((r) => (Number(r.miles) || 0) > 0),
      total_amount:    computed,
      external_wo_id:  form.external_wo_id  || null,
      customer_name:   form.customer_name   || null,
      project_name:    form.project_name    || null,
      is_project:      !!form.is_project,
      client_reference: form.client_reference || null,
      // Sent once either is used, so saving works before migration 140.
      ...(form.client_status || form.client_program || item?.client_status || item?.client_program ? {
        client_status: form.client_status?.trim() || null, client_program: form.client_program?.trim() || null,
      } : {}),
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
      wo_tasks:        tasks.filter((t) => t.label.trim()),
      // Sent only once a job has a list, so saving works before migration 128.
      ...(capture || item?.capture ? { capture } : {}),
      ...(startAsks.length || item?.start_asks ? { start_asks: startAsks } : {}),
      ...(linksText.trim() || item?.client_links ? { client_links: parseClientLinks(linksText) } : {}),
      // Only a link that is still on the list; sent once either has been used, so saving works before migration 133.
      ...(checkinLink || checkoutLink || item?.checkin_link || item?.checkout_link ? {
        checkin_link: parseClientLinks(linksText).includes(checkinLink) ? checkinLink : null,
        checkout_link: parseClientLinks(linksText).includes(checkoutLink) ? checkoutLink : null,
      } : {}),
      // The same for the survey and documents links (migration 142).
      ...(surveyLink || deliverableLink || item?.survey_link || item?.deliverable_link ? {
        survey_link: parseClientLinks(linksText).includes(surveyLink) ? surveyLink : null,
        deliverable_link: parseClientLinks(linksText).includes(deliverableLink) ? deliverableLink : null,
      } : {}),
    };
    onSave({ ...item, ...payload });
  };

  const statusStyle = STATUS_COLORS[form.wo_status as WorkOrderStatus] ?? STATUS_COLORS['Open'];
  const next = woNextStep({
    saved: !!item?.id, status: form.wo_status, techs: contractorNames, responses: item?.assignment_responses,
    checkedIn: !!item?.checked_in_at, invoiced,
  });
  const nextAt = WO_STEPS.findIndex((st) => st.key === next.step);
  const unsavedStatus = !!item?.id && form.wo_status !== item.wo_status;
  const runNext = (a: WoNextAction) => {
    if (a === 'pick-tech') {
      setTab('details');
      setTimeout(() => techCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0);
    } else if (a === 'approve') set('wo_status', 'Approved');
    else if (a === 'mark-paid') set('wo_status', 'Paid');
    else if (a === 'invoice' || a === 'closeout') setLogOpen(true);
  };
  const onHold = form.wo_status === 'On Hold';
  const toggleHold = () => set('wo_status', !onHold ? 'On Hold'
    : item?.checked_in_at ? 'In Progress' : contractorNames.length ? 'Assigned' : 'Open');

  return (
    <div className="modal-overlay">
      {logOpen && item?.id && (
        <JobLogReport w={{ ...item, ...form } as EnrichedWorkOrder}
          deliverables={listFor([], form.title ?? '', form.description ?? '').items} onClose={() => setLogOpen(false)} />
      )}
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720 }}>
        {/* Header: what it is, its status, and when, once (Fred, 2026-10-18:
            "just need the date and time at the top once"). */}
        <div className="woe-head">
          <div className="woe-head-top">
            <span className="woe-eyebrow">{item ? 'Work order' : 'New work order'}{form.wo_number ? ` · #${form.wo_number}` : ''}</span>
            <span className="woe-status" style={{ background: statusStyle.bg, color: statusStyle.color }}>{form.wo_status || 'Open'}</span>
            <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
          </div>
          <h2 className="woe-title">{form.title || (item ? `WO #${item.wo_number}` : 'New work order')}</h2>
          <div className="woe-when">
            <label><span><Calendar size={13} /> Date</span>
              <input className="input" type="date" value={form.start_date ?? ''} onChange={(e) => set('start_date', e.target.value)} />
            </label>
            <label><span><Clock size={13} /> Time</span>
              <input className="input" type="time" value={form.start_time ?? ''} onChange={(e) => set('start_time', e.target.value)} />
            </label>
            <label><span><Calendar size={13} /> Last day (if more than one)</span>
              <input className="input" type="date" value={form.end_date ?? ''} onChange={(e) => set('end_date', e.target.value)} />
            </label>
          </div>
        </div>

        {/* Next step (lib/wo-next-step.ts): where the job is, and one button for what's next. */}
        <div className="woe-next" aria-label="Next step">
          <ol className="woe-steps">
            {WO_STEPS.map((st, i) => (
              <li key={st.key} data-state={i < nextAt ? 'done' : i === nextAt ? 'now' : 'later'}>{st.label}</li>
            ))}
          </ol>
          <div className="woe-next-row">
            <span className="woe-next-note">
              {next.note}{unsavedStatus && <b> Press Save changes to keep it.</b>}
            </span>
            {item?.id && ['done', 'approved', 'invoiced', 'paid'].includes(next.step) && next.action?.do !== 'invoice' && (
              <button type="button" className="btn btn-ghost" onClick={() => setLogOpen(true)}>Job log</button>
            )}
            {item?.id && form.wo_status !== 'Paid' && (
              <button type="button" className={onHold ? 'btn btn-primary' : 'btn btn-ghost'} onClick={toggleHold}>
                {onHold ? 'Take off hold' : 'Put on hold'}
              </button>
            )}
            {next.action && (next.action.do !== 'invoice' || item?.id) && (
              <button type="button" className="btn btn-primary" onClick={() => runNext(next.action!.do)}>{next.action.label}</button>
            )}
          </div>
        </div>

        {/* Sections: Details, plus only what this job uses or Fred adds (lib/wo-tabs.ts). */}
        <div className="woe-tabs" role="group" aria-label="Sections">
          {shownTabs.map((t) => (
            <span key={t.key} style={{ display: 'inline-flex', alignItems: 'center' }}>
              <button type="button" className="woe-tab" aria-pressed={t.key === 'chat' ? tab === 'chat' : undefined} onClick={() => goSection(t.key)}>
                {t.icon} {t.label}
                {t.key === 'documents' && docUrls.length > 0 && <span className="woe-count">{docUrls.length}</span>}
              </button>
              {t.key !== 'details' && (
                <button type="button" onClick={() => removeTab(t.key, t.label)} aria-label={`Remove ${t.label}`} title={`Remove ${t.label} from this job`}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', color: '#9ca3af', display: 'inline-flex' }}>
                  <X size={13} />
                </button>
              )}
            </span>
          ))}
          {hiddenTabs.length > 0 && (
            <select className="woe-add" aria-label="Add a section" value="" onChange={(e) => {
              const k = e.target.value as Tab;
              if (!k) return;
              setAddedTabs((a) => (a.includes(k) ? a : [...a, k]));
              setRemovedTabs((r) => r.filter((x) => x !== k));
              goSection(k);
            }}>
              <option value="">+ Add</option>
              {hiddenTabs.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          )}
        </div>

        <div id="woe-sec-details" className="woe-sec-anchor" />
        {/* ── DETAILS TAB ── */}
        {onPage('details') && (
          <div className="woe-stack">
            {!item && trackerBox}
            <section className="woe-card">
              <h3><FileText size={15} /> Job</h3>
              <div className="woe-grid woe-grid-job">
                <label className="woe-field"><span>WO #</span>
                  <input className="input" value={form.wo_number ?? ''} onChange={(e) => set('wo_number', e.target.value)} placeholder="e.g. 1001" autoFocus />
                </label>
                <label className="woe-field"><span>Job title</span>
                  <input className="input" value={form.title ?? ''} onChange={(e) => set('title', e.target.value)} placeholder="e.g. LDS-1110 — Site 5011876, Gaffney, SC" />
                </label>
              </div>
              <div className="woe-grid">
                <label className="woe-field"><span>Type of work</span>
                  <select className="select input" value={form.service_type ?? ''} onChange={(e) => set('service_type', e.target.value)}>
                    <option value="">Select type</option>
                    {choicesFor('serviceTypes', form.service_type).map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </label>
                <label className="woe-field"><span>Status</span>
                  <select className="select input" value={form.wo_status ?? 'Open'} onChange={(e) => set('wo_status', e.target.value as WorkOrderStatus)}
                    style={{ color: statusStyle.color, fontWeight: 700 }}>
                    {WO_STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
                  </select>
                </label>
              </div>
            </section>

            {/* Who's on it. No money on this page (Fred: "remove money"); tech pay is under Pay. */}
            <section className="woe-card" ref={techCardRef}>
              <h3><User size={15} /> Tech</h3>
              {contractorNames.map((name) => {
                const isLead = name === resolvedLead;
                const isMulti = contractorNames.length >= 2;
                const resp = item?.assignment_responses?.[name];
                return (
                  <div key={name} className="woe-tech">
                    {isMulti && (
                      <button type="button" onClick={() => setLeadContractorName(name)} title={isLead ? 'Lead tech' : 'Make lead tech'}
                        aria-label={isLead ? `${name} is the lead tech` : `Make ${name} the lead tech`}
                        style={{ width: 18, height: 18, borderRadius: '50%', flexShrink: 0, padding: 0, cursor: 'pointer',
                          border: isLead ? '2px solid #0E1B2E' : '2px solid #ccc', background: isLead ? '#0E1B2E' : '#fff' }} />
                    )}
                    <span className="woe-tech-name">{name}</span>
                    {isMulti && (
                      <span className="woe-badge" style={{ background: isLead ? 'rgba(14,27,46,0.1)' : 'rgba(0,0,0,0.06)', color: isLead ? '#0E1B2E' : '#6b7280' }}>
                        {isLead ? 'Lead' : 'Helper'}
                      </span>
                    )}
                    {item && (!resp
                      ? <span className="woe-badge" style={{ background: 'rgba(245,158,11,0.12)', color: '#b45309' }}>Waiting</span>
                      : resp.status === 'accepted'
                        ? <span className="woe-badge" title={`Accepted ${new Date(resp.at).toLocaleString()}`} style={{ background: 'rgba(4,120,87,0.12)', color: '#047857' }}>Accepted</span>
                        : <span className="woe-badge" title={`Declined ${new Date(resp.at).toLocaleString()}`} style={{ background: 'rgba(185,28,28,0.12)', color: '#b91c1c' }}>Declined</span>)}
                    <button type="button" onClick={() => removeContractor(name)} aria-label={`Take ${name} off this job`}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: '#9ca3af', display: 'flex' }}>
                      <X size={14} />
                    </button>
                  </div>
                );
              })}
              <div className="woe-tech-add">
                <select className="select input" style={{ flex: 1 }} value={contractorToAdd} onChange={(e) => setContractorToAdd(e.target.value)}
                  aria-label="Add a tech">
                  <option value="">{contractorNames.length === 0 ? 'Pick a tech' : 'Add another tech'}</option>
                  {contractors.filter((c) => !contractorNames.includes(c.name)).map((c) => (
                    <option key={c.id} value={c.name} disabled={!!c.on_hold}>{c.name}{c.on_hold ? ' — on hold' : ''}</option>
                  ))}
                </select>
                <button type="button" className="btn btn-primary" onClick={addContractor} disabled={!contractorToAdd} style={{ opacity: contractorToAdd ? 1 : 0.5 }}>
                  <Plus size={14} /> Add
                </button>
              </div>
            </section>

            <section className="woe-card">
              <h3><ClipboardList size={15} /> Description</h3>
              <textarea className="input" rows={4} value={form.description ?? ''} onChange={(e) => set('description', e.target.value)} placeholder="What the job is" />
            </section>

            <section className="woe-card">
              <h3><Link2 size={15} /> Client links</h3>
              <p className="woe-hint">One per line. The tech sees each one as a button.</p>
              <textarea className="input" rows={3} value={linksText} onChange={(e) => setLinksText(e.target.value)} placeholder="Paste the client's links here" />
              {parseClientLinks(linksText).length > 0 && (
                <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
                  {([
                    ['When the tech checks in on site, open (e.g. the Teams meeting)', checkinLink, setCheckinLink],
                    ['When the tech checks out for the day, open (e.g. the checkout form)', checkoutLink, setCheckoutLink],
                    ['The site survey, where the tech fills it in', surveyLink, setSurveyLink],
                    ['The documents, where the tech uploads the photos and deliverables (e.g. the Google Drive folder)', deliverableLink, setDeliverableLink],
                  ] as const).map(([label, value, setValue]) => (
                    <label key={label} style={{ display: 'grid', gap: 4, fontSize: 13, fontWeight: 600 }}>
                      {label}
                      <select className="select input" value={parseClientLinks(linksText).includes(value) ? value : ''} onChange={(e) => setValue(e.target.value)}>
                        <option value="">Nothing</option>
                        {parseClientLinks(linksText).map((l) => <option key={l} value={l}>{linkLabel(l)}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
              )}
            </section>

            <CustomFieldInputs target="jobs" values={asValues(form.custom)} onChange={(v) => setForm((f) => ({ ...f, custom: v }))} />

            <section className="woe-card">
              <WhatTheTechRecords capture={capture} onChange={setCapture} templates={jobTemplates}
                startAsks={startAsks} onStartAsks={setStartAsks} />
            </section>
          </div>
        )}

        {onPage('site') && <h3 id="woe-sec-site" className="woe-sec-title">Where</h3>}
        {/* ── SITE TAB ── */}
        {onPage('site') && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <PF label="Site Name" icon={<MapPin size={13} />}>
              <input className="input" value={form.site_name ?? ''} onChange={(e) => set('site_name', e.target.value)} placeholder="e.g. Walmart #4521, Eastgate Mall" />
            </PF>
            <PF label="Street Address" icon={<MapPin size={13} />}>
              <input className="input" value={form.site_address ?? ''} onChange={(e) => setAddr('site_address', e.target.value)} placeholder="123 Main St" />
            </PF>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 80px 100px', gap: 12 }}>
              <PF label="City">
                <input className="input" value={form.site_city ?? ''} onChange={(e) => setAddr('site_city', e.target.value)} placeholder="City" />
              </PF>
              <PF label="State">
                <input className="input" value={form.site_state ?? ''} onChange={(e) => setAddr('site_state', e.target.value.toUpperCase())} placeholder="PA" maxLength={2} />
              </PF>
              <PF label="ZIP">
                <input className="input" value={form.site_zip ?? ''} onChange={(e) => setAddr('site_zip', e.target.value)} placeholder="00000" maxLength={10} />
              </PF>
            </div>
            <AddressCheck form={form} onUse={(a) => setForm((f) => ({
              ...f, site_address: a.street, site_city: a.city, site_state: a.state, site_zip: a.zip, site_lat: a.lat, site_lng: a.lng,
            }))} />
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

        {onPage('contacts') && <h3 id="woe-sec-contacts" className="woe-sec-title">Who to call</h3>}
        {/* ── CONTACTS TAB ── */}
        {onPage('contacts') && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ padding: '12px 16px', background: 'rgba(14,27,46,0.05)', borderRadius: 10, fontSize: 12, color: '#666' }}>
              Add all site contacts. Contractors will see this info in their portal.
            </div>

            {contacts.length === 0 && (
              <div style={{ textAlign: 'center', padding: '24px 0', color: '#aaa', fontSize: 13 }}>
                No contacts yet — click &quot;Add Contact&quot; to get started.
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

        {onPage('scope') && <h3 id="woe-sec-scope" className="woe-sec-title">Scope & checklist</h3>}
        {/* ── SCOPE TAB ── */}
        {onPage('scope') && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>


            {/* Deliverables + Closeout in one card */}
            <div style={{ border: '1.5px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ padding: '8px 12px', background: '#f9fafb', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 6 }}>
                <ClipboardList size={13} style={{ color: 'var(--teal, #0E1B2E)' }} />
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

            {/* Tech checklist — ticked off by the tech in their portal */}
            <div style={{ border: '1.5px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ padding: '8px 12px', background: '#f9fafb', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 6 }}>
                <ClipboardList size={13} style={{ color: 'var(--teal, #0E1B2E)' }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: 0.4, flex: 1 }}>Tech checklist</span>
                <span style={{ fontSize: 11, color: '#6b7280' }}>{tasks.length ? `${tasks.filter((t) => t.completed).length} of ${tasks.length} done` : 'Techs tick these off in their portal'}</span>
                {tasks.length > 0 && (
                  <button type="button" className="btn btn-ghost" style={{ padding: '2px 8px', fontSize: 11, color: '#b91c1c' }}
                    onClick={() => setTasks([])} title="Takes every step off. Save to keep it.">Remove all</button>
                )}
              </div>
              <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {tasks.map((t, i) => (
                  <div key={t.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <select className="select input" style={{ width: 120, flexShrink: 0, fontSize: 12, padding: '6px 8px' }} value={t.category}
                      onChange={(e) => setTasks((ts) => ts.map((x, j) => (j === i ? { ...x, category: e.target.value as WoTask['category'] } : x)))}>
                      {(['Pre Visit', 'On Site', 'Post Site'] as const).map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <input className="input" style={{ flex: 1, textDecoration: t.completed ? 'line-through' : 'none' }} value={t.label}
                      onChange={(e) => setTasks((ts) => ts.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                    <button type="button" className="icon-btn" title="Remove" onClick={() => setTasks((ts) => ts.filter((_, j) => j !== i))}><X size={14} /></button>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <select className="select input" style={{ width: 120, flexShrink: 0, fontSize: 12, padding: '6px 8px' }} value={newTaskCat}
                    onChange={(e) => setNewTaskCat(e.target.value as WoTask['category'])}>
                    {(['Pre Visit', 'On Site', 'Post Site'] as const).map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <input className="input" style={{ flex: 1 }} value={newTask} placeholder="Add a step, e.g. Take before and after photos"
                    onChange={(e) => setNewTask(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTask(); } }} />
                  <button type="button" className="btn btn-ghost" style={{ padding: '8px 12px' }} onClick={addTask}><Plus size={14} /> Add</button>
                </div>
              </div>
            </div>

            {/* Tools + Parts in one card */}
            <div style={{ border: '1.5px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ padding: '8px 12px', background: '#f9fafb', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Wrench size={13} style={{ color: 'var(--teal, #0E1B2E)' }} />
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
                    {choicesFor('serviceTypes', form.service_type).map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
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

        {onPage('questions') && <h3 id="woe-sec-questions" className="woe-sec-title">Questions</h3>}
        {/* ── QUESTIONS TAB ── */}
        {onPage('questions') && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Built-in packets */}
            <div style={{ padding: '12px 16px', background: 'rgba(14,27,46,0.05)', borderRadius: 10 }}>
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
                      border: '1.5px solid rgba(14,27,46,0.22)',
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
              <div style={{ padding: '12px 16px', background: 'rgba(14,27,46,0.05)', borderRadius: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#555', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8 }}>
                  Load from Template
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {questionTemplates.map((tpl) => (
                    <button
                      key={tpl.id}
                      onClick={() => applyTemplate(tpl.id)}
                      style={{
                        padding: '6px 14px', borderRadius: 20, border: '1.5px solid rgba(14,27,46,0.3)',
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, background: 'rgba(201,162,75,0.08)', border: '1.5px solid rgba(201,162,75,0.2)' }}>
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

        {onPage('documents') && <h3 id="woe-sec-documents" className="woe-sec-title">Documents & links</h3>}
        {/* ── DOCUMENTS TAB ── */}
        {onPage('documents') && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* ── Sign-Off Sheet ── */}
            <div style={{ border: '1.5px solid rgba(14,27,46,0.25)', borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ padding: '10px 14px', background: 'rgba(14,27,46,0.06)', borderBottom: '1px solid rgba(14,27,46,0.12)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Printer size={14} style={{ color: 'var(--teal, #0E1B2E)' }} />
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
                <div style={{ border: '1.5px solid rgba(201,162,75,0.3)', borderRadius: 10, overflow: 'hidden' }}>
                  <div style={{ padding: '10px 14px', background: 'rgba(201,162,75,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
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
                <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(201,162,75,0.05)', border: '1.5px dashed rgba(201,162,75,0.3)', fontSize: 12, color: '#aaa' }}>
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
                      padding: '16px 12px', border: '2px dashed rgba(14,27,46,0.35)', borderRadius: 10,
                      background: 'rgba(14,27,46,0.04)', cursor: docUploading ? 'not-allowed' : 'pointer',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                      color: 'var(--teal)', fontFamily: 'Inter, sans-serif', opacity: docUploading ? 0.6 : 1,
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
                      padding: '16px 12px', border: '2px dashed rgba(201,162,75,0.4)', borderRadius: 10,
                      background: 'rgba(201,162,75,0.05)', cursor: docUploading ? 'not-allowed' : 'pointer',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                      color: '#b8944a', fontFamily: 'Inter, sans-serif', opacity: docUploading ? 0.6 : 1,
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
        {onPage('marketplace') && <h3 id="woe-sec-marketplace" className="woe-sec-title">Client & ticket</h3>}
        {/* ── MARKETPLACE TAB ── */}
        {onPage('marketplace') && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {trackerBox}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <PF label="Source" icon={<Briefcase size={13} />}>
                <div style={{ position: 'relative' }}>
                  <select className="select input" value={form.source_platform ?? 'Internal'} onChange={(e) => set('source_platform', e.target.value)}>
                    {choicesFor('sources', form.source_platform ?? 'Internal').map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                  <ChevronDown size={13} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#aaa' }} />
                </div>
              </PF>
              <PF label="Ticket # / External WO" icon={<Hash size={13} />}>
                <input className="input" value={form.external_wo_id ?? ''} onChange={(e) => set('external_wo_id', e.target.value)} placeholder="e.g. LDS-1103, FN-123456" />
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
                {/* Fred, 2026-10-13: projects get the travel / on site / hotel day,
                    receipts and miles, and the client report (migration 117). */}
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 13.5, cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!form.is_project} onChange={(e) => set('is_project', e.target.checked)} />
                  <span><b>Project site</b>: techs log travel, time on site, lunch and receipts; miles from GPS</span>
                </label>
              </PF>
              <PF label="Site # / Client reference" icon={<Hash size={13} />}>
                <input className="input" value={form.client_reference ?? ''} onChange={(e) => set('client_reference', e.target.value)} placeholder="e.g. 5333202, store or PO number" />
              </PF>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <PF label="Client's status">
                <input className="input" value={form.client_status ?? ''} maxLength={120} onChange={(e) => set('client_status', e.target.value)} placeholder="Their status, e.g. Pending Tech Assignment" />
              </PF>
              <PF label="Program / type">
                <input className="input" value={form.client_program ?? ''} maxLength={120} onChange={(e) => set('client_program', e.target.value)} placeholder="e.g. Legacy" />
              </PF>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <PF label="Assignment Type">
                <div style={{ position: 'relative' }}>
                  <select className="select input" value={form.assignment_type ?? 'Internal'} onChange={(e) => set('assignment_type', e.target.value)}>
                    {choicesFor('assignmentTypes', form.assignment_type ?? 'Internal').map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                  <ChevronDown size={13} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#aaa' }} />
                </div>
              </PF>
              <PF label="Priority" icon={<ShieldCheck size={13} />}>
                <div style={{ position: 'relative' }}>
                  <select className="select input" value={form.priority ?? 'Normal'} onChange={(e) => set('priority', e.target.value)}>
                    {choicesFor('priorities', form.priority ?? 'Normal').map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
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

        {onPage('pay') && <h3 id="woe-sec-pay" className="woe-sec-title">Pay</h3>}
        {/* ── PAY TAB ── */}
        {onPage('pay') && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* What each tech gets on this job. It used to sit on Details; Fred
                wanted no money there (2026-10-18), so it lives here now. */}
            {contractorNames.length > 0 && (
              <section className="woe-card">
                <h3><User size={15} /> Tech pay</h3>
                {contractorNames.map((name) => {
                  const extra = mileageForTech(mileageLogs, name) + materialsForTech(materialsUsed, name, contractorNames[0] ?? null);
                  return (
                    <div key={name} className="woe-tech">
                      <span className="woe-tech-name">{name}</span>
                      {extra > 0 && <span className="woe-badge" title="Mileage and materials this tech is owed back, on top of their labour" style={{ background: 'rgba(4,120,87,0.12)', color: '#047857' }}>+{fmtMoney(extra)} back</span>}
                      <span style={{ fontSize: 12, color: '#888', fontWeight: 700 }}>$</span>
                      <input className="input" type="number" min="0" step="0.01" value={contractorPay[name] ?? ''}
                        onChange={(e) => setTechPay(name, e.target.value === '' ? 0 : Number(e.target.value))}
                        placeholder="0.00" aria-label={`${name}'s pay`} style={{ width: 100, textAlign: 'right' }} />
                    </div>
                  );
                })}
                {(() => {
                  // The whole payout, not just the labour: mileage, materials and add-ons are money out too.
                  const assigned = contractorNames.reduce((sum, n) => sum + (Number(contractorPay[n]) || 0), 0);
                  const mileagePay = mileageReimbursement(mileageLogs);
                  const materialsPay = materialsReimbursement(materialsUsed);
                  const addonsPay = payAddonsTotal(payAddons);
                  const woAmount = calcTotal(form, payAddons);
                  const payout = Math.round((assigned + mileagePay + materialsPay + addonsPay) * 100) / 100;
                  const profit = Math.round((woAmount - payout) * 100) / 100;
                  return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: assigned === 0 ? '#9ca3af' : profit >= 0 ? '#047857' : '#b45309' }}>
                        {assigned === 0 && payout === 0
                          ? 'No tech pay set: the tech gets the full client labour'
                          : [
                              `Labour ${fmtMoney(assigned)}`,
                              mileagePay ? `Mileage ${fmtMoney(mileagePay)}` : null,
                              materialsPay ? `Materials ${fmtMoney(materialsPay)}` : null,
                              addonsPay ? `Add-ons ${fmtMoney(addonsPay)}` : null,
                            ].filter(Boolean).join(' + ')
                            + ` = ${fmtMoney(payout)} out · Client ${fmtMoney(woAmount)} · Your profit ${fmtMoney(profit)}${profit < 0 ? ' (paying out more than the client pays!)' : ''}`}
                      </span>
                      {contractorNames.length >= 2 && (
                        <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => {
                          const even = Math.floor((woAmount / contractorNames.length) * 100) / 100;
                          const next: Record<string, number> = {};
                          // The first tech takes the rounding so the split always adds up to the total.
                          contractorNames.forEach((n, i) => { next[n] = i === 0 ? Math.round((woAmount - even * (contractorNames.length - 1)) * 100) / 100 : even; });
                          setContractorPay(next);
                        }}>Split evenly</button>
                      )}
                    </div>
                  );
                })()}
              </section>
            )}
            {/* Pay type selector */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#555', marginBottom: 10, letterSpacing: 0.5, textTransform: 'uppercase' }}>Pay Type</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
                {PAY_TYPES.map((pt) => (
                  <button key={pt} type="button" onClick={() => set('pay_type', pt)} style={{
                    padding: '12px 8px', borderRadius: 10, border: 'none', cursor: 'pointer',
                    fontFamily: 'Inter, sans-serif', fontWeight: 700, fontSize: 12,
                    background: form.pay_type === pt ? 'var(--teal)' : 'rgba(14,27,46,0.06)',
                    color: form.pay_type === pt ? 'white' : 'var(--teal)',
                    boxShadow: form.pay_type === pt ? '0 4px 12px rgba(14,27,46,0.3)' : 'none',
                    transition: 'all 0.2s',
                  }}>{pt}</button>
                ))}
              </div>
            </div>

            {/* ── Add-ons on the pay ──────────────────────────────────────
                Labour, then a list of lines that add or come off, and a sum —
                the shape of the Field Nation panel Fred works from. Fixed
                fields could not hold a per diem, a toll or a platform fee. */}
            <div style={{ border: '1px solid #eee', borderRadius: 12, padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.5, color: '#555', textTransform: 'uppercase' }}>
                  Add-ons on the pay
                </div>
                <select
                  className="input"
                  value=""
                  onChange={(e) => { if (e.target.value) addPayAddon(e.target.value as PayAddonKind); }}
                  title="Add a charge on top of the labour, or something that comes off it"
                  style={{ width: 'auto', fontSize: 12, padding: '6px 10px', cursor: 'pointer' }}
                >
                  <option value="">+ Add a line…</option>
                  {PAY_ADDON_KINDS.map((k) => (
                    <option key={k.kind} value={k.kind}>
                      {k.deduct ? '− ' : '+ '}{k.label}
                    </option>
                  ))}
                </select>
              </div>

              {payAddons.length === 0 ? (
                <div style={{ fontSize: 12, color: '#aaa', padding: '10px 2px' }}>
                  Nothing on top of the labour yet. Materials, mileage, per diem and tolls add to the pay;
                  tax and platform fees come off it.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {payAddons.map((a) => (
                    <div key={a.id} style={{
                      display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap',
                      padding: '7px 9px', borderRadius: 9,
                      background: a.deduct ? 'rgba(239,68,68,0.05)' : 'rgba(16,185,129,0.05)',
                      border: '1px solid rgba(0,0,0,0.07)',
                    }}>
                      <button
                        type="button"
                        onClick={() => updatePayAddon(a.id, { deduct: !a.deduct })}
                        title={a.deduct ? 'Comes off the pay — click to make it add' : 'Adds to the pay — click to make it come off'}
                        style={{
                          width: 26, height: 26, borderRadius: 999, cursor: 'pointer', flexShrink: 0,
                          border: 'none', fontSize: 15, fontWeight: 800,
                          background: a.deduct ? 'rgba(239,68,68,0.15)' : 'rgba(16,185,129,0.15)',
                          color: a.deduct ? '#b91c1c' : '#047857',
                        }}
                      >
                        {a.deduct ? '−' : '+'}
                      </button>
                      <input
                        className="input"
                        value={a.label}
                        onChange={(e) => updatePayAddon(a.id, { label: e.target.value })}
                        placeholder="What is it"
                        style={{ flex: '2 1 160px', fontSize: 13, padding: '6px 9px', fontWeight: 600 }}
                      />
                      {contractorNames.length > 1 && (
                        <select
                          className="input"
                          value={a.contractor_name ?? ''}
                          onChange={(e) => updatePayAddon(a.id, { contractor_name: e.target.value || null })}
                          title="Whose line is this"
                          style={{ width: 'auto', fontSize: 11, padding: '6px 8px' }}
                        >
                          <option value="">Lead tech</option>
                          {contractorNames.map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                      )}
                      {/* Two hours at $55 and 117.4 miles at $0.50 are the same
                          shape, so a line is either a flat figure or qty × rate. */}
                      {a.qty != null || a.rate != null ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                          <input
                            className="input" type="number" step="0.01" min="0"
                            value={a.qty ?? ''}
                            onChange={(e) => updatePayAddon(a.id, { qty: e.target.value === '' ? null : Number(e.target.value) })}
                            placeholder="qty"
                            title={a.kind === 'labour' ? 'Hours' : a.kind === 'mileage' ? 'Miles' : 'How many'}
                            style={{ width: 62, fontSize: 12, padding: '6px 8px', textAlign: 'right' }}
                          />
                          <span style={{ fontSize: 12, color: '#aaa' }}>×</span>
                          <span style={{ fontSize: 12, color: '#888', fontWeight: 700 }}>$</span>
                          <input
                            className="input" type="number" step="0.01" min="0"
                            value={a.rate ?? ''}
                            onChange={(e) => updatePayAddon(a.id, { rate: e.target.value === '' ? null : Number(e.target.value) })}
                            placeholder="rate"
                            style={{ width: 70, fontSize: 12, padding: '6px 8px', textAlign: 'right' }}
                          />
                          <span style={{ fontSize: 12, fontWeight: 800, minWidth: 74, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                            {fmtMoney(payAddonAmount(a))}
                          </span>
                          <button
                            type="button"
                            onClick={() => updatePayAddon(a.id, { amount: payAddonAmount(a), qty: null, rate: null })}
                            title="Enter one figure instead"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#bbb', fontSize: 10, padding: 2 }}
                          >
                            flat
                          </button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                          <span style={{ fontSize: 12, color: '#888', fontWeight: 700 }}>$</span>
                          <input
                            className="input" type="number" step="0.01" min="0"
                            value={a.amount || ''}
                            onChange={(e) => updatePayAddon(a.id, { amount: Number(e.target.value) })}
                            placeholder="0.00"
                            style={{ width: 92, fontSize: 12, padding: '6px 8px', textAlign: 'right' }}
                          />
                          <button
                            type="button"
                            onClick={() => updatePayAddon(a.id, { qty: 1, rate: a.amount || 0 })}
                            title="Work it out as an amount × a rate"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#bbb', fontSize: 10, padding: 2 }}
                          >
                            × rate
                          </button>
                        </div>
                      )}
                      {/* Which side this line lands on. Both can be on: travel
                          is often billed to the client AND paid back to whoever
                          drove. This is what the separate travel, materials and
                          mileage sections could never say without disagreeing. */}
                      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                        {!a.deduct && (
                          <SideToggle
                            on={a.bill_client}
                            onClick={() => updatePayAddon(a.id, { bill_client: !a.bill_client })}
                            onLabel="Client pays" offLabel="Not billed"
                            title={a.bill_client ? 'On the client’s bill' : 'Not billed to the client'}
                            color="#047857"
                          />
                        )}
                        <SideToggle
                          on={a.pay_tech}
                          onClick={() => updatePayAddon(a.id, { pay_tech: !a.pay_tech })}
                          onLabel={a.deduct ? 'Off their pay' : 'Tech paid'}
                          offLabel={a.deduct ? 'Not off pay' : 'Not paid out'}
                          title={a.pay_tech ? 'Counts in what the tech is owed' : 'Does not affect the tech’s pay'}
                          color={a.deduct ? '#b91c1c' : 'var(--teal)'}
                        />
                      </div>
                      <button type="button" onClick={() => removePayAddon(a.id)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#aaa', padding: 4, flexShrink: 0 }}>
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                  <div style={{ paddingTop: 9, borderTop: '1px solid #e8e8e8', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#666' }}>
                      <span>Client pays</span>
                      <strong style={{ fontSize: 16, color: 'var(--teal)', fontVariantNumeric: 'tabular-nums' }}>
                        {fmtMoney(billableAddons(payAddons))}
                      </strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#666' }}>
                      <span>Goes out to the tech</span>
                      <strong style={{
                        fontVariantNumeric: 'tabular-nums',
                        color: payAddonsTotal(payAddons) < 0 ? '#b91c1c' : '#333',
                      }}>
                        {fmtMoney(payAddonsTotal(payAddons))}
                      </strong>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* What the client is billed on top of the labour. Revenue — the
                tech's mileage reimbursement is separate, further down, because
                whether a tech gets the travel back varies by job. */}
            {/* Fixed */}
            {/* Every pay type used to bring its own pair of rate boxes —
                hourly rate and hours, rate per device and a count, a blended
                base with overtime — plus expense, travel and bonus underneath.
                All of it is a line now, and a line already does qty × rate, so
                there is nothing left for these to say. Pay Type stays as the
                label for the KIND of job it is. */}

            {form.source_platform?.toLowerCase() === 'netview' && item && (
              <NetviewSubmitButton wo={item} contractors={contractors} />
            )}
          </div>
        )}

        {onPage('payments') && <h3 id="woe-sec-payments" className="woe-sec-title">Payments</h3>}
        {/* ── PAYMENTS TAB ── */}
        {onPage('payments') && (
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
              <div style={{ padding: '16px 18px', borderRadius: 12, border: '1.5px solid rgba(14,27,46,0.25)', background: 'rgba(14,27,46,0.03)' }}>
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

        {onPage('timelog') && <h3 id="woe-sec-timelog" className="woe-sec-title">Time on the job</h3>}
        {/* ── TIME LOGS TAB ── */}
        {/* The same day cards as the Hours screen, so a time changed here is the
            time on the Field Sheet and the invoice, and the other way round
            (Fred, 2026-10-24: "so i change the time do it reflest in the work order"). */}
        {onPage('timelog') && (
          <div style={{ display: 'grid', gap: 20 }}>
            {item && <div className="wf"><JobDays wo={item} /></div>}
            {/* The phones' own record, which the office's changes above never alter: folded away so it
                isn't read as the hours (Fred, 2026-10-24: "i updated the time loge but it did not reflect"). */}
            <details>
              <summary style={{ cursor: 'pointer', fontSize: 13, color: '#6b7280', padding: '4px 0' }}>
                What the techs&apos; phones recorded (your changes are in the days above)
              </summary>
              <WOTimeLogs woId={item?.id} />
            </details>
          </div>
        )}

        {onPage('closeout') && <h3 id="woe-sec-closeout" className="woe-sec-title">Closeout</h3>}
        {/* ── CLOSEOUT TAB ── */}
        {onPage('closeout') && (
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
              {kits.length > 0 && (
                <div style={{ position: 'relative', flex: '1 1 200px' }}>
                  <select
                    className="select input"
                    value=""
                    onChange={(e) => { if (e.target.value) addKit(e.target.value); e.target.value = ''; }}
                    title="Drop in a saved list of materials for this kind of job"
                    style={{ fontSize: 12 }}
                  >
                    <option value="">+ Add from kit&hellip;</option>
                    {[...kits].sort((a, b) => a.name.localeCompare(b.name)).map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.name} ({(k.items ?? []).length} line{(k.items ?? []).length === 1 ? '' : 's'} · {fmtMoney(kitCost(k.items))})
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={11} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#aaa' }} />
                </div>
              )}
              <button type="button" className="btn btn-ghost" onClick={() => addUsedRow(null)} style={{ fontSize: 12 }}>
                <Plus size={13} /> Other item (bought for job)
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setReceiptOpen((o) => !o)}
                title="Snap or paste a store receipt — items and costs land here automatically"
                style={{ fontSize: 12, color: 'var(--teal)' }}
              >
                🧾 Add from receipt
              </button>
            </div>

            {receiptOpen && (
              <div style={{ padding: '14px 16px', borderRadius: 10, border: '1.5px solid rgba(14,27,46,0.25)', background: 'rgba(14,27,46,0.03)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 12, color: '#666', lineHeight: 1.5 }}>
                  <strong>Scan or upload:</strong> the camera, a screenshot of the emailed receipt, or a saved PDF.{' '}
                  <strong>Or paste:</strong> copy the receipt text below. Items and prices are read
                  automatically and added as EXTRA materials for you to review.
                </div>
                {/* No `capture`: forcing the camera hides the gallery and Files,
                    so a receipt that is already a screenshot or a PDF could
                    never be picked. Left off, the phone offers all three. */}
                <label className="btn btn-ghost" style={{ fontSize: 12, cursor: receiptBusy ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start' }}>
                  <Camera size={13} /> {receiptBusy ? 'Reading…' : 'Scan or upload a receipt'}
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    disabled={receiptBusy}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) importReceipt({ file: f });
                      e.target.value = '';
                    }}
                    style={{ display: 'none' }}
                  />
                </label>
                <textarea
                  className="input"
                  rows={4}
                  value={receiptText}
                  onChange={(e) => setReceiptText(e.target.value)}
                  placeholder={'Or paste receipt text, e.g.\n2X4X8 KD STUD  3.98\nROMEX 14/2 50FT  45.97'}
                  style={{ fontSize: 12, fontFamily: 'monospace' }}
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={receiptBusy || !receiptText.trim()}
                  onClick={() => importReceipt({ text: receiptText })}
                  style={{ fontSize: 12, alignSelf: 'flex-end', opacity: receiptBusy || !receiptText.trim() ? 0.6 : 1 }}
                >
                  {receiptBusy ? 'Reading…' : 'Read items from text'}
                </button>
              </div>
            )}

            {/* Rows */}
            {materialsUsed.length === 0 ? (
              <div style={{ padding: '28px 16px', textAlign: 'center', color: '#aaa', fontSize: 13, border: '1.5px dashed #e5e7eb', borderRadius: 10 }}>
                Nothing added yet
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {materialsUsed.map((r) => (
                  <div key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 10px', borderRadius: 10, background: r.material_id ? 'rgba(14,27,46,0.04)' : 'rgba(245,158,11,0.05)', border: '1px solid rgba(0,0,0,0.08)', flexWrap: 'wrap' }}>
                    <span style={{
                      fontSize: 9, fontWeight: 800, letterSpacing: 0.5, padding: '2px 7px', borderRadius: 999, flexShrink: 0,
                      background: r.material_id ? 'rgba(14,27,46,0.12)' : 'rgba(245,158,11,0.15)',
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
                    {/* Whether the client is buying it, and whether whoever
                        bought it gets paid back, are Pay-panel lines now. One
                        place for money; this row records what was used. */}
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#333', minWidth: 70, textAlign: 'right' }}>
                      {fmtMoney((Number(r.quantity) || 0) * (Number(r.unit_cost) || 0))}
                    </span>
                    <button type="button" onClick={() => removeUsedRow(r.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#aaa', padding: 4, flexShrink: 0 }}>
                      <X size={13} />
                    </button>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', padding: '4px 10px', flexWrap: 'wrap' }}>
                  {onSaveKit ? (
                    <button
                      type="button"
                      onClick={saveAsKit}
                      title="Save this list as a kit you can drop into the next job like it"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--teal)', fontSize: 12, fontWeight: 600, padding: 0 }}
                    >
                      <Layers size={12} style={{ verticalAlign: -2, marginRight: 4 }} />Save these as a kit
                    </button>
                  ) : <span />}
                  <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#888', letterSpacing: 0.5, textTransform: 'uppercase' }}>Materials cost</span>
                    <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--teal)' }}>{fmtMoney(materialsUsedCost(materialsUsed))}</span>
                  </span>
                </div>
              </div>
            )}

            <div style={{ fontSize: 11, color: '#9ca3af' }}>
              Changes apply when you save the work order. Removing a stock row (or lowering its quantity) puts the units back in inventory.
            </div>

            {/* ── Mileage (older work orders only) ──
                Mileage is a line on the Pay panel now, so there is one place to
                put it. Jobs that recorded it here before the rebuild still show
                and still count; new ones do not get this section at all. */}
            {mileageLogs.length > 0 && (
            <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 16, marginTop: 4 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Mileage <span style={{ fontSize: 11, fontWeight: 600, color: '#aaa' }}>· recorded before the Pay panel</span></div>
              <div style={{ fontSize: 12, color: '#888', lineHeight: 1.5, marginBottom: 12 }}>
                Kept as it was so the payout does not change. New mileage goes on the Pay tab,
                where it can be billed to the client, paid back to the tech, or both.
              </div>

              {mileageLogs.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
                  {mileageLogs.map((r) => (
                    <div key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 10px', borderRadius: 10, background: 'rgba(14,27,46,0.04)', border: '1px solid rgba(0,0,0,0.08)', flexWrap: 'wrap' }}>
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
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-ghost" onClick={addMileageRow} style={{ fontSize: 12 }}>
                    <Plus size={13} /> Add mileage
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={calcingMiles}
                    onClick={autoCalcMiles}
                    title="Real road miles: home base → this site → home (uses the site address)"
                    style={{ fontSize: 12, color: 'var(--teal)', opacity: calcingMiles ? 0.6 : 1 }}
                  >
                    🚗 {calcingMiles ? 'Calculating…' : 'Calculate from address'}
                  </button>
                </div>
                {mileageLogs.length > 0 && (
                  <span style={{ fontSize: 12, color: '#555' }}>
                    <strong>{totalMiles(mileageLogs).toLocaleString()}</strong> miles ·{' '}
                    <strong style={{ color: 'var(--teal)' }}>{fmtMoney(mileageReimbursement(mileageLogs))}</strong> reimbursement
                  </span>
                )}
              </div>
            </div>
            )}
          </div>
        )}

        {tab === 'chat' && <h3 id="woe-sec-chat" className="woe-sec-title">Chat</h3>}
        {/* ── CHAT TAB ── */}
        {tab === 'chat' && (
          <WorkOrderChatPanel woNumber={item?.wo_number} />
        )}


        {/* ── FOOTER ── */}
        <div className="save-bar">
          {askDelete && onDelete ? (
            <>
              <span role="alert" style={{ marginRight: 'auto', fontSize: 13, color: '#b91c1c', fontWeight: 700 }}>
                {`Delete WO ${item?.wo_number ?? ''} for good? Its time, photos and receipts go too. This can't be undone.`}
              </span>
              <button className="btn btn-ghost" onClick={() => setAskDelete(false)}>Keep it</button>
              <button className="btn" style={{ background: '#b91c1c', color: '#fff' }} onClick={onDelete}>Yes, delete</button>
            </>
          ) : <>
          {onDelete && item?.id && (
            <button className="btn btn-ghost" style={{ marginRight: 'auto', color: '#b91c1c' }} onClick={() => setAskDelete(true)}>
              <Trash2 size={14} /> Delete work order
            </button>
          )}
          {!canSave && (
            <span role="status" style={{ marginRight: 'auto', fontSize: 13, color: '#b45309', fontWeight: 600 }}>
              Add a work order number to save.
            </span>
          )}
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={!canSave}
            style={{ opacity: canSave ? 1 : 0.5 }}
          >
            {item ? 'Save Changes' : 'Create Work Order'}
          </button>
          </>}
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
    <div style={{ padding: '14px 16px', borderRadius: 10, background: 'rgba(14,27,46,0.05)', border: '1.5px dashed rgba(14,27,46,0.2)' }}>
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
    <div style={{ padding: '12px 16px', borderRadius: 10, background: 'rgba(14,27,46,0.06)', border: '1.5px solid rgba(14,27,46,0.15)', textAlign: 'right' }}>
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

/**
 * What the tech records on this job (Fred, 2026-10-18: "No one want to look at
 * blank items it not needed"): a saved template (Settings -> Job templates) or
 * the items ticked here. "Everything" keeps the job as jobs have always been.
 */
function WhatTheTechRecords({ capture, onChange, templates, startAsks, onStartAsks }: {
  capture: CaptureItem[] | null; onChange: (next: CaptureItem[] | null) => void; templates: ReturnType<typeof useJobTemplates>['templates'];
  startAsks: StartAsk[]; onStartAsks: (next: StartAsk[]) => void;
}) {
  // A blank job reads as Blank, even while one of the templates is still blank too.
  const blank = !!capture && capture.length === 0 && startAsks.length === 0;
  const used = blank ? null : templateOf(capture, templates, startAsks);
  const value = capture === null ? 'old' : used ? used.id : 'blank';
  return (
    <div className="wf" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <label htmlFor="wo-capture" style={{ fontSize: 11, fontWeight: 700, color: '#555', letterSpacing: 0.5, textTransform: 'uppercase' }}>What the tech records</label>
        <div style={{ position: 'relative', flex: '1 1 240px' }}>
          <select id="wo-capture" className="select input" value={value} onChange={(e) => {
            const v = e.target.value;
            if (v === 'old') onChange(null);
            else if (v === 'blank') { onChange([]); onStartAsks([]); }
            else {
              const t = templates.find((x) => x.id === v);
              onChange(t?.items ?? null);
              // A template brings its check-in items too.
              if (t) onStartAsks(t.startAsks ?? []);
            }
          }}>
            {/* Only a job made before has no list; it keeps asking for everything. */}
            {capture === null && <option value="old">Everything (a job made before)</option>}
            <option value="blank">{used || capture === null || capture.length === 0 ? 'Blank: tick what this job needs' : 'My own ticks'}</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <ChevronDown size={13} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#aaa' }} />
        </div>
      </div>
      {capture !== null && (
        <>
          <div className="woe-pills" role="group" aria-label="What the tech records">
            {CAPTURE_ITEMS.map((c) => (
              <button key={c.key} type="button" className="woe-pill" aria-pressed={capture.includes(c.key)} title={c.hint}
                onClick={() => onChange(toggleItem(capture, c.key))}>{c.label}</button>
            ))}
          </div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>
            The tech sees only what you pick. Time on site is always kept.
          </div>
        </>
      )}
      <details className="woe-more" open={startAsks.length > 0}>
        <summary>At check-in, also ask for{startAsks.length ? ` (${startAsks.length})` : ''}</summary>
        <div style={{ marginTop: 8 }}><StartAsksEditor idPrefix="wo-capture" asks={startAsks} onChange={onStartAsks} /></div>
      </details>
    </div>
  );
}

function RequirementToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, background: checked ? 'rgba(14,27,46,0.07)' : '#fafafa', border: `1.5px solid ${checked ? 'rgba(14,27,46,0.22)' : '#e5e7eb'}`, cursor: 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span style={{ fontSize: 12, color: checked ? 'var(--teal)' : '#555', fontWeight: 700 }}>{label}</span>
    </label>
  );
}

function SummaryTile({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ padding: '14px 16px', borderRadius: 10, background: '#fafafa', border: '1.5px solid #e5e7eb', textAlign: 'center' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color, fontFamily: 'Inter, sans-serif' }}>{value}</div>
    </div>
  );
}

/** A small on/off pill saying which side of the job a pay line lands on. */
function SideToggle({ on, onClick, onLabel, offLabel, title, color }: {
  on: boolean;
  onClick: () => void;
  onLabel: string;
  offLabel: string;
  title: string;
  color: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        fontSize: 10, fontWeight: 700, padding: '4px 9px', borderRadius: 999,
        cursor: 'pointer', whiteSpace: 'nowrap', border: 'none',
        background: on ? `color-mix(in srgb, ${color} 14%, transparent)` : 'rgba(0,0,0,0.05)',
        color: on ? color : '#999',
      }}
    >
      {on ? `✓ ${onLabel}` : offLabel}
    </button>
  );
}
