'use client';
// "Invoices to send" on Home: job log invoices not yet in QuickBooks or on NetView's form (lib/billing-waiting.ts).
import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, FileText } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { BILLING_SINCE, billingDetail, billingWaiting, type BillingJob, type BillingRow } from '@/lib/billing-waiting';

export default function BillingToSend({ jobs, onOpenJob }: { jobs: BillingJob[]; onOpenJob: (woId: string) => void }) {
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
  if (items.length === 0) return null;
  return (
    <div style={{ marginTop: 14 }}>
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
  );
}
