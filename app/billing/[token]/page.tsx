// Public billing-helper page — shared via unguessable token link
// (user_settings.billing_share_token, migration-043). Shows ONLY the visits
// that still need invoicing, grouped by customer with amounts. Read-only:
// a second person can work the billing queue without a login and without
// access to anything else in the app.
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { createAdminClient } from '@/lib/supabase/admin';
import { visitAmount } from '@/lib/visits';
import type { SiteVisit } from '@/lib/types';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Needs Invoicing — FAJ Solutions LLC',
  robots: { index: false, follow: false },
};

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const fmtDate = (d: string | null) =>
  d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Date TBD';

export default async function BillingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 16) notFound();

  const supabase = createAdminClient();
  const { data: settings } = await supabase
    .from('user_settings').select('user_id').eq('billing_share_token', token).maybeSingle();
  if (!settings) notFound();

  const { data } = await supabase
    .from('site_visits').select('*')
    .eq('user_id', settings.user_id)
    .eq('invoice_status', 'not_invoiced')
    .order('visit_date', { ascending: false, nullsFirst: false }) as { data: SiteVisit[] | null };
  const visits = data ?? [];

  const byProgram = new Map<string, SiteVisit[]>();
  for (const v of visits) {
    const k = v.program || 'Other';
    byProgram.set(k, [...(byProgram.get(k) ?? []), v]);
  }
  const groups = [...byProgram.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const grandTotal = visits.reduce((s, v) => s + visitAmount(v), 0);
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(160deg, #f4f1ea 0%, #eef2f2 100%)', padding: '24px 12px 48px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <div style={{ padding: '8px 4px 18px' }}>
          <div className="display" style={{ fontSize: 20, fontWeight: 700, color: '#0D7377', letterSpacing: 3 }}>FAJ SOLUTIONS</div>
          <div style={{ fontSize: 11, color: '#8a6d2f', fontWeight: 700, letterSpacing: 2 }}>BILLING — NEEDS INVOICING · {today.toUpperCase()}</div>
        </div>

        <div style={{ background: 'white', borderRadius: 18, boxShadow: '0 18px 60px rgba(13,115,119,0.13)', overflow: 'hidden' }}>
          <div style={{ background: 'linear-gradient(135deg, #0D7377 0%, #0a5a5d 100%)', color: 'white', padding: '22px 26px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <div className="serif" style={{ fontSize: 26, fontWeight: 600 }}>To Be Invoiced</div>
              <div style={{ fontSize: 13, opacity: 0.85 }}>{visits.length} visit{visits.length !== 1 ? 's' : ''} waiting</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, letterSpacing: 1.5, opacity: 0.75, fontWeight: 700 }}>TOTAL VALUE</div>
              <div style={{ fontSize: 26, fontWeight: 800 }}>{money(grandTotal)}</div>
            </div>
          </div>

          <div style={{ padding: '10px 26px 22px' }}>
            {groups.length === 0 && (
              <p style={{ textAlign: 'center', color: '#999', padding: '40px 0' }}>
                Nothing waiting to be invoiced. 🎉
              </p>
            )}
            {groups.map(([prog, progVisits]) => {
              const progTotal = progVisits.reduce((s, v) => s + visitAmount(v), 0);
              return (
                <div key={prog} style={{ marginTop: 18 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: '2px solid #0D7377', padding: '6px 2px' }}>
                    <span style={{ fontWeight: 800, fontSize: 16, color: '#0D7377' }}>{prog}</span>
                    <span style={{ fontWeight: 800 }}>{money(progTotal)}</span>
                  </div>
                  {progVisits.map((v) => (
                    <div key={v.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '10px 2px', borderBottom: '1px solid #f0ede6', flexWrap: 'wrap' }}>
                      <div style={{ minWidth: 220, flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>
                          {[v.site_name, v.site_code ? `#${v.site_code}` : null].filter(Boolean).join(' ') || v.address || 'Site'}
                          <span style={{ color: '#999', fontWeight: 600, fontSize: 12 }}> · {fmtDate(v.visit_date)} · {v.visit_type}</span>
                        </div>
                        <div style={{ fontSize: 12, color: '#888' }}>
                          {[
                            v.hours != null ? `${v.hours}h` : null,
                            v.rate || 'rate not set',
                            v.travel_charge != null ? `travel ${money(Number(v.travel_charge))}` : null,
                          ].filter(Boolean).join(' · ')}
                        </div>
                        {v.notes && <div style={{ fontSize: 12, color: '#aaa', marginTop: 2, display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{v.notes}</div>}
                      </div>
                      <div style={{ fontWeight: 800, fontSize: 15, whiteSpace: 'nowrap' }}>{money(visitAmount(v))}</div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>

          <div style={{ borderTop: '1px solid #f0ede6', padding: '14px 26px', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, fontSize: 12, color: '#999' }}>
            <span>Live view — reload for the latest. Read-only.</span>
            <span className="display" style={{ letterSpacing: 2, color: '#C9A961', fontWeight: 700 }}>FAJ SOLUTIONS LLC</span>
          </div>
        </div>
      </div>
    </div>
  );
}
