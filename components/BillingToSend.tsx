'use client';
// "Invoices to send" on Home: job log invoices not yet in QuickBooks or on NetView's form (lib/billing-waiting.ts).
import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronRight, FileText } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { accountingTracking, BILLING_SINCE, billingDetail, billingWaiting, type BillingRow } from '@/lib/billing-waiting';
import type { EnrichedWorkOrder } from '@/lib/types';
import { fmtMoney } from '@/lib/utils';

export default function BillingToSend({ jobs, onOpenJob }: { jobs: EnrichedWorkOrder[]; onOpenJob: (woId: string) => void }) {
  const [rows, setRows] = useState<BillingRow[]>([]);
  useEffect(() => {
    const load = async () => {
      const { data } = await createClient().from('job_log_rates')
        .select('wo_id, rates, all_hours_rate, invoice, updated_at').gte('updated_at', `${BILLING_SINCE}T00:00:00`);
      setRows((data as BillingRow[] | null) ?? []);
    };
    const first = setTimeout(() => void load(), 0);
    // Marked on the job log, then back on Home: look again.
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    const t = setInterval(() => void load(), 5 * 60_000);
    return () => { clearTimeout(first); clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, [jobs]);
  const items = useMemo(() => billingWaiting(rows, jobs), [rows, jobs]);
  const tracking = useMemo(() => accountingTracking(rows, jobs).slice(0, 30), [rows, jobs]);
  return (
    <div style={{ marginTop: 14, display: 'grid', gap: 20 }}>
      {items.length > 0 && (
        <div>
          <h2 className="serif" style={{ fontSize: 21, fontWeight: 600, margin: '0 0 10px' }}>
            Invoices to send <span style={{ fontSize: 13, fontWeight: 400, color: '#8a8578' }}>({items.length})</span>
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 9 }}>
            {items.map((i) => (
              <button key={i.woId} onClick={() => onOpenJob(i.woId)} title="Open the job, then Job log → Invoice" style={{
                display: 'flex', alignItems: 'center', gap: 11, textAlign: 'left', cursor: 'pointer', padding: '13px 14px',
                borderRadius: 13, background: 'white', border: '1px solid rgba(14,27,46,0.25)', boxShadow: '0 1px 6px rgba(0,0,0,0.03)',
              }}>
                <span style={{ width: 32, height: 32, borderRadius: 9, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(14,27,46,0.10)' }}>
                  <FileText size={16} color="var(--teal)" />
                </span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: 'block', fontSize: 14, fontWeight: 700, lineHeight: 1.3, overflowWrap: 'anywhere' }}>{i.title}</span>
                  <span style={{ display: 'block', fontSize: 12, color: '#8a8578', marginTop: 2 }}>{billingDetail(i)}</span>
                </span>
                <ChevronRight size={16} color="#c9c3b4" style={{ flexShrink: 0 }} />
              </button>
            ))}
          </div>
        </div>
      )}

      {tracking.length > 0 && (
        <div>
          <h2 className="serif" style={{ fontSize: 21, fontWeight: 600, margin: '0 0 4px' }}>Job invoice &amp; tech pay</h2>
          <div style={{ fontSize: 12, color: '#8a8578', marginBottom: 10 }}>Finished jobs, with client invoicing and technician payment kept separate.</div>
          <div style={{ display: 'grid', gap: 7 }}>
            {tracking.map((item) => {
              const invoiceText = item.invoice === 'sent'
                ? `QuickBooks ${item.invoiceNumber || 'sent'}`
                : item.invoice === 'not_sent' ? 'Not sent to QuickBooks' : 'Invoice not prepared';
              const techText = !item.paySet ? 'Tech pay not set'
                : item.techDue > 0 ? `${fmtMoney(item.techPaid)} paid · ${fmtMoney(item.techDue)} due`
                  : `${fmtMoney(item.techPaid)} paid in full`;
              return (
                <button className="job-accounting-row" key={item.woId} onClick={() => onOpenJob(item.woId)} style={{
                  display: 'grid', gridTemplateColumns: 'minmax(190px, 1fr) minmax(150px, .7fr) minmax(170px, .8fr) auto',
                  alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', cursor: 'pointer',
                  padding: '11px 13px', borderRadius: 11, background: 'white', border: '1px solid #e7e3d9',
                }}>
                  <strong style={{ fontSize: 13, overflowWrap: 'anywhere' }}>{item.title}</strong>
                  <span style={{ fontSize: 12, fontWeight: 700, color: item.invoice === 'sent' ? '#047857' : '#b45309', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    {item.invoice === 'sent' && <CheckCircle2 size={14} />} {invoiceText}
                  </span>
                  <span style={{ fontSize: 12, color: item.techDue > 0 || !item.paySet ? '#b45309' : '#047857', fontWeight: 650 }}>{techText}</span>
                  <ChevronRight size={16} color="#c9c3b4" />
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
