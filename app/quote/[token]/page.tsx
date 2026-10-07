// Public client-facing quote — shared via unguessable token link
// (quotes.share_token, migration-044). Mirrors the invoice page: the client
// taps a link from a text/email and sees a branded, printable quote.
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Quote, Survey } from '@/lib/types';
import PrintButton from '../../invoice/[token]/PrintButton';
import QuotePlacements from './QuotePlacements';
import { todayISO } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Quote — FAJ Solutions LLC',
  robots: { index: false, follow: false },
};

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const fmtDate = (d: string | null) =>
  d ? new Date(d.split('T')[0] + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : null;

const STATUS: Record<string, { label: string; color: string }> = {
  draft:    { label: 'QUOTE',    color: '#0E1B2E' },
  sent:     { label: 'QUOTE',    color: '#0E1B2E' },
  accepted: { label: 'ACCEPTED', color: '#047857' },
  rejected: { label: 'DECLINED', color: '#b91c1c' },
  expired:  { label: 'EXPIRED',  color: '#999999' },
};

export default async function PublicQuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 16) notFound();

  const supabase = createAdminClient();
  const { data: quote } = await supabase
    .from('quotes').select('*').eq('share_token', token).maybeSingle<Quote>();
  if (!quote) notFound();

  // The walk-through behind this quote, when there is one. It carries the
  // placement photos and the site address; a quote written by hand simply
  // has none, and the page renders without the section.
  const { data: survey } = quote.survey_id
    ? await supabase.from('surveys').select('*').eq('id', quote.survey_id).maybeSingle<Survey>()
    : { data: null };

  const st = STATUS[quote.status] ?? STATUS.sent;
  const expired = quote.valid_until && quote.valid_until < todayISO();

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(160deg, #f4f1ea 0%, #eef2f2 100%)', padding: '24px 12px 48px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 4px 18px', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div className="display" style={{ fontSize: 20, fontWeight: 700, color: '#0E1B2E', letterSpacing: 3 }}>FAJ SOLUTIONS</div>
            <div style={{ fontSize: 11, color: '#8a6d2f', fontWeight: 700, letterSpacing: 2 }}>FIELD SERVICES · NETWORKING · LLC</div>
          </div>
          <PrintButton />
        </div>

        <div style={{ background: 'white', borderRadius: 18, boxShadow: '0 18px 60px rgba(14,27,46,0.13)', overflow: 'hidden' }}>
          <div style={{ background: 'linear-gradient(135deg, #0E1B2E 0%, #13284A 100%)', color: 'white', padding: '26px 28px', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, letterSpacing: 2, opacity: 0.75, fontWeight: 700 }}>ESTIMATE / QUOTE</div>
              <div className="serif" style={{ fontSize: 30, fontWeight: 600, lineHeight: 1.1 }}>{quote.quote_number}</div>
              {quote.title && <div style={{ fontSize: 13, opacity: 0.85, marginTop: 4 }}>{quote.title}</div>}
            </div>
            <div style={{ textAlign: 'right' }}>
              <span style={{ display: 'inline-block', background: 'white', color: st.color, fontWeight: 800, fontSize: 12, letterSpacing: 1.5, borderRadius: 999, padding: '6px 16px' }}>
                {st.label}
              </span>
              {quote.valid_until && (
                <div style={{ fontSize: 12, opacity: 0.85, marginTop: 8 }}>
                  {expired ? 'Expired' : 'Valid through'} {fmtDate(quote.valid_until)}
                </div>
              )}
            </div>
          </div>

          <div style={{ padding: '24px 28px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, marginBottom: 22 }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.5, color: '#999' }}>PREPARED FOR</div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{quote.client_name || 'Client'}</div>
                {quote.client_email && <div style={{ fontSize: 13, color: '#666' }}>{quote.client_email}</div>}
                {quote.client_phone && <div style={{ fontSize: 13, color: '#666' }}>{quote.client_phone}</div>}
                {survey && (survey.site_name || survey.site_address) && (
                  <div style={{ fontSize: 13, color: '#666', marginTop: 6 }}>
                    <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.5, color: '#999', display: 'block' }}>SITE</span>
                    {survey.site_name}
                    {survey.site_address && <div>{survey.site_address}</div>}
                    {(survey.site_city || survey.site_state || survey.site_zip) && (
                      <div>{[survey.site_city, survey.site_state].filter(Boolean).join(', ')} {survey.site_zip}</div>
                    )}
                  </div>
                )}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.5, color: '#999' }}>FROM</div>
                <div style={{ fontWeight: 700 }}>FAJ Solutions LLC</div>
                <div style={{ fontSize: 13, color: '#666' }}>fajsolutions@gmail.com</div>
                <div style={{ fontSize: 13, color: '#666' }}>Prepared {fmtDate(quote.created_at)}</div>
              </div>
            </div>

            {quote.description && <p style={{ fontSize: 13, color: '#555', margin: '0 0 18px' }}>{quote.description}</p>}

            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  {['Description', 'Qty', 'Rate', 'Amount'].map((h, i) => (
                    <th key={h} style={{ textAlign: i === 0 ? 'left' : 'right', padding: '8px 6px', borderBottom: '2px solid #0E1B2E', fontSize: 10, letterSpacing: 1.2, color: '#0E1B2E' }}>{h.toUpperCase()}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {quote.line_items.map((li) => (
                  <tr key={li.id}>
                    <td style={{ padding: '10px 6px', borderBottom: '1px solid #f0ede6' }}>{li.description}</td>
                    <td style={{ padding: '10px 6px', borderBottom: '1px solid #f0ede6', textAlign: 'right', whiteSpace: 'nowrap' }}>{li.quantity}</td>
                    <td style={{ padding: '10px 6px', borderBottom: '1px solid #f0ede6', textAlign: 'right', whiteSpace: 'nowrap' }}>{money(Number(li.rate))}</td>
                    <td style={{ padding: '10px 6px', borderBottom: '1px solid #f0ede6', textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 700 }}>{money(Number(li.quantity) * Number(li.rate))}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <div style={{ minWidth: 240 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 6px', fontSize: 13, color: '#666' }}>
                  <span>Subtotal</span><span>{money(Number(quote.subtotal))}</span>
                </div>
                {Number(quote.tax_amount) > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 6px', fontSize: 13, color: '#666' }}>
                    <span>Tax ({quote.tax_rate}%)</span><span>{money(Number(quote.tax_amount))}</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 6px', marginTop: 6, borderTop: '2px solid #0E1B2E', fontSize: 18, fontWeight: 800 }}>
                  <span>Estimate Total</span>
                  <span style={{ color: '#0E1B2E' }}>{money(Number(quote.total))}</span>
                </div>
              </div>
            </div>

            {survey && <QuotePlacements survey={survey} />}

            {quote.notes && (
              <div style={{ background: '#f8f6f1', borderRadius: 12, padding: '12px 16px', marginTop: 18, fontSize: 13, color: '#555' }}>
                <b style={{ color: '#8a6d2f' }}>Notes: </b>{quote.notes}
              </div>
            )}

            <div style={{ background: 'rgba(14,27,46,0.06)', borderRadius: 12, padding: '14px 16px', marginTop: 18, fontSize: 13, color: '#333' }}>
              <b>Ready to move forward?</b> Reply to the message this quote came with, or email
              {' '}<a href="mailto:fajsolutions@gmail.com" style={{ color: '#0E1B2E', fontWeight: 700 }}>fajsolutions@gmail.com</a>{' '}
              to approve — we&apos;ll schedule your work right away.
            </div>
          </div>

          <div style={{ borderTop: '1px solid #f0ede6', padding: '16px 28px', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, fontSize: 12, color: '#999' }}>
            <span>Thank you for considering FAJ Solutions.</span>
            <span className="display" style={{ letterSpacing: 2, color: '#C9A24B', fontWeight: 700 }}>FAJ SOLUTIONS LLC</span>
          </div>
        </div>
      </div>
    </div>
  );
}
