'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  fetchAccountantMe, fetch1099, fetchPayouts, fetchInvoices, fetchReceived, fetchJobs, revealTaxId,
  summarize1099, jobMoney, jobsTotals, sum, toCsv, downloadCsv,
  type AccountantMe, type Row1099, type TechPayout, type AcctInvoice, type AcctReceived,
} from '@/lib/accountant';
import { form1099Threshold, needs1099, thresholdNeedsCheck, maskTaxId } from '@/lib/tax1099';
import { staffReasonText } from '@/lib/assistant';
import { fmtMoney, fmtDate } from '@/lib/utils';
import { useInactivityLogout } from '@/lib/useInactivityLogout';
import { toastError } from '@/lib/toast';
import Toaster from '@/components/Toaster';
import type { WorkOrder } from '@/lib/types';
import { Calculator, LogOut, FileText, Wallet, Receipt, Briefcase, Download, Eye, AlertTriangle, CheckCircle2 } from 'lucide-react';

type Tab = '1099' | 'payouts' | 'income' | 'jobs';

export default function AccountantPage() {
  const router = useRouter();
  const supabase = createClient();
  const thisYear = new Date().getFullYear();

  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [me, setMe] = useState<AccountantMe | null>(null);
  const [tab, setTab] = useState<Tab>('1099');
  const [year, setYear] = useState(thisYear);
  const [busy, setBusy] = useState(false);

  const [rows1099, setRows1099] = useState<Row1099[]>([]);
  const [payouts, setPayouts] = useState<TechPayout[]>([]);
  const [invoices, setInvoices] = useState<AcctInvoice[]>([]);
  const [received, setReceived] = useState<AcctReceived[]>([]);
  const [jobs, setJobs] = useState<WorkOrder[]>([]);

  const signOut = async () => {
    await supabase.auth.signOut({ scope: 'local' });
    router.replace('/accountant/login');
  };
  useInactivityLogout(signOut);

  const loadYear = async (y: number) => {
    setBusy(true);
    try {
      const [a, b, c, d, e] = await Promise.all([fetch1099(y), fetchPayouts(y), fetchInvoices(y), fetchReceived(y), fetchJobs(y)]);
      setRows1099(a); setPayouts(b); setInvoices(c); setReceived(d); setJobs(e);
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Could not load that year.');
    } finally { setBusy(false); }
  };

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace('/accountant/login'); return; }
      try {
        const who = await fetchAccountantMe();
        if (!who) { setDenied(true); setLoading(false); return; }
        setMe(who);
        await loadYear(thisYear);
      } catch { setDenied(true); }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeYear = (y: number) => { setYear(y); loadYear(y); };

  if (loading) {
    return <Centered><Calculator size={26} color="var(--gold)" style={{ marginBottom: 12 }} /><div className="serif" style={{ fontSize: 20, color: 'var(--teal)' }}>Loading…</div></Centered>;
  }
  if (denied) {
    return (
      <Centered>
        <div className="glass card" style={{ maxWidth: 420, padding: 32, textAlign: 'center' }}>
          <Calculator size={26} color="#bbb" style={{ marginBottom: 10 }} />
          <div className="serif" style={{ fontSize: 22, marginBottom: 8 }}>Not an accountant account</div>
          <p style={{ color: '#666', fontSize: 13, lineHeight: 1.6, margin: '0 0 18px' }}>
            You&apos;re signed in, but this login isn&apos;t set up as an accountant, or it has been turned off. Ask Fred.
          </p>
          <button className="btn btn-primary" onClick={signOut}>Sign out</button>
        </div>
      </Centered>
    );
  }

  const years = [thisYear, thisYear - 1, thisYear - 2];

  return (
    <div style={{ minHeight: '100vh', paddingBottom: 40 }}>
      <Toaster />
      <header style={{ background: 'linear-gradient(135deg, #1c2833 0%, #0E1B2E 100%)', color: 'white', padding: '18px 16px 0', position: 'sticky', top: 0, zIndex: 20 }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <Calculator size={15} color="var(--gold-light)" />
              <span className="display" style={{ fontSize: 10, color: 'var(--gold-light)', fontWeight: 700, letterSpacing: 1.5 }}>FAJ SOLUTIONS · ACCOUNTANT · READ-ONLY</span>
            </div>
            <div className="serif" style={{ fontSize: 21, fontWeight: 600 }}>{me?.name}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label htmlFor="yr" style={{ fontSize: 12, opacity: 0.85 }}>Tax year</label>
            <select id="yr" className="select input" value={year} onChange={(e) => changeYear(Number(e.target.value))} style={{ width: 96 }}>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <button onClick={signOut} style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: 'white', cursor: 'pointer', borderRadius: 999, padding: '8px 13px', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700 }}>
              <LogOut size={14} /> Sign out
            </button>
          </div>
        </div>
        <nav style={{ maxWidth: 1100, margin: '14px auto 0', display: 'flex', gap: 4, overflowX: 'auto' }}>
          <TabBtn active={tab === '1099'} onClick={() => setTab('1099')} icon={<FileText size={15} />} label="1099s & W-9s" />
          <TabBtn active={tab === 'payouts'} onClick={() => setTab('payouts')} icon={<Wallet size={15} />} label="Paid to techs" />
          <TabBtn active={tab === 'income'} onClick={() => setTab('income')} icon={<Receipt size={15} />} label="Income" />
          <TabBtn active={tab === 'jobs'} onClick={() => setTab('jobs')} icon={<Briefcase size={15} />} label="Jobs" />
        </nav>
      </header>

      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '18px 16px 0', opacity: busy ? 0.55 : 1, transition: 'opacity 0.15s' }}>
        <div style={{ fontSize: 12, color: '#777', marginBottom: 14, lineHeight: 1.6 }}>
          This is what FAJ Solutions recorded in its app for {year}. QuickBooks is the official ledger; use this to check it
          and to prepare 1099s. Nothing here can be changed.
        </div>
        {tab === '1099' && <Tab1099 rows={rows1099} year={year} />}
        {tab === 'payouts' && <TabPayouts rows={payouts} year={year} />}
        {tab === 'income' && <TabIncome invoices={invoices} received={received} year={year} />}
        {tab === 'jobs' && <TabJobs jobs={jobs} year={year} />}
      </main>
    </div>
  );
}

// ─── 1099s & W-9s ───────────────────────────────────────────────────────────

function Tab1099({ rows, year }: { rows: Row1099[]; year: number }) {
  const [shown, setShown] = useState<Record<string, string>>({});
  const s = summarize1099(rows, year);
  const threshold = form1099Threshold(year);

  const reveal = async (r: Row1099) => {
    if (!r.contractor_id) return;
    try {
      const res = await revealTaxId(r.contractor_id);
      if (!res.ok || !res.tax_id) { toastError(res.reason === 'no_tax_id' ? 'No tax ID on file for this tech.' : staffReasonText(res.reason)); return; }
      setShown((m) => ({ ...m, [r.contractor_id as string]: `${res.tax_id_type ?? ''} ${res.tax_id}`.trim() }));
    } catch (e) { toastError(e instanceof Error ? e.message : 'Could not show it.'); }
  };

  const exportCsv = () => downloadCsv(`FAJ-1099-${year}.csv`, toCsv(
    ['Tech', 'Business name', 'Entity', 'Tax ID (last 4)', 'Address', 'City', 'State', 'ZIP', 'Email', 'Paid', 'Payments', 'Needs 1099-NEC', 'W-9 on file'],
    rows.map((r) => [r.name, r.business_name, r.entity_type, r.tax_id_last4 ? maskTaxId(r.tax_id_type, r.tax_id_last4) : '', r.address, r.city, r.state, r.zip, r.email, r.paid, r.payments, needs1099(r.paid, year) ? 'Yes' : 'No', r.w9_received ? 'Yes' : 'No']),
  ));

  return (
    <div>
      <Stats items={[
        ['Paid to techs', fmtMoney(s.total)],
        [`Need a 1099-NEC (${fmtMoney(threshold)}+)`, String(s.needing)],
        ['Of those, missing W-9', String(s.missingW9), s.missingW9 > 0],
        ['Of those, missing tax ID', String(s.missingTin), s.missingTin > 0],
      ]} />
      <Note>
        For {year}, a tech paid {fmtMoney(threshold)} or more needs a 1099-NEC by January 31, {year + 1}
        {year >= 2026 ? '. The federal line rose from $600 to $2,000 for payments made in 2026 and later' : ''}
        {thresholdNeedsCheck(year) ? ' and is adjusted for inflation; confirm the IRS figure' : ''}. State rules can differ.
        Tax IDs show their last four digits. Pressing Show reveals one in full and is recorded for Fred.
      </Note>
      <Toolbar onExport={exportCsv} />
      <Table
        headers={['Tech', 'Paid', '1099?', 'Tax ID', 'W-9', 'Mailing address']}
        rows={rows.map((r) => {
          const need = needs1099(r.paid, year);
          const full = r.contractor_id ? shown[r.contractor_id] : undefined;
          return [
            <div key="n"><b>{r.name}</b>{r.business_name && <div style={{ fontSize: 11, color: '#777' }}>{r.business_name}{r.entity_type ? ` · ${r.entity_type}` : ''}</div>}</div>,
            <b key="p">{fmtMoney(r.paid)}</b>,
            need ? <Flag key="f" bad>Yes</Flag> : <Flag key="f">No</Flag>,
            r.tax_id_last4
              ? <span key="t" style={{ fontFamily: 'monospace', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                  {full ?? maskTaxId(r.tax_id_type, r.tax_id_last4)}
                  {!full && <button className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => reveal(r)}><Eye size={12} /> Show</button>}
                </span>
              : <span key="t" style={{ color: need ? '#b91c1c' : '#999', fontWeight: need ? 700 : 400 }}>Missing</span>,
            r.w9_file && r.contractor_id
              ? <a key="w" href={`/api/accountant/w9?contractor=${r.contractor_id}`} target="_blank" rel="noreferrer" style={{ color: 'var(--teal)', fontWeight: 700 }}>Open W-9</a>
              : r.w9_received ? <span key="w" style={{ color: '#047857' }}>Received</span>
              : <span key="w" style={{ color: need ? '#b91c1c' : '#999', fontWeight: need ? 700 : 400 }}>Missing</span>,
            <span key="a" style={{ fontSize: 12 }}>{[r.address, r.city, [r.state, r.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ') || <span style={{ color: '#999' }}>Not on file</span>}</span>,
          ];
        })}
        empty={`No payments to techs recorded for ${year}.`}
      />
    </div>
  );
}

// ─── Paid to techs ──────────────────────────────────────────────────────────

function TabPayouts({ rows, year }: { rows: TechPayout[]; year: number }) {
  const total = sum(rows.map((r) => r.amount));
  const notInQb = rows.filter((r) => !r.in_quickbooks).length;
  const exportCsv = () => downloadCsv(`FAJ-tech-payouts-${year}.csv`, toCsv(
    ['Date', 'Tech', 'Work order', 'Amount', 'Method', 'In QuickBooks', 'Notes'],
    rows.map((r) => [r.payment_date, r.contractor_name, r.wo_number, r.amount, r.method, r.in_quickbooks ? 'Yes' : 'No', r.notes]),
  ));
  return (
    <div>
      <Stats items={[['Paid to techs', fmtMoney(total)], ['Payments', String(rows.length)], ['Not yet in QuickBooks', String(notInQb), notInQb > 0]]} />
      <Toolbar onExport={exportCsv} />
      <Table
        headers={['Date', 'Tech', 'Work order', 'Amount', 'Method', 'QuickBooks']}
        rows={rows.map((r) => [fmtDate(r.payment_date), r.contractor_name, r.wo_number ?? '', <b key="a">{fmtMoney(r.amount)}</b>, r.method ?? '', r.in_quickbooks ? <Flag key="q">Yes</Flag> : <Flag key="q" bad>No</Flag>])}
        empty={`No payments to techs recorded for ${year}.`}
      />
    </div>
  );
}

// ─── Income ─────────────────────────────────────────────────────────────────

function TabIncome({ invoices, received, year }: { invoices: AcctInvoice[]; received: AcctReceived[]; year: number }) {
  const invoiced = sum(invoices.map((i) => i.total ?? 0));
  const cash = sum(received.map((r) => r.amount));
  const exportCsv = () => downloadCsv(`FAJ-invoices-${year}.csv`, toCsv(
    ['Invoice', 'Client', 'Issued', 'Due', 'Subtotal', 'Tax', 'Total', 'Paid', 'Status'],
    invoices.map((i) => [i.invoice_number, i.client_name, i.issued, i.due_date, i.subtotal, i.tax_amount, i.total, i.paid, i.status]),
  ));
  return (
    <div>
      <Stats items={[['Invoiced in the app', fmtMoney(invoiced)], ['Invoices', String(invoices.length)], ['Payments received (recorded)', fmtMoney(cash)]]} />
      <Note>Most client billing is done in QuickBooks, so this list is only the invoices raised in the app. QuickBooks has the full picture of income.</Note>
      <Toolbar onExport={exportCsv} />
      <Table
        headers={['Invoice', 'Client', 'Issued', 'Total', 'Paid', 'Status']}
        rows={invoices.map((i) => [i.invoice_number ?? '', i.client_name ?? '', fmtDate(i.issued), <b key="t">{fmtMoney(i.total ?? 0)}</b>, fmtMoney(i.paid), i.status ?? ''])}
        empty={`No invoices raised in the app for ${year}.`}
      />
      {received.length > 0 && (
        <>
          <div style={{ fontWeight: 700, margin: '22px 0 8px' }}>Payments received</div>
          <Table
            headers={['Date', 'Client', 'Invoice', 'Amount', 'Method', 'Reference']}
            rows={received.map((r) => [fmtDate(r.payment_date), r.client_name ?? '', r.invoice_number ?? '', <b key="a">{fmtMoney(r.amount)}</b>, r.method ?? '', r.reference ?? ''])}
            empty=""
          />
        </>
      )}
    </div>
  );
}

// ─── Jobs ───────────────────────────────────────────────────────────────────

function TabJobs({ jobs, year }: { jobs: WorkOrder[]; year: number }) {
  const t = useMemo(() => jobsTotals(jobs), [jobs]);
  const exportCsv = () => downloadCsv(`FAJ-jobs-${year}.csv`, toCsv(
    ['Work order', 'Client', 'Date', 'Status', 'Revenue', 'Paid out', 'Profit'],
    jobs.map((w) => { const m = jobMoney(w); return [w.wo_number, w.customer_name, w.scheduled_date ?? w.start_date, w.wo_status, m.revenue, m.payout, m.profit ?? 'Pay split not set']; }),
  ));
  return (
    <div>
      <Stats items={[['Job revenue', fmtMoney(t.revenue)], ['Paid out on jobs', fmtMoney(t.payout)], ['Profit', fmtMoney(t.profit)], ['Jobs with no pay split', String(t.noSplit), t.noSplit > 0]]} />
      {t.noSplit > 0 && <Note>{t.noSplit} job{t.noSplit === 1 ? ' has' : 's have'} no pay split recorded, so {t.noSplit === 1 ? 'its' : 'their'} profit is left out of the total rather than guessed.</Note>}
      <Toolbar onExport={exportCsv} />
      <Table
        headers={['Work order', 'Client', 'Date', 'Revenue', 'Paid out', 'Profit']}
        rows={jobs.map((w) => {
          const m = jobMoney(w);
          return [w.wo_number ?? '', w.customer_name ?? '', fmtDate(w.scheduled_date ?? w.start_date), fmtMoney(m.revenue), fmtMoney(m.payout),
            m.profit === null ? <span key="p" style={{ color: '#b45309' }}>Not set</span> : <b key="p">{fmtMoney(m.profit)}</b>];
        })}
        empty={`No jobs dated in ${year}.`}
      />
    </div>
  );
}

// ─── Small pieces ───────────────────────────────────────────────────────────

function Stats({ items }: { items: [string, string, boolean?][] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginBottom: 14 }}>
      {items.map(([label, value, warn]) => (
        <div key={label} className="glass card" style={{ padding: '12px 14px', background: warn ? 'rgba(239,68,68,0.06)' : undefined }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, color: '#999', textTransform: 'uppercase' }}>{label}</div>
          <div style={{ fontSize: 20, fontWeight: 800, marginTop: 3, color: warn ? '#b91c1c' : 'var(--teal)', display: 'flex', alignItems: 'center', gap: 6 }}>
            {warn ? <AlertTriangle size={16} /> : null}{value}
          </div>
        </div>
      ))}
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12.5, color: '#555', background: 'rgba(14,27,46,0.06)', borderRadius: 10, padding: '10px 14px', marginBottom: 14, lineHeight: 1.6 }}>{children}</div>;
}

function Toolbar({ onExport }: { onExport: () => void }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
      <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={onExport}><Download size={13} /> Download spreadsheet (CSV)</button>
    </div>
  );
}

function Flag({ bad, children }: { bad?: boolean; children: React.ReactNode }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 9px', borderRadius: 999, display: 'inline-flex', alignItems: 'center', gap: 4, background: bad ? 'rgba(239,68,68,0.12)' : 'rgba(16,185,129,0.12)', color: bad ? '#b91c1c' : '#047857' }}>
      {bad ? null : <CheckCircle2 size={11} />}{children}
    </span>
  );
}

function Table({ headers, rows, empty }: { headers: string[]; rows: React.ReactNode[][]; empty: string }) {
  return (
    <div className="glass card" style={{ padding: 0, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 640 }}>
        <thead>
          <tr style={{ background: 'rgba(14,27,46,0.05)' }}>
            {headers.map((h) => <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700, letterSpacing: 1, color: '#888', textTransform: 'uppercase' }}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderTop: '1px solid #f0f0f0' }}>
              {r.map((c, j) => <td key={j} style={{ padding: '10px 12px', verticalAlign: 'top' }}>{c}</td>)}
            </tr>
          ))}
          {rows.length === 0 && empty && <tr><td colSpan={headers.length} style={{ padding: 28, textAlign: 'center', color: '#999' }}>{empty}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function TabBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button onClick={onClick} style={{
      flex: '1 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, whiteSpace: 'nowrap',
      padding: '11px 12px', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700, borderRadius: '10px 10px 0 0',
      background: active ? 'var(--cream, #faf7f0)' : 'transparent', color: active ? 'var(--teal)' : 'rgba(255,255,255,0.85)',
    }}>{icon} {label}</button>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20 }}>{children}</div>;
}
