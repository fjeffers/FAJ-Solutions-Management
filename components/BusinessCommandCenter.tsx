'use client';

import {
  Boxes, BriefcaseBusiness, Building2, CalendarDays, FileChartColumn,
  Search, Users, WalletCards, Plus,
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
    inField: liveJobs.filter((w) => w.wo_status === 'In Progress').length,
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
  workOrders, contractors, materials, quotes, invoices, invoicePayments, home, onGo, onNewJob, onSearch,
}: {
  workOrders: EnrichedWorkOrder[];
  contractors: Contractor[];
  materials: Material[];
  quotes: Quote[];
  invoices: Invoice[];
  invoicePayments: InvoicePayment[];
  home?: HomeLook;
  onGo: (view: string) => void;
  onNewJob: () => void;
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
  const crmCards = [
    { group: 'CRM', title: 'Customers', value: String(savedCustomers ?? s.customers), detail: 'Contacts, history and client portals', view: 'customers', icon: Building2 },
    { group: 'CRM', title: 'Sales', value: String(s.openQuotes), detail: `${fmtMoney(s.openQuoteValue)} in open quotes`, view: 'quotes', icon: BriefcaseBusiness },
  ] as const;
  const erpCards = [
    { group: 'ERP', title: 'Jobs', value: String(s.activeJobs), detail: `${s.todayJobs} scheduled today`, view: 'workorders', icon: FileChartColumn },
    { group: 'ERP', title: 'Schedule', value: String(s.inField), detail: 'Jobs in progress now', view: 'scheduling', icon: CalendarDays },
    { group: 'ERP', title: 'Team', value: String(s.activeTechs), detail: 'Active technicians and assignments', view: 'contractors', icon: Users },
    { group: 'ERP', title: 'Money', value: fmtMoney(s.outstandingInvoices), detail: `${s.overdueInvoices} overdue invoice${s.overdueInvoices === 1 ? '' : 's'}`, view: 'financials', icon: WalletCards },
    { group: 'ERP', title: 'Inventory', value: String(s.inventoryItems), detail: `${s.lowStock} item${s.lowStock === 1 ? '' : 's'} low on stock`, view: 'materials', icon: Boxes },
    { group: 'OFFICE', title: 'Reports & admin', value: String(s.completedJobs), detail: 'Completed jobs ready for records', view: 'office', icon: FileChartColumn },
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
  const cardGrid = (cards: typeof crmCards | typeof erpCards) => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))', gap: 9 }}>
      {cards.map(({ group, title, value, detail, view, icon: Icon }) => (
        <button
          key={title}
          onClick={() => onGo(view)}
          style={{
            minWidth: 0, textAlign: 'left', cursor: 'pointer', padding: '14px', borderRadius: 14,
            color: theme.text, background: theme.card, border: `1px solid ${theme.cardBorder}`,
            backdropFilter: 'blur(10px)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.06)',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13.5, fontWeight: 750 }}>
              <Icon size={16} color={theme.accent} /> {title}
            </span>
            <span style={{ fontSize: 9, fontWeight: 850, color: theme.muted, letterSpacing: 1.2 }}>{group}</span>
          </span>
          <span className="serif" style={{ display: 'block', marginTop: 14, fontSize: 26, lineHeight: 1, fontWeight: 680, color: theme.text, overflowWrap: 'anywhere' }}>{value}</span>
          <span style={{ display: 'block', marginTop: 6, color: theme.muted, fontSize: 11.5, lineHeight: 1.35 }}>{detail}</span>
        </button>
      ))}
    </div>
  );

  return (
    <section aria-label="CRM and ERP command center" style={{
      position: 'relative', overflow: 'hidden', borderRadius: 22, padding: 'clamp(20px, 3vw, 34px)',
      background: theme.hero, color: theme.text, boxShadow: '0 20px 55px rgba(5,20,35,.18)',
      border: `1px solid ${theme.cardBorder}`,
    }}>
      <span aria-hidden style={{
        position: 'absolute', width: 420, height: 420, borderRadius: '50%', right: -160, top: -250,
        background: theme.glow, filter: 'blur(2px)',
      }} />
      <div style={{ position: 'relative', zIndex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 18, flexWrap: 'wrap', marginBottom: 23 }}>
          <div style={{ maxWidth: 690 }}>
            <div style={{ fontSize: 10.5, fontWeight: 850, color: theme.accent, letterSpacing: 2.6 }}>{look.brand}</div>
            <h1 className="serif" style={{ fontSize: 'clamp(29px, 4vw, 46px)', lineHeight: 1.04, fontWeight: 650, margin: '9px 0 0', letterSpacing: '-.02em' }}>{look.title}</h1>
            <p style={{ margin: '10px 0 0', color: theme.muted, fontSize: 'clamp(13px, 1.6vw, 15.5px)', lineHeight: 1.5 }}>{look.subtitle}</p>
          </div>
          <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
            <button onClick={onSearch} style={{
              minHeight: 39, padding: '0 14px', borderRadius: 10, border: `1px solid ${theme.cardBorder}`,
              background: theme.card, color: theme.text, fontWeight: 750, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 7,
            }}><Search size={15} /> Find anything</button>
            <button onClick={onNewJob} style={{
              minHeight: 39, padding: '0 15px', borderRadius: 10, border: 0,
              background: theme.accent, color: look.theme === 'midnight' ? '#1D2630' : look.theme === 'violet' ? '#132A2C' : '#FFFFFF',
              fontWeight: 800, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 7,
            }}><Plus size={15} /> New job</button>
          </div>
        </div>

        <div style={{ marginBottom: 12, padding: '12px 13px', borderRadius: 16, background: 'rgba(0,0,0,.09)', border: `1px solid ${theme.cardBorder}` }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 9 }}>
            <span style={{ fontSize: 10, fontWeight: 850, letterSpacing: 1.6, color: theme.accent }}>FAJ BUSINESS FLOW</span>
            <span style={{ fontSize: 10.5, color: theme.muted }}>From first contact to money collected</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, overflowX: 'auto', paddingBottom: 2 }}>
            {flow.map((step, i) => (
              <span key={step.label} style={{ display: 'contents' }}>
                <button type="button" onClick={() => onGo(step.view)} style={{
                  flex: '1 0 92px', minHeight: 38, borderRadius: 10, border: `1px solid ${theme.cardBorder}`,
                  background: theme.card, color: theme.text, fontSize: 11.5, fontWeight: 780, cursor: 'pointer',
                }}>{step.label}</button>
                {i < flow.length - 1 && <span aria-hidden style={{ color: theme.accent, fontWeight: 900, fontSize: 17 }}>›</span>}
              </span>
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, .72fr) minmax(0, 1.55fr)', gap: 12 }} className="faj-system-grid">
          <section style={{ padding: 12, borderRadius: 17, background: 'rgba(255,255,255,.035)', border: `1px solid ${theme.cardBorder}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '1px 2px 10px' }}>
              <span style={{ width: 27, height: 27, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: theme.card }}><Building2 size={15} color={theme.accent} /></span>
              <span>
                <b style={{ display: 'block', fontSize: 13.5 }}>CRM</b>
                <span style={{ display: 'block', fontSize: 10.5, color: theme.muted }}>Win and keep customers</span>
              </span>
            </div>
            {cardGrid(crmCards)}
          </section>
          <section style={{ padding: 12, borderRadius: 17, background: 'rgba(255,255,255,.035)', border: `1px solid ${theme.cardBorder}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '1px 2px 10px' }}>
              <span style={{ width: 27, height: 27, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: theme.card }}><Boxes size={15} color={theme.accent} /></span>
              <span>
                <b style={{ display: 'block', fontSize: 13.5 }}>ERP</b>
                <span style={{ display: 'block', fontSize: 10.5, color: theme.muted }}>Run the entire operation</span>
              </span>
            </div>
            {cardGrid(erpCards)}
          </section>
        </div>
      </div>
    </section>
  );
}
