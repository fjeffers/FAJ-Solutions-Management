'use client';

import {
  Boxes, BriefcaseBusiness, Building2, CalendarDays, FileChartColumn,
  Search, Users, WalletCards, Plus, Bell, ArrowUpRight, Gauge, Sparkles, ClipboardCheck, Radio,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { fmtMoney, todayISO } from '@/lib/utils';
import type {
  Contractor, EnrichedWorkOrder, Invoice, InvoicePayment, Material, Quote,
} from '@/lib/types';
import { normalizeHomeLook, type HomeLook } from '@/lib/app-layout';

export type BusinessSnapshot = {
  customers: number;
  openQuotes: number;
  openQuoteValue: number;
  activeJobs: number;
  todayJobs: number;
  inField: number;
  activeTechs: number;
  outstandingInvoices: number;
  overdueInvoices: number;
  inventoryItems: number;
  lowStock: number;
  completedJobs: number;
};

export function businessSnapshot({
  workOrders, contractors, materials, quotes, invoices, invoicePayments, today = todayISO(),
}: {
  workOrders: EnrichedWorkOrder[];
  contractors: Contractor[];
  materials: Material[];
  quotes: Quote[];
  invoices: Invoice[];
  invoicePayments: InvoicePayment[];
  today?: string;
}): BusinessSnapshot {
  const customers = new Set(
    [
      ...workOrders.map((w) => w.customer_name),
      ...quotes.map((q) => q.client_name),
      ...invoices.map((i) => i.client_name),
    ]
      .map((name) => String(name ?? '').trim().toLowerCase())
      .filter(Boolean),
  );
  const openQuotes = quotes.filter((q) => q.status === 'draft' || q.status === 'sent');
  const liveJobs = workOrders.filter((w) => !w.archived_at && w.wo_status !== 'Paid');
  const paidByInvoice = new Map<string, number>();
  for (const payment of invoicePayments) {
    paidByInvoice.set(payment.invoice_id, (paidByInvoice.get(payment.invoice_id) ?? 0) + Number(payment.amount || 0));
  }
  const openInvoices = invoices
    .filter((i) => i.status === 'sent')
    .map((i) => ({ invoice: i, due: Math.max(0, Number(i.total || 0) - (paidByInvoice.get(i.id) ?? 0)) }))
    .filter((i) => i.due > 0);

  return {
    customers: customers.size,
    openQuotes: openQuotes.length,
    openQuoteValue: openQuotes.reduce((sum, q) => sum + Number(q.total || 0), 0),
    activeJobs: liveJobs.length,
    todayJobs: liveJobs.filter((w) => (w.scheduled_date || w.start_date) === today).length,
    inField: liveJobs.filter(
      (w) => w.wo_status === 'In Progress' && (w.scheduled_date || w.start_date) === today,
    ).length,
    activeTechs: contractors.filter((c) => !c.on_hold).length,
    outstandingInvoices: openInvoices.reduce((sum, i) => sum + i.due, 0),
    overdueInvoices: openInvoices.filter(({ invoice }) => !!invoice.due_date && invoice.due_date < today).length,
    inventoryItems: materials.length,
    lowStock: materials.filter((m) =>
      m.stock_quantity <= 0 || (m.low_stock_threshold != null && m.stock_quantity <= m.low_stock_threshold)
    ).length,
    completedJobs: workOrders.filter((w) => ['Work Done', 'Approved', 'Paid'].includes(w.wo_status)).length,
  };
}

export default function BusinessCommandCenter({
  workOrders, contractors, materials, quotes, invoices, invoicePayments, home, ownerName = 'Frederick Jeffers',
  onGo, onNewJob, onAI, onSearch,
}: {
  workOrders: EnrichedWorkOrder[];
  contractors: Contractor[];
  materials: Material[];
  quotes: Quote[];
  invoices: Invoice[];
  invoicePayments: InvoicePayment[];
  home?: HomeLook;
  ownerName?: string;
  onGo: (view: string) => void;
  onNewJob: () => void;
  onAI: () => void;
  onSearch: () => void;
}) {
  const look = normalizeHomeLook(home);
  const s = businessSnapshot({ workOrders, contractors, materials, quotes, invoices, invoicePayments });
  const [savedCustomers, setSavedCustomers] = useState<number | null>(null);
  useEffect(() => {
    const db = createClient();
    const load = () => {
      void db.from('customers').select('id', { count: 'exact', head: true })
        .then(({ count, error }) => { if (!error) setSavedCustomers(count ?? 0); });
    };
    load();
    const timer = window.setInterval(load, 30_000);
    window.addEventListener('focus', load);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', load);
    };
  }, []);
  const availableAppCards = [
    { key: 'attention', group: 'TODAY', title: 'Waiting on you', detail: 'Inbox, approvals and invoices', view: 'attention', icon: Bell },
    { key: 'followups', group: 'CRM', title: 'Follow-up', detail: 'Quotes, clients and technician replies', view: 'followups', icon: ClipboardCheck },
    { key: 'field', group: 'FIELD', title: 'In the field', detail: 'Live work and upcoming visits', view: 'field', icon: Radio },
    { key: 'customers', group: 'CRM', title: 'Customers', value: String(savedCustomers ?? s.customers), detail: 'Contacts, history and client portals', view: 'customers', icon: Building2 },
    { key: 'quotes', group: 'CRM', title: 'Sales', value: String(s.openQuotes), detail: `${fmtMoney(s.openQuoteValue)} in open quotes`, view: 'quotes', icon: BriefcaseBusiness },
    { key: 'workorders', group: 'ERP', title: 'Jobs', value: String(s.activeJobs), detail: `${s.todayJobs} scheduled today`, view: 'workorders', icon: FileChartColumn },
    { key: 'scheduling', group: 'ERP', title: 'Schedule', value: String(s.inField), detail: 'Jobs in progress now', view: 'scheduling', icon: CalendarDays },
    { key: 'contractors', group: 'ERP', title: 'Team', value: String(s.activeTechs), detail: 'Active technicians and assignments', view: 'contractors', icon: Users },
    { key: 'financials', group: 'ERP', title: 'Money', value: fmtMoney(s.outstandingInvoices), detail: `${s.overdueInvoices} overdue invoice${s.overdueInvoices === 1 ? '' : 's'}`, view: 'financials', icon: WalletCards },
    { key: 'materials', group: 'ERP', title: 'Inventory', value: String(s.inventoryItems), detail: `${s.lowStock} item${s.lowStock === 1 ? '' : 's'} low on stock`, view: 'materials', icon: Boxes },
    { key: 'office', group: 'OFFICE', title: 'Reports & admin', value: String(s.completedJobs), detail: 'Completed jobs ready for records', view: 'office', icon: FileChartColumn },
    { key: 'ai', group: 'AI', title: 'AI generator', detail: 'Build a work order from files or notes', view: 'ai', icon: Sparkles },
    { key: 'new-job', group: 'CREATE', title: 'New job', detail: 'Start and assign new work', view: 'new-job', icon: Plus },
  ] as const;
  const appCards = look.tiles.flatMap((key) => {
    const card = availableAppCards.find((item) => item.key === key);
    return card ? [card] : [];
  });
  const kpis = [
    { label: 'Customers', value: String(savedCustomers ?? s.customers), detail: 'CRM records', view: 'customers', icon: Building2 },
    { label: 'Open jobs', value: String(s.activeJobs), detail: `${s.todayJobs} today`, view: 'workorders', icon: BriefcaseBusiness },
    { label: 'In the field', value: String(s.inField), detail: 'Live now', view: 'field', icon: Gauge },
    { label: 'Open quotes', value: fmtMoney(s.openQuoteValue), detail: `${s.openQuotes} proposals`, view: 'quotes', icon: FileChartColumn },
    { label: 'Outstanding', value: fmtMoney(s.outstandingInvoices), detail: `${s.overdueInvoices} overdue`, view: 'financials', icon: WalletCards },
    { label: 'Inventory', value: String(s.inventoryItems), detail: `${s.lowStock} low stock`, view: 'materials', icon: Boxes },
  ] as const;
  const liveStatus = [
    { label: "Jobs on today's schedule", value: String(s.todayJobs), view: 'scheduling', tone: '#39D5FF' },
    { label: 'Work happening now', value: String(s.inField), view: 'field', tone: '#57E6A5' },
    { label: 'Invoices needing attention', value: String(s.overdueInvoices), view: 'financials', tone: '#FFB74D' },
    { label: 'Inventory needing attention', value: String(s.lowStock), view: 'materials', tone: '#FF6B7A' },
  ] as const;
  const themes = {
    midnight: {
      hero: 'linear-gradient(125deg, #061426 0%, #0D2F45 58%, #174C5F 100%)',
      glow: 'rgba(217,175,85,.26)', accent: '#E5BD66', text: '#FFFFFF', muted: 'rgba(255,255,255,.72)',
      card: 'rgba(255,255,255,.085)', cardBorder: 'rgba(255,255,255,.14)',
    },
    violet: {
      hero: 'linear-gradient(125deg, #150E2A 0%, #37216F 56%, #245F68 100%)',
      glow: 'rgba(136,101,255,.34)', accent: '#79E0CF', text: '#FFFFFF', muted: 'rgba(255,255,255,.74)',
      card: 'rgba(255,255,255,.09)', cardBorder: 'rgba(255,255,255,.16)',
    },
    light: {
      hero: 'linear-gradient(125deg, #F8F4E9 0%, #FFFFFF 54%, #E3F2F2 100%)',
      glow: 'rgba(14,86,103,.15)', accent: '#0E5667', text: '#10283A', muted: '#5E6A70',
      card: 'rgba(255,255,255,.7)', cardBorder: 'rgba(14,86,103,.14)',
    },
  } as const;
  const theme = themes[look.theme];
  const flow = [
    { label: 'Lead', view: 'surveys' },
    { label: 'Quote', view: 'quotes' },
    { label: 'Contract', view: 'contracts' },
    { label: 'Job', view: 'workorders' },
    { label: 'Dispatch', view: 'scheduling' },
    { label: 'Invoice', view: 'financials' },
    { label: 'Paid', view: 'financials' },
  ] as const;

  return (
    <section aria-label="CRM and ERP command center" style={{
      position: 'relative', overflow: 'hidden', borderRadius: 24, padding: 14,
      background: 'linear-gradient(145deg, #031326 0%, #061E36 52%, #04182C 100%)',
      color: '#FFFFFF', boxShadow: '0 24px 70px rgba(0,16,35,.28)',
      border: '1px solid rgba(38,179,255,.24)',
    }}>
      <div style={{ position: 'relative', zIndex: 1 }}>
        <div className="faj-enterprise-topbar" style={{
          display: 'grid', gridTemplateColumns: 'minmax(180px, .55fr) minmax(280px, 1.5fr) auto',
          alignItems: 'center', gap: 12, padding: '5px 5px 14px',
        }}>
          <img src="/wf/logo-wide.png" alt={look.brand} style={{ width: 185, maxWidth: '100%', height: 'auto', display: 'block' }} />
          <button onClick={onSearch} style={{
            minHeight: 44, width: '100%', padding: '0 16px', borderRadius: 22,
            border: '1px solid rgba(52,200,184,.38)', background: 'rgba(2,20,39,.72)',
            color: 'rgba(230,243,255,.72)', cursor: 'pointer', display: 'flex', alignItems: 'center',
            gap: 9, textAlign: 'left', boxShadow: 'inset 0 0 22px rgba(28,179,193,.05)',
          }}><Search size={17} color="#E5BD66" /> Search jobs, customers, invoices, technicians...</button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onAI} style={{
              minHeight: 40, padding: '0 13px', borderRadius: 10, border: '1px solid rgba(229,189,102,.4)',
              background: 'rgba(229,189,102,.08)', color: '#E5BD66', fontWeight: 780, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 7,
            }}><Sparkles size={15} /> AI generator</button>
            <button onClick={onNewJob} style={{
              minHeight: 40, padding: '0 14px', borderRadius: 10, border: 0,
              background: '#E5BD66', color: '#102033', fontWeight: 850, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 7,
            }}><Plus size={15} /> New job</button>
          </div>
        </div>
        <div style={{
          minHeight: 226, padding: 'clamp(22px, 4vw, 43px)', borderRadius: 18, overflow: 'hidden',
          display: 'flex', alignItems: 'center', position: 'relative',
          backgroundImage: 'linear-gradient(90deg, rgba(1,15,31,.97) 0%, rgba(3,26,48,.87) 48%, rgba(3,25,46,.28) 100%), url(/wf/faj-mountain-hero.jpg)',
          backgroundSize: 'cover', backgroundPosition: 'center',
          border: '1px solid rgba(44,188,255,.32)', boxShadow: 'inset 0 0 55px rgba(0,145,255,.11)',
        }}>
          <div aria-hidden style={{
            position: 'absolute', right: '4%', bottom: '10%', maxWidth: '48%', textAlign: 'right',
            fontSize: 'clamp(28px, 5vw, 68px)', lineHeight: .9, fontWeight: 900, letterSpacing: '.08em',
            color: 'rgba(255,255,255,.15)', textShadow: '0 0 28px rgba(52,200,184,.35)',
          }}>NEVER<br />GIVE UP</div>
          <div className="faj-summit-flag" aria-hidden>
            <span className="faj-summit-flag-pole" />
            <span className="faj-summit-flag-cloth">
              <img src="/wf/logo-wide.png" alt="" />
            </span>
          </div>
          <div style={{ maxWidth: 690, position: 'relative', zIndex: 1 }}>
            <div style={{ fontSize: 10.5, fontWeight: 850, color: '#E5BD66', letterSpacing: 2.6 }}>FAJ SOLUTIONS · CRM + ERP WORKSPACE</div>
            <h1 style={{ fontSize: 'clamp(31px, 4.4vw, 52px)', lineHeight: 1.02, fontWeight: 760, margin: '10px 0 0', letterSpacing: '-.035em' }}>Welcome back, {ownerName}.</h1>
            <p style={{ margin: '11px 0 0', color: 'rgba(230,243,255,.78)', fontSize: 'clamp(13px, 1.6vw, 16px)', lineHeight: 1.5 }}>
              <strong style={{ color: '#FFFFFF' }}>{look.title}</strong><br />{look.subtitle}
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 20 }}>
              <span style={{ padding: '7px 10px', borderRadius: 999, background: 'rgba(52,200,184,.12)', border: '1px solid rgba(52,200,184,.3)', color: '#7BE0D0', fontSize: 10.5, fontWeight: 750 }}>Live business control</span>
              <span style={{ padding: '7px 10px', borderRadius: 999, background: 'rgba(229,189,102,.1)', border: '1px solid rgba(229,189,102,.3)', color: '#E5BD66', fontSize: 10.5, fontWeight: 750 }}>One FAJ system</span>
            </div>
          </div>
        </div>

        <div className="faj-kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 9, marginTop: 11 }}>
          {kpis.map(({ label, value, detail, view, icon: Icon }) => (
            <button key={label} onClick={() => onGo(view)} style={{
              minWidth: 0, textAlign: 'left', cursor: 'pointer', padding: '13px 12px', borderRadius: 14,
              color: '#FFFFFF', background: 'linear-gradient(145deg, rgba(8,52,88,.94), rgba(5,31,56,.96))',
              border: '1px solid rgba(39,186,255,.35)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.06), 0 8px 22px rgba(0,9,23,.18)',
            }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 7, color: '#7BE0D0', fontSize: 10.5, fontWeight: 760 }}><Icon size={15} /> {label}</span>
              <strong style={{ display: 'block', fontSize: 21, lineHeight: 1, marginTop: 10, overflowWrap: 'anywhere' }}>{value}</strong>
              <span style={{ display: 'block', marginTop: 5, color: 'rgba(221,239,255,.68)', fontSize: 10.5 }}>{detail}</span>
            </button>
          ))}
        </div>

        <div style={{ marginTop: 11, padding: '11px 13px', borderRadius: 14, background: 'rgba(4,28,51,.9)', border: '1px solid rgba(39,186,255,.25)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 9 }}>
            <span style={{ fontSize: 10, fontWeight: 850, letterSpacing: 1.6, color: '#E5BD66' }}>CONNECTED BUSINESS FLOW</span>
            <span style={{ fontSize: 10.5, color: 'rgba(221,239,255,.64)' }}>From first contact to money collected</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, overflowX: 'auto', paddingBottom: 2 }}>
            {flow.map((step, i) => (
              <span key={step.label} style={{ display: 'contents' }}>
                <button type="button" onClick={() => onGo(step.view)} style={{
                  flex: '1 0 92px', minHeight: 36, borderRadius: 10, border: '1px solid rgba(39,186,255,.28)',
                  background: 'rgba(9,48,80,.9)', color: '#FFFFFF', fontSize: 11.5, fontWeight: 780, cursor: 'pointer',
                }}>{step.label}</button>
                {i < flow.length - 1 && <span aria-hidden style={{ color: '#E5BD66', fontWeight: 900, fontSize: 17 }}>›</span>}
              </span>
            ))}
          </div>
        </div>

        <div className="faj-enterprise-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2.25fr) minmax(250px, .75fr)', gap: 11, marginTop: 11 }}>
          <section style={{ padding: 14, borderRadius: 16, background: 'rgba(4,28,51,.92)', border: '1px solid rgba(39,186,255,.25)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 11 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 800 }}><Boxes size={17} color="#E5BD66" /> Applications</span>
              <span style={{ color: '#7BE0D0', fontSize: 10.5 }}>CRM + ERP workspace</span>
            </div>
            <div className="faj-app-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
              {appCards.map(({ group, title, detail, view, icon: Icon }) => (
                <button key={title} onClick={() => view === 'ai' ? onAI() : view === 'new-job' ? onNewJob() : onGo(view)} style={{
                  minWidth: 0, minHeight: 91, padding: '12px 10px', borderRadius: 12, cursor: 'pointer',
                  color: '#FFFFFF', background: 'linear-gradient(145deg, rgba(9,54,89,.96), rgba(5,35,63,.96))',
                  border: '1px solid rgba(39,186,255,.28)', textAlign: 'left',
                }}>
                  <span style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                    <span style={{ width: 29, height: 29, borderRadius: 9, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(52,200,184,.12)', color: '#7BE0D0' }}><Icon size={16} /></span>
                    <span style={{ fontSize: 8.5, color: '#E5BD66', fontWeight: 850, letterSpacing: 1 }}>{group}</span>
                  </span>
                  <b style={{ display: 'block', fontSize: 12.5, marginTop: 10 }}>{title}</b>
                  <span style={{ display: 'block', color: 'rgba(221,239,255,.6)', fontSize: 9.5, lineHeight: 1.3, marginTop: 3 }}>{detail}</span>
                </button>
              ))}
            </div>
          </section>
          <section style={{ padding: 14, borderRadius: 16, background: 'rgba(4,28,51,.92)', border: '1px solid rgba(39,186,255,.25)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 11 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 800 }}><Bell size={17} color="#E5BD66" /> My Day</span>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#52E6A7', boxShadow: '0 0 12px #52E6A7' }} />
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              {liveStatus.map((item) => (
                <button key={item.label} onClick={() => onGo(item.view)} style={{
                  display: 'grid', gridTemplateColumns: '8px 1fr auto', alignItems: 'center', gap: 9, width: '100%',
                  minHeight: 47, padding: '8px 10px', borderRadius: 11, cursor: 'pointer', color: '#FFFFFF',
                  background: 'rgba(9,49,81,.78)', border: '1px solid rgba(39,186,255,.2)', textAlign: 'left',
                }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: item.tone, boxShadow: `0 0 10px ${item.tone}` }} />
                  <span style={{ fontSize: 10.5, color: 'rgba(230,243,255,.75)' }}>{item.label}</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 850, fontSize: 14 }}>{item.value}<ArrowUpRight size={12} color="#7BE0D0" /></span>
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
