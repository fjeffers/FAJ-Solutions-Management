'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { contractorOwedOnWO, fmtMoney } from '@/lib/utils';
import type { Payment, QuickBooksReceivable, WorkOrder } from '@/lib/types';

const date = (value: string | null) => value
  ? new Date(value.length === 10 ? `${value}T12:00:00` : value).toLocaleDateString()
  : '—';

function payoutFor(workOrder: WorkOrder | undefined, payments: Payment[]) {
  if (!workOrder) return { expected: null, paid: 0, status: 'No linked job' };
  const paid = payments
    .filter((p) => p.wo_number === workOrder.wo_number)
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const names = workOrder.contractor_names?.length
    ? workOrder.contractor_names
    : workOrder.contractor_name ? [workOrder.contractor_name] : [];
  const hasPay = Boolean(workOrder.contractor_pay && Object.keys(workOrder.contractor_pay).length > 0);
  if (!hasPay) return { expected: null, paid, status: paid > 0 ? 'Paid, rate not set' : 'Pay not set' };
  const expected = names.reduce((sum, name) => sum + contractorOwedOnWO(workOrder, name), 0);
  if (expected <= 0) return { expected, paid, status: 'No tech payout' };
  if (paid >= expected - 0.005) return { expected, paid, status: 'Tech paid' };
  if (paid > 0) return { expected, paid, status: 'Tech partly paid' };
  return { expected, paid, status: 'Tech owed' };
}

export default function QuickBooksReceivablesView({
  workOrders,
  payments,
}: {
  workOrders: WorkOrder[];
  payments: Payment[];
}) {
  const [rows, setRows] = useState<QuickBooksReceivable[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (method: 'GET' | 'POST' = 'GET') => {
    const res = await fetch('/api/quickbooks/receivables', { method });
    const body = await res.json().catch(() => ({})) as { error?: string; invoices?: QuickBooksReceivable[] };
    if (!res.ok) setError(body.error || 'QuickBooks sync failed.');
    else {
      setRows((body.invoices ?? []).sort((a, b) => String(b.sent_at ?? '').localeCompare(String(a.sent_at ?? ''))));
      setError('');
    }
    setLoading(false);
    return res.ok;
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => { void load(); }, 0);
    const timer = window.setInterval(() => { void load(); }, 5 * 60_000);
    const onFocus = () => { void load(); };
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [load]);

  const sync = async () => {
    setSyncing(true);
    setError('');
    try {
      await load('POST');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  const workOrdersById = useMemo(() => new Map(workOrders.map((w) => [w.id, w])), [workOrders]);
  const totals = useMemo(() => rows.reduce((sum, row) => ({
    billed: sum.billed + Number(row.total || 0),
    received: sum.received + Math.max(0, Number(row.total || 0) - Number(row.balance || 0)),
    outstanding: sum.outstanding + Number(row.balance || 0),
    open: sum.open + (Number(row.balance || 0) > 0.005 ? 1 : 0),
  }), { billed: 0, received: 0, outstanding: 0, open: 0 }), [rows]);

  return (
    <section className="glass card" style={{ maxWidth: 1200, margin: '14px auto 0', padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 17, margin: 0 }}>QuickBooks billing status</h2>
          <div style={{ fontSize: 12, color: '#667085', marginTop: 3 }}>
            Invoice sent, client payment, outstanding balance, and technician payout on the same job.
          </div>
        </div>
        <button type="button" className="btn btn-primary" onClick={sync} disabled={syncing}>
          <RefreshCw size={14} className={syncing ? 'spin' : undefined} /> {syncing ? 'Syncing…' : 'Sync QuickBooks'}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, marginTop: 14 }}>
        {[
          { label: 'Open invoices', value: String(totals.open) },
          { label: 'Clients owe', value: fmtMoney(totals.outstanding) },
          { label: 'Client paid', value: fmtMoney(totals.received) },
          { label: 'Invoiced', value: fmtMoney(totals.billed) },
        ].map(({ label, value }) => (
          <div key={label} style={{ padding: 10, border: '1px solid #E5E7EB', borderRadius: 10 }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', color: '#667085', fontWeight: 800 }}>{label}</div>
            <div style={{ fontSize: 19, fontWeight: 850, marginTop: 2 }}>{value}</div>
          </div>
        ))}
      </div>

      {error && <div style={{ marginTop: 10, color: '#b42318', fontSize: 12 }}>{error}</div>}
      {loading ? (
        <div style={{ padding: '18px 0', color: '#667085' }}>Loading QuickBooks invoices…</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: '18px 0 2px', color: '#667085' }}>No QuickBooks invoices are mirrored yet. Use Sync QuickBooks once.</div>
      ) : (
        <div style={{ overflowX: 'auto', marginTop: 14 }}>
          <table style={{ width: '100%', minWidth: 920, borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #D0D5DD', textAlign: 'left', color: '#475467' }}>
                {['Invoice', 'Job', 'Client', 'Created / sent', 'Amount', 'Client paid', 'Balance', 'Payment date', 'Tech payout'].map((head) => (
                  <th key={head} style={{ padding: '8px 7px' }}>{head}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const workOrder = row.work_order_id ? workOrdersById.get(row.work_order_id) : undefined;
                const received = Math.max(0, Number(row.total) - Number(row.balance));
                const payout = payoutFor(workOrder, payments);
                return (
                  <tr key={row.qbo_invoice_id} style={{ borderBottom: '1px solid #EAECF0' }}>
                    <td style={{ padding: '9px 7px' }}>
                      <div style={{ fontWeight: 800 }}>{row.qbo_invoice_number || 'QuickBooks invoice'}</div>
                      <div style={{ color: row.email_status === 'EmailSent' ? '#047857' : '#667085', fontSize: 11 }}>
                        {row.email_status === 'EmailSent' ? 'Sent to client' : row.email_status === 'NeedToSend' ? 'Needs sending' : 'In QuickBooks'}
                      </div>
                    </td>
                    <td style={{ padding: '9px 7px' }}>{workOrder ? `WO ${workOrder.wo_number}` : 'QuickBooks only'}</td>
                    <td style={{ padding: '9px 7px' }}>{row.customer_name || workOrder?.customer_name || '—'}</td>
                    <td style={{ padding: '9px 7px' }}>{date(row.sent_at)}</td>
                    <td style={{ padding: '9px 7px' }}>{fmtMoney(Number(row.total))}</td>
                    <td style={{ padding: '9px 7px', color: received > 0 ? '#047857' : undefined }}>{fmtMoney(received)}</td>
                    <td style={{ padding: '9px 7px', color: Number(row.balance) > 0 ? '#b45309' : '#047857', fontWeight: 800 }}>
                      {fmtMoney(Number(row.balance))} · {row.status}
                    </td>
                    <td style={{ padding: '9px 7px' }}>{date(row.last_payment_at)}</td>
                    <td style={{ padding: '9px 7px' }}>
                      <div style={{ fontWeight: 800 }}>{payout.status}</div>
                      <div style={{ color: '#667085', fontSize: 11 }}>
                        {fmtMoney(payout.paid)}{payout.expected == null ? '' : ` of ${fmtMoney(payout.expected)}`}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {rows[0]?.synced_at && (
        <div style={{ marginTop: 9, color: '#667085', fontSize: 11 }}>Last synced {new Date(rows[0].synced_at).toLocaleString()}</div>
      )}
    </section>
  );
}
