'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { enrichWorkOrders, contractorOwedOnWO, woPayoutTotal, fmtMoney } from '@/lib/utils';
import { geocodeAddress } from '@/lib/geocode';
import { useInactivityLogout } from '@/lib/useInactivityLogout';
import { useDarkMode } from '@/lib/useDarkMode';
import type { Contractor, WorkOrder, Payment, QuestionTemplate, DeliverableTemplate, EnrichedWorkOrder, ContractorTimeLog, Material, MaterialKit, Quote, Survey, Contract, Invoice, InvoicePayment, ImportQueueItem, GmailConnection, QuickBooksConnection, SiteVisit } from '@/lib/types';
import { BarChart3, CreditCard, Users, FileText, TrendingUp, LogOut, Menu, X, BookOpen, ClipboardCheck, Sparkles, Settings, Wallet, Search, Moon, Sun, Download, Award, Calendar, Map, Package, FileSignature, Inbox, ChevronDown, Receipt, Network, Timer, Building2, ShieldCheck, Wrench, ClipboardList, FileCheck2, UserCog, Workflow, LifeBuoy } from 'lucide-react';

import DashboardView from '@/components/DashboardView';
import FinancialDashboardView from '@/components/FinancialDashboardView';
import WorkOrdersView, { type LinkedVisit } from '@/components/WorkOrdersView';
import PaymentsView from '@/components/PaymentsView';
import ContractorsView from '@/components/ContractorsView';
import ContractorAnalyticsView from '@/components/ContractorAnalyticsView';
import SchedulingView from '@/components/SchedulingView';
import DispatchMapView from '@/components/DispatchMapView';
import MaterialsView from '@/components/MaterialsView';
import QuotesView, { nextQuoteNumber } from '@/components/QuotesView';
import SurveysView from '@/components/SurveysView';
import ContractsView from '@/components/ContractsView';
import AttentionPanel from '@/components/AttentionPanel';
import InvoicesView from '@/components/InvoicesView';
import NetworkView from '@/components/NetworkView';
import TeamView from '@/components/TeamView';
import SiteLogView from '@/components/SiteLogView';
import MaintenanceView from '@/components/MaintenanceView';
import CustomersView from '@/components/CustomersView';
import PortalAdminView from '@/components/PortalAdminView';
import ImportQueueView from '@/components/ImportQueueView';
import SupportView from '@/components/SupportView';
import StatementView from '@/components/StatementView';
import TenNinetyNineView from '@/components/TenNinetyNineView';
import W9View from '@/components/W9View';
import QuickBooksView from '@/components/QuickBooksView';
import SettingsView from '@/components/SettingsView';
import PayablesView from '@/components/PayablesView';
import LedgerView from '@/components/LedgerView';
import GlobalSearch from '@/components/GlobalSearch';
import { nextFreeWorkOrderNumber } from '@/lib/wo-number';
import { belongsInTechPortal } from '@/lib/tech-portal';
import { myStaffSection } from '@/lib/assistant';
import { reassignWorkOrder, describeReassignment } from '@/lib/reassign';
import ContractorModal from '@/components/ContractorModal';
import WorkOrderModal from '@/components/WorkOrderModal';
import PaymentModal from '@/components/PaymentModal';
import { exportWorkOrdersCSV, exportPaymentsCSV, exportContractorsCSV, export1099CSV } from '@/lib/export';
import { logAudit } from '@/lib/audit';
import { notifyContractor, sendPortalLink, sendOnboarding } from '@/lib/notify';
import { toastError, toastInfo, toastSuccess } from '@/lib/toast';
import { stockAdjustments } from '@/lib/materials-used';
import type { StockInPlan } from '@/lib/stock-in';
import { quoteFromSurvey } from '@/lib/surveys';
import { contractFromQuote, nextContractNumber } from '@/lib/contracts';
import Toaster from '@/components/Toaster';
import { NETVIEW_FORM_URL } from '@/lib/netview-payroll';

const VIEWS = [
  'dashboard', 'financials', 'customers', 'workorders', 'payments', 'payables', 'ledger', 'invoices', 'contractors',
  'contractor-analytics', 'scheduling', 'dispatch', 'materials', 'quotes', 'network', 'sitelog', 'import-queue',
  'maintenance', 'statements', '1099', 'w9', 'quickbooks', 'portal-admin', 'settings', 'surveys', 'contracts',
  'team', 'support',
] as const;
type View = (typeof VIEWS)[number];

/** ?wo=19101348 — a Site Log card linking straight to its work order. */
function woFromUrlParam(): string {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get('wo') ?? '';
}

function viewFromUrl(): View {
  if (typeof window === 'undefined') return 'dashboard';
  const v = new URLSearchParams(window.location.search).get('view');
  return VIEWS.includes(v as View) ? (v as View) : 'dashboard';
}

// Which sidebar dropdown each view lives under — used to auto-open the right
// section when navigating (including via search, dashboard links, or the URL).
/**
 * Which collapsible section a view lives in — 'daily' meaning none, because
 * those five sit above the sections and are always on screen.
 *
 * The sidebar used to give a feature with 83 rows the same weight as one with
 * none, and buried the Site Log fifth under Field Ops even though it is where
 * every job starts. Only one section can be open at a time, so the ordinary
 * round of Site Log → Work Order → pay the tech meant collapsing and opening
 * a section at each step.
 *
 * So the daily loop is always visible and everything else is grouped by what
 * it is for. Nothing was removed: every screen that existed still exists.
 */
const SECTION_OF_VIEW: Record<View, string> = {
  // Always on screen — the round Fred actually does.
  dashboard: 'daily', sitelog: 'daily', workorders: 'daily',
  payables: 'daily', 'import-queue': 'daily', team: 'daily', support: 'daily',

  payments: 'money', financials: 'money', ledger: 'money',
  customers: 'money', quickbooks: 'money', invoices: 'money',

  contractors: 'techs', 'contractor-analytics': 'techs', 'portal-admin': 'techs',
  statements: 'techs', '1099': 'techs', w9: 'techs',

  surveys: 'pipeline', quotes: 'pipeline', contracts: 'pipeline',
  scheduling: 'pipeline', dispatch: 'pipeline',

  materials: 'onsite', maintenance: 'onsite', network: 'onsite',

  settings: 'settings',
} as Record<View, string>;

// Collapsible sidebar section. Open/closed state is owned by HomePage and
// persisted to localStorage so the layout survives refreshes.
function NavSection({ title, open, onToggle, badge, children }: {
  title: string;
  open: boolean;
  onToggle: () => void;
  badge?: number;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 4 }}>
      <button
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
          background: 'none', border: 'none', cursor: 'pointer',
          fontSize: 9, fontWeight: 700, letterSpacing: 2, color: 'rgba(255,255,255,0.35)',
          padding: '8px 12px 6px', textTransform: 'uppercase',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {title}
          {!open && badge != null && badge > 0 && (
            <span style={{ background: 'var(--teal)', color: 'white', borderRadius: 999, fontSize: 9, fontWeight: 800, padding: '1px 6px', letterSpacing: 0 }}>
              {badge}
            </span>
          )}
        </span>
        <ChevronDown size={12} style={{ transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform 0.15s' }} />
      </button>
      {open && <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{children}</div>}
    </div>
  );
}

type Modal =
  | { type: 'contractor'; item: Contractor | null }
  | { type: 'wo'; item: WorkOrder | null; prefill?: Partial<WorkOrder> }
  | { type: 'payment'; item: Payment | null; prefill?: Partial<Payment> }
  | null;

export default function HomePage() {
  const router = useRouter();
  const supabase = createClient();
  const { dark, toggle: toggleDark } = useDarkMode();
  // View lives in the URL (?view=...) so refresh, bookmarks, and back/forward work.
  // Safe to initialize from the URL: the loading screen renders identically on
  // server and client, so there's no hydration mismatch.
  const [view, setViewState] = useState<View>(viewFromUrl);
  const setView = (v: View) => {
    setViewState(v);
    setOpenSection(SECTION_OF_VIEW[v]);
    const url = v === 'dashboard' ? window.location.pathname : `${window.location.pathname}?view=${v}`;
    window.history.pushState(null, '', url);
  };
  useEffect(() => {
    const onPop = () => {
      const v = viewFromUrl();
      setViewState(v);
      setOpenSection(SECTION_OF_VIEW[v]);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const [modal, setModal] = useState<Modal>(null);
  // Support inbox (migration-104): an approved ticket opens the New job form;
  // the job that form saves is linked back to the ticket.
  const ticketForNextJob = useRef<string | null>(null);
  const [supportCount, setSupportCount] = useState(0);
  useEffect(() => {
    void supabase.from('support_tickets').select('id', { count: 'exact', head: true }).eq('status', 'new')
      .then(({ count }) => setSupportCount(count ?? 0));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once on load; the inbox keeps it current
  const [searchOpen, setSearchOpen] = useState(false);
  // Dropdown-style nav: one section open at a time; the section holding the
  // current view opens automatically, clicking a header toggles it.
  const [openSection, setOpenSection] = useState<string | null>(() => SECTION_OF_VIEW[viewFromUrl()]);
  // Read once on mount: the board should open on the linked work order, but
  // must not keep re-filtering itself as the user then searches for something else.
  const [woFromUrl] = useState<string>(() => woFromUrlParam());
  const sectionOpen = (k: string) => openSection === k;
  const toggleSection = (k: string) => setOpenSection((prev) => (prev === k ? null : k));
  const [selectedContractor, setSelectedContractor] = useState<string | null>(null);
  const [taxYear, setTaxYear] = useState<number>(new Date().getFullYear());
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [questionTemplates, setQuestionTemplates] = useState<QuestionTemplate[]>([]);
  const [deliverableTemplates, setDeliverableTemplates] = useState<DeliverableTemplate[]>([]);
  const [contractorTimeLogs, setContractorTimeLogs] = useState<ContractorTimeLog[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [materialKits, setMaterialKits] = useState<MaterialKit[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [invoicePayments, setInvoicePayments] = useState<InvoicePayment[]>([]);
  const [importQueue, setImportQueue] = useState<ImportQueueItem[]>([]);
  const [gmailConnection, setGmailConnection] = useState<GmailConnection | null>(null);
  const [qboConnection, setQboConnection] = useState<QuickBooksConnection | null>(null);
  const [loading, setLoading] = useState(true);
  /** Contractor id with an onboarding email or QuickBooks sync in flight. */
  const [contractorBusy, setContractorBusy] = useState<string | null>(null);
  /** Site visits that became work orders, so a job can show where it came from. */
  // Every non-archived visit, in the partial shape the dashboard and the work
  // order cards need. `linkedVisits` below is the subset that has a work order.
  const [dashboardVisits, setDashboardVisits] = useState<SiteVisit[]>([]);

  // Core data every view needs — loaded before first paint.
  const loadCore = async (): Promise<boolean> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.replace('/login'); return false; }

    // A tech signed in here belongs in their own portal, not the owner app.
    // The login page already routed them there; this catches the session that
    // was already open. Without it, a tech opening the app root got the full
    // owner UI and everything they created was filed under their own account —
    // invisible to Fred AND to the tech portal (migration-082).
    if (await belongsInTechPortal()) { router.replace('/tech'); return false; }
    // Same for staff (migrations 092-095): an assistant or accountant has their
    // own section. The owner app would hand them an empty shell — RLS gives a
    // staff session zero rows — and anything they created here would be filed
    // under their own account, invisible to Fred.
    const staffSection = await myStaffSection();
    if (staffSection) { router.replace(staffSection); return false; }
    // Only the business owner gets the management app (Fred, 2026-10-02:
    // "need to be separate from admin — admin sees everything, tech just sees
    // their portal"). Any other login — a tech arriving from their
    // confirmation email before their login is linked, or a login nobody set
    // up — goes to the tech portal, which links a tech by email or says plainly
    // that the login is not set up. A network error lets the owner through
    // rather than locking Fred out of his own business; RLS still shows any
    // other login nothing.
    const { data: who, error: whoErr } = await supabase.rpc('wf_role');
    if (!whoErr && (who as { role?: string } | null)?.role === 'none') { router.replace('/tech'); return false; }

    const [cRes, wRes, pRes, svRes] = await Promise.all([
      supabase.from('contractors').select('*').order('name'),
      supabase.from('work_orders').select('*').order('wo_number'),
      supabase.from('payments').select('*').order('payment_date', { ascending: false }),
      // Enough of each visit for two jobs: showing a work order where it came
      // from, and letting the dashboard see money walked but never billed.
      // This used to fetch only visits that already had a work order, which
      // made a visit billed straight to the client invisible to the monitor.
      supabase.from('site_visits')
        .select('id, work_order_id, visit_date, site_name, site_code, visit_type, hours, miles, '
              + 'rate, invoice_status, travel_charge, materials_cost, other_charges, '
              + 'total_project_price, archived_at'),
    ]);
    if (cRes.data) setContractors(cRes.data);
    if (wRes.data) setWorkOrders(wRes.data);
    if (pRes.data) setPayments(pRes.data);
    if (svRes.data) setDashboardVisits(svRes.data as unknown as SiteVisit[]);
    const failed = [cRes.error && 'contractors', wRes.error && 'work orders', pRes.error && 'payments'].filter(Boolean);
    if (failed.length > 0) {
      toastError(`Couldn't load ${failed.join(', ')}. Check your connection and refresh.`);
    }
    return true;
  };

  // Everything else — loaded right after first paint so startup stays fast.
  const loadSecondary = async () => {
    const [tRes, dtRes, ctlRes, matRes, kitRes, qRes, svyRes, ctrRes, invRes, ipRes, iqRes, gcRes, qboRes] = await Promise.all([
      supabase.from('question_templates').select('*').order('created_at', { ascending: false }),
      supabase.from('deliverable_templates').select('*').order('created_at', { ascending: false }),
      supabase.from('contractor_time_logs').select('*').order('updated_at', { ascending: false }),
      supabase.from('materials').select('*').order('name'),
      supabase.from('material_kits').select('*').order('name'),
      supabase.from('quotes').select('*').order('created_at', { ascending: false }),
      supabase.from('surveys').select('*').order('created_at', { ascending: false }),
      supabase.from('contracts').select('*').order('created_at', { ascending: false }),
      supabase.from('invoices').select('*').order('created_at', { ascending: false }),
      supabase.from('invoice_payments').select('*').order('payment_date', { ascending: false }),
      supabase.from('import_queue').select('*').order('created_at', { ascending: false }),
      // Explicit column list — refresh_token/access_token are excluded from browser SELECT by RLS anyway.
      supabase.from('gmail_connections').select('id, user_id, connected_email, last_polled_at, created_at').maybeSingle(),
      supabase.from('quickbooks_connections').select('id, user_id, realm_id, company_name, environment, default_expense_account_id, default_expense_account_name, default_payment_account_id, default_payment_account_name, connected_at, created_at').maybeSingle(),
    ]);
    if (tRes.data) setQuestionTemplates(tRes.data as QuestionTemplate[]);
    if (dtRes.data) setDeliverableTemplates(dtRes.data as DeliverableTemplate[]);
    if (ctlRes.data) setContractorTimeLogs(ctlRes.data as ContractorTimeLog[]);
    if (matRes.data) setMaterials(matRes.data as Material[]);
    if (kitRes.data) setMaterialKits(kitRes.data as MaterialKit[]);
    if (qRes.data) setQuotes(qRes.data as Quote[]);
    if (svyRes.data) setSurveys(svyRes.data as Survey[]);
    if (ctrRes.data) setContracts(ctrRes.data as Contract[]);
    if (invRes.data) setInvoices(invRes.data as Invoice[]);
    if (ipRes.data) setInvoicePayments(ipRes.data as InvoicePayment[]);
    if (iqRes.data) setImportQueue(iqRes.data as ImportQueueItem[]);
    setGmailConnection((gcRes.data as GmailConnection | null) ?? null);
    setQboConnection((qboRes.data as QuickBooksConnection | null) ?? null);
    const failed = [
      tRes.error && 'templates', dtRes.error && 'deliverable templates', ctlRes.error && 'time logs',
      matRes.error && 'materials', kitRes.error && 'material kits', qRes.error && 'quotes', svyRes.error && 'surveys', ctrRes.error && 'contracts', invRes.error && 'invoices',
      ipRes.error && 'invoice payments', iqRes.error && 'import queue',
    ].filter(Boolean);
    if (failed.length > 0) {
      toastError(`Couldn't load ${failed.join(', ')}. Check your connection and refresh.`);
    }
  };

  const loadAll = async () => {
    const ok = await loadCore();
    if (ok) await loadSecondary();
  };

  useEffect(() => {
    (async () => {
      const ok = await loadCore();
      if (!ok) return;
      setLoading(false);       // paint the app as soon as core data is in
      loadSecondary();         // fill in the rest in the background
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep this tab in sync when data changes elsewhere (another tab, phone,
  // portal check-ins, cron email imports). Requires migration-028.
  // Events are debounced so a burst of writes triggers a single reload.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { loadAll(); }, 600);
    };
    const channel = supabase
      .channel('app-data-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_orders' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contractors' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'import_queue' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contractor_time_logs' }, refresh)
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const enrichedWOs = useMemo(() => enrichWorkOrders(workOrders, payments), [workOrders, payments]);

  const pendingImportCount = useMemo(
    () => importQueue.filter((i) => i.status === 'pending').length,
    [importQueue],
  );

  const linkedVisits = useMemo(
    () => dashboardVisits.filter((v) => v.work_order_id) as unknown as LinkedVisit[],
    [dashboardVisits],
  );

  // Auto-suggest next WO number for new work orders.
  // Skips numbers already in use: a plain "highest + 1" handed 19101358 to a
  // second job, and because payments join by wo_number another tech's payout
  // read as money paid on it. See lib/wo-number.ts and migration-078.
  const nextWoNumber = useMemo(
    () => nextFreeWorkOrderNumber(workOrders.map((w) => w.wo_number)),
    [workOrders],
  );

  const stats = useMemo(() => {
    // total = revenue (client prices); paid/remaining track payouts to techs.
    //
    // What is still OWED counts live jobs only. A closed job with no pay split
    // recorded falls back to "the tech gets the whole client price", so 27
    // archived import stubs were adding $22,465 of debt that does not exist —
    // and the alert panel above, which already excluded closed jobs, disagreed
    // with this figure on the same screen.
    const live  = enrichedWOs.filter((w) => !w.archived_at);
    const total = enrichedWOs.reduce((s, w) => s + Number(w.total_amount), 0);
    const paid  = enrichedWOs.reduce((s, w) => s + w.paid, 0);
    return {
      total, paid,
      remaining: live.reduce((s, w) => s + w.remaining, 0),
      paidCount:    live.filter((w) => w.payment_status === 'paid').length,
      partialCount: live.filter((w) => w.payment_status === 'partial').length,
      pendingCount: live.filter((w) => w.payment_status === 'pending').length,
      jobCount:     live.length,
    };
  }, [enrichedWOs]);

  // ── Contractors ────────────────────────────────────────────────────────────

  const saveContractor = async (c: Partial<Contractor>) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const payload = {
      name: c.name, phone: c.phone ?? null, email: c.email ?? null, notes: c.notes ?? null,
      business_name: c.business_name ?? null, entity_type: c.entity_type ?? null,
      tax_id: c.tax_id ?? null, tax_id_type: c.tax_id_type ?? null,
      address: c.address ?? null, city: c.city ?? null, state: c.state ?? null, zip: c.zip ?? null,
      w9_received: c.w9_received ?? false, zelle_phone: c.zelle_phone ?? null,
      on_hold: c.on_hold ?? false,
      // Direct Deposit (migration-009)
      bank_name:           c.bank_name           || null,
      account_holder_name: c.account_holder_name || null,
      routing_number:      c.routing_number      || null,
      account_number:      c.account_number      || null,
      account_type:        c.account_type        || null,
    };
    if (c.id) {
      const { error } = await supabase.from('contractors').update(payload).eq('id', c.id);
      if (error) { toastError(`Couldn't save contractor: ${error.message}`); return; }
      logAudit({ action: 'update', entityType: 'contractor', entityId: c.id, entityLabel: c.name ?? '' });
    } else {
      const { error } = await supabase.from('contractors').insert({ ...payload, user_id: user.id });
      if (error) { toastError(`Couldn't save contractor: ${error.message}`); return; }
      logAudit({ action: 'create', entityType: 'contractor', entityLabel: c.name ?? '' });
    }
    toastSuccess('Contractor saved');
    loadAll();
  };

  const deleteContractor = async (id: string) => {
    const c = contractors.find((x) => x.id === id);
    const { error } = await supabase.from('contractors').delete().eq('id', id);
    if (error) { toastError(`Couldn't delete contractor: ${error.message}`); return; }
    logAudit({ action: 'delete', entityType: 'contractor', entityId: id, entityLabel: c?.name ?? '' });
    loadAll();
  };

  // ── Work Orders ────────────────────────────────────────────────────────────

  const saveWorkOrder = async (w: Partial<WorkOrder>) => {
    const fromTicket = w.id ? null : ticketForNextJob.current;
    ticketForNextJob.current = null;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Geocode the site address once and persist it, rather than re-geocoding on every map load.
    const prevWO = w.id ? workOrders.find((x) => x.id === w.id) : null;
    const addressChanged = !prevWO
      || prevWO.site_address !== (w.site_address ?? null)
      || prevWO.site_city    !== (w.site_city    ?? null)
      || prevWO.site_state   !== (w.site_state   ?? null);
    let siteLat = prevWO?.site_lat ?? null;
    let siteLng = prevWO?.site_lng ?? null;
    if (w.site_address && (addressChanged || siteLat == null)) {
      const fullAddress = [w.site_address, w.site_city, w.site_state, w.site_zip].filter(Boolean).join(', ');
      const coords = await geocodeAddress(fullAddress);
      siteLat = coords?.lat ?? null;
      siteLng = coords?.lng ?? null;
    }

    const payload = {
      wo_number:       w.wo_number!,
      contractor_name: w.contractor_name!,
      title:           w.title           ?? null,
      source_platform: w.source_platform ?? 'Internal',
      external_wo_id:  w.external_wo_id  ?? null,
      customer_name:   w.customer_name   ?? null,
      project_name:    w.project_name    ?? null,
      client_reference: w.client_reference ?? null,
      buyer_company:   w.buyer_company   ?? null,
      assignment_type: w.assignment_type ?? 'Internal',
      priority:        w.priority        ?? 'Normal',
      description:     w.description     ?? null,
      start_date:      w.start_date      || null,
      end_date:        w.end_date        || null,
      total_amount:    Number(w.total_amount),
      wo_status:       w.wo_status       ?? 'Open',
      pay_type:        w.pay_type        ?? 'Fixed',
      hourly_rate:     w.hourly_rate     ?? null,
      hours_worked:    w.hours_worked    ?? null,
      per_device_rate: w.per_device_rate ?? null,
      device_count:    w.device_count    ?? null,
      blended_base:    w.blended_base    ?? null,
      expense_budget:  w.expense_budget  ?? null,
      travel_amount:   w.travel_amount   ?? null,
      bonus_amount:    w.bonus_amount    ?? null,
      site_name:       w.site_name       ?? null,
      site_address:    w.site_address    ?? null,
      site_city:       w.site_city       ?? null,
      site_state:      w.site_state      ?? null,
      site_zip:        w.site_zip        ?? null,
      site_lat:        siteLat,
      site_lng:        siteLng,
      schedule_type:   w.schedule_type   ?? 'Exact Time',
      start_time:      w.start_time      ?? null,
      end_time:        w.end_time        ?? null,
      time_zone:       w.time_zone       ?? null,
      deliverables:    w.deliverables    ?? null,
      deliverable_instructions: w.deliverable_instructions ?? null,
      tools_required:  w.tools_required  ?? null,
      parts_materials: w.parts_materials ?? null,
      access_instructions: w.access_instructions ?? null,
      parking_instructions: w.parking_instructions ?? null,
      check_in_required: w.check_in_required ?? true,
      check_out_required: w.check_out_required ?? true,
      signature_required: w.signature_required ?? false,
      photo_required:  w.photo_required  ?? false,
      service_type:    w.service_type    ?? null,
      required_skills: w.required_skills ?? null,
      // POC + custom Q&A (migration-006)
      poc_name:        w.poc_name        ?? null,
      poc_phone:       w.poc_phone       ?? null,
      poc_email:       w.poc_email       ?? null,
      support_contact: w.support_contact ?? null,
      custom_qa:       w.custom_qa       ?? [],
      // Multi-contacts (migration-019)
      contacts:        w.contacts        ?? [],
      // Vendor attachment (migration-007)
      attachment_url:  w.attachment_url  ?? null,
      // Admin documents (migration-008)
      doc_urls:        w.doc_urls        ?? [],
      // Multi-contractor (migration-014)
      contractor_names: w.contractor_names ?? null,
      // Lead / Assistant tech (migration-017)
      lead_contractor_name: w.lead_contractor_name ?? null,
      // Per-tech pay split (migration-029)
      contractor_pay: w.contractor_pay ?? null,
      // Closeout materials (migration-031)
      materials_used: w.materials_used ?? [],
      // Mileage (migration-032)
      mileage_logs: w.mileage_logs ?? [],
      // The form sent these all along but they were never written, so the
      // pay add-ons panel and the Tech checklist forgot everything on save.
      // Only written when the caller sends them, so a partial save can't wipe them.
      ...(w.pay_addons !== undefined ? { pay_addons: w.pay_addons ?? [] } : {}),
      ...(w.wo_tasks !== undefined ? { wo_tasks: w.wo_tasks ?? [] } : {}),
      ...(w.billable_miles !== undefined ? { billable_miles: w.billable_miles ?? null } : {}),
      // The calendar and the tech's schedule go by scheduled_date. A new job
      // starts on its start date; moving the start date moves it.
      ...(!prevWO
        ? { scheduled_date: w.scheduled_date || w.start_date || null }
        : (prevWO.start_date ?? null) !== (w.start_date || null)
          ? { scheduled_date: w.start_date || null }
          : {}),
    };
    if (w.id) {
      const { error } = await supabase.from('work_orders').update(payload).eq('id', w.id);
      if (error) { toastError(`Couldn't save WO#${w.wo_number}: ${error.message}`); return; }
      logAudit({ action: 'update', entityType: 'work_order', entityId: w.id, entityLabel: `WO#${w.wo_number}` });
      // Notify contractor on status change
      const prev = workOrders.find((x) => x.id === w.id);
      if (prev && prev.wo_status !== w.wo_status) {
        const c = contractors.find((x) => x.name === w.contractor_name);
        if (c?.email) notifyContractor({ type: 'status_change', contractor_email: c.email, contractor_name: c.name, wo_number: w.wo_number!, title: w.title ?? undefined, status: w.wo_status ?? '' });
      }
    } else {
      const { data: created, error } = await supabase.from('work_orders').insert({ ...payload, user_id: user.id }).select('id').single();
      if (error) {
        // migration-078 refuses a number that is already in use. Say so plainly
        // rather than showing the raw constraint name — a repeated number is a
        // real problem, because payments attach to jobs by number.
        toastError(error.code === '23505'
          ? `WO#${w.wo_number} already exists. Give this job a different number — two jobs sharing a number would mix up their payouts.`
          : `Couldn't save WO#${w.wo_number}: ${error.message}`);
        return;
      }
      logAudit({ action: 'create', entityType: 'work_order', entityLabel: `WO#${w.wo_number}` });
      if (fromTicket && created?.id) {
        const { error: linkErr } = await supabase.from('support_tickets').update({ wo_id: created.id }).eq('id', fromTicket);
        if (linkErr) console.warn('[support] could not link ticket to job', linkErr.message);
      }
      // Notify every assigned tech with their own accept/decline links and pay
      const assignedNames: string[] = (payload.contractor_names && payload.contractor_names.length > 0)
        ? payload.contractor_names
        : (payload.contractor_name ? [payload.contractor_name] : []);
      const siteLine = [w.site_name, w.site_address, w.site_city, w.site_state].filter(Boolean).join(', ') || null;
      const scheduleLine = [w.start_date, w.start_time].filter(Boolean).join(' ') || null;
      const refId = w.external_wo_id || w.client_reference || null;
      for (const name of assignedNames) {
        const c = contractors.find((x) => x.name === name);
        if (!c?.email) continue;
        // On hold (migration-104): saved on the job, but no email until released.
        if (c.on_hold) { toastInfo(`${c.name} is on hold, so no job email was sent.`); continue; }
        notifyContractor({
          type: 'wo_assigned',
          contractor_email: c.email,
          contractor_name: c.name,
          wo_number: w.wo_number!,
          title: w.title ?? undefined,
          wo_id: created?.id,
          portal_token: c.portal_token ?? null,
          pay: contractorOwedOnWO({ ...(payload as unknown as WorkOrder) }, name),
          reference: refId ? `${w.source_platform && w.source_platform !== 'Internal' ? `${w.source_platform} ` : ''}#${refId}` : null,
          site: siteLine,
          schedule: scheduleLine,
        });
      }
    }
    // Sync inventory with the closeout materials: deduct newly used stock,
    // put back anything removed or reduced. Extra (non-inventory) items skip this.
    const adjustments = stockAdjustments(prevWO?.materials_used, w.materials_used);
    for (const [materialId, delta] of adjustments) {
      const mat = materials.find((m) => m.id === materialId);
      if (!mat) continue;
      const newStock = Math.max(0, Number(mat.stock_quantity) - delta);
      const { error: stockErr } = await supabase
        .from('materials')
        .update({ stock_quantity: newStock, updated_at: new Date().toISOString() })
        .eq('id', materialId);
      if (stockErr) toastError(`Couldn't update stock for ${mat.name}: ${stockErr.message}`);
      else if (delta > 0 && newStock === 0) toastError(`${mat.name} is now out of stock`);
    }

    toastSuccess(`Work order #${w.wo_number} saved`);
    loadAll();
  };

  const handleSendOnboarding = async (c: Contractor) => {
    if (!c.email || !c.portal_token) {
      toastError(`${c.name} needs an email and a portal link first`);
      return;
    }
    setContractorBusy(c.id);
    const res = await sendOnboarding({
      contractor_email: c.email,
      contractor_name: c.name,
      // ?view=paperwork so the W-9 request opens on the forms alone. A job
      // link uses the bare token and shows only the work.
      portal_url: `${window.location.origin}/portal/${c.portal_token}?view=paperwork`,
    });
    if (res.ok) await markInviteSent([c.id]);
    setContractorBusy(null);
    if (res.ok) { toastSuccess(`W-9 request sent to ${c.name}`); await loadCore(); }
    else toastError(`Couldn't email ${c.name}: ${res.error}`);
  };

  /**
   * Stamps who has actually been asked. Without this the card can never show
   * "Requested", and Fred has no way to tell who he has already chased.
   */
  const markInviteSent = async (ids: string[]) => {
    if (ids.length === 0) return;
    const { error } = await supabase
      .from('contractors')
      .update({ w9_invite_sent_at: new Date().toISOString() })
      .in('id', ids);
    if (error) toastError(`Email sent, but recording it failed: ${error.message}`);
  };

  // One at a time rather than Promise.all: a burst of sends trips Resend's rate
  // limit, and a partial failure needs to name who actually missed out.
  const handleSendAllOnboarding = async (list: Contractor[]) => {
    if (list.length === 0) return;
    if (!confirm(`Email all ${list.length} contractor${list.length !== 1 ? 's' : ''} a link to file their W-9 and sign the agreement?`)) return;
    setContractorBusy('ALL');
    const failed: string[] = [];
    const sentIds: string[] = [];
    for (const c of list) {
      if (!c.email || !c.portal_token) { failed.push(c.name); continue; }
      const res = await sendOnboarding({
        contractor_email: c.email,
        contractor_name: c.name,
        portal_url: `${window.location.origin}/portal/${c.portal_token}?view=paperwork`,
      });
      if (res.ok) sentIds.push(c.id); else failed.push(c.name);
    }
    const sent = sentIds.length;
    await markInviteSent(sentIds);
    setContractorBusy(null);
    if (sent > 0) toastSuccess(`W-9 request sent to ${sent} contractor${sent !== 1 ? 's' : ''}`);
    if (failed.length > 0) toastError(`Couldn't email: ${failed.join(', ')}`);
    await loadCore();
  };

  const handleSyncQuickBooks = async (c: Contractor) => {
    setContractorBusy(c.id);
    try {
      const res = await fetch('/api/quickbooks/sync-contractor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contractorId: c.id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) toastError(json.error ?? 'QuickBooks sync failed');
      else { toastSuccess(`${c.name} synced to QuickBooks`); await loadCore(); }
    } catch {
      toastError('QuickBooks sync failed');
    } finally {
      setContractorBusy(null);
    }
  };

  const handleSendPortal = async (w: EnrichedWorkOrder) => {
    // Collect all names on this WO (multi-contractor or fall back to primary)
    const names: string[] = (w.contractor_names && w.contractor_names.length > 0)
      ? w.contractor_names
      : (w.contractor_name ? [w.contractor_name] : []);

    for (const name of names) {
      const contractor = contractors.find((c) => c.name === name);
      if (!contractor?.email || !contractor.portal_token) continue;
      const portalUrl = `${window.location.origin}/portal/${contractor.portal_token}`;
      // Each tech only sees WOs they're assigned to (by contractor_name match)
      const contractorWOs = workOrders
        .filter((wo) => {
          const assignedNames: string[] = (wo.contractor_names && wo.contractor_names.length > 0)
            ? wo.contractor_names
            : (wo.contractor_name ? [wo.contractor_name] : []);
          return assignedNames.includes(contractor.name) && wo.wo_status !== 'Paid' && wo.wo_status !== 'Approved';
        })
        .map((wo) => ({
          wo_number: wo.wo_number,
          title: wo.title,
          start_date: wo.start_date,
          start_time: wo.start_time,
          site_address: wo.site_address,
          site_city: wo.site_city,
          site_state: wo.site_state,
        }));
      try {
        await sendPortalLink({
          contractor_email: contractor.email,
          contractor_name: contractor.name,
          portal_url: portalUrl,
          work_orders: contractorWOs,
        });
        toastSuccess(`Portal link sent to ${contractor.name}`);
      } catch {
        toastError(`Couldn't send portal link to ${contractor.name}`);
      }
    }
  };

  const deleteWorkOrder = async (id: string) => {
    const wo = workOrders.find((x) => x.id === id);
    const { error } = await supabase.from('work_orders').delete().eq('id', id);
    if (error) { toastError(`Couldn't delete WO#${wo?.wo_number ?? ''}: ${error.message}`); return; }
    logAudit({ action: 'delete', entityType: 'work_order', entityId: id, entityLabel: `WO#${wo?.wo_number ?? ''}` });
    loadAll();
  };

  // Lightweight partial-field patch (unlike saveWorkOrder, which expects a full form payload).
  // Used by Scheduling and Dispatch Map for drag-drop updates.
  const updateWorkOrderFields = async (id: string, patch: Partial<WorkOrder>) => {
    const wo = workOrders.find((x) => x.id === id);
    const { error } = await supabase.from('work_orders').update(patch).eq('id', id);
    if (error) { toastError(`Couldn't update WO#${wo?.wo_number ?? ''}: ${error.message}`); loadAll(); return; }
    logAudit({ action: 'update', entityType: 'work_order', entityId: id, entityLabel: `WO#${wo?.wo_number ?? ''}` });
    loadAll();
  };

  // FieldNation-style close: fully-paid jobs close as Paid; jobs closed early
  // close as Approved. Either way they leave the active board (archived, not
  // deleted — Ledger, Payments, and the Closed tab still have them).
  /**
   * Hand a job from one tech to another.
   *
   * The money rule is not obvious, so lib/reassign works it out and it is unit
   * tested: whatever the outgoing tech has already been PAID stays theirs and
   * they stay on the job for that share, and only the unpaid remainder
   * transfers. Otherwise a part-paid job would be paid for twice.
   */
  const reassignJob = async (w: EnrichedWorkOrder, from: string, to: string) => {
    const plan = reassignWorkOrder(w as unknown as WorkOrder, payments, from, to);
    if (!plan) { toastError("That move doesn't work — check who is on the job."); return; }
    if (!confirm(`${describeReassignment(plan, from, to)}

Go ahead?`)) return;

    const { error } = await supabase.from('work_orders').update({
      contractor_name: plan.contractor_name,
      contractor_names: plan.contractor_names,
      lead_contractor_name: plan.lead_contractor_name,
      contractor_pay: plan.contractor_pay,
      assignment_responses: plan.assignment_responses,
      updated_at: new Date().toISOString(),
    }).eq('id', w.id);
    if (error) { toastError(`Couldn't hand the job over: ${error.message}`); return; }

    logAudit({ action: 'update', entityType: 'work_order', entityId: w.id,
               entityLabel: `WO#${w.wo_number} reassigned ${from} → ${to}` });

    // Tell the incoming tech, the same way a new assignment is announced.
    const c = contractors.find((x) => x.name === to);
    if (c?.email) {
      notifyContractor({
        type: 'wo_assigned',
        contractor_email: c.email,
        contractor_name: c.name,
        wo_number: w.wo_number,
        title: w.title ?? undefined,
        wo_id: w.id,
        portal_token: c.portal_token ?? null,
        pay: plan.movedToIncoming,
      });
    }
    toastSuccess(`WO#${w.wo_number} is ${to}'s now`);
    loadAll();
  };

  const closeWorkOrder = async (w: EnrichedWorkOrder) => {
    const finalStatus = w.remaining <= 0 && w.paid > 0 ? 'Paid' : 'Approved';
    const { error } = await supabase
      .from('work_orders')
      .update({ wo_status: finalStatus, archived_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', w.id);
    if (error) { toastError(`Couldn't close WO#${w.wo_number}: ${error.message}`); return; }
    logAudit({ action: 'archive', entityType: 'work_order', entityId: w.id, entityLabel: `WO#${w.wo_number} closed as ${finalStatus}` });
    toastSuccess(`WO #${w.wo_number} closed${finalStatus === 'Paid' ? ' — everyone paid ✓' : w.remaining > 0 ? ` (${fmtMoney(w.remaining)} still owed — find it under Closed)` : ''}`);
    loadAll();
  };

  const handleArchive = async (id: string) => {
    const wo = workOrders.find((x) => x.id === id);
    const { error } = await supabase.from('work_orders').update({ archived_at: new Date().toISOString() }).eq('id', id);
    if (error) { toastError(`Couldn't archive WO#${wo?.wo_number ?? ''}: ${error.message}`); return; }
    logAudit({ action: 'archive', entityType: 'work_order', entityId: id, entityLabel: `WO#${wo?.wo_number ?? ''}` });
    loadAll();
  };

  const handleUnarchive = async (id: string) => {
    const wo = workOrders.find((x) => x.id === id);
    const { error } = await supabase.from('work_orders').update({ archived_at: null }).eq('id', id);
    if (error) { toastError(`Couldn't unarchive WO#${wo?.wo_number ?? ''}: ${error.message}`); return; }
    logAudit({ action: 'unarchive', entityType: 'work_order', entityId: id, entityLabel: `WO#${wo?.wo_number ?? ''}` });
    loadAll();
  };

  // ── Payments ───────────────────────────────────────────────────────────────

  const savePayment = async (p: Partial<Payment>) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const payload = {
      wo_number: p.wo_number!, contractor_name: p.contractor_name!,
      payment_date: p.payment_date!, amount: Number(p.amount),
      method: p.method || 'Check', notes: p.notes ?? null,
    };
    if (p.id) {
      const { error } = await supabase.from('payments').update(payload).eq('id', p.id);
      if (error) { toastError(`Couldn't save payment: ${error.message}`); return; }
      logAudit({ action: 'update', entityType: 'payment', entityId: p.id, entityLabel: `WO#${p.wo_number} — ${p.contractor_name}` });
    } else {
      const { error } = await supabase.from('payments').insert({ ...payload, user_id: user.id });
      if (error) { toastError(`Couldn't save payment: ${error.message}`); return; }
      logAudit({ action: 'create', entityType: 'payment', entityLabel: `WO#${p.wo_number} — ${p.contractor_name} — $${p.amount}` });
      // Notify contractor of payment
      const c = contractors.find((x) => x.name === p.contractor_name);
      if (c?.email) notifyContractor({ type: 'payment_recorded', contractor_email: c.email, contractor_name: c.name, wo_number: p.wo_number!, amount: Number(p.amount) });
    }
    toastSuccess(`Payment recorded — WO#${p.wo_number}`);

    // Auto-close: if this payment settles everyone on the job, the job closes
    // itself (status Paid + off the active board) — no manual step.
    const wo = workOrders.find((x) => x.wo_number === p.wo_number);
    if (wo && !wo.archived_at) {
      const priorPaid = payments
        .filter((x) => x.wo_number === p.wo_number && x.id !== p.id)
        .reduce((s, x) => s + Number(x.amount), 0);
      const nowPaid = priorPaid + Number(p.amount);
      if (nowPaid > 0 && nowPaid >= woPayoutTotal(wo)) {
        const { error: closeErr } = await supabase
          .from('work_orders')
          .update({ wo_status: 'Paid', archived_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('id', wo.id);
        if (!closeErr) toastSuccess(`WO #${wo.wo_number} fully paid — closed automatically ✓`);
      }
    }

    loadAll();
  };

  const deletePayment = async (id: string) => {
    const p = payments.find((x) => x.id === id);
    const { error } = await supabase.from('payments').delete().eq('id', id);
    if (error) { toastError(`Couldn't delete payment: ${error.message}`); return; }
    logAudit({ action: 'delete', entityType: 'payment', entityId: id, entityLabel: `WO#${p?.wo_number ?? ''} — ${p?.contractor_name ?? ''}` });
    loadAll();
  };

  const handlePayWO = (w: EnrichedWorkOrder) => {
    const contractor = contractors.find((c) => c.name === w.contractor_name);
    // Zelle is the house default; direct deposit only when Zelle isn't on file
    const method = contractor?.zelle_phone
      ? 'Zelle'
      : contractor?.routing_number && contractor?.account_number
      ? 'Direct Deposit'
      : 'Zelle';
    setModal({
      type: 'payment',
      item: null,
      prefill: {
        wo_number: w.wo_number,
        contractor_name: w.contractor_name,
        amount: w.remaining,
        method,
        payment_date: new Date().toISOString().split('T')[0],
      },
    });
  };

  // ── Question Templates ─────────────────────────────────────────────────────

  const saveTemplate = async (
    id: string | null,
    data: { name: string; questions: QuestionTemplate['questions']; attachment_url: string | null },
  ) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = id
      ? await supabase
          .from('question_templates')
          .update({ name: data.name, questions: data.questions, attachment_url: data.attachment_url, updated_at: new Date().toISOString() })
          .eq('id', id)
      : await supabase
          .from('question_templates')
          .insert({ name: data.name, questions: data.questions, attachment_url: data.attachment_url, user_id: user.id });
    if (error) { toastError(`Couldn't save template: ${error.message}`); return; }
    loadAll();
  };

  const deleteTemplate = async (id: string) => {
    const { error } = await supabase.from('question_templates').delete().eq('id', id);
    if (error) { toastError(`Couldn't delete template: ${error.message}`); return; }
    loadAll();
  };

  // ── Deliverable Templates ──────────────────────────────────────────────────

  const saveDeliverableTemplate = async (
    id: string | null,
    data: { name: string; items: string[] },
  ) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = id
      ? await supabase
          .from('deliverable_templates')
          .update({ name: data.name, items: data.items, updated_at: new Date().toISOString() })
          .eq('id', id)
      : await supabase
          .from('deliverable_templates')
          .insert({ name: data.name, items: data.items, user_id: user.id });
    if (error) { toastError(`Couldn't save template: ${error.message}`); return; }
    loadAll();
  };

  const deleteDeliverableTemplate = async (id: string) => {
    const { error } = await supabase.from('deliverable_templates').delete().eq('id', id);
    if (error) { toastError(`Couldn't delete template: ${error.message}`); return; }
    loadAll();
  };

  const uploadTemplateAttachment = async (file: File): Promise<string | null> => {
    const path = `templates/${Date.now()}-${file.name.replace(/\s+/g, '_')}`;
    const { data, error } = await supabase.storage
      .from('deliverables')
      .upload(path, file, { upsert: false });
    if (error || !data) { toastError(`Upload failed: ${error?.message ?? 'unknown error'}`); return null; }
    const { data: urlData } = supabase.storage.from('deliverables').getPublicUrl(data.path);
    return urlData.publicUrl;
  };

  const uploadWoDocument = async (file: File): Promise<string | null> => {
    const path = `wo-docs/${Date.now()}-${file.name.replace(/\s+/g, '_')}`;
    const { data, error } = await supabase.storage
      .from('deliverables')
      .upload(path, file, { upsert: false });
    if (error || !data) { toastError(`Upload failed: ${error?.message ?? 'unknown error'}`); return null; }
    const { data: urlData } = supabase.storage.from('deliverables').getPublicUrl(data.path);
    return urlData.publicUrl;
  };

  // ── Materials ──────────────────────────────────────────────────────────────

  const saveMaterial = async (m: Partial<Material>) => {
    // Every failure here used to be silent: no user meant a bare return, and a
    // thrown request meant nothing at all. Clicking Save and seeing nothing
    // happen is the worst possible answer, so each path now says something.
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      toastError('You appear to be signed out — refresh the page and sign in again');
      return;
    }
    if (!m.name?.trim()) { toastError('An item needs a name'); return; }
    const payload = {
      name: m.name.trim(), description: m.description ?? null, category: m.category ?? null,
      unit: m.unit || 'each', stock_quantity: Number(m.stock_quantity ?? 0),
      low_stock_threshold: m.low_stock_threshold ?? null, unit_cost: Number(m.unit_cost ?? 0),
      supplier: m.supplier ?? null, sku: m.sku ?? null, location: m.location ?? null, notes: m.notes ?? null,
    };
    try {
      const { error } = m.id
        ? await supabase.from('materials').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', m.id)
        : await supabase.from('materials').insert({ ...payload, user_id: user.id });
      if (error) { toastError(`Couldn't save material: ${error.message}`); return; }
    } catch {
      toastError("Couldn't save that item — check your connection and try again");
      return;
    }
    toastSuccess(`"${payload.name}" saved`);
    loadAll();
  };

  const deleteMaterial = async (id: string) => {
    const { error } = await supabase.from('materials').delete().eq('id', id);
    if (error) { toastError(`Couldn't delete material: ${error.message}`); return; }
    loadAll();
  };

  // Stock in: what came back from the store goes on the shelf. Top-ups raise
  // an existing item's count and refresh its cost; the rest become new items.
  // Deliberately sequential and all-or-nothing-reported: a half-applied run
  // that claims success is how inventory quietly stops matching the shelf.
  const stockIn = async (plan: StockInPlan) => {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      toastError('You appear to be signed out — refresh the page and sign in again');
      return;
    }
    let done = 0;
    const failed: string[] = [];
    try {
      for (const t of plan.topUps) {
        const { error } = await supabase.from('materials')
          .update({ stock_quantity: t.newQuantity, unit_cost: t.newUnitCost, updated_at: new Date().toISOString() })
          .eq('id', t.material.id);
        if (error) failed.push(t.material.name); else done += 1;
      }
      for (const c of plan.creates) {
        const { error } = await supabase.from('materials').insert({
          name: c.name, unit: 'each', stock_quantity: c.quantity, unit_cost: c.unit_cost,
          low_stock_threshold: null, user_id: user.id,
        });
        if (error) failed.push(c.name); else done += 1;
      }
    } catch {
      toastError("Couldn't finish adding to inventory — check your connection");
      loadAll();
      return;
    }
    if (failed.length > 0) {
      toastError(`Added ${done}, but these failed: ${failed.join(', ')}`);
    } else {
      toastSuccess(`Inventory updated — ${plan.topUps.length} topped up, ${plan.creates.length} new`);
    }
    loadAll();
  };

  // ── Material kits (migration-084) ──────────────────────────────────────────
  //
  // A saved recipe of materials. Saving or deleting a kit never touches stock —
  // inventory moves only when a work order that used one is saved.

  const saveMaterialKit = async (k: Partial<MaterialKit>) => {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      toastError('You appear to be signed out — refresh the page and sign in again');
      return;
    }
    const payload = {
      name: (k.name ?? '').trim(),
      description: k.description?.trim() || null,
      items: (k.items ?? []).filter((i) => (i.name ?? '').trim() !== ''),
    };
    if (!payload.name) { toastError('A kit needs a name'); return; }
    try {
      const { error } = k.id
        ? await supabase.from('material_kits').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', k.id)
        : await supabase.from('material_kits').insert({ ...payload, user_id: user.id });
      if (error) {
        toastError(error.code === '23505'
          ? 'You already have a kit called "' + payload.name + '"'
          : "Couldn't save kit: " + error.message);
        return;
      }
    } catch {
      toastError("Couldn't save that kit — check your connection and try again");
      return;
    }
    toastSuccess('Kit "' + payload.name + '" saved');
    loadAll();
  };

  const deleteMaterialKit = async (id: string) => {
    const { error } = await supabase.from('material_kits').delete().eq('id', id);
    if (error) { toastError("Couldn't delete kit: " + error.message); return; }
    loadAll();
  };

  // ── Quotes ─────────────────────────────────────────────────────────────────

  // ── Surveys (migration-066) ────────────────────────────────────────────────
  // The walk-through that starts a job. Its scope lines become quote lines, so
  // nothing between the site visit and the client's number gets re-typed.

  const saveSurvey = async (sv: Partial<Survey>): Promise<Survey | null> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const payload = {
      survey_number: sv.survey_number!, customer_id: sv.customer_id ?? null,
      client_name: sv.client_name ?? null, client_email: sv.client_email ?? null,
      client_phone: sv.client_phone ?? null, poc_name: sv.poc_name ?? null, poc_phone: sv.poc_phone ?? null,
      site_name: sv.site_name ?? null, site_address: sv.site_address ?? null,
      site_city: sv.site_city ?? null, site_state: sv.site_state ?? null, site_zip: sv.site_zip ?? null,
      title: sv.title ?? null, survey_date: sv.survey_date || null, surveyed_by: sv.surveyed_by ?? null,
      status: sv.status ?? 'draft',
      existing_conditions: sv.existing_conditions ?? null, findings: sv.findings ?? null,
      recommendations: sv.recommendations ?? null, notes: sv.notes ?? null,
      scope_items: sv.scope_items ?? [],
      survey_type: sv.survey_type ?? 'camera', last_page: sv.last_page ?? 1,
      cameras: sv.cameras ?? [], cable_drops: sv.cable_drops ?? [], documents: sv.documents ?? [],
      custom_qa: sv.custom_qa ?? [],
      head_end_notes: sv.head_end_notes ?? null, rack_space: sv.rack_space ?? null,
      switch_notes: sv.switch_notes ?? null, access_notes: sv.access_notes ?? null,
      labor_rate: sv.labor_rate ?? null, labor_hours: sv.labor_hours ?? null,
      tax_rate: Number(sv.tax_rate ?? 0), payment_terms: sv.payment_terms ?? null,
    };
    const { data, error } = sv.id
      ? await supabase.from('surveys').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', sv.id).select('*').single()
      : await supabase.from('surveys').insert({ ...payload, user_id: user.id }).select('*').single();
    if (error) { toastError(`Couldn't save survey: ${error.message}`); return null; }
    loadAll();
    return (data as Survey) ?? null;
  };

  /**
   * The wizard's last step. Saving first is what lets a brand-new survey go
   * straight to a quote — buildQuoteFromSurvey needs a row with an id.
   */
  const saveSurveyAndQuote = async (sv: Partial<Survey>) => {
    const saved = await saveSurvey(sv);
    if (saved) await buildQuoteFromSurvey(saved);
  };

  const deleteSurvey = async (id: string) => {
    // The quote and work order it produced survive — their survey_id just goes
    // null (ON DELETE SET NULL). Deleting paperwork must never delete money.
    const { error } = await supabase.from('surveys').delete().eq('id', id);
    if (error) { toastError(`Couldn't delete survey: ${error.message}`); return; }
    loadAll();
  };

  /** Survey → Quote: one click, no re-typing. Links both directions. */
  const buildQuoteFromSurvey = async (sv: Survey) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const draft = quoteFromSurvey(sv, nextQuoteNumber(quotes));
    const { data: newQuote, error } = await supabase.from('quotes')
      .insert({ ...draft, user_id: user.id }).select('id, quote_number').single();
    if (error) { toastError(`Couldn't build quote from survey: ${error.message}`); return; }
    if (newQuote) {
      const { error: sErr } = await supabase.from('surveys').update({
        quote_id: newQuote.id, status: 'quoted', updated_at: new Date().toISOString(),
      }).eq('id', sv.id);
      if (sErr) toastError(`Quote created, but couldn't link it back to the survey: ${sErr.message}`);
      else toastSuccess(`Built ${newQuote.quote_number} from ${sv.survey_number}`);
    }
    loadAll();
  };

  // ── Contracts (migration-070) ──────────────────────────────────────────────
  // The last link: papered from the accepted quote so the scope and the money
  // are inherited rather than restated.

  const saveContract = async (c: Partial<Contract>) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { id, created_at, ...rest } = c as Contract;
    void created_at;
    const { error } = id
      ? await supabase.from('contracts').update({ ...rest, updated_at: new Date().toISOString() }).eq('id', id)
      : await supabase.from('contracts').insert({ ...rest, user_id: user.id });
    if (error) { toastError(`Couldn't save contract: ${error.message}`); return; }
    loadAll();
  };

  const deleteContract = async (id: string) => {
    const { error } = await supabase.from('contracts').delete().eq('id', id);
    if (error) { toastError(`Couldn't delete contract: ${error.message}`); return; }
    loadAll();
  };

  /** Quote → Contract: one click, scope and money carried across. */
  const buildContractFromQuote = async (q: Quote) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const survey = q.survey_id ? surveys.find((s) => s.id === q.survey_id) ?? null : null;
    const draft = contractFromQuote(q, nextContractNumber(contracts), survey);
    const { data: newContract, error } = await supabase.from('contracts')
      .insert({ ...draft, user_id: user.id }).select('id, contract_number').single();
    if (error) { toastError(`Couldn't build contract: ${error.message}`); return; }
    if (newContract) {
      const { error: qErr } = await supabase.from('quotes')
        .update({ contract_id: newContract.id, updated_at: new Date().toISOString() }).eq('id', q.id);
      if (qErr) toastError(`Contract created, but couldn't link it to the quote: ${qErr.message}`);
      else toastSuccess(`Built ${newContract.contract_number} from ${q.quote_number}`);
      setView('contracts');
    }
    loadAll();
  };

  const saveQuote = async (q: Partial<Quote>) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const payload = {
      quote_number: q.quote_number!, client_name: q.client_name ?? null, client_email: q.client_email ?? null,
      client_phone: q.client_phone ?? null, title: q.title ?? null, description: q.description ?? null,
      line_items: q.line_items ?? [], subtotal: Number(q.subtotal ?? 0), tax_rate: Number(q.tax_rate ?? 0),
      tax_amount: Number(q.tax_amount ?? 0), total: Number(q.total ?? 0), status: q.status ?? 'draft',
      valid_until: q.valid_until || null, notes: q.notes ?? null,
    };
    const { error } = q.id
      ? await supabase.from('quotes').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', q.id)
      : await supabase.from('quotes').insert({ ...payload, user_id: user.id });
    if (error) { toastError(`Couldn't save quote: ${error.message}`); return; }
    loadAll();
  };

  const deleteQuote = async (id: string) => {
    const { error } = await supabase.from('quotes').delete().eq('id', id);
    if (error) { toastError(`Couldn't delete quote: ${error.message}`); return; }
    loadAll();
  };

  const acceptQuote = async (q: Quote) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: newWO, error } = await supabase.from('work_orders').insert({
      user_id: user.id,
      wo_number: nextWoNumber,
      contractor_name: '',
      title: q.title ?? null,
      customer_name: q.client_name ?? null,
      customer_id: q.customer_id ?? null,
      description: q.description ?? null,
      total_amount: Number(q.total),
      pay_type: 'Fixed',
      wo_status: 'Open',
      source_platform: 'Internal',
      assignment_type: 'Internal',
      priority: 'Normal',
      schedule_type: 'Exact Time',
    }).select('id').single();
    if (error) { toastError(`Couldn't create work order from quote: ${error.message}`); return; }
    if (newWO) {
      const { error: qErr } = await supabase.from('quotes').update({
        status: 'accepted', accepted_at: new Date().toISOString(), work_order_id: newWO.id,
      }).eq('id', q.id);
      if (qErr) toastError(`Work order created, but couldn't mark quote accepted: ${qErr.message}`);
      else toastSuccess(`Quote accepted — created WO#${nextWoNumber}`);

      // Close the loop back to the walk-through: a finished job can now be
      // traced to the survey that won it, and the survey reads 'Won'.
      if (q.survey_id) {
        await supabase.from('surveys').update({
          work_order_id: newWO.id, status: 'won', updated_at: new Date().toISOString(),
        }).eq('id', q.survey_id);
      }
    }
    loadAll();
  };

  // ── Invoices ───────────────────────────────────────────────────────────────

  const saveInvoice = async (inv: Partial<Invoice>) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const existing = inv.id ? invoices.find((i) => i.id === inv.id) : null;
    const payload = {
      invoice_number: inv.invoice_number!, client_name: inv.client_name ?? null, client_email: inv.client_email ?? null,
      client_phone: inv.client_phone ?? null, title: inv.title ?? null, description: inv.description ?? null,
      line_items: inv.line_items ?? [], subtotal: Number(inv.subtotal ?? 0), tax_rate: Number(inv.tax_rate ?? 0),
      tax_amount: Number(inv.tax_amount ?? 0), total: Number(inv.total ?? 0), status: inv.status ?? 'draft',
      due_date: inv.due_date || null, notes: inv.notes ?? null,
      work_order_ids: inv.work_order_ids ?? [],
      // Stamp sent_at/paid_at on the first transition into each status.
      sent_at: inv.status !== 'draft' ? (existing?.sent_at ?? new Date().toISOString()) : null,
      paid_at: inv.status === 'paid' ? (existing?.paid_at ?? new Date().toISOString()) : null,
    };
    const { error } = inv.id
      ? await supabase.from('invoices').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', inv.id)
      : await supabase.from('invoices').insert({ ...payload, user_id: user.id });
    if (error) { toastError(`Couldn't save invoice: ${error.message}`); return; }
    loadAll();
  };

  const deleteInvoice = async (id: string) => {
    const { error } = await supabase.from('invoices').delete().eq('id', id);
    if (error) { toastError(`Couldn't delete invoice: ${error.message}`); return; }
    loadAll();
  };

  // Recompute stored status from the payment sum: fully covered → paid,
  // otherwise a paying invoice is at least 'sent' (never back to draft).
  const syncInvoicePaidStatus = async (inv: Invoice) => {
    const { data, error } = await supabase.from('invoice_payments').select('amount').eq('invoice_id', inv.id);
    if (error) return;
    const paid = (data ?? []).reduce((s, p) => s + Number(p.amount), 0);
    const fullyPaid = paid >= Number(inv.total) - 0.005 && Number(inv.total) > 0;
    if (fullyPaid && inv.status !== 'paid') {
      await supabase.from('invoices').update({ status: 'paid', paid_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', inv.id);
    } else if (!fullyPaid && inv.status === 'paid') {
      await supabase.from('invoices').update({ status: 'sent', paid_at: null, updated_at: new Date().toISOString() }).eq('id', inv.id);
    } else if (!fullyPaid && inv.status === 'draft' && paid > 0) {
      await supabase.from('invoices').update({ status: 'sent', sent_at: inv.sent_at ?? new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', inv.id);
    }
  };

  const recordInvoicePayment = async (inv: Invoice, p: { amount: number; payment_date: string; method: string; reference: string }) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from('invoice_payments').insert({
      user_id: user.id, invoice_id: inv.id, amount: Number(p.amount),
      payment_date: p.payment_date, method: p.method, reference: p.reference || null,
    });
    if (error) { toastError(`Couldn't record payment: ${error.message}`); return; }
    await syncInvoicePaidStatus(inv);
    toastSuccess(`Recorded ${p.method} payment on ${inv.invoice_number}`);
    loadAll();
  };

  const deleteInvoicePayment = async (inv: Invoice, paymentId: string) => {
    const { error } = await supabase.from('invoice_payments').delete().eq('id', paymentId);
    if (error) { toastError(`Couldn't delete payment: ${error.message}`); return; }
    await syncInvoicePaidStatus(inv);
    loadAll();
  };

  // ── Import Queue ───────────────────────────────────────────────────────────

  // Returns whether the work order was actually created, so a bulk run can
  // report what failed instead of claiming a clean success. In `silent` mode
  // (approve-all) it skips the per-item toast and reload — eighteen of each
  // would be eighteen toasts and eighteen full refetches.
  const approveImportItem = async (id: string, opts?: { silent?: boolean }): Promise<boolean> => {
    let ok = false;
    try {
      const res = await fetch(`/api/import-queue/${id}/approve`, { method: 'POST' });
      ok = res.ok;
      if (!res.ok && !opts?.silent) {
        const data = await res.json().catch(() => ({}));
        toastError(data.error || 'Import approval failed');
      } else if (res.ok && !opts?.silent) {
        toastSuccess('Import approved — work order created');
      }
    } catch {
      if (!opts?.silent) toastError('Import approval failed — check your connection');
    }
    if (!opts?.silent) loadAll();
    return ok;
  };

  const rejectImportItem = async (id: string) => {
    try {
      const res = await fetch(`/api/import-queue/${id}/reject`, { method: 'POST' });
      if (!res.ok) toastError('Import rejection failed');
    } catch {
      toastError('Import rejection failed — check your connection');
    }
    loadAll();
  };

  // ── QuickBooks ─────────────────────────────────────────────────────────────

  const syncPaymentToQuickBooks = async (paymentId: string) => {
    try {
      const res = await fetch('/api/quickbooks/sync-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_id: paymentId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toastError(data.error || 'QuickBooks sync failed');
      } else {
        toastSuccess('Payment synced to QuickBooks');
      }
    } catch {
      toastError('QuickBooks sync failed — check your connection');
    }
    loadAll();
  };

  // ── Nav / Auth ─────────────────────────────────────────────────────────────

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  useInactivityLogout(handleLogout);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); setSearchOpen(true); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const navigate = (key: View) => { setView(key); setMobileNavOpen(false); };

  const NI = ({ k, icon, label }: { k: View; icon: React.ReactNode; label: string }) => (
    <button className={`nav-btn ${view === k ? 'active' : ''}`} onClick={() => navigate(k)}>
      {icon} {label}
    </button>
  );

  // ── Loading ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <Sparkles size={28} color="var(--gold)" style={{ marginBottom: 12 }} />
          <div className="serif" style={{ fontSize: 22, color: 'var(--teal)' }}>Loading your business...</div>
        </div>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="app-root">
      <Toaster />
      {/* Mobile header — hidden on desktop via CSS, shown on mobile via media query */}
      <div
        className="no-print"
        id="mobile-header"
        style={{ position: 'sticky', top: 0, zIndex: 50, padding: '12px 16px', background: 'linear-gradient(135deg, #13284A 0%, #0E1B2E 100%)', color: 'white', alignItems: 'center', justifyContent: 'space-between' }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/wf/logo-wide.png" alt="FAJ Solutions" style={{ height: 34, width: 'auto' }} />
        <button onClick={() => setMobileNavOpen(!mobileNavOpen)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}>
          {mobileNavOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Sidebar — .mobile-open beats the mobile display:none in CSS */}
      {mobileNavOpen && <div className="mobile-nav-backdrop no-print" onClick={() => setMobileNavOpen(false)} />}
      <aside
        className={`no-print glass-dark sidebar-desktop ${mobileNavOpen ? 'mobile-open' : ''}`}
        style={{ width: 250, padding: '24px 16px', position: 'sticky', top: 0, height: '100vh', flexDirection: 'column', gap: 2 }}
      >
        <div style={{ padding: '0 12px 20px 12px', borderBottom: '1px solid rgba(255,255,255,0.1)', marginBottom: 12 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/wf/logo-wide.png" alt="FAJ Solutions" style={{ width: '100%', maxWidth: 196, height: 'auto', display: 'block', marginBottom: 6 }} />
          <div className="display" style={{ fontSize: 11, fontWeight: 600, color: 'var(--gold-light)', letterSpacing: 1.6, textTransform: 'uppercase' }}>Business Manager</div>
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', flex: 1, overflowY: 'auto' }}>
          {/* The daily round, always on screen. Site Log first because that is
              where a job starts: walk the site, turn it into a work order, pay
              the tech. Those four plus the dashboard are ~90% of the use, and
              they used to be spread across two collapsible sections that could
              not both be open. */}
          <div style={{
            display: 'flex', flexDirection: 'column', gap: 2,
            paddingBottom: 12, marginBottom: 10,
            borderBottom: '1px solid rgba(255,255,255,0.09)',
          }}>
            <div style={{
              fontSize: 9, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase',
              color: 'rgba(255,255,255,0.35)', padding: '2px 12px 6px',
            }}>
              Every day
            </div>
            <NI k="dashboard"  icon={<BarChart3 size={15} />} label="Dashboard" />
            <NI k="sitelog"    icon={<Timer size={15} />}     label="Site Log" />
            {/* Fred, 2026-10-02: "rename to WorkFlow, I like it and keep it". */}
            <NI k="workorders" icon={<Workflow size={15} />} label="WorkFlow" />
            <NI k="payables"   icon={<Wallet size={15} />}    label="Pay Techs" />
            <NI k="team"       icon={<UserCog size={15} />}   label="Team" />
            <button className={`nav-btn ${view === 'support' ? 'active' : ''}`} onClick={() => navigate('support')}>
              <LifeBuoy size={15} /> Support
              {supportCount > 0 && (
                <span style={{
                  background: 'var(--gold)', color: '#0E1B2E', borderRadius: 999,
                  fontSize: 9, fontWeight: 800, padding: '1px 6px', marginLeft: 4,
                }}>
                  {supportCount}
                </span>
              )}
            </button>
            <button className={`nav-btn ${view === 'import-queue' ? 'active' : ''}`} onClick={() => navigate('import-queue')}>
              <Inbox size={15} /> Import
              {pendingImportCount > 0 && (
                <span style={{
                  background: 'var(--teal)', color: 'white', borderRadius: 999,
                  fontSize: 9, fontWeight: 800, padding: '1px 6px', marginLeft: 4,
                }}>
                  {pendingImportCount}
                </span>
              )}
            </button>
          </div>

          <NavSection title="Money" open={sectionOpen('money')} onToggle={() => toggleSection('money')}>
            <NI k="payments"   icon={<CreditCard size={15} />} label="Payments Made" />
            <NI k="financials" icon={<TrendingUp size={15} />} label="Financials" />
            <NI k="ledger"     icon={<BookOpen size={15} />}   label="Ledger" />
            <NI k="customers"  icon={<Building2 size={15} />}  label="Customers" />
            <NI k="quickbooks" icon={<TrendingUp size={15} />} label="QuickBooks" />
            {/* Client billing happens in QuickBooks and NetView, so these two
                sit here rather than competing with the daily round. */}
            <a
              className="nav-btn"
              href={NETVIEW_FORM_URL}
              target="_blank"
              rel="noopener noreferrer"
              title="Opens NetView's vendor payment form in a new tab. Tip: open a NetView work order and use 'Submit to Netview' there to get the form pre-filled."
              style={{ textDecoration: 'none' }}
              onClick={() => setMobileNavOpen(false)}
            >
              <FileText size={15} /> NetView Invoice
            </a>
            <NI k="invoices"   icon={<Receipt size={15} />}    label="Invoices" />
          </NavSection>

          <NavSection title="Techs" open={sectionOpen('techs')} onToggle={() => toggleSection('techs')}>
            <NI k="contractors" icon={<Users size={15} />}        label="Contractors" />
            <NI k="contractor-analytics" icon={<Award size={15} />} label="Performance" />
            <NI k="portal-admin" icon={<ShieldCheck size={15} />} label="Portal & Review" />
            <NI k="statements"  icon={<FileText size={15} />}     label="Statements" />
            <NI k="1099"        icon={<ClipboardCheck size={15} />} label="1099s" />
            <NI k="w9"          icon={<BookOpen size={15} />}     label="W-9s" />
          </NavSection>

          <NavSection title="Winning work" open={sectionOpen('pipeline')} onToggle={() => toggleSection('pipeline')}>
            <NI k="surveys"    icon={<ClipboardList size={15} />}  label="Surveys" />
            <NI k="quotes"     icon={<FileSignature size={15} />}  label="Quotes" />
            <NI k="contracts"  icon={<FileCheck2 size={15} />}     label="Contracts" />
            <NI k="scheduling" icon={<Calendar size={15} />}       label="Scheduling" />
            <NI k="dispatch"   icon={<Map size={15} />}            label="Dispatch Map" />
          </NavSection>

          <NavSection title="On site" open={sectionOpen('onsite')} onToggle={() => toggleSection('onsite')}>
            <NI k="materials"   icon={<Package size={15} />} label="Materials" />
            <NI k="maintenance" icon={<Wrench size={15} />}  label="Maintenance" />
            <NI k="network"     icon={<Network size={15} />} label="Network" />
          </NavSection>

          <NavSection title="Settings" open={sectionOpen('settings')} onToggle={() => toggleSection('settings')}>
            <NI k="settings"    icon={<Settings size={15} />}     label="Settings" />
          </NavSection>
        </nav>

        {/* Utility buttons */}
        <div style={{ display: 'flex', gap: 6, padding: '8px 12px', marginTop: 8 }}>
          <button
            onClick={() => setSearchOpen(true)}
            title="Search (Ctrl+K)"
            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px', borderRadius: 8, border: 'none', background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}
          >
            <Search size={13} /> Search
          </button>
          <button
            onClick={toggleDark}
            title="Toggle dark mode"
            style={{ padding: '8px', borderRadius: 8, border: 'none', background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
          >
            {dark ? <Sun size={13} /> : <Moon size={13} />}
          </button>
          <button
            onClick={() => {
              if (view === 'workorders') exportWorkOrdersCSV(enrichedWOs);
              else if (view === 'payments') exportPaymentsCSV(payments);
              else if (view === 'contractors') exportContractorsCSV(contractors);
              else if (view === '1099') export1099CSV(contractors, payments, taxYear);
              else exportWorkOrdersCSV(enrichedWOs);
            }}
            title="Export CSV"
            style={{ padding: '8px', borderRadius: 8, border: 'none', background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
          >
            <Download size={13} />
          </button>
        </div>

        <button
          onClick={handleLogout}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 8, border: 'none', background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontSize: 13, fontWeight: 600, width: '100%', marginTop: 8 }}
        >
          <LogOut size={14} /> Sign Out
        </button>
      </aside>

      {/* ── Global Search ── */}
      <GlobalSearch
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        workOrders={enrichedWOs}
        contractors={contractors}
        payments={payments}
        onSelect={(r) => {
          setSearchOpen(false);
          if (r.type === 'wo') { setView('workorders'); setModal({ type: 'wo', item: r.data }); }
          else if (r.type === 'contractor') { setView('contractors'); setModal({ type: 'contractor', item: r.data }); }
          else if (r.type === 'payment') { setView('payments'); setModal({ type: 'payment', item: r.data }); }
        }}
      />

      {/* ── Main Content ── */}
      <main className="main-content" style={{ flex: 1, overflow: 'auto', minWidth: 0 }}>
        {view === 'dashboard' && (
          <div className="view-inner" style={{ maxWidth: 1100, margin: '0 auto', paddingBottom: 0 }}>
            <AttentionPanel
              data={{
                surveys, quotes, contracts, workOrders: enrichedWOs,
                invoices, invoicePayments, siteVisits: dashboardVisits,
              }}
              onGo={(v) => setView(v as typeof view)}
            />
          </div>
        )}
        {view === 'dashboard' && (
          <DashboardView
            stats={stats}
            workOrders={enrichedWOs}
            payments={payments}
            onView={(v) => setView(v as typeof view)}
          />
        )}
        {view === 'financials' && (
          <FinancialDashboardView workOrders={enrichedWOs} />
        )}
        {view === 'contractor-analytics' && (
          <ContractorAnalyticsView contractors={contractors} workOrders={enrichedWOs} />
        )}
        {view === 'scheduling' && (
          <SchedulingView workOrders={enrichedWOs} contractors={contractors} onUpdateWO={updateWorkOrderFields} />
        )}
        {view === 'dispatch' && (
          <DispatchMapView
            workOrders={enrichedWOs}
            contractors={contractors}
            contractorTimeLogs={contractorTimeLogs}
            onUpdateWO={updateWorkOrderFields}
          />
        )}
        {view === 'materials' && (
          <MaterialsView materials={materials} kits={materialKits} onSave={saveMaterial} onDelete={deleteMaterial} onSaveKit={saveMaterialKit} onDeleteKit={deleteMaterialKit} onStockIn={stockIn} />
        )}
        {view === 'surveys' && (
          <SurveysView
            surveys={surveys}
            questionTemplates={questionTemplates}
            onSave={async (sv) => { await saveSurvey(sv); }}
            onSaveAndQuote={saveSurveyAndQuote}
            onDelete={deleteSurvey}
            onBuildQuote={buildQuoteFromSurvey}
            onOpenQuote={() => setView('quotes')}
            onOpenWorkOrder={(id) => {
              const wo = workOrders.find((w) => w.id === id);
              setView('workorders');
              if (wo) setModal({ type: 'wo', item: wo });
            }}
          />
        )}
        {view === 'contracts' && (
          <ContractsView
            contracts={contracts}
            onSave={saveContract}
            onDelete={deleteContract}
            onOpenQuote={() => setView('quotes')}
            onOpenSurvey={() => setView('surveys')}
          />
        )}
        {view === 'quotes' && (
          <QuotesView quotes={quotes} materials={materials} kits={materialKits} onSave={saveQuote} onDelete={deleteQuote} onAccept={acceptQuote} onBuildContract={buildContractFromQuote} />
        )}
        {view === 'customers' && <CustomersView />}
        {view === 'portal-admin' && <PortalAdminView />}
        {view === 'network' && <NetworkView />}
        {view === 'sitelog' && <SiteLogView />}
        {view === 'team' && <TeamView onOpenContractors={() => navigate('contractors')} />}
        {view === 'maintenance' && <MaintenanceView />}
        {view === 'invoices' && (
          <InvoicesView
            invoices={invoices}
            invoicePayments={invoicePayments}
            workOrders={workOrders}
            onSave={saveInvoice}
            onDelete={deleteInvoice}
            onRecordPayment={recordInvoicePayment}
            onDeletePayment={deleteInvoicePayment}
          />
        )}
        {view === 'support' && (
          <SupportView
            contractors={contractors}
            onCount={setSupportCount}
            onMakeJob={(prefill, ticketId) => {
              ticketForNextJob.current = ticketId;
              setModal({ type: 'wo', item: null, prefill });
            }}
          />
        )}
        {view === 'import-queue' && (
          <ImportQueueView
            items={importQueue}
            connection={gmailConnection}
            onApprove={approveImportItem}
            onReject={rejectImportItem}
            onImported={loadAll}
          />
        )}
        {view === 'workorders' && (
          <WorkOrdersView
            initialSearch={woFromUrl}
            siteVisits={linkedVisits}
            workOrders={enrichedWOs}
            stats={stats}
            contractors={contractors}
            payments={payments}
            onReassign={reassignJob}
            onAdd={() => setModal({ type: 'wo', item: null })}
            onAddFromAI={(fields) => setModal({ type: 'wo', item: null, prefill: fields })}
            onEdit={(w) => setModal({ type: 'wo', item: w })}
            onDelete={deleteWorkOrder}
            onDuplicate={(w) => {
              // Strip identity + computed fields so saveWorkOrder does an INSERT, not UPDATE.
              // materials_used stays behind too — it records what THAT job consumed.
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              const { id, created_at, updated_at, paid, remaining, payment_status, payout_total, pay_set, archived_at, materials_used, mileage_logs, ...copy } = w;
              setModal({ type: 'wo', item: { ...copy, wo_number: '' } as WorkOrder });
            }}
            onPay={handlePayWO}
            onSendPortal={handleSendPortal}
            onArchive={handleArchive}
            onCloseJob={closeWorkOrder}
            onUnarchive={handleUnarchive}
            onRefresh={loadAll}
          />
        )}
        {view === 'payments' && (
          <PaymentsView
            payments={payments}
            workOrders={workOrders}
            contractors={contractors}
            onAdd={() => setModal({ type: 'payment', item: null })}
            onEdit={(p) => setModal({ type: 'payment', item: p })}
            onDelete={deletePayment}
            qboConnected={!!qboConnection?.default_expense_account_id}
            onSyncPayment={syncPaymentToQuickBooks}
          />
        )}
        {view === 'ledger' && (
          <LedgerView workOrders={enrichedWOs} payments={payments} />
        )}
        {view === 'payables' && (
          <PayablesView
            workOrders={enrichedWOs}
            contractors={contractors}
            payments={payments}
            onPay={handlePayWO}
            onQuickPay={() => setModal({ type: 'payment', item: null })}
            onEditWO={(w) => setModal({ type: 'wo', item: w })}
          />
        )}
        {view === 'contractors' && (
          <ContractorsView
            contractors={contractors}
            workOrders={enrichedWOs}
            payments={payments}
            onAdd={() => setModal({ type: 'contractor', item: null })}
            onEdit={(c) => setModal({ type: 'contractor', item: c })}
            onDelete={deleteContractor}
            onViewStatement={(name) => { setSelectedContractor(name); setView('statements'); }}
            onAddJob={(_prefill) => setModal({ type: 'wo', item: null })}
            onAddPayment={(prefill) => setModal({ type: 'payment', item: null, prefill })}
            onEditPayment={(p) => setModal({ type: 'payment', item: p })}
            onSendOnboarding={handleSendOnboarding}
            onSendAll={handleSendAllOnboarding}
            onSyncQuickBooks={handleSyncQuickBooks}
            busy={contractorBusy}
          />
        )}
        {view === 'statements' && (
          <StatementView
            contractors={contractors}
            workOrders={enrichedWOs}
            payments={payments}
            selected={selectedContractor}
            setSelected={setSelectedContractor}
          />
        )}
        {view === '1099' && (
          <TenNinetyNineView
            contractors={contractors}
            payments={payments}
            year={taxYear}
            setYear={setTaxYear}
          />
        )}
        {view === 'w9' && (
          <W9View contractors={contractors} onEdit={(c) => setModal({ type: 'contractor', item: c })} />
        )}
        {view === 'quickbooks' && (
          <QuickBooksView
            workOrders={workOrders}
            payments={payments}
            contractors={contractors}
            connection={qboConnection}
            onReloaded={loadAll}
          />
        )}
        {view === 'settings' && (
          <SettingsView
            templates={questionTemplates}
            onSave={saveTemplate}
            onDelete={deleteTemplate}
            onUploadAttachment={uploadTemplateAttachment}
            deliverableTemplates={deliverableTemplates}
            onSaveDeliverable={saveDeliverableTemplate}
            onDeleteDeliverable={deleteDeliverableTemplate}
          />
        )}
      </main>

      {/* ── Modals ── */}
      {modal?.type === 'wo' && (
        <WorkOrderModal
          item={modal.item}
          nextWoNumber={modal.item ? undefined : nextWoNumber}
          prefill={modal.prefill}
          contractors={contractors}
          questionTemplates={questionTemplates}
          deliverableTemplates={deliverableTemplates}
          payments={payments}
          onSave={(w) => { saveWorkOrder(w); setModal(null); }}
          onClose={() => { ticketForNextJob.current = null; setModal(null); }}
          onSaveTemplate={async (name, qaItems) => {
            await saveTemplate(null, {
              name,
              questions: qaItems.map((q) => ({ id: q.id, label: q.label, type: q.type })),
              attachment_url: null,
            });
          }}
          onUploadDoc={uploadWoDocument}
          onSavePayment={savePayment}
          onDeletePayment={deletePayment}
          onEditPayment={(p) => setModal({ type: 'payment', item: p })}
          materials={materials}
          kits={materialKits}
          onSaveKit={saveMaterialKit}
        />
      )}
      {modal?.type === 'contractor' && (
        <ContractorModal
          item={modal.item}
          onSave={(c) => { saveContractor(c); setModal(null); }}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === 'payment' && (
        <PaymentModal
          item={modal.item}
          prefill={modal.prefill}
          workOrders={workOrders}
          contractors={contractors}
          payments={payments}
          onSave={(p) => { savePayment(p); setModal(null); }}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
