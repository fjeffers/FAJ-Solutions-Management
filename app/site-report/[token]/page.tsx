import { createClient } from '@supabase/supabase-js';
import { notFound } from 'next/navigation';
import {
  groupBySite, siteReportTotals, fmtDay, fmtClock, fmtSessions, clientVisibleNote,
  type ReportVisit,
} from '@/lib/site-report';

// Public, read-only site activity report (migration 049), reached by an
// unguessable token — same pattern as /invoice/<token> and /billing/<token>,
// and allowed through proxy.ts.
//
// Money-free by construction: get_shared_site_report selects dates, sites, hours
// and notes only. There is no rate or total to leak because none is fetched.
// A wrong token 404s rather than hinting that a report exists.

export const dynamic = 'force-dynamic';
// Same as the invoice/quote/billing pages — a shared client report must never
// be indexed, even though the token makes it unguessable.
export const metadata = { robots: { index: false, follow: false } };

type Payload = {
  customer: { name: string; city: string | null; state: string | null };
  visits: ReportVisit[];
};

export default async function SiteReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  const { data, error } = await supabase.rpc('get_shared_site_report', { p_token: token });
  if (error || !data) return notFound();

  const { customer, visits } = data as Payload;
  const totals = siteReportTotals(visits);
  const groups = groupBySite(visits);
  const place = [customer.city, customer.state].filter(Boolean).join(', ');

  return (
    <div style={{ minHeight: '100vh', background: '#f4f1ea', padding: '28px 14px', fontFamily: 'Arial, Helvetica, sans-serif', color: '#1a1a1a', overflowX: 'hidden' }}>
      <div style={{ maxWidth: 860, margin: '0 auto', overflowWrap: 'anywhere' }}>

        <div style={{ padding: '0 4px 16px' }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#0E1B2E', letterSpacing: 3 }}>FAJ SOLUTIONS</div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#8a6d2f', letterSpacing: 2 }}>SITE ACTIVITY REPORT</div>
        </div>

        <div style={{ background: 'linear-gradient(135deg,#0E1B2E,#13284A)', borderRadius: '16px 16px 0 0', color: '#fff', padding: '22px 26px' }}>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{customer.name}</div>
          {place && <div style={{ fontSize: 13, opacity: 0.85, marginTop: 2 }}>{place}</div>}
          <div style={{ fontSize: 12, opacity: 0.8, marginTop: 8 }}>
            {totals.firstVisit && totals.lastVisit
              ? `${fmtDay(totals.firstVisit)} — ${fmtDay(totals.lastVisit)}`
              : 'No visits recorded yet'}
          </div>
        </div>

        <div style={{ background: '#faf9f6', borderRadius: '0 0 16px 16px', border: '1px solid #eee', borderTop: 'none', padding: 18 }}>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 10, marginBottom: 18 }}>
            {[
              ['Sites', String(totals.sites)],
              ['Visits', String(totals.visits)],
              ['Hours on site', totals.hours.toFixed(1)],
            ].map(([label, value]) => (
              <div key={label} style={{ background: '#fff', border: '1px solid #eee', borderRadius: 12, padding: '13px 15px' }}>
                <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1, color: '#999', textTransform: 'uppercase' }}>{label}</div>
                <div style={{ fontSize: 21, fontWeight: 800, color: '#0E1B2E' }}>{value}</div>
              </div>
            ))}
          </div>

          {groups.length === 0 && (
            <div style={{ fontSize: 13, color: '#888', padding: '10px 2px' }}>
              No site visits have been logged for this account yet.
            </div>
          )}

          {groups.map((g) => (
            <div key={g.title} style={{ background: '#fff', border: '1px solid #eee', borderRadius: 12, padding: '15px 17px', marginBottom: 12 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'baseline', marginBottom: 8 }}>
                <div style={{ fontSize: 15, fontWeight: 800, overflowWrap: 'anywhere' }}>{g.title}</div>
                <div style={{ fontSize: 11, color: '#999' }}>
                  {g.visits.length} visit{g.visits.length !== 1 ? 's' : ''}
                </div>
              </div>

              {g.visits.map((v, i) => {
                const sessions = fmtSessions(v.sessions);
                const times = [fmtClock(v.time_in), fmtClock(v.time_out)].filter(Boolean).join(' – ');
                const note = clientVisibleNote(v);
                return (
                  <div key={i} style={{ padding: '9px 0', borderTop: i === 0 ? 'none' : '1px solid #f5f2ea' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 12px', alignItems: 'baseline' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, minWidth: 110 }}>{fmtDay(v.visit_date) || '—'}</div>
                      {times && <div style={{ fontSize: 12, color: '#555' }}>{times}</div>}
                      {v.hours != null && <div style={{ fontSize: 12, fontWeight: 700, color: '#0E1B2E' }}>{v.hours}h</div>}
                      {v.visit_type && (
                        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', color: '#7c3aed' }}>
                          {v.visit_type}
                        </div>
                      )}
                    </div>
                    {note && (
                      <div style={{ fontSize: 12.5, color: '#333', marginTop: 3, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                        {note}
                      </div>
                    )}
                    {sessions && (
                      <div style={{ fontSize: 11, color: '#888', marginTop: 3 }}>{sessions}</div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}

          <div style={{ textAlign: 'center', fontSize: 11, color: '#aaa', padding: '14px 0 2px' }}>
            FAJ Solutions · Read-only site activity report
          </div>
        </div>
      </div>
    </div>
  );
}
