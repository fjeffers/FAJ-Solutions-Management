'use client';

// The job log's invoice page, as the client lays theirs out (Fred, 2026-10-30: "this how the client want the
// layout to look", "mirror it exactly"): F.A.J at the top with the logo, INVOICE, who it's billed and shipped to,
// its number, date, terms and due date; then each tech, the lead first, with their hours, meals, mileage and hotel
// day by day and their total; then Labor, Mileage, Meals, Travel and the Total Invoice. lib/job-log-invoice.ts.
// With `edit`, it's edited right on its lines ("the invoice need to be one ... so we edit job log it shows as an
// invoice"): each day's date and hours, meals, miles and hotel, each tech's rates, and the invoice's number and dates.
import type { CSSProperties, ReactNode } from 'react';
import { Plus, X } from 'lucide-react';
import { NumBox } from '@/components/JobSheetEditor';
import { dueDate, FAJ, type Invoice, type InvoiceHead, type InvoiceLine, type InvoiceMeta, type InvoiceSection, type InvoiceTech } from '@/lib/job-log-invoice';

const line = '1px solid #000';
const td: CSSProperties = { padding: '2px 6px', verticalAlign: 'top' };
const right: CSSProperties = { ...td, textAlign: 'right', whiteSpace: 'nowrap' };
const center: CSSProperties = { ...td, textAlign: 'center' };
const label: CSSProperties = { fontSize: 10, color: '#8A8F98', letterSpacing: 0.4, textTransform: 'uppercase' };
const input: CSSProperties = { boxSizing: 'border-box', width: '100%', minHeight: 32, padding: '3px 6px', border: '1px solid #D9D2C3', borderRadius: 6, fontSize: 13, background: '#fff' };

/** What editing on the invoice can change, and how; lib/job-log-invoice.ts editLine and the rest change the time sheet. */
export type InvoiceEditor = {
  meta: InvoiceMeta;
  setMeta: (p: Partial<InvoiceMeta>) => void;
  /** All the hours at one rate (on), or each tech's. */
  together: { on: boolean; hour: number | null };
  setTogether: (t: { on: boolean; hour: number | null }) => void;
  rateOf: (tech: string) => { hour: number | null; mile: number | null };
  setRate: (tech: string, k: 'hour' | 'mile', v: number | null) => void;
  change: (l: InvoiceLine, p: { day?: string; qty?: number | null; amount?: number | null; description?: string }) => void;
  remove: (l: InvoiceLine) => void;
  add: (tech: string, item: 'Labor' | 'Mileage' | 'Material' | 'Hotel') => void;
};

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

function DayBox({ value, label: name, onChange }: { value: string; label: string; onChange: (d: string) => void }) {
  return <input type="date" aria-label={name} style={input} value={value} onChange={(e) => e.target.value && onChange(e.target.value)} />;
}
function Remove({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <button type="button" aria-label={`Take out ${name}`} title="Take this line out" onClick={onClick}
      style={{ width: 26, height: 26, border: 'none', background: 'none', color: '#B42318', cursor: 'pointer', padding: 0 }}><X size={16} /></button>
  );
}
/** "+ Add a day" under a tech's lines. */
function AddRow({ children, onClick, name }: { children: ReactNode; onClick: () => void; name: string }) {
  return (
    <tr className="no-print">
      <td colSpan={8} style={{ ...td, paddingBottom: 6 }}>
        <button type="button" aria-label={name} className="wf-btn wf-btn-ghost wf-btn-sm" onClick={onClick}><Plus size={14} /> {children}</button>
      </td>
    </tr>
  );
}

function Lines({ lines, tech, edit }: { lines: InvoiceLine[]; tech: string; edit?: InvoiceEditor }) {
  return (
    <>
      {lines.map((l, i) => {
        const at = `${tech}, ${day(l.date)}`;
        // On the invoice: the day of a day worked, a drive and a hotel; the hours, the miles, the meals' receipts and
        // the hotel's amount. A meal day follows the days worked.
        const dateCell = edit && l.item !== 'Meal' ? <DayBox value={l.date} label={`${l.item} day, ${at}`} onChange={(d) => edit.change(l, { day: d })} /> : day(l.date);
        const qtyCell = edit && (l.item === 'Labor' || l.item === 'Mileage')
          ? <NumBox label={`${l.item === 'Labor' ? 'Hours' : 'Miles'}, ${at}`} value={l.qty} onChange={(n) => edit.change(l, { qty: n })} />
          : qty(l.qty, l.item === 'Labor');
        const rateCell = edit && l.item === 'Meal' ? <NumBox label={`Meals, ${at}`} value={l.spent || null} onChange={(n) => edit.change(l, { amount: n })} />
          : edit && (l.item === 'Hotel' || l.item === 'Material') ? <NumBox label={`${l.item}, ${at}`} value={l.rate} onChange={(n) => edit.change(l, { amount: n })} />
            : <Money n={l.rate} rate />;
        // A material's store, as typed.
        const description = edit && l.item === 'Material'
          ? <input aria-label={`Material store, ${at}`} style={input} value={l.description} placeholder="Store" onChange={(e) => edit.change(l, { description: e.target.value })} />
          : l.description;
        return (
          <tr key={`${l.item}-${i}`}>
            <td style={td}>{dateCell}</td>
            <td style={center}>{l.item}</td>
            <td style={td} colSpan={2}>{description}</td>
            <td style={right}>{qtyCell}</td>
            <td style={right}>{rateCell}</td>
            <td style={right}><Money n={l.amount} /></td>
            {edit && <td style={td}>{(l.item !== 'Meal' || (l.spent ?? 0) > 0) && <Remove name={`${l.item} ${at}`} onClick={() => edit.remove(l)} />}</td>}
          </tr>
        );
      })}
    </>
  );
}

/** A section's title's line ("Total Meal Allowance … $ 106.02") with a rule over it, then its lines. */
function Section({ s, tech, edit, rate, add }: { s: InvoiceSection; tech: string; edit?: InvoiceEditor; rate?: ReactNode; add?: ReactNode }) {
  return (
    <>
      <tr>
        <td style={td} colSpan={3} />
        <td style={{ ...center, fontWeight: 700, borderTop: line, whiteSpace: 'nowrap' }}>{s.title}</td>
        {rate ? <><td style={{ ...td, borderTop: line }} /><td style={{ ...right, borderTop: line }}>{rate}</td></> : <td style={{ ...td, borderTop: line }} colSpan={2} />}
        <td style={{ ...right, borderTop: line }}><Money n={s.amount} bold /></td>
        {edit && <td style={td} />}
      </tr>
      <Lines lines={s.lines} tech={tech} edit={edit} />
      {add}
    </>
  );
}

function Tech({ t, edit }: { t: InvoiceTech; edit?: InvoiceEditor }) {
  const rates = edit?.rateOf(t.tech);
  // A helper's drives or hotel that are the lead's: a line added goes with the lead's, so the helper keeps sharing
  // them (CodeRabbit on PR #44).
  const ownerOf = (s: InvoiceSection) => s.lines.find((l) => l.tech && l.tech !== t.tech)?.tech ?? t.tech;
  return (
    <tbody className="jl-avoid" style={{ borderBottom: line }}>
      <tr style={{ fontWeight: 700 }}>
        <td style={center} colSpan={2}>{t.role}</td>
        <td style={td}>{t.tech}</td>
        <td style={{ ...center, borderBottom: line }}>{t.hours.title}</td>
        <td style={right}>{qty(t.hours.qty, true)}</td>
        <td style={right}>{edit && !edit.together.on
          ? <NumBox label={`$ per hour, ${t.tech}`} value={rates?.hour ?? null} onChange={(n) => edit.setRate(t.tech, 'hour', n)} />
          : <Money n={t.hours.rate} rate />}</td>
        <td style={right}><Money n={t.hours.amount} bold /></td>
        {edit && <td style={td} />}
      </tr>
      <Lines lines={t.hours.lines} tech={t.tech} edit={edit} />
      {edit && <AddRow name={`Add a day, ${t.tech}`} onClick={() => edit.add(t.tech, 'Labor')}>Add a day</AddRow>}
      <Section s={t.meals} tech={t.tech} edit={edit} />
      <Section s={t.mileage} tech={t.tech} edit={edit}
        rate={edit && <NumBox label={`$ per mile, ${t.tech}`} value={rates?.mile ?? null} onChange={(n) => edit.setRate(t.tech, 'mile', n)} />}
        add={edit && <AddRow name={`Add a drive, ${t.tech}`} onClick={() => edit.add(ownerOf(t.mileage), 'Mileage')}>Add a drive</AddRow>} />
      {/* The materials, on the lead's part before the hotel (Fred: "under lead tech before hotel"). */}
      {t.materials && (t.materials.lines.length > 0 || edit) && (
        <Section s={t.materials} tech={t.tech} edit={edit}
          add={edit && <AddRow name={`Add a material, ${t.tech}`} onClick={() => edit.add(t.tech, 'Material')}>Add a material</AddRow>} />
      )}
      <Section s={t.travel} tech={t.tech} edit={edit}
        add={edit && <AddRow name={`Add a hotel, ${t.tech}`} onClick={() => edit.add(ownerOf(t.travel), 'Hotel')}>Add a hotel</AddRow>} />
      <tr>
        <td style={td} colSpan={3} />
        <td style={{ ...center, fontWeight: 700, textDecoration: 'underline', borderTop: line }}>{t.role} Total</td>
        <td style={{ ...td, borderTop: line }} colSpan={2} />
        <td style={{ ...right, borderTop: line }}><Money n={t.total} bold /></td>
        {edit && <td style={td} />}
      </tr>
    </tbody>
  );
}

/** The invoice's own boxes, at its top while it's edited: the number, date and terms, the labor, the meals, the hours' rate. */
function EditTop({ edit }: { edit: InvoiceEditor }) {
  const { meta, setMeta, together } = edit;
  const field: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12 };
  return (
    <div className="no-print" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end', marginTop: 12, padding: '10px 12px', background: '#FBF6EA', border: '1px solid #E3C987', borderRadius: 10 }}>
      <label style={{ ...field, width: 110 }}>Invoice #
        <input style={input} value={meta.number} onChange={(e) => setMeta({ number: e.target.value })} />
      </label>
      <label style={field}>Date
        <input type="date" style={input} value={meta.date} onChange={(e) => e.target.value && setMeta({ date: e.target.value })} />
      </label>
      <div style={{ ...field, width: 90 }}>Terms (net days)
        <NumBox label="Terms, net days" value={meta.terms} onChange={(n) => setMeta({ terms: n == null ? 30 : Math.round(n) })} />
      </div>
      <div style={{ ...field, width: 130 }}>Meal allowance a day
        <NumBox label="Meal allowance a day" value={meta.meal} onChange={(n) => setMeta({ meal: n })} />
      </div>
      <label style={{ ...field, flex: '1 1 240px' }}>What the labor was (each day’s line)
        <input style={input} value={meta.labor} onChange={(e) => setMeta({ labor: e.target.value })} />
      </label>
      {/* The techs' hours each at their own rate, or all at one (Fred: "give me the options for together or separate hours"). */}
      <div role="group" aria-label="Hours on the invoice" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, flexBasis: '100%' }}>
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>Hours:</span>
        <button type="button" aria-pressed={!together.on} className={`wf-btn wf-btn-sm ${!together.on ? 'wf-btn-navy' : 'wf-btn-outline'}`} onClick={() => edit.setTogether({ ...together, on: false })}>Separate (each tech’s rate)</button>
        <button type="button" aria-pressed={together.on} className={`wf-btn wf-btn-sm ${together.on ? 'wf-btn-navy' : 'wf-btn-outline'}`} onClick={() => edit.setTogether({ ...together, on: true })}>Together (one rate)</button>
        {together.on && <span style={{ width: 110 }}><NumBox label="$ per hour, all techs" value={together.hour} onChange={(n) => edit.setTogether({ on: true, hour: n })} /></span>}
      </div>
    </div>
  );
}

export default function JobLogInvoice({ invoice, head, edit }: { invoice: Invoice; head: InvoiceHead; edit?: InvoiceEditor }) {
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
      {edit && <EditTop edit={edit} />}

      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 18 }}>
        <colgroup>
          <col style={{ width: edit ? '15%' : '12%' }} /><col style={{ width: '9%' }} /><col style={{ width: edit ? '24%' : '31%' }} /><col style={{ width: '16%' }} />
          <col style={{ width: edit ? '10%' : '9%' }} /><col style={{ width: edit ? '11%' : '10%' }} /><col style={{ width: '11%' }} />
          {edit && <col style={{ width: 30 }} />}
        </colgroup>
        <thead>
          <tr style={{ fontWeight: 700 }}>
            {['Date', 'Item', 'Description', 'Qty', 'Rate', 'Amount'].map((h) => (
              <th key={h} colSpan={h === 'Description' ? 2 : 1} style={{ ...center, border: line, fontWeight: 700 }}>{h}</th>
            ))}
            {edit && <th style={td} />}
          </tr>
        </thead>
        {invoice.techs.map((t) => <Tech key={t.tech} t={t} edit={edit} />)}
        <tbody className="jl-avoid">
          <tr><td colSpan={7} style={{ ...center, fontWeight: 700, textDecoration: 'underline', borderBottom: '2px solid #000', paddingTop: 12 }}>Totals</td></tr>
          {([['Labor', invoice.totals.labor], ['Mileage', invoice.totals.mileage], ['Meals', invoice.totals.meals],
            ...(invoice.techs.some((t) => t.materials?.lines.length) ? [['Materials', invoice.totals.materials] as const] : []),
            ['Travel', invoice.totals.travel]] as const).map(([k, v]) => (
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
