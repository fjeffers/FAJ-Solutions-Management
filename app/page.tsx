'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { enrichWorkOrders } from '@/lib/utils';
import type { Contractor, WorkOrder, Payment } from '@/lib/types';
import { BarChart3, Briefcase, CreditCard, Users, FileText, TrendingUp, LogOut, Menu, X, BookOpen, ClipboardCheck, Sparkles } from 'lucide-react';

import DashboardView from '@/components/DashboardView';
import WorkOrdersView from '@/components/WorkOrdersView';
import PaymentsView from '@/components/PaymentsView';
import ContractorsView from '@/components/ContractorsView';
import StatementView from '@/components/StatementView';
import TenNinetyNineView from '@/components/TenNinetyNineView';
import W9View from '@/components/W9View';
import QuickBooksView from '@/components/QuickBooksView';
import ContractorModal from '@/components/ContractorModal';
import WorkOrderModal from '@/components/WorkOrderModal';
import PaymentModal from '@/components/PaymentModal';

type View = 'dashboard' | 'workorders' | 'payments' | 'contractors' | 'statements' | '1099' | 'w9' | 'quickbooks';
type Modal =
  | { type: 'contractor'; item: Contractor | null }
  | { type: 'wo'; item: WorkOrder | null }
  | { type: 'payment'; item: Payment | null }
  | null;

export default function HomePage() {
  const router = useRouter();
  const supabase = createClient();
  const [view, setView] = useState<View>('dashboard');
  const [modal, setModal] = useState<Modal>(null);
  const [selectedContractor, setSelectedContractor] = useState<string | null>(null);
  const [taxYear, setTaxYear] = useState<number>(new Date().getFullYear());
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);

  const loadAll = async () => {
    // Auth guard: redirect to login if session is gone client-side
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.replace('/login'); return; }

    const [cRes, wRes, pRes] = await Promise.all([
      supabase.from('contractors').select('*').order('name'),
      supabase.from('work_orders').select('*').order('wo_number'),
      supabase.from('payments').select('*').order('payment_date', { ascending: false }),
    ]);
    if (cRes.data) setContractors(cRes.data);
    if (wRes.data) setWorkOrders(wRes.data);
    if (pRes.data) setPayments(pRes.data);
    setLoading(false);
  };

  useEffect(() => { loadAll(); }, []);

  const enrichedWOs = useMemo(() => enrichWorkOrders(workOrders, payments), [workOrders, payments]);

  const stats = useMemo(() => {
    const total = enrichedWOs.reduce((s, w) => s + Number(w.total_amount), 0);
    const paid = enrichedWOs.reduce((s, w) => s + w.paid, 0);
    return {
      total, paid, remaining: total - paid,
      paidCount: enrichedWOs.filter((w) => w.payment_status === 'paid').length,
      partialCount: enrichedWOs.filter((w) => w.payment_status === 'partial').length,
      pendingCount: enrichedWOs.filter((w) => w.payment_status === 'pending').length,
      jobCount: enrichedWOs.length,
    };
  }, [enrichedWOs]);

  const saveContractor = async (c: Partial<Contractor>) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const payload = {
      name: c.name, phone: c.phone ?? null, email: c.email ?? null, notes: c.notes ?? null,
      business_name: c.business_name ?? null, entity_type: c.entity_type ?? null,
      tax_id: c.tax_id ?? null, tax_id_type: c.tax_id_type ?? null,
      address: c.address ?? null, city: c.city ?? null, state: c.state ?? null, zip: c.zip ?? null,
      w9_received: c.w9_received ?? false, zelle_phone: c.zelle_phone ?? null,
    };
    if (c.id) { await supabase.from('contractors').update(payload).eq('id', c.id); }
    else { await supabase.from('contractors').insert({ ...payload, user_id: user.id }); }
    loadAll();
  };

  const deleteContractor = async (id: string) => { await supabase.from('contractors').delete().eq('id', id); loadAll(); };

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
      // FieldNation status & pay
      wo_status:       w.wo_status       ?? 'Open',
      pay_type:        w.pay_type        ?? 'Fixed',
      hourly_rate:     w.hourly_rate     ?? null,
      hours_worked:    w.hours_worked    ?? null,
      per_device_rate: w.per_device_rate ?? null,
      device_count:    w.device_count    ?? null,
      blended_base:    w.blended_base    ?? null,
      // Site
      site_name:       w.site_name       ?? null,
      site_address:    w.site_address    ?? null,
      site_city:       w.site_city       ?? null,
      site_state:      w.site_state      ?? null,
      site_zip:        w.site_zip        ?? null,
      // Schedule times
      start_time:      w.start_time      ?? null,
      end_time:        w.end_time        ?? null,
      // Scope
      deliverables:    w.deliverables    ?? null,
      service_type:    w.service_type    ?? null,
      required_skills: w.required_skills ?? null,
    };
    if (w.id) { await supabase.from('work_orders').update(payload).eq('id', w.id); }
    else { await supabase.from('work_orders').insert({ ...payload, user_id: user.id }); }
    loadAll();
  };

  const deleteWorkOrder = async (id: string) => { await supabase.from('work_orders').delete().eq('id', id); loadAll(); };

  const savePayment = async (p: Partial<Payment>) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const payload = { wo_number: p.wo_number!, contractor_name: p.contractor_name!, payment_date: p.payment_date!, amount: Number(p.amount), method: p.method || 'Check', notes: p.notes ?? null };
    if (p.id) { await supabase.from('payments').update(payload).eq('id', p.id); }
    else { await supabase.from('payments').insert({ ...payload, user_id: user.id }); }
    loadAll();
  };

  const deletePayment = async (id: string) => { await supabase.from('payments').delete().eq('id', id); loadAll(); };
  const handleLogout = async () => { await supabase.auth.signOut(); router.push('/login'); router.refresh(); };
  const navigate = (key: View) => { setView(key); setMobileNavOpen(false); };

  const NI = ({ k, icon, label }: { k: View; icon: React.ReactNode; label: string }) => (
    <button className={`nav-btn ${view === k ? 'active' : ''}`} onClick={() => navigate(k)}>{icon} {label}</button>
  );

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

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <div className="no-print" id="mobile-header" style={{ display: 'none', position: 'sticky', top: 0, zIndex: 50, padding: '12px 16px', background: 'linear-gradient(135deg, #0D7377 0%, #0a5a5d 100%)', color: 'white', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Sparkles size={16} color="var(--gold-light)" />
          <span className="display" style={{ fontSize: 12, color: 'var(--gold-light)', fontWeight: 700 }}>FAJ SOLUTIONS</span>
        </div>
        <button onClick={() => setMobileNavOpen(!mobileNavOpen)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}>
          {mobileNavOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      <aside className="no-print glass-dark sidebar-desktop" style={{ width: 250, padding: '24px 16px', position: 'sticky', top: 0, height: '100vh', flexDirection: 'column', gap: 2, ...(mobileNavOpen ? { display: 'flex', position: 'fixed', zIndex: 40, width: 260 } : {}) }}>
        <div style={{ padding: '0 12px 20px 12px', borderBottom: '1px solid rgba(255,255,255,0.1)', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <Sparkles size={20} color="var(--gold-light)" />
            <div className="display" style={{ fontSize: 13, color: 'var(--gold-light)', fontWeight: 700 }}>FAJ</div>
          </div>
          <div className="serif" style={{ fontSize: 20, fontWeight: 600, color: 'white', lineHeight: 1.2 }}>Business Manager</div>
        </div>
        <div style={{ fontSize: 9, letterSpacing: 2, color: 'rgba(255,255,255,0.35)', padding: '4px 18px 4px', marginTop: 4 }}>OPERATIONS</div>
        <NI k="dashboard" icon={<BarChart3 size={15} />} label="Dashboard" />
        <NI k="workorders" icon={<Briefcase size={15} />} label="Work Orders" />
        <NI k="payments" icon={<CreditCard size={15} />} label="Payments" />
        <NI k="contractors" icon={<Users size={15} />} label="Contractors" />
        <div style={{ fontSize: 9, letterSpacing: 2, color: 'rgba(255,255,255,0.35)', padding: '12px 18px 4px' }}>REPORTS & TAX</div>
        <NI k="statements" icon={<FileText size={15} />} label="Statements" />
        <NI k="1099" icon={<TrendingUp size={15} />} label="1099 Summary" />
        <NI k="w9" icon={<ClipboardCheck size={15} />} label="W-9 Manager" />
        <NI k="quickbooks" icon={<BookOpen size={15} />} label="QuickBooks" />
        <div style={{ marginTop: 'auto', padding: '16px 12px 0', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
          <button className="btn btn-ghost" onClick={handleLogout} style={{ width: '100%', color: 'var(--gold-light)', borderColor: 'var(--gold-light)', justifyContent: 'center' }}>
            <LogOut size={14} /> Sign Out
          </button>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', textAlign: 'center', marginTop: 10, letterSpacing: 1 }}>CLOUD SYNCED · FAJ SOLUTIONS</div>
        </div>
      </aside>

      <main className="main-content" style={{ flex: 1, padding: '32px 40px', overflow: 'auto', minWidth: 0 }}>
        {view === 'dashboard' && <DashboardView stats={stats} workOrders={enrichedWOs} payments={payments} onView={(v) => setView(v as View)} />}
        {view === 'workorders' && <WorkOrdersView workOrders={enrichedWOs} stats={stats} onAdd={() => setModal({ type: 'wo', item: null })} onEdit={(w) => setModal({ type: 'wo', item: w })} onDelete={deleteWorkOrder} />}
        {view === 'payments' && <PaymentsView payments={payments} workOrders={workOrders} onAdd={() => setModal({ type: 'payment', item: null })} onEdit={(p) => setModal({ type: 'payment', item: p })} onDelete={deletePayment} />}
        {view === 'contractors' && <ContractorsView contractors={contractors} workOrders={enrichedWOs} onAdd={() => setModal({ type: 'contractor', item: null })} onEdit={(c) => setModal({ type: 'contractor', item: c })} onDelete={deleteContractor} onViewStatement={(name) => { setSelectedContractor(name); setView('statements'); }} />}
        {view === 'statements' && <StatementView contractors={contractors} workOrders={enrichedWOs} payments={payments} selected={selectedContractor} setSelected={setSelectedContractor} />}
        {view === '1099' && <TenNinetyNineView contractors={contractors} payments={payments} year={taxYear} setYear={setTaxYear} />}
        {view === 'w9' && <W9View contractors={contractors} onEdit={(c) => setModal({ type: 'contractor', item: c })} />}
        {view === 'quickbooks' && <QuickBooksView payments={payments} workOrders={workOrders} contractors={contractors} />}
      </main>

      {modal?.type === 'contractor' && <ContractorModal item={modal.item} onSave={async (c) => { await saveContractor(c); setModal(null); }} onClose={() => setModal(null)} />}
      {modal?.type === 'wo' && <WorkOrderModal item={modal.item} contractors={contractors} onSave={async (w) => { await saveWorkOrder(w); setModal(null); }} onClose={() => setModal(null)} />}
      {modal?.type === 'payment' && <PaymentModal item={modal.item} workOrders={workOrders} contractors={contractors} onSave={async (p) => { await savePayment(p); setModal(null); }} onClose={() => setModal(null)} />}
    </div>
  );
}
