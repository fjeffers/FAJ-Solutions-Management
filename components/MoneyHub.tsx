'use client';
// The Financials dashboard (Fred, 2026-10-24: "payment made, Financials, and
// ledger all pretty the same thing combine it and call it Financials dashboard
// so it see payment received payed ... all under one page"; "can i have all
// money under one place financials dashboard including pay tech").
//
// One menu entry, one page: the money in and out across the top, and a tab for
// each money screen underneath. The screens themselves are the same ones as
// before (Financials, Invoices, Payments Made, Pay Techs, Ledger), so nothing
// they do changes; links straight to one of them still land on its tab.
import { useMemo } from 'react';
import { fmtMoney } from '@/lib/utils';
import { moneyTotals } from '@/lib/payables';
import type { Invoice, InvoicePayment, Payment, WorkOrder } from '@/lib/types';

export const MONEY_TABS = [
  { view: 'financials', label: 'Overview' },
  { view: 'invoices', label: 'Invoices & money in' },
  { view: 'payables', label: 'Pay Techs' },
  { view: 'payments', label: 'Paid to techs' },
  { view: 'ledger', label: 'Ledger' },
] as const;
export type MoneyView = (typeof MONEY_TABS)[number]['view'];
export const isMoneyView = (v: string): v is MoneyView => MONEY_TABS.some((t) => t.view === v);

export function MoneyHub({ view, onGo, invoices, invoicePayments, payments, workOrders }: {
  view: MoneyView; onGo: (v: MoneyView) => void;
  invoices: Invoice[]; invoicePayments: InvoicePayment[]; payments: Payment[]; workOrders: WorkOrder[];
}) {
  const year = String(new Date().getFullYear());
  const t = useMemo(() => moneyTotals({ invoices, invoicePayments, payments, workOrders, year }), [invoices, invoicePayments, payments, workOrders, year]);
  const tiles: { label: string; value: number; tab: MoneyView; color: string }[] = [
    { label: `Money in, ${year}`, value: t.receivedYtd, tab: 'invoices', color: '#047857' },
    { label: 'Clients owe', value: t.clientsOwe, tab: 'invoices', color: 'var(--teal, #0E1B2E)' },
    { label: `Paid to techs, ${year}`, value: t.paidOutYtd, tab: 'payments', color: '#4338ca' },
    { label: 'Techs are owed', value: t.techsOwed, tab: 'payables', color: t.techsOwed > 0 ? '#b45309' : '#047857' },
    { label: `Kept, ${year}`, value: Math.round((t.receivedYtd - t.paidOutYtd) * 100) / 100, tab: 'financials', color: t.receivedYtd >= t.paidOutYtd ? '#047857' : '#b91c1c' },
  ];
  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '16px 16px 0' }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 2px' }}>Financials dashboard</h1>
      <div style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>All the money in one place: what clients paid and owe, what techs were paid and are owed.</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginBottom: 12 }}>
        {tiles.map((x) => (
          <button key={x.label} type="button" onClick={() => onGo(x.tab)} className="glass card"
            style={{ padding: '12px 16px', textAlign: 'left', border: 0, cursor: 'pointer', background: undefined }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: '#888', marginBottom: 4 }}>{x.label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: x.color }}>{fmtMoney(x.value)}</div>
          </button>
        ))}
      </div>
      <div role="tablist" aria-label="Money" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', borderBottom: '1px solid #E4DFD3', paddingBottom: 8 }}>
        {MONEY_TABS.map((tab) => (
          <button key={tab.view} type="button" role="tab" aria-selected={view === tab.view} onClick={() => onGo(tab.view)}
            className={`btn ${view === tab.view ? 'btn-primary' : 'btn-ghost'}`} style={{ padding: '7px 14px', fontSize: 13 }}>
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}
