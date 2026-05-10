'use client';
import { useState, useMemo } from 'react';
import {
  ArrowLeft, Plus, DollarSign, Briefcase, FileText, Download,
  Phone, Mail, Building2, Hash, CreditCard, Clock, ChevronDown,
  ChevronUp, CheckCircle, XCircle, TrendingUp, AlertCircle,
} from 'lucide-react';
import { fmtMoney, fmtDate, sortByWO } from '@/lib/utils';
import type { Contractor, EnrichedWorkOrder, Payment } from '@/lib/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function payLabel(wo: EnrichedWorkOrder): string {
  switch (wo.pay_type) {
    case 'Hourly':
      return `${wo.hours_worked ?? 0}h @ ${fmtMoney(Number(wo.hourly_rate))}/hr`;
    case 'Per Device':
      return `${wo.device_count ?? 0} devices @ ${fmtMoney(Number(wo.per_device_rate))}`;
    case 'Blended':
      return `Base ${fmtMoney(Number(wo.blended_base))} + ${wo.hours_worked ?? 0}h @ ${fmtMoney(Number(wo.hourly_rate))}/hr`;
    default:
      return 'Fixed';
  }
}

const STATUS_DOT: Record<string, string> = {
  'Open':        '#90a4ae',
  'Assigned':    '#ffb300',
  'In Progress': '#fb8c00',
  'Work Done':   '#3949ab',
  'Approved':    '#00897b',
  'Paid':        '#2e7d32',
};

function exportQBStatement(
  contractor: Contractor,
  workOrders: EnrichedWorkOrder[],
  payments: Payment[],
  year: number,
) {
  const yearWOs = workOrders.filter((w) => {
    const d = w.start_date || w.created_at;
    return d && new Date(d).getFullYear() === year;
  });
  const yearPayments = payments.filter(
    (p) => new Date(p.payment_date).getFullYear() === year,
  );

  const lines: string[] = [
    `QuickBooks Contractor Statement — ${year}`,
    `Contractor,${contractor.name}`,
    contractor.business_name ? `Business,${contractor.business_name}` : '',
    contractor.tax_id ? `Tax ID,${contractor.tax_id}` : '',
    `Prepared,${new Date().toLocaleDateString()}`,
    '',
    '=== WORK ORDERS ===',
    'WO#,Title,Date,Pay Type,Hours,Rate,Amount,Status',
    ...yearWOs.map((w) =>
      [
        w.wo_number,
        w.title || w.service_type || '',
        w.start_date || '',
        w.pay_type,
        w.hours_worked ?? '',
        w.hourly_rate ?? w.per_device_rate ?? w.blended_base ?? '',
        w.total_amount,
        w.wo_status,
      ].join(','),
    ),
    '',
    `Total Billed,${yearWOs.reduce((s, w) => s + Number(w.total_amount), 0).toFixed(2)}`,
    '',
    '=== PAYMENTS ===',
    'Date,WO#,Amount,Method,Notes',
    ...yearPayments.map((p) =>
      [p.payment_date, p.wo_number, p.amount, p.method, p.notes ?? ''].join(','),
    ),
    '',
    `Total Paid,${yearPayments.reduce((s, p) => s + Number(p.amount), 0).toFixed(2)}`,
    `Balance Due,${(
      yearWOs.reduce((s, w) => s + Number(w.total_amount), 0) -
      yearPayments.reduce((s, p) => s + Number(p.amount), 0)
    ).toFixed(2)}`,
  ].filter((l) => l !== undefined);

  const csv = lines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `QB_Statement_${contractor.name.replace(/\s+/g, '_')}_${year}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ContractorDetailView({
  contractor,
  workOrders,
  payments,
  onBack,
  onAddJob,
  onAddPayment,
  onEditPayment,
}: {
  contractor: Contractor;
  workOrders: EnrichedWorkOrder[];
  payments: Payment[];
  onBack: () => void;
  onAddJob: (prefill?: { contractor_name: string }) => void;
  onAddPayment: (prefill?: { contractor_name: string; wo_number?: string }) => void;
  onEditPayment: (p: Payment) => void;
}) {
  const [tab, setTab] = useState<'jobs' | 'payments' | 'statement'>('jobs');
  const [expandedWO, setExpandedWO] = useState<string | null>(null);
  const [qbYear, setQbYear] = useState(new Date().getFullYear());

  const myJobs = useMemo(
    () => sortByWO(workOrders.filter((w) => w.contractor_name === contractor.name)),
    [workOrders, contractor.name],
  );
  const myPayments = useMemo(
    () =>
      [...payments.filter((p) => p.contractor_name === contractor.name)].sort(
        (a, b) => new Date(b.payment_date).getTime() - new Date(a.payment_date).getTime(),
      ),
    [payments, contractor.name],
  );

  const totalBilled = myJobs.reduce((s, w) => s + Number(w.total_amount), 0);
  const totalPaid   = myPayments.reduce((s, p) => s + Number(p.amount), 0);
  const balance     = totalBilled - totalPaid;

  const paymentsWithBalance = useMemo(() => {
    const sorted = [...myPayments].sort(
      (a, b) => new Date(a.payment_date).getTime() - new Date(b.payment_date).getTime(),
    );
    let running = 0;
    return sorted
      .map((p) => { running += Number(p.amount); return { ...p, running }; })
      .reverse();
  }, [myPayments]);

  const availableYears = useMemo(() => {
    const ys = new Set([
      ...myJobs.map((w) => new Date(w.start_date || w.created_at).getFullYear()),
      ...myPayments.map((p) => new Date(p.payment_date).getFullYear()),
      new Date().getFullYear(),
    ]);
    return Array.from(ys).sort((a, b) => b - a);
  }, [myJobs, myPayments]);

  const TAB_BTN = (key: typeof tab, label: string, icon: React.ReactNode) => (
    <button
      onClick={() => setTab(key)}
      style={{
        padding: '8px 18px', border: 'none', borderRadius: 8, fontSize: 13,
        fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
        background: tab === key ? 'var(--teal, #0D7377)' : 'transparent',
        color: tab === key ? 'white' : '#666', transition: 'all 0.15s',
      }}
    >
      {icon}{label}
    </button>
  );

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <button
        onClick={onBack}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none',
          cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--teal, #0D7377)',
          marginBottom: 20, padding: 0,
        }}
      >
        <ArrowLeft size={15} /> All Contractors
      </button>

      <div style={{ background: 'white', borderRadius: 16, border: '1px solid #e8ecf0', overflow: 'hidden', marginBottom: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
        <div style={{ height: 6, background: 'linear-gradient(90deg, #0D7377, #14a085)' }} />
        <div style={{ padding: '24px 28px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
            <div>
              <h1 className="serif" style={{ fontSize: 28, fontWeight: 700, margin: 0, color: '#1a1a2e' }}>{contractor.name}</h1>
              {contractor.business_name && (
                <div style={{ fontSize: 14, color: '#555', marginTop: 3, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Building2 size={13} color="var(--teal, #0D7377)" />{contractor.business_name}
                </div>
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 12 }}>
                {contractor.phone && <span style={{ fontSize: 13, color: '#555', display: 'flex', alignItems: 'center', gap: 5 }}><Phone size={12} color="#0D7377" /> {contractor.phone}</span>}
                {contractor.email && <span style={{ fontSize: 13, color: '#555', display: 'flex', alignItems: 'center', gap: 5 }}><Mail size={12} color="#0D7377" /> {contractor.email}</span>}
                {contractor.tax_id && <span style={{ fontSize: 13, color: '#555', display: 'flex', alignItems: 'center', gap: 5 }}><Hash size={12} color="#0D7377" /> {contractor.tax_id_type || 'Tax ID'}: {contractor.tax_id}</span>}
                <span style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 5 }}>
                  {contractor.w9_received
                    ? <><CheckCircle size={13} color="#047857" /><span style={{ color: '#047857', fontWeight: 600 }}>W-9 On File</span></>
                    : <><XCircle size={13} color="#b91c1c" /><span style={{ color: '#b91c1c', fontWeight: 600 }}>No W-9</span></>}
                </span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                onClick={() => onAddJob({ contractor_name: contractor.name })}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 9, border: 'none', background: 'var(--teal, #0D7377)', color: 'white', fontSize: 13, fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 8px rgba(13,115,119,0.25)' }}
              >
                <Plus size={14} /> Add Job
              </button>
              <button
                onClick={() => onAddPayment({ contractor_name: contractor.name })}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 9, border: '1.5px solid var(--teal, #0D7377)', background: 'transparent', color: 'var(--teal, #0D7377)', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
              >
                <DollarSign size={14} /> Log Payment
              </button>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0, marginTop: 24, background: '#f7f9fc', borderRadius: 12, border: '1px solid #eef0f4', overflow: 'hidden' }}>
            {[
              { label: 'Total Billed', value: fmtMoney(totalBilled), color: '#1a1a2e' },
              { label: 'Total Paid',   value: fmtMoney(totalPaid),   color: '#047857' },
              { label: 'Balance Due',  value: fmtMoney(balance),     color: balance > 0 ? '#b91c1c' : '#047857' },
              { label: 'Total Jobs',   value: String(myJobs.length), color: '#1a1a2e' },
            ].map(({ label, value, color }, i) => (
              <div key={label} style={{ padding: '14px 18px', borderRight: i < 3 ? '1px solid #eef0f4' : 'none', textAlign: 'center' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#aaa', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 20, fontWeight: 800, color }}>{value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 16, background: 'white', borderRadius: 12, border: '1px solid #e8ecf0', padding: 6, width: 'fit-content' }}>
        {TAB_BTN('jobs', 'Jobs', <Briefcase size={13} />)}
        {TAB_BTN('payments', 'Payment History', <CreditCard size={13} />)}
        {TAB_BTN('statement', 'QB Statement', <TrendingUp size={13} />)}
      </div>

      {tab === 'jobs' && (
        <div style={{ background: 'white', borderRadius: 14, border: '1px solid #e8ecf0', overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
          {myJobs.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '56px 24px', color: '#aaa' }}>
              <Briefcase size={32} style={{ marginBottom: 12, opacity: 0.3 }} />
              <div style={{ fontWeight: 600, fontSize: 15, color: '#546e7a', marginBottom: 6 }}>No jobs yet</div>
              <div style={{ fontSize: 13 }}>Click &quot;Add Job&quot; to assign the first work order.</div>
            </div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr 100px 120px 90px 90px 28px', gap: 0, padding: '10px 20px', background: '#f7f9fc', borderBottom: '1px solid #eef0f4', fontSize: 10, fontWeight: 700, color: '#90a4ae', letterSpacing: 1.2, textTransform: 'uppercase' }}>
                <span>WO #</span><span>Title / Service</span><span>Date</span><span>Pay Type</span>
                <span style={{ textAlign: 'right' }}>Amount</span><span style={{ textAlign: 'center' }}>Status</span><span />
              </div>
              {myJobs.map((wo) => {
                const expanded = expandedWO === wo.id;
                const woPmts = myPayments.filter((p) => p.wo_number === wo.wo_number);
                const woPaid = woPmts.reduce((s, p) => s + Number(p.amount), 0);
                const woBalance = Number(wo.total_amount) - woPaid;
                const dot = STATUS_DOT[wo.wo_status ?? 'Open'] ?? '#90a4ae';
                return (
                  <div key={wo.id} style={{ borderBottom: '1px solid #f5f5f5' }}>
                    <div
                      style={{ display: 'grid', gridTemplateColumns: '90px 1fr 100px 120px 90px 90px 28px', gap: 0, padding: '13px 20px', alignItems: 'center', cursor: 'pointer', transition: 'background 0.1s' }}
                      onClick={() => setExpandedWO(expanded ? null : wo.id)}
                    >
                      <span style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 700, color: '#0D7377' }}>#{wo.wo_number}</span>
                      <span style={{ fontSize: 13, color: '#1a1a2e', fontWeight: 600 }}>{wo.title || wo.service_type || '—'}</span>
                      <span style={{ fontSize: 12, color: '#90a4ae' }}>{wo.start_date ? fmtDate(wo.start_date) : '—'}</span>
                      <span style={{ fontSize: 11, color: '#555' }}>{payLabel(wo)}</span>
                      <span style={{ fontSize: 14, fontWeight: 800, color: '#1a1a2e', textAlign: 'right' }}>{fmtMoney(Number(wo.total_amount))}</span>
                      <span style={{ textAlign: 'center' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 20, background: `${dot}18`, color: dot }}>
                          <span style={{ width: 5, height: 5, borderRadius: '50%', background: dot, display: 'inline-block' }} />{wo.wo_status}
                        </span>
                      </span>
                      <span style={{ color: '#aaa', textAlign: 'right' }}>{expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</span>
                    </div>
                    {expanded && (
                      <div style={{ padding: '14px 20px 18px 20px', background: '#fafbfc', borderTop: '1px solid #f0f4f8' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
                          <div>
                            <div style={{ fontSize: 10, fontWeight: 700, color: '#aaa', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 10 }}>Job Details</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              {wo.hours_worked != null && <Row icon={<Clock size={11} />} label="Hours on Site" value={`${wo.hours_worked} hrs`} />}
                              {wo.hourly_rate != null && <Row icon={<DollarSign size={11} />} label="Rate" value={fmtMoney(Number(wo.hourly_rate)) + '/hr'} />}
                              {wo.device_count != null && <Row icon={<Hash size={11} />} label="Devices" value={String(wo.device_count)} />}
                              {wo.per_device_rate != null && <Row icon={<DollarSign size={11} />} label="Per Device" value={fmtMoney(Number(wo.per_device_rate))} />}
                              {wo.blended_base != null && <Row icon={<DollarSign size={11} />} label="Blended Base" value={fmtMoney(Number(wo.blended_base))} />}
                              {wo.site_name && <Row icon={<Briefcase size={11} />} label="Site" value={wo.site_name} />}
                              {wo.start_date && <Row icon={<Clock size={11} />} label="Start" value={`${fmtDate(wo.start_date)}${wo.start_time ? ' ' + wo.start_time : ''}`} />}
                              {wo.end_date && <Row icon={<Clock size={11} />} label="End" value={`${fmtDate(wo.end_date)}${wo.end_time ? ' ' + wo.end_time : ''}`} />}
                            </div>
                          </div>
                          <div>
                            <div style={{ fontSize: 10, fontWeight: 700, color: '#aaa', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 10 }}>Payments ({woPmts.length})</div>
                            {woPmts.length === 0 ? (
                              <div style={{ fontSize: 12, color: '#aaa' }}>No payments recorded yet.</div>
                            ) : (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                {woPmts.map((p) => (
                                  <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#555' }}>
                                    <span>{fmtDate(p.payment_date)} · {p.method}</span>
                                    <span style={{ fontWeight: 700, color: '#047857' }}>{fmtMoney(Number(p.amount))}</span>
                                  </div>
                                ))}
                                <div style={{ marginTop: 4, paddingTop: 6, borderTop: '1px solid #eee', display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700 }}>
                                  <span style={{ color: woBalance > 0 ? '#b91c1c' : '#047857' }}>{woBalance > 0 ? `Balance: ${fmtMoney(woBalance)}` : 'Fully Paid ✓'}</span>
                                  <span style={{ color: '#047857' }}>Paid: {fmtMoney(woPaid)}</span>
                                </div>
                              </div>
                            )}
                            <button
                              onClick={(e) => { e.stopPropagation(); onAddPayment({ contractor_name: contractor.name, wo_number: wo.wo_number }); }}
                              style={{ marginTop: 10, fontSize: 11, fontWeight: 700, padding: '5px 12px', borderRadius: 7, border: '1.5px solid #0D7377', background: 'transparent', color: '#0D7377', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}
                            >
                              <Plus size={11} /> Add Payment
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}

      {tab === 'payments' && (
        <div style={{ background: 'white', borderRadius: 14, border: '1px solid #e8ecf0', overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
          {paymentsWithBalance.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '56px 24px', color: '#aaa' }}>
              <CreditCard size={32} style={{ marginBottom: 12, opacity: 0.3 }} />
              <div style={{ fontWeight: 600, fontSize: 15, color: '#546e7a', marginBottom: 6 }}>No payments recorded</div>
              <div style={{ fontSize: 13 }}>Log payments against work orders using the button above.</div>
            </div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '110px 90px 1fr 100px 110px 110px', padding: '10px 20px', background: '#f7f9fc', borderBottom: '1px solid #eef0f4', fontSize: 10, fontWeight: 700, color: '#90a4ae', letterSpacing: 1.2, textTransform: 'uppercase' }}>
                <span>Date</span><span>WO #</span><span>Notes</span><span>Method</span>
                <span style={{ textAlign: 'right' }}>Amount</span><span style={{ textAlign: 'right' }}>Running Total</span>
              </div>
              {paymentsWithBalance.map((p, idx) => (
                <div
                  key={p.id}
                  style={{ display: 'grid', gridTemplateColumns: '110px 90px 1fr 100px 110px 110px', padding: '12px 20px', alignItems: 'center', borderBottom: idx < paymentsWithBalance.length - 1 ? '1px solid #f5f5f5' : 'none', cursor: 'pointer', transition: 'background 0.1s' }}
                  onClick={() => onEditPayment(p)}
                >
                  <span style={{ fontSize: 13, color: '#555' }}>{fmtDate(p.payment_date)}</span>
                  <span style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 700, color: '#0D7377' }}>#{p.wo_number}</span>
                  <span style={{ fontSize: 12, color: '#90a4ae', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.notes || '—'}</span>
                  <span style={{ fontSize: 12, color: '#555' }}>{p.method}</span>
                  <span style={{ fontSize: 14, fontWeight: 800, color: '#047857', textAlign: 'right' }}>+{fmtMoney(Number(p.amount))}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#1a1a2e', textAlign: 'right' }}>{fmtMoney(p.running)}</span>
                </div>
              ))}
              <div style={{ padding: '14px 20px', background: 'rgba(13,115,119,0.04)', borderTop: '2px solid #eef0f4', display: 'flex', justifyContent: 'flex-end', gap: 32 }}>
                <span style={{ fontSize: 13, color: '#555' }}>Total Billed: <strong>{fmtMoney(totalBilled)}</strong></span>
                <span style={{ fontSize: 13, color: '#047857' }}>Total Paid: <strong>{fmtMoney(totalPaid)}</strong></span>
                <span style={{ fontSize: 13, color: balance > 0 ? '#b91c1c' : '#047857', fontWeight: 700 }}>Balance: {fmtMoney(balance)}</span>
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'statement' && (
        <div style={{ background: 'white', borderRadius: 14, border: '1px solid #e8ecf0', overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
          <div style={{ padding: '18px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #eef0f4', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, color: '#aaa', textTransform: 'uppercase', marginBottom: 3 }}>QuickBooks Statement</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#1a1a2e' }}>{contractor.name}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <select value={qbYear} onChange={(e) => setQbYear(Number(e.target.value))} className="select input" style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid #e0e0e0', fontSize: 13 }}>
                {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
              <button
                onClick={() => exportQBStatement(contractor, myJobs, myPayments, qbYear)}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 9, border: 'none', background: '#047857', color: 'white', fontSize: 13, fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 6px rgba(4,120,87,0.3)' }}
              >
                <Download size={13} /> Export CSV for QuickBooks
              </button>
            </div>
          </div>
          {(() => {
            const yrJobs = myJobs.filter((w) => { const d = w.start_date || w.created_at; return d && new Date(d).getFullYear() === qbYear; });
            const yrPmts = myPayments.filter((p) => new Date(p.payment_date).getFullYear() === qbYear);
            const yrBilled = yrJobs.reduce((s, w) => s + Number(w.total_amount), 0);
            const yrPaid = yrPmts.reduce((s, p) => s + Number(p.amount), 0);
            return (
              <div style={{ padding: '0 24px 24px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, margin: '20px 0' }}>
                  {[{ label: `Jobs in ${qbYear}`, value: String(yrJobs.length), color: '#0D7377' }, { label: 'Total Billed', value: fmtMoney(yrBilled), color: '#1a1a2e' }, { label: 'Total Paid', value: fmtMoney(yrPaid), color: '#047857' }].map(({ label, value, color }) => (
                    <div key={label} style={{ padding: '16px', borderRadius: 10, background: '#f7f9fc', border: '1px solid #eef0f4', textAlign: 'center' }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#aaa', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 6 }}>{label}</div>
                      <div style={{ fontSize: 22, fontWeight: 800, color }}>{value}</div>
                    </div>
                  ))}
                </div>
                {yrPaid >= 600 && (
                  <div style={{ padding: '12px 16px', borderRadius: 10, marginBottom: 20, background: 'rgba(185,28,28,0.06)', border: '1px solid rgba(185,28,28,0.2)', display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                    <AlertCircle size={15} color="#b91c1c" />
                    <span><strong style={{ color: '#b91c1c' }}>1099-NEC Required</strong> — {contractor.name} received {fmtMoney(yrPaid)} in {qbYear}, which exceeds the $600 threshold.</span>
                  </div>
                )}
                <div style={{ marginBottom: 24 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#0D7377', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 10 }}>Work Orders — {qbYear}</div>
                  {yrJobs.length === 0 ? <div style={{ fontSize: 13, color: '#aaa', padding: '16px 0' }}>No jobs in {qbYear}.</div> : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead><tr style={{ background: '#f7f9fc', borderBottom: '1px solid #eee' }}>{['WO #', 'Title', 'Date', 'Pay Type', 'Hours', 'Amount', 'Status'].map((h, i) => <th key={h} style={{ padding: '8px 10px', textAlign: i >= 4 ? 'right' : 'left', fontSize: 10, fontWeight: 700, color: '#90a4ae', letterSpacing: 1 }}>{h}</th>)}</tr></thead>
                      <tbody>{yrJobs.map((w) => (<tr key={w.id} style={{ borderBottom: '1px solid #f5f5f5' }}><td style={{ padding: '10px 10px', fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: '#0D7377' }}>#{w.wo_number}</td><td style={{ padding: '10px 10px', color: '#333' }}>{w.title || w.service_type || '—'}</td><td style={{ padding: '10px 10px', color: '#888' }}>{w.start_date ? fmtDate(w.start_date) : '—'}</td><td style={{ padding: '10px 10px', color: '#555' }}>{w.pay_type}</td><td style={{ padding: '10px 10px', textAlign: 'right', color: '#555' }}>{w.hours_worked ?? '—'}</td><td style={{ padding: '10px 10px', textAlign: 'right', fontWeight: 700 }}>{fmtMoney(Number(w.total_amount))}</td><td style={{ padding: '10px 10px', textAlign: 'right' }}><span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: `${STATUS_DOT[w.wo_status ?? 'Open']}18`, color: STATUS_DOT[w.wo_status ?? 'Open'] }}>{w.wo_status}</span></td></tr>))}</tbody>
                      <tfoot><tr style={{ borderTop: '2px solid #eee' }}><td colSpan={5} style={{ padding: '10px 10px', fontWeight: 700, color: '#555', fontSize: 12 }}>Total</td><td style={{ padding: '10px 10px', textAlign: 'right', fontWeight: 800, fontSize: 15, color: '#1a1a2e' }}>{fmtMoney(yrBilled)}</td><td /></tr></tfoot>
                    </table>
                  )}
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#047857', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 10 }}>Payments Received — {qbYear}</div>
                  {yrPmts.length === 0 ? <div style={{ fontSize: 13, color: '#aaa', padding: '16px 0' }}>No payments in {qbYear}.</div> : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead><tr style={{ background: '#f7f9fc', borderBottom: '1px solid #eee' }}>{['Date', 'WO #', 'Method', 'Notes', 'Amount'].map((h, i) => <th key={h} style={{ padding: '8px 10px', textAlign: i === 4 ? 'right' : 'left', fontSize: 10, fontWeight: 700, color: '#90a4ae', letterSpacing: 1 }}>{h}</th>)}</tr></thead>
                      <tbody>{[...yrPmts].sort((a, b) => new Date(a.payment_date).getTime() - new Date(b.payment_date).getTime()).map((p) => (<tr key={p.id} style={{ borderBottom: '1px solid #f5f5f5' }}><td style={{ padding: '10px 10px', color: '#555' }}>{fmtDate(p.payment_date)}</td><td style={{ padding: '10px 10px', fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: '#0D7377' }}>#{p.wo_number}</td><td style={{ padding: '10px 10px', color: '#555' }}>{p.method}</td><td style={{ padding: '10px 10px', color: '#aaa' }}>{p.notes || '—'}</td><td style={{ padding: '10px 10px', textAlign: 'right', fontWeight: 700, color: '#047857' }}>{fmtMoney(Number(p.amount))}</td></tr>))}</tbody>
                      <tfoot><tr style={{ borderTop: '2px solid #eee' }}><td colSpan={4} style={{ padding: '10px 10px', fontWeight: 700, color: '#555', fontSize: 12 }}>Total Paid</td><td style={{ padding: '10px 10px', textAlign: 'right', fontWeight: 800, fontSize: 15, color: '#047857' }}>{fmtMoney(yrPaid)}</td></tr></tfoot>
                    </table>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
      <span style={{ color: 'var(--teal, #0D7377)', display: 'flex' }}>{icon}</span>
      <span style={{ color: '#aaa', minWidth: 90 }}>{label}</span>
      <span style={{ color: '#333', fontWeight: 600 }}>{value}</span>
    </div>
  );
}
