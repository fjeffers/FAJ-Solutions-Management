'use client';
import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardCheck, CloudUpload } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { effectiveProgress, progressAlert, type LdsDailyCheckout, type LdsDailyCheckoutRow } from '@/lib/lds-daily-checkout';

const dayName = (row: LdsDailyCheckoutRow) =>
  row.install_day === 'return' ? 'Return visit' : `Day ${row.install_day}`;

export default function LdsCheckoutMonitor({ workOrderId }: { workOrderId: string }) {
  const [rows, setRows] = useState<LdsDailyCheckoutRow[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const db = createClient();
    const load = async () => {
      const { data, error } = await db.from('lds_daily_checkouts').select('*')
        .eq('wo_id', workOrderId).order('day', { ascending: false }).order('updated_at', { ascending: false });
      if (!error) setRows((data ?? []) as LdsDailyCheckoutRow[]);
      setLoading(false);
    };
    const first = setTimeout(() => void load(), 0);
    const channel = db.channel(`lds-checkout-${workOrderId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lds_daily_checkouts', filter: `wo_id=eq.${workOrderId}` }, () => void load())
      .subscribe();
    const poll = setInterval(() => void load(), 10000);
    const focus = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', focus);
    return () => { clearTimeout(first); clearInterval(poll); document.removeEventListener('visibilitychange', focus); void db.removeChannel(channel); };
  }, [workOrderId]);

  return (
    <section style={{ border: '1px solid #bfdbfe', borderRadius: 14, padding: 16, background: '#eff6ff' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, color: '#1e3a8a' }}>
        <ClipboardCheck size={16} /> FAJ daily checkout
      </div>
      <div style={{ fontSize: 12, color: '#3b82f6', marginTop: 3 }}>
        Answers, labeled photos, schedule problems and the report sent to Simple Sub.
      </div>
      {loading ? (
        <div style={{ padding: '14px 0 0', fontSize: 12, color: '#6b7280' }}>Loading checkouts…</div>
      ) : rows.length === 0 ? (
        <div style={{ marginTop: 12, background: 'white', borderRadius: 10, padding: '11px 12px', fontSize: 12.5, color: '#6b7280' }}>
          No daily checkout has been sent yet.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 9, marginTop: 12 }}>
          {rows.map((row) => {
            const c = row.data as LdsDailyCheckout;
            const status = effectiveProgress(c);
            const alert = progressAlert(c);
            const color = status === 'behind' ? '#b91c1c' : status === 'at_risk' ? '#b45309' : '#15803d';
            return (
              <details key={row.id} style={{ background: 'white', border: `1px solid ${status === 'on_track' ? '#dbeafe' : `${color}55`}`, borderRadius: 11, padding: '10px 12px' }}>
                <summary style={{ cursor: 'pointer', listStyle: 'none', display: 'flex', alignItems: 'center', gap: 9 }}>
                  {status === 'on_track' ? <CheckCircle2 size={17} color={color} /> : <AlertTriangle size={17} color={color} />}
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <b>{dayName(row)} · {row.contractor_name}</b>
                    <span style={{ display: 'block', fontSize: 11.5, color: '#6b7280', marginTop: 2 }}>
                      {row.day} · {row.submitted_at ? `Sent ${new Date(row.submitted_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : 'Draft'}
                    </span>
                  </span>
                  <span style={{ color, fontWeight: 800, fontSize: 11.5, textTransform: 'uppercase' }}>{status.replace('_', ' ')}</span>
                </summary>
                <div style={{ display: 'grid', gap: 7, marginTop: 10, paddingTop: 9, borderTop: '1px solid #e5e7eb', fontSize: 12.5 }}>
                  {alert && <div style={{ color, fontWeight: 700 }}>{alert}</div>}
                  <div><b>Work:</b> {c.workCompleted || 'Not entered'}</div>
                  <div><b>Tomorrow:</b> {c.planTomorrow || 'Not entered'}</div>
                  <div><b>Materials missing:</b> {c.materials.missing || 'None'}</div>
                  <div><b>APs:</b> {c.aps.length} · Pulled {c.aps.filter((a) => a.cablePulled === 'yes').length} · Terminated {c.aps.filter((a) => a.terminated === 'yes').length} · Tested {c.aps.filter((a) => a.tested === 'yes').length}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: row.simplysub_uploaded_at ? '#15803d' : '#6b7280' }}>
                    <CloudUpload size={14} />
                    {row.simplysub_uploaded_at
                      ? `Report filed in Simple Sub ${new Date(row.simplysub_uploaded_at).toLocaleString()}`
                      : row.report_generated_at ? 'Report generated; Simple Sub upload is waiting' : 'Report is created after the tech sends the checkout'}
                  </div>
                </div>
              </details>
            );
          })}
        </div>
      )}
    </section>
  );
}
