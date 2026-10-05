'use client';
import { useState, useMemo, useEffect } from 'react';
import { Printer, Link as LinkIcon, CheckCircle2 } from 'lucide-react';
import { fmtMoney, fmtDate } from '@/lib/utils';
import type { Payment, WorkOrder, Contractor, QuickBooksConnection, QuickBooksAccount } from '@/lib/types';
import QuickBooksCompletedJobsExport from '@/components/QuickBooksCompletedJobsExport';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function QuickBooksConnectionPanel({ connection, onReloaded }: { connection: QuickBooksConnection | null; onReloaded: () => void }) {
  const [accounts, setAccounts] = useState<QuickBooksAccount[]>([]);
  const [expenseId, setExpenseId] = useState(connection?.default_expense_account_id ?? '');
  const [paymentId, setPaymentId] = useState(connection?.default_payment_account_id ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!connection) return;
    fetch('/api/quickbooks/accounts').then((r) => r.json()).then((d) => { if (d.accounts) setAccounts(d.accounts); });
  }, [connection]);

  const saveMapping = async () => {
    const expense = accounts.find((a) => a.id === expenseId);
    const payment = accounts.find((a) => a.id === paymentId);
    if (!expense || !payment) return;
    setSaving(true);
    try {
      await fetch('/api/quickbooks/save-mapping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expense_account_id: expense.id, expense_account_name: expense.name,
          payment_account_id: payment.id, payment_account_name: payment.name,
        }),
      });
      onReloaded();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="glass card no-print" style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: connection ? 16 : 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <LinkIcon size={16} color={connection ? '#047857' : '#aaa'} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 13 }}>
              {connection ? `Connected: ${connection.company_name} (${connection.environment})` : 'QuickBooks not connected'}
            </div>
            {connection && !connection.default_expense_account_id && (
              <div style={{ fontSize: 11, color: '#b45309' }}>Set your account mapping below before syncing payments.</div>
            )}
          </div>
        </div>
        <a href="/api/integrations/quickbooks/connect" className="btn btn-primary" style={{ textDecoration: 'none' }}>
          {connection ? 'Reconnect' : 'Connect QuickBooks'}
        </a>
      </div>

      {connection && accounts.length > 0 && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: '#555', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Expense Account</label>
            <select className="select input" value={expenseId} onChange={(e) => setExpenseId(e.target.value)} style={{ minWidth: 200 }}>
              <option value="">Select…</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: '#555', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Payment (Bank) Account</label>
            <select className="select input" value={paymentId} onChange={(e) => setPaymentId(e.target.value)} style={{ minWidth: 200 }}>
              <option value="">Select…</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <button className="btn btn-ghost" disabled={saving || !expenseId || !paymentId} onClick={saveMapping}>
            {connection.default_expense_account_id ? <CheckCircle2 size={13} /> : null} {saving ? 'Saving…' : 'Save Mapping'}
          </button>
        </div>
      )}
    </div>
  );
}

export default function QuickBooksView({ payments, workOrders, contractors, connection, onReloaded }: { payments: Payment[]; workOrders: WorkOrder[]; contractors: Contractor[]; connection: QuickBooksConnection | null; onReloaded: () => void }) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const [range, setRange] = useState<'year' | 'quarter' | 'month'>('year');
  const [year, setYear] = useState(now.getFullYear());
  const [quarter, setQuarter] = useState(Math.floor(now.getMonth() / 3) + 1);
  const [month, setMonth] = useState(now.getMonth());

  const allYears = useMemo(() => {
    const ys = new Set(payments.map((p) => new Date(p.payment_date).getFullYear()));
    if (!ys.has(currentYear)) ys.add(currentYear);
    return Array.from(ys).sort((a, b) => b - a);
  }, [payments, currentYear]);

  const filtered = useMemo(() => {
    return payments.filter((p) => {
      const d = new Date(p.payment_date);
      const y = d.getFullYear();
      const m = d.getMonth();
      if (y !== year) return false;
      if (range === 'quarter') { const q = Math.floor(m / 3) + 1; return q === quarter; }
      if (range === 'month') return m === month;
      return true;
    });
  }, [payments, year, range, quarter, month]);

  const rangeLabel = range === 'year' ? `FY ${year}` : range === 'quarter' ? `Q${quarter} ${year}` : `${MONTHS[month]} ${year}`;
  const totalPaid = filtered.reduce((s, p) => s + Number(p.amount), 0);

  const monthlyBreakdown = useMemo(() => {
    const months = range === 'year' ? Array.from({length: 12}, (_, i) => i) :
      range === 'quarter' ? [(quarter-1)*3, (quarter-1)*3+1, (quarter-1)*3+2] : [month];
    return months.map((m) => {
      const mPays = filtered.filter((p) => new Date(p.payment_date).getMonth() === m);
      return { month: m, total: mPays.reduce((s, p) => s + Number(p.amount), 0), count: mPays.length };
    });
  }, [filtered, range, quarter, month]);

  const contractorSummary = useMemo(() => {
    return contractors.map((c) => {
      const paid = filtered.filter((p) => p.contractor_name === c.name).reduce((s, p) => s + Number(p.amount), 0);
      return { ...c, paid };
    }).filter((c) => c.paid > 0).sort((a, b) => b.paid - a.paid);
  }, [contractors, filtered]);

  const methodBreakdown = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach((p) => { map[p.method] = (map[p.method] || 0) + Number(p.amount); });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [filtered]);

  return (
    <div className="view-inner" style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ marginBottom: 28 }}>
        <div className="display" style={{ fontSize: 11, color: 'var(--teal)', letterSpacing: 3, marginBottom: 6 }}>EXPORTS</div>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 className="serif" style={{ fontSize: 36, fontWeight: 600, margin: 0, lineHeight: 1 }}>QuickBooks Report</h1>
            <p style={{ margin: '6px 0 0', color: '#666', fontSize: 14 }}>Formatted payment summary for your accountant</p>
          </div>
          <button className="btn btn-gold no-print" onClick={() => window.print()}><Printer size={14} /> Print / Export PDF</button>
        </div>
      </div>

      <QuickBooksConnectionPanel connection={connection} onReloaded={onReloaded} />

      <QuickBooksCompletedJobsExport workOrders={workOrders} />

      <div className="glass card no-print" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: '#555', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Range</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['year', 'quarter', 'month'] as const).map((r) => (
                <button key={r} className={`filter-chip ${range === r ? 'active' : ''}`} onClick={() => setRange(r)}>{r === 'year' ? 'Full Year' : r.charAt(0).toUpperCase() + r.slice(1)}</button>
              ))}
            </div>
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: '#555', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Year</label>
            <select className="select input" value={year} onChange={(e) => setYear(Number(e.target.value))} style={{ width: 100 }}>
              {allYears.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          {range === 'quarter' && (
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: '#555', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Quarter</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {[1,2,3,4].map((q) => <button key={q} className={`filter-chip ${quarter === q ? 'active' : ''}`} onClick={() => setQuarter(q)}>Q{q}</button>)}
              </div>
            </div>
          )}
          {range === 'month' && (
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: '#555', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Month</label>
              <select className="select input" value={month} onChange={(e) => setMonth(Number(e.target.value))} style={{ width: 140 }}>
                {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
              </select>
            </div>
          )}
        </div>
      </div>

      <div style={{ background: 'white', padding: '40px 48px', borderRadius: 16, boxShadow: '0 8px 32px rgba(0,0,0,0.08)', maxWidth: 1000, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32, paddingBottom: 24, borderBottom: '2px solid var(--gold)' }}>
          <div>
            <div className="display" style={{ fontSize: 13, color: 'var(--gold)', marginBottom: 4 }}>FAJ SOLUTIONS</div>
            <div style={{ fontSize: 12, color: '#888' }}>fajsolutions@gmail.com</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="serif" style={{ fontSize: 32, fontWeight: 600, color: 'var(--ink)', lineHeight: 1 }}>Payment Report</div>
            <div style={{ fontSize: 13, color: 'var(--teal)', fontWeight: 700, marginTop: 6 }}>{rangeLabel}</div>
            <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>Generated {fmtDate(new Date().toISOString())}</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, marginBottom: 32 }}>
          {[
            { label: 'Total Disbursed', value: fmtMoney(totalPaid) },
            { label: 'Transactions', value: String(filtered.length) },
            { label: 'Contractors', value: String(contractorSummary.length) },
          ].map((k) => (
            <div key={k.label} style={{ textAlign: 'center', padding: '16px', background: 'rgba(14,27,46,0.04)', borderRadius: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, color: '#aaa', textTransform: 'uppercase', marginBottom: 6 }}>{k.label}</div>
              <div className="serif" style={{ fontSize: 26, fontWeight: 600, color: 'var(--teal)' }}>{k.value}</div>
            </div>
          ))}
        </div>

        <Section title="Monthly Breakdown">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--teal)', color: 'white' }}>
                {['Month', 'Transactions', 'Total Paid'].map((h, i) => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: i === 2 ? 'right' : 'left', fontSize: 10, fontWeight: 700, letterSpacing: 1 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {monthlyBreakdown.filter((r) => r.total > 0).map((r) => (
                <tr key={r.month} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '10px 12px' }}>{MONTHS[r.month]}</td>
                  <td style={{ padding: '10px 12px', color: '#666' }}>{r.count}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600 }}>{fmtMoney(r.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title="Contractor Summary">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--teal)', color: 'white' }}>
                {['Contractor', 'Entity Type', 'Tax ID', 'Total Paid', '1099'].map((h, i) => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: i === 3 ? 'right' : 'left', fontSize: 10, fontWeight: 700, letterSpacing: 1 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {contractorSummary.map((c) => (
                <tr key={c.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 600 }}>{c.name}</td>
                  <td style={{ padding: '10px 12px', color: '#666' }}>{c.entity_type || '—'}</td>
                  <td style={{ padding: '10px 12px', color: '#666', fontFamily: 'monospace', fontSize: 12 }}>{c.tax_id || '—'}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700 }}>{fmtMoney(c.paid)}</td>
                  <td style={{ padding: '10px 12px' }}>{c.paid >= 600 ? <span style={{ background: 'rgba(239,68,68,0.12)', color: '#b91c1c', padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700 }}>REQUIRED</span> : <span style={{ color: '#aaa', fontSize: 11 }}>N/A</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title="Payment Methods">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--teal)', color: 'white' }}>
                {['Method', 'Total'].map((h, i) => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: i === 1 ? 'right' : 'left', fontSize: 10, fontWeight: 700, letterSpacing: 1 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {methodBreakdown.map(([method, total]) => (
                <tr key={method} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '10px 12px' }}>{method}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600 }}>{fmtMoney(total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title={`All Transactions — ${rangeLabel}`}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--teal)', color: 'white' }}>
                {['Date', 'Contractor', 'WO #', 'Method', 'Notes', 'Amount'].map((h, i) => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: i === 5 ? 'right' : 'left', fontSize: 10, fontWeight: 700, letterSpacing: 1 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...filtered].sort((a, b) => new Date(a.payment_date).getTime() - new Date(b.payment_date).getTime()).map((p, idx) => (
                <tr key={p.id} style={{ borderBottom: '1px solid #eee', background: idx % 2 === 1 ? '#fafafa' : undefined }}>
                  <td style={{ padding: '8px 12px', color: '#555' }}>{fmtDate(p.payment_date)}</td>
                  <td style={{ padding: '8px 12px' }}>{p.contractor_name}</td>
                  <td style={{ padding: '8px 12px', color: 'var(--teal)', fontWeight: 700 }}>#{p.wo_number}</td>
                  <td style={{ padding: '8px 12px', color: '#666' }}>{p.method}</td>
                  <td style={{ padding: '8px 12px', color: '#888' }}>{p.notes || '—'}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>{fmtMoney(Number(p.amount))}</td>
                </tr>
              ))}
              <tr style={{ background: 'rgba(14,27,46,0.08)', fontWeight: 700, borderTop: '2px solid var(--teal)' }}>
                <td colSpan={5} style={{ padding: '10px 12px', textAlign: 'right', fontSize: 12 }}>TOTAL</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--teal)', fontSize: 14 }}>{fmtMoney(totalPaid)}</td>
              </tr>
            </tbody>
          </table>
        </Section>

        <div style={{ textAlign: 'center', marginTop: 40, paddingTop: 20, borderTop: '1px solid rgba(201,162,75,0.3)', fontSize: 11, color: '#aaa', fontStyle: 'italic' }}>
          FAJ Solutions · {rangeLabel} · Generated {fmtDate(new Date().toISOString())}<br />
          For accounting purposes only. Verify all figures before filing.
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, color: 'var(--teal)', textTransform: 'uppercase', marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid rgba(201,162,75,0.4)' }}>{title}</div>
      {children}
    </div>
  );
}
