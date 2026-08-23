// Public client-facing invoice — shared via unguessable token link
// (invoices.share_token, migration-042). No login: the client taps the link
// from a text/email and sees a branded, printable invoice. Read-only; reads
// through the service-role client since the viewer has no session.
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Invoice, InvoicePayment } from '@/lib/types';
import PrintButton from './PrintButton';
import { todayISO } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Invoice — FAJ Solutions LLC',
  robots: { index: false, follow: false },
};

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

const fmtDate = (d: string | null) => {
  if (!d) return null;
  return new Date(d.split('T')[0] + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });
};

export default async function PublicInvoicePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 16) notFound();

  const supabase = createAdminClient();
  const { data: invoice } = await supabase
    .from('invoices').select('*').eq('share_token', token).maybeSingle<Invoice>();
  if (!invoice) notFound();

  const { data: payments } = await supabase
    .from('invoice_payments').select('*').eq('invoice_id', invoice.id)
    .order('payment_date') as { data: InvoicePayment[] | null };

  const paid = (payments ?? []).reduce((s, p) => s + Number(p.amount), 0);
  const balance = Math.max(0, Number(invoice.total) - paid);
  const overdue = balance > 0 && invoice.due_date && invoice.due_date < todayISO();
  const statusLabel = balance <= 0 && Number(invoice.total) > 0 ? 'PAID' : overdue ? 'OVERDUE' : paid > 0 ? 'PARTIALLY PAID' : 'DUE';
  const statusColor = statusLabel === 'PAID' ? '#047857' : statusLabel === 'OVERDUE' ? '#b91c1c' : '#b45309';

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(160deg, #f4f1ea 0%, #eef2f2 100%)', padding: '24px 12px 48px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        {/* Brand bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 4px 18px', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div className="display" style={{ fontSize: 20, fontWeight: 700, color: '#0D7377', letterSpacing: 3 }}>FAJ SOLUTIONS</div>
            <div style={{ fontSize: 11, color: '#8a6d2f', fontWeight: 700, letterSpacing: 2 }}>FIELD SERVICES · NETWORKING · LLC</div>
          </div>
          <PrintButton />
        </div>

        {/* Invoice card */}
        <div style={{ background: 'white', borderRadius: 18, boxShadow: '0 18px 60px rgba(13,115,119,0.13)', overflow: 'hidden' }}>
          <div style={{ background: 'linear-gradient(135deg, #0D7377 0%, #0a5a5d 100%)', color: 'white', padding: '26px 28px', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, letterSpacing: 2, opacity: 0.75, fontWeight: 700 }}>INVOICE</div>
              <div className="serif" style={{ fontSize: 30, fontWeight: 600, lineHeight: 1.1 }}>{invoice.invoice_number}</div>
              {invoice.title && <div style={{ fontSize: 13, opacity: 0.85, marginTop: 4 }}>{invoice.title}</div>}
            </div>
            <div style={{ textAlign: 'right' }}>
              <span style={{ display: 'inline-block', background: 'white', color: statusColor, fontWeight: 800, fontSize: 12, letterSpacing: 1.5, borderRadius: 999, padding: '6px 16px' }}>
                {statusLabel}
              </span>
              {invoice.due_date && (
                <div style={{ fontSize: 12, opacity: 0.85, marginTop: 8 }}>Due {fmtDate(invoice.due_date)}</div>
              )}
            </div>
          </div>

          <div style={{ padding: '24px 28px' }}>
            {/* Parties */}
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, marginBottom: 22 }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.5, color: '#999' }}>BILLED TO</div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{invoice.client_name || 'Client'}</div>
                {invoice.client_email && <div style={{ fontSize: 13, color: '#666' }}>{invoice.client_email}</div>}
                {invoice.client_phone && <div style={{ fontSize: 13, color: '#666' }}>{invoice.client_phone}</div>}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.5, color: '#999' }}>FROM</div>
                <div style={{ fontWeight: 700 }}>FAJ Solutions LLC</div>
                <div style={{ fontSize: 13, color: '#666' }}>fajsolutions@gmail.com</div>
                <div style={{ fontSize: 13, color: '#666' }}>Issued {fmtDate(invoice.created_at)}</div>
              </div>
            </div>

            {invoice.description && (
              <p style={{ fontSize: 13, color: '#555', margin: '0 0 18px' }}>{invoice.description}</p>
            )}

            {/* Line items */}
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  {['Description', 'Qty', 'Rate', 'Amount'].map((h, i) => (
                    <th key={h} style={{ textAlign: i === 0 ? 'left' : 'right', padding: '8px 6px', borderBottom: '2px solid #0D7377', fontSize: 10, letterSpacing: 1.2, color: '#0D7377' }}>{h.toUpperCase()}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invoice.line_items.map((li) => (
                  <tr key={li.id}>
                    <td style={{ padding: '10px 6px', borderBottom: '1px solid #f0ede6' }}>{li.description}</td>
                    <td style={{ padding: '10px 6px', borderBottom: '1px solid #f0ede6', textAlign: 'right', whiteSpace: 'nowrap' }}>{li.quantity}</td>
                    <td style={{ padding: '10px 6px', borderBottom: '1px solid #f0ede6', textAlign: 'right', whiteSpace: 'nowrap' }}>{money(Number(li.rate))}</td>
                    <td style={{ padding: '10px 6px', borderBottom: '1px solid #f0ede6', textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 700 }}>{money(Number(li.quantity) * Number(li.rate))}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Totals */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <div style={{ minWidth: 240 }}>
                <TotalRow label="Subtotal" value={money(Number(invoice.subtotal))} />
                {Number(invoice.tax_amount) > 0 && <TotalRow label={`Tax (${invoice.tax_rate}%)`} value={money(Number(invoice.tax_amount))} />}
                <TotalRow label="Total" value={money(Number(invoice.total))} bold />
                {paid > 0 && <TotalRow label="Payments received" value={`− ${money(paid)}`} color="#047857" />}
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 6px', marginTop: 6, borderTop: '2px solid #0D7377', fontSize: 18, fontWeight: 800 }}>
                  <span>Balance Due</span>
                  <span style={{ color: statusColor }}>{money(balance)}</span>
                </div>
              </div>
            </div>

            {invoice.notes && (
              <div style={{ background: '#f8f6f1', borderRadius: 12, padding: '12px 16px', marginTop: 18, fontSize: 13, color: '#555' }}>
                <b style={{ color: '#8a6d2f' }}>Notes: </b>{invoice.notes}
              </div>
            )}
          </div>

          <div style={{ borderTop: '1px solid #f0ede6', padding: '16px 28px', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, fontSize: 12, color: '#999' }}>
            <span>Thank you for your business.</span>
            <span className="display" style={{ letterSpacing: 2, color: '#C9A961', fontWeight: 700 }}>FAJ SOLUTIONS LLC</span>
          </div>
        </div>

        <p className="no-print" style={{ textAlign: 'center', fontSize: 11, color: '#aaa', marginTop: 16 }}>
          Questions about this invoice? Reply to the message it came with, or email fajsolutions@gmail.com
        </p>
      </div>
    </div>
  );
}

function TotalRow({ label, value, bold = false, color }: { label: string; value: string; bold?: boolean; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 6px', fontSize: 13, fontWeight: bold ? 800 : 500, color: color ?? (bold ? '#1a1a1a' : '#666') }}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
