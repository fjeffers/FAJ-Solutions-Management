'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { enrichWorkOrders } from '@/lib/utils';
import { useInactivityLogout } from '@/lib/useInactivityLogout';
import { useDarkMode } from '@/lib/useDarkMode';
import type { Contractor, WorkOrder, Payment, QuestionTemplate, EnrichedWorkOrder } from '@/lib/types';
import {
  BarChart3, Briefcase, CreditCard, Users, FileText, TrendingUp,
  LogOut, Menu, X, BookOpen, ClipboardCheck, Sparkles, Settings, Wallet,
  Search, Moon, Sun, Download,
} from 'lucide-react';

import DashboardView from '@/components/DashboardView';
import WorkOrdersView from '@/components/WorkOrdersView';
import PaymentsView from '@/components/PaymentsView';
import ContractorsView from '@/components/ContractorsView';
import StatementView from '@/components/StatementView';
import TenNinetyNineView from '@/components/TenNinetyNineView';
import W9View from '@/components/W9View';
import QuickBooksView from '@/components/QuickBooksView';
import QuestionTemplatesView from '@/components/QuestionTemplatesView';
import PayablesView from '@/components/PayablesView';
import GlobalSearch from '@/components/GlobalSearch';
import ContractorModal from '@/components/ContractorModal';
import WorkOrderModal from '@/components/WorkOrderModal';
import PaymentModal from '@/components/PaymentModal';
import { exportWorkOrdersCSV, exportPaymentsCSV, exportContractorsCSV, export1099CSV } from '@/lib/export';
import { logAudit } from '@/lib/audit';
import { notifyContractor } from '@/lib/notify';

type View =
  | 'dashboard' | 'workorders' | 'payments' | 'payables' | 'contractors'
  | 'statements' | '1099' | 'w9' | 'quickbooks' | 'settings';

type Modal =
  | { type: 'contractor'; item: Contractor | null }
  | { type: 'wo'; item: WorkOrder | null }
  | { type: 'payment'; item: Payment | null; prefill?: Partial<Payment> }
  | null;

export default function HomePage() {
  const router = useRouter();
  const supabase = createClient();
  const { dark, toggle: toggleDark } = useDarkMode();
  const [view, setView] = useState<View>('dashboard');
  const [modal, setModal] = useState<Modal>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedContractor, setSelectedContractor] = useState<string | null>(null);
  const [taxYear, setTaxYear] = useState<number>(new Date().getFullYear());
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [questionTemplates, setQuestionTemplates] = useState<QuestionTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  const loadAll = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.replace('/login'); return; }

    const [cRes, wRes, pRes, tRes] = await Promise.all([
      supabase.from('contractors').select('*').order('name'),
      supabase.from('work_orders').select('*').order('wo_number'),
      supabase.from('payments').select('*').order('payment_date', { ascending: false }),
      supabase.from('question_templates').select('*').order('created_at', { ascending: false }),
    ]);
    if (cRes.data) setContractors(cRes.data);
    if (wRes.data) setWorkOrders(wRes.data);
    if (pRes.data) setPayments(pRes.data);
    if (tRes.data) setQuestionTemplates(tRes.data as QuestionTemplate[]);
    setLoading(false);
  };

  useEffect(() => { loadAll(); }, []);

  const enrichedWOs = useMemo(() => enrichWorkOrders(workOrders, payments), [workOrders, payments]);

  const stats = useMemo(() => {
    const total = enrichedWOs.reduce((s, w) => s + Number(w.total_amount), 0);
    const paid  = enrichedWOs.reduce((s, w) => s + w.paid, 0);
    return {
      total, paid, remaining: total - paid,
      paidCount:    enrichedWOs.filter((w) => w.payment_status === 'paid').length,
      partialCount: enrichedWOs.filter((w) => w.payment_status === 'partial').length,
      pendingCount: enrichedWOs.filter((w) => w.payment_status === 'pending').length,
      jobCount:     enrichedWOs.length,
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
      // Direct Deposit (migration-009)
      bank_name:           c.bank_name           || null,
      account_holder_name: c.account_holder_name || null,
      routing_number:      c.routing_number      || null,
      account_number:      c.account_number      || null,
      account_type:        c.account_type        || null,
    };
    if (c.id) {
      await supabase.from('contractors').update(payload).eq('id', c.id);
      logAudit({ action: 'update', entityType: 'contractor', entityId: c.id, entityLabel: c.name ?? '' });
    } else {
      await supabase.from('contractors').insert({ ...payload, user_id: user.id });
      logAudit({ action: 'create', entityType: 'contractor', entityLabel: c.name ?? '' });
    }
    loadAll();
  };

  const deleteContractor = async (id: string) => {
    const c = contractors.find((x) => x.id === id);
    await supabase.from('contractors').delete().eq('id', id);
    logAudit({ action: 'delete', entityType: 'contractor', entityId: id, entityLabel: c?.name ?? '' });
    loadAll();
  };

  // ── Work Orders ────────────────────────────────────────────────────────────

  const saveWorkOrder = async (w: Partial<WorkOrder>) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const payload = {
      wo_number:       w.wo_number!,
      contractor_name: w.contractor_name!,
      title:           w.title           ?? null,
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
      site_name:       w.site_name       ?? null,
      site_address:    w.site_address    ?? null,
      site_city:       w.site_city       ?? null,
      site_state:      w.site_state      ?? null,
      site_zip:        w.site_zip        ?? null,
      start_time:      w.start_time      ?? null,
      end_time:        w.end_time        ?? null,
      deliverables:    w.deliverables    ?? null,
      service_type:    w.service_type    ?? null,
      required_skills: w.required_skills ?? null,
      // POC + custom Q&A (migration-006)
      poc_name:        w.poc_name        ?? null,
      poc_phone:       w.poc_phone       ?? null,
      poc_email:       w.poc_email       ?? null,
      support_contact: w.support_contact ?? null,
      custom_qa:       w.custom_qa       ?? [],
      // Vendor attachment (migration-007)
      attachment_url:  w.attachment_url  ?? null,
      // Admin documents (migration-008)
      doc_urls:        w.doc_urls        ?? [],
    };
    if (w.id) {
      await supabase.from('work_orders').update(payload).eq('id', w.id);
      logAudit({ action: 'update', entityType: 'work_order', entityId: w.id, entityLabel: `WO#${w.wo_number}` });
      // Notify contractor on status change
      const prev = workOrders.find((x) => x.id === w.id);
      if (prev && prev.wo_status !== w.wo_status) {
        const c = contractors.find((x) => x.name === w.contractor_name);
        if (c?.email) notifyContractor({ type: 'status_change', contractor_email: c.email, contractor_name: c.name, wo_number: w.wo_number!, title: w.title ?? undefined, status: w.wo_status ?? '' });
      }
    } else {
      await supabase.from('work_orders').insert({ ...payload, user_id: user.id });
      logAudit({ action: 'create', entityType: 'work_order', entityLabel: `WO#${w.wo_number}` });
      // Notify contractor of assignment
      const c = contractors.find((x) => x.name === w.contractor_name);
      if (c?.email) notifyContractor({ type: 'wo_assigned', contractor_email: c.email, contractor_name: c.name, wo_number: w.wo_number!, title: w.title ?? undefined });
    }
    loadAll();
  };

  const deleteWorkOrder = async (id: string) => {
    const wo = workOrders.find((x) => x.id === id);
    await supabase.from('work_orders').delete().eq('id', id);
    logAudit({ action: 'delete', entityType: 'work_order', entityId: id, entityLabel: `WO#${wo?.wo_number ?? ''}` });
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
      await supabase.from('payments').update(payload).eq('id', p.id);
      logAudit({ action: 'update', entityType: 'payment', entityId: p.id, entityLabel: `WO#${p.wo_number} — ${p.contractor_name}` });
    } else {
      await supabase.from('payments').insert({ ...payload, user_id: user.id });
      logAudit({ action: 'create', entityType: 'payment', entityLabel: `WO#${p.wo_number} — ${p.contractor_name} — $${p.amount}` });
      // Notify contractor of payment
      const c = contractors.find((x) => x.name === p.contractor_name);
      if (c?.email) notifyContractor({ type: 'payment_recorded', contractor_email: c.email, contractor_name: c.name, wo_number: p.wo_number!, amount: Number(p.amount) });
    }
    loadAll();
  };

  const deletePayment = async (id: string) => {
    const p = payments.find((x) => x.id === id);
    await supabase.from('payments').delete().eq('id', id);
    logAudit({ action: 'delete', entityType: 'payment', entityId: id, entityLabel: `WO#${p?.wo_number ?? ''} — ${p?.contractor_name ?? ''}` });
    loadAll();
  };

  const handlePayWO = (w: EnrichedWorkOrder) => {
    const contractor = contractors.find((c) => c.name === w.contractor_name);
    const method = contractor?.routing_number && contractor?.account_number
      ? 'Direct Deposit'
      : contractor?.zelle_phone
      ? 'Zelle'
      : 'Check';
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
    if (id) {
      await supabase
        .from('question_templates')
        .update({ name: data.name, questions: data.questions, attachment_url: data.attachment_url, updated_at: new Date().toISOString() })
        .eq('id', id);
    } else {
      await supabase
        .from('question_templates')
        .insert({ name: data.name, questions: data.questions, attachment_url: data.attachment_url, user_id: user.id });
    }
    loadAll();
  };

  const deleteTemplate = async (id: string) => {
    await supabase.from('question_templates').delete().eq('id', id);
    loadAll();
  };

  const uploadTemplateAttachment = async (file: File): Promise<string | null> => {
    const path = `templates/${Date.now()}-${file.name.replace(/\s+/g, '_')}`;
    const { data, error } = await supabase.storage
      .from('deliverables')
      .upload(path, file, { upsert: false });
    if (error || !data) { console.error('Upload error:', error); return null; }
    const { data: urlData } = supabase.storage.from('deliverables').getPublicUrl(data.path);
    return urlData.publicUrl;
  };

  const uploadWoDocument = async (file: File): Promise<string | null> => {
    const path = `wo-docs/${Date.now()}-${file.name.replace(/\s+/g, '_')}`;
    const { data, error } = await supabase.storage
      .from('deliverables')
      .upload(path, file, { upsert: false });
    if (error || !data) { console.error('Upload error:', error); return null; }
    const { data: urlData } = supabase.storage.from('deliverables').getPublicUrl(data.path);
    return urlData.publicUrl;
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
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/* Mobile header */}
      <div
        className="no-print"
        id="mobile-header"
        style={{ display: 'none', position: 'sticky', top: 0, zIndex: 50, padding: '12px 16px', background: 'linear-gradient(135deg, #0D7377 0%, #0a5a5d 100%)', color: 'white', alignItems: 'center', justifyContent: 'space-between' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Sparkles size={16} color="var(--gold-light)" />
          <span className="display" style={{ fontSize: 12, color: 'var(--gold-light)', fontWeight: 700 }}>FAJ SOLUTIONS</span>
        </div>
        <button onClick={() => setMobileNavOpen(!mobileNavOpen)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}>
          {mobileNavOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Sidebar */}
      <aside
        className="no-print glass-dark sidebar-desktop"
        style={{ width: 250, padding: '24px 16px', position: 'sticky', top: 0, height: '100vh', flexDirection: 'column', gap: 2, ...(mobileNavOpen ? { display: 'flex', position: 'fixed', zIndex: 40, width: 260 } : {}) }}
      >
        <div style={{ padding: '0 12px 20px 12px', borderBottom: '1px solid rgba(255,255,255,0.1)', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <Sparkles size={20} color="var(--gold-light)" />
            <div className="display" style={{ fontSize: 13, color: 'var(--gold-light)', fontWeight: 700 }}>FAJ</div>
          </div>
          <div className="serif" style={{ fontSize: 20, fontWeight: 600, color: 'white', lineHeight: 1.2 }}>Business Manager</div>
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 2, color: 'rgba(255,255,255,0.35)', padding: '0 12px', marginBottom: 6, textTransform: 'uppercase' }}>Main</div>
          <NI k="dashboard"   icon={<BarChart3 size={15} />}    label="Dashboard" />
          <NI k="workorders"  icon={<Briefcase size={15} />}    label="Work Orders" />
          <NI k="payments"    icon={<CreditCard size={15} />}   label="Payments" />
          <NI k="payables"    icon={<Wallet size={15} />}       label="Payables" />
          <NI k="contractors" icon={<Users size={15} />}        label="Contractors" />
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 2, color: 'rgba(255,255,255,0.35)', padding: '12px 12px 6px', textTransform: 'uppercase' }}>Reports</div>
          <NI k="statements"  icon={<FileText size={15} />}     label="Statements" />
          <NI k="1099"        icon={<ClipboardCheck size={15} />} label="1099s" />
          <NI k="w9"          icon={<BookOpen size={15} />}     label="W-9s" />
          <NI k="quickbooks"  icon={<TrendingUp size={15} />}   label="QuickBooks" />
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 2, color: 'rgba(255,255,255,0.35)', padding: '12px 12px 6px', textTransform: 'uppercase' }}>Settings</div>
          <NI k="settings"    icon={<Settings size={15} />}     label="Templates" />
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
      <main style={{ flex: 1, overflow: 'auto' }}>
        {view === 'dashboard' && (
          <DashboardView
            stats={stats}
            workOrders={enrichedWOs}
            payments={payments}
            onView={(v) => setView(v as typeof view)}
          />
        )}
        {view === 'workorders' && (
          <WorkOrdersView
            workOrders={enrichedWOs}
            stats={stats}
            contractors={contractors}
            onAdd={() => setModal({ type: 'wo', item: null })}
            onEdit={(w) => setModal({ type: 'wo', item: w })}
            onDelete={deleteWorkOrder}
            onDuplicate={(w) => {
              // Strip identity fields so saveWorkOrder does an INSERT, not UPDATE
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              const { id, created_at, updated_at, paid, remaining, payment_status, ...copy } = w;
              setModal({ type: 'wo', item: { ...copy, wo_number: '' } as WorkOrder });
            }}
            onPay={handlePayWO}
          />
        )}
        {view === 'payments' && (
          <PaymentsView
            payments={payments}
            workOrders={workOrders}
            onAdd={() => setModal({ type: 'payment', item: null })}
            onEdit={(p) => setModal({ type: 'payment', item: p })}
            onDelete={deletePayment}
          />
        )}
        {view === 'payables' && (
          <PayablesView
            workOrders={enrichedWOs}
            contractors={contractors}
            onPay={handlePayWO}
            onQuickPay={() => setModal({ type: 'payment', item: null })}
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
          />
        )}
        {view === 'settings' && (
          <QuestionTemplatesView
            templates={questionTemplates}
            onSave={saveTemplate}
            onDelete={deleteTemplate}
            onUploadAttachment={uploadTemplateAttachment}
          />
        )}
      </main>

      {/* ── Modals ── */}
      {modal?.type === 'wo' && (
        <WorkOrderModal
          item={modal.item}
          contractors={contractors}
          questionTemplates={questionTemplates}
          onSave={(w) => { saveWorkOrder(w); setModal(null); }}
          onClose={() => setModal(null)}
          onSaveTemplate={async (name, qaItems) => {
            await saveTemplate(null, {
              name,
              questions: qaItems.map((q) => ({ id: q.id, label: q.label, type: q.type })),
              attachment_url: null,
            });
          }}
          onUploadDoc={uploadWoDocument}
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
          onSave={(p) => { savePayment(p); setModal(null); }}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
