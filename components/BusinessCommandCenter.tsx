'use client';

import {
  Boxes, BriefcaseBusiness, Building2, CalendarDays, FileChartColumn,
  Search, Users, WalletCards, Plus,
} from 'lucide-react';
import { fmtMoney, todayISO } from '@/lib/utils';
import type {
  Contractor, EnrichedWorkOrder, Invoice, InvoicePayment, Material, Quote,
} from '@/lib/types';

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
    .filter((i) => i.status !== 'paid' && i.status !== 'void')
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
    lowStock: materials.filter((m) => m.low_stock_threshold != null && m.stock_quantity <= m.low_stock_threshold).length,
    completedJobs: workOrders.filter((w) => ['Work Done', 'Approved', 'Paid'].includes(w.wo_status)).length,
  };
}

export default function BusinessCommandCenter({
  workOrders, contractors, materials, quotes, invoices, invoicePayments, onGo, onNewJob, onSearch,
}: {
  workOrders: EnrichedWorkOrder[];
  contractors: Contractor[];
  materials: Material[];
  quotes: Quote[];
  invoices: Invoice[];
  invoicePayments: InvoicePayment[];
  onGo: (view: string) => void;
  onNewJob: () => void;
  onSearch: () => void;
}) {
  const s = businessSnapshot({ workOrders, contractors, materials, quotes, invoices, invoicePayments });
  const cards = [
    { group: 'CRM', title: 'Customers', value: String(s.customers), detail: 'Contacts, history and client portals', view: 'customers', icon: Building2 },
    { group: 'CRM', title: 'Sales', value: String(s.openQuotes), detail: `${fmtMoney(s.openQuoteValue)} in open quotes`, view: 'quotes', icon: BriefcaseBusiness },
    { group: 'ERP', title: 'Jobs', value: String(s.activeJobs), detail: `${s.todayJobs} scheduled today`, view: 'workorders', icon: FileChartColumn },
    { group: 'ERP', title: 'Schedule', value: String(s.inField), detail: 'Jobs in progress now', view: 'scheduling', icon: CalendarDays },
    { group: 'ERP', title: 'Team', value: String(s.activeTechs), detail: 'Active technicians and assignments', view: 'contractors', icon: Users },
    { group: 'ERP', title: 'Money', value: fmtMoney(s.outstandingInvoices), detail: `${s.overdueInvoices} overdue invoice${s.overdueInvoices === 1 ? '' : 's'}`, view: 'financials', icon: WalletCards },
    { group: 'ERP', title: 'Inventory', value: String(s.inventoryItems), detail: `${s.lowStock} item${s.lowStock === 1 ? '' : 's'} low on stock`, view: 'materials', icon: Boxes },
    { group: 'OFFICE', title: 'Reports & admin', value: String(s.completedJobs), detail: 'Completed jobs ready for records', view: 'office', icon: FileChartColumn },
  ] as const;

  return (
    <section aria-label="CRM and ERP command center" className="glass card" style={{ padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--teal)', letterSpacing: 1.6 }}>CRM + ERP</div>
          <h2 className="serif" style={{ fontSize: 25, fontWeight: 600, margin: '3px 0 0' }}>Business command center</h2>
          <p style={{ margin: '4px 0 0', color: '#777', fontSize: 13 }}>Customers, work, people and money, all using the same records.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="wf-btn wf-btn-outline wf-btn-sm" onClick={onSearch}><Search size={14} /> Find anything</button>
          <button className="wf-btn wf-btn-gold wf-btn-sm" onClick={onNewJob}><Plus size={14} /> New job</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(205px, 1fr))', gap: 9 }}>
        {cards.map(({ group, title, value, detail, view, icon: Icon }) => (
          <button
            key={title}
            onClick={() => onGo(view)}
            style={{
              minWidth: 0, textAlign: 'left', cursor: 'pointer', padding: '13px 14px', borderRadius: 13,
              background: 'white', border: '1px solid #eae5d8', boxShadow: '0 1px 6px rgba(0,0,0,0.025)',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13.5, fontWeight: 750 }}>
                <Icon size={16} color="var(--teal)" /> {title}
              </span>
              <span style={{ fontSize: 9.5, fontWeight: 800, color: '#8a8578', letterSpacing: 1 }}>{group}</span>
            </span>
            <span className="serif" style={{ display: 'block', marginTop: 10, fontSize: 24, lineHeight: 1, fontWeight: 650, color: 'var(--teal)', overflowWrap: 'anywhere' }}>{value}</span>
            <span style={{ display: 'block', marginTop: 5, color: '#777', fontSize: 11.5, lineHeight: 1.3 }}>{detail}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
