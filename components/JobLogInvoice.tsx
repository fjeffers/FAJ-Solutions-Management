'use client';

// The job log's invoice page, as the client lays theirs out (Fred, 2026-10-30: "this how the client want the
// layout to look", "mirror it exactly"): F.A.J at the top with the logo, INVOICE, who it's billed and shipped to,
// its number, date, terms and due date; then each tech, the lead first, with their hours, meals, mileage and hotel
// day by day and their total; then Labor, Mileage, Meals, Travel and the Total Invoice. lib/job-log-invoice.ts.
import type { CSSProperties } from 'react';
import { dueDate, FAJ, type Invoice, type InvoiceHead, type InvoiceLine, type InvoiceSection } from '@/lib/job-log-invoice';

const line = '1px solid #000';
const td: CSSProperties = { padding: '2px 6px', verticalAlign: 'top' };
const right: CSSProperties = { ...td, textAlign: 'right', whiteSpace: 'nowrap' };
const center: CSSProperties = { ...td, textAlign: 'center' };
const label: CSSProperties = { fontSize: 10, color: '#8A8F98', letterSpacing: 0.4, textTransform: 'uppercase' };

/** 10/19/2026 */
const day = (d: string) => `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}`;
/** "$ 1,579.75", a nought as "$ -", as the client's Accounting columns; a rate to four places as typed ($0.725). */
function Money({ n, bold, rate }: { n: number | null; bold?: boolean; rate?: boolean }) {
  if (n == null) return null;
  return (
    <span style={{ display: 'flex', justifyContent: 'space-between', gap: 6, fontWeight: bold ? 700 : undefined }}>
      <span>$</span><span>{n === 0 ? '-' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: rate ? 4 : 2 })}</span>
    </span>
  );
}
/** A quantity as theirs: hours to two places (10.20), miles and the rest as they are (478, 1). */
const qty = (n: number | null, hours?: boolean) => (n == null ? '' : n.toLocaleString('en-US', { minimumFractionDigits: hours ? 2 : 0, maximumFractionDigits: hours ? 2 : 1 }));

function Lines({ lines }: { lines: InvoiceLine[] }) {
  return (
    <>
      {lines.map((l, i) => (
        <tr key={`${l.item}-${l.date}-${i}`}>
          <td style={td}>{day(l.date)}</td>
          <td style={center}>{l.item}</td>
          <td style={td} colSpan={2}>{l.description}</td>
          <td style={right}>{qty(l.qty, l.item === 'Labor')}</td>
          <td style={right}><Money n={l.rate} rate /></td>
          <td style={right}><Money n={l.amount} /></td>
        </tr>
      ))}
    </>
  );
}

/** A section's title's line ("Total Meal Allowance … $ 106.02") with a rule over it, then its lines. */
function Section({ s }: { s: InvoiceSection }) {
  return (
    <>
      <tr>
        <td style={td} colSpan={3} />
        <td style={{ ...center, fontWeight: 700, borderTop: line, whiteSpace: 'nowrap' }}>{s.title}</td>
        <td style={{ ...td, borderTop: line }} colSpan={2} />
        <td style={{ ...right, borderTop: line }}><Money n={s.amount} bold /></td>
      </tr>
      <Lines lines={s.lines} />
    </>
  );
}

export default function JobLogInvoice({ invoice, head }: { invoice: Invoice; head: InvoiceHead }) {
  const { meta } = head;
  return (
    <div className="jl-invoice" style={{ padding: '24px 28px 32px', fontFamily: 'Calibri, Carlito, Arial, sans-serif', fontSize: 12.5, color: '#000' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
        <div style={{ fontSize: 10.5, lineHeight: 1.5 }}>
          <div style={{ fontWeight: 700, fontSize: 12.5 }}>{FAJ.name}</div>
          {FAJ.lines.map((l) => <div key={l}>{l}</div>)}
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/wf/logo-wide.png" alt="F.A.J Solutions — Technology. Delivered." style={{ height: 70, width: 'auto' }} />
      </div>
      <div style={{ color: '#3E7CC2', fontSize: 20, marginTop: 18, letterSpacing: 0.5 }}>INVOICE</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.4fr) auto', gap: 16, marginTop: 8, fontSize: 11 }}>
        <div><div style={label}>Bill to</div><div>{head.billTo}</div></div>
        <div><div style={label}>Ship to</div>{head.shipTo.map((l) => <div key={l}>{l}</div>)}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto auto', columnGap: 24 }}>
          {[['Invoice', meta.number], ['Date', day(meta.date)], ['Terms', `Net ${meta.terms}`], ['Due date', day(dueDate(meta.date, meta.terms))]].map(([k, v]) => (
            <div key={k} style={{ display: 'contents' }}><span style={label}>{k}</span><span>{v}</span></div>
          ))}
        </div>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 18 }}>
        <colgroup>
          <col style={{ width: '12%' }} /><col style={{ width: '9%' }} /><col style={{ width: '31%' }} /><col style={{ width: '18%' }} />
          <col style={{ width: '9%' }} /><col style={{ width: '10%' }} /><col style={{ width: '11%' }} />
        </colgroup>
        <thead>
          <tr style={{ fontWeight: 700 }}>
            {['Date', 'Item', 'Description', 'Qty', 'Rate', 'Amount'].map((h) => (
              <th key={h} colSpan={h === 'Description' ? 2 : 1} style={{ ...center, border: line, fontWeight: 700 }}>{h}</th>
            ))}
          </tr>
        </thead>
        {invoice.techs.map((t) => (
          <tbody key={t.tech} className="jl-avoid" style={{ borderBottom: line }}>
            <tr style={{ fontWeight: 700 }}>
              <td style={center} colSpan={2}>{t.role}</td>
              <td style={td}>{t.tech}</td>
              <td style={{ ...center, borderBottom: line }}>{t.hours.title}</td>
              <td style={right}>{qty(t.hours.qty, true)}</td>
              <td style={right}><Money n={t.hours.rate} rate /></td>
              <td style={right}><Money n={t.hours.amount} bold /></td>
            </tr>
            <Lines lines={t.hours.lines} />
            <Section s={t.meals} />
            <Section s={t.mileage} />
            <Section s={t.travel} />
            <tr>
              <td style={td} colSpan={3} />
              <td style={{ ...center, fontWeight: 700, textDecoration: 'underline', borderTop: line }}>{t.role} Total</td>
              <td style={{ ...td, borderTop: line }} colSpan={2} />
              <td style={{ ...right, borderTop: line }}><Money n={t.total} bold /></td>
            </tr>
          </tbody>
        ))}
        <tbody className="jl-avoid">
          <tr><td colSpan={7} style={{ ...center, fontWeight: 700, textDecoration: 'underline', borderBottom: '2px solid #000', paddingTop: 12 }}>Totals</td></tr>
          {([['Labor', invoice.totals.labor], ['Mileage', invoice.totals.mileage], ['Meals', invoice.totals.meals], ['Travel', invoice.totals.travel]] as const).map(([k, v]) => (
            <tr key={k}><td colSpan={5} style={right}>{k}</td><td style={td} /><td style={right}><Money n={v} /></td></tr>
          ))}
          <tr>
            <td colSpan={5} style={{ ...right, fontWeight: 700, textDecoration: 'underline' }}>Total Invoice</td><td style={td} />
            <td style={{ ...right, borderTop: '3px double #000' }}><Money n={invoice.totals.total} bold /></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
