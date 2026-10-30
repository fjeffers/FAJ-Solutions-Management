'use client';

// The job log's tables to edit (Fred, 2026-10-30: "I need to edit all of it hours time milages materials etc all
// of it"): every row's tech, date, clock in and out, break, odometer, miles, store and amount, a row added or
// taken out, each section's hours, miles or money worked out as it's typed (lib/job-log-sheet.ts). Each row's
// boxes go two to a line on a phone and the whole row on one line on a computer (.jse-row, app/wf.css).
import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import {
  hoursTotal, milesFromOdometer, milesTotal, moneyTotal, rowHours,
  type JobSheet, type MileRow, type MoneyRow, type TimeRow,
} from '@/lib/job-log-sheet';

type Section = 'time' | 'miles' | 'meals' | 'materials' | 'other';

const box: React.CSSProperties = { boxSizing: 'border-box', width: '100%', minWidth: 0, minHeight: 36, padding: '5px 8px', border: '1px solid #D9D2C3', borderRadius: 6, fontSize: 14, background: '#fff', color: '#1B1C1F' };
const fmt = (n: number | null) => (n == null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: 2 }));

/** A box with its name above it (the box's own label says which row, for a screen reader). */
const Field = ({ name, children }: { name: string; children: React.ReactNode }) => (
  <div style={{ display: 'grid', gap: 2, minWidth: 0 }}>
    <span aria-hidden="true" style={{ fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, color: '#5E6470' }}>{name}</span>
    {children}
  </div>
);

/**
 * A number typed as text, so "47." can be typed on the way to "47.48"; anything that isn't a number isn't taken.
 * An empty box is `empty` (none, or 0 for an amount or a break), and shows empty.
 */
function NumBox({ value, onChange, label, empty = null }: {
  value: number | null; onChange: (n: number | null) => void; label: string; empty?: number | null;
}) {
  const show = (n: number | null) => (n == null || n === empty ? '' : String(n));
  const [text, setText] = useState(show(value));
  const [seen, setSeen] = useState(value);
  // A new value from outside (the miles worked out from the odometer): show it.
  if (value !== seen) {
    setSeen(value);
    setText(show(value));
  }
  return (
    <input aria-label={label} inputMode="decimal" style={box} value={text}
      onChange={(e) => {
        const t = e.target.value;
        // Only what makes a number ("$1,234.5", "47."): a slip like "18..50" isn't taken, so the box never shows
        // one figure while the sheet keeps another (Greptile on PR #39).
        if (!/^\s*\$?[\d,]*\.?\d*\s*$/.test(t)) return;
        setText(t);
        const digits = t.replace(/[$,\s]/g, '');
        if (digits === '' || digits === '.') { setSeen(empty); onChange(empty); return; }
        const n = Number(digits);
        setSeen(n);
        onChange(n);
      }} />
  );
}

export default function JobSheetEditor({ sheet, onChange, crew, firstDay }: {
  sheet: JobSheet;
  onChange: (s: JobSheet) => void;
  /** The job's techs, the lead first: offered for a row's name. */
  crew: string[];
  /** The day a new row starts on when its section has none yet. */
  firstDay: string;
}) {
  const set = <K extends Section>(k: K, rows: JobSheet[K]) => onChange({ ...sheet, [k]: rows });
  const edit = <K extends Section>(k: K, i: number, patch: Partial<JobSheet[K][number]>) =>
    set(k, sheet[k].map((r, j) => (j === i ? { ...r, ...patch } : r)) as JobSheet[K]);
  const remove = (k: Section, i: number) => set(k, sheet[k].filter((_, j) => j !== i) as JobSheet[typeof k]);
  const lastDay = (k: Section) => sheet[k].at(-1)?.day || firstDay;
  const add = (k: Section) => {
    const base = { tech: sheet[k].at(-1)?.tech || crew[0] || '', day: lastDay(k) };
    const row = k === 'time' ? { ...base, in: '', out: '', brk: 0 }
      : k === 'miles' ? { ...base, start: null, end: null, miles: 0 }
        : { ...base, store: '', amount: 0, ...(k === 'other' ? { for: '' } : {}) };
    set(k, [...sheet[k], row] as JobSheet[typeof k]);
  };

  /** A row: its boxes, wrapping as the screen allows, and its ✗ to take it out. */
  const row = (k: Section, i: number, r: { tech: string; day: string }, fields: React.ReactNode) => (
    <div key={i} className={`jse-row jse-${k}`} style={{ position: 'relative', padding: '8px 36px 8px 0', borderBottom: '1px solid #ECE8DF' }}>
      <Field name="Name"><input aria-label={`Name, ${k} row ${i + 1}`} list="job-sheet-crew" style={box} value={r.tech} onChange={(e) => edit(k, i, { tech: e.target.value })} /></Field>
      <Field name="Date"><input aria-label={`Date, ${k} row ${i + 1}`} type="date" style={box} value={r.day} onChange={(e) => edit(k, i, { day: e.target.value })} /></Field>
      {fields}
      <button type="button" aria-label={`Take out ${k} row ${i + 1}`} title="Take this row out" onClick={() => remove(k, i)}
        style={{ position: 'absolute', right: 0, top: 22, width: 32, height: 32, border: 'none', background: 'none', color: '#B42318', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={18} /></button>
    </div>
  );
  const part = (title: string, k: Section, rows: React.ReactNode[], total: string) => (
    <div style={{ marginTop: 18 }}>
      <h3 style={{ fontSize: 15, fontWeight: 700, color: '#0E1B2E', margin: '0 0 2px', paddingBottom: 4, borderBottom: '2px solid #C9A24B' }}>{title}</h3>
      {rows.length ? rows : <div style={{ color: '#5E6470', fontSize: 13, padding: '8px 0' }}>None yet.</div>}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="wf-btn wf-btn-ghost wf-btn-sm" onClick={() => add(k)}><Plus size={14} /> Add a row</button>
        <b style={{ fontSize: 13 }}>{total}</b>
      </div>
    </div>
  );
  /** A number worked out from the boxes, where a box would be. */
  const shown = (name: string, value: string) => (
    <Field name={name}><div style={{ ...box, border: '1px solid transparent', background: 'none', fontWeight: 700, paddingLeft: 2 }}>{value}</div></Field>
  );

  const money = (k: 'meals' | 'materials' | 'other', title: string, rows: MoneyRow[]) => part(title, k,
    rows.map((r, i) => row(k, i, r, (
      <>
        {k === 'other' && <Field name="For"><input aria-label={`For, ${k} row ${i + 1}`} style={box} value={r.for ?? ''} onChange={(e) => edit(k, i, { for: e.target.value })} /></Field>}
        <Field name="Store"><input aria-label={`Store, ${k} row ${i + 1}`} style={box} value={r.store} onChange={(e) => edit(k, i, { store: e.target.value })} /></Field>
        <Field name="Amount"><NumBox label={`Amount, ${k} row ${i + 1}`} value={r.amount} empty={0} onChange={(n) => edit(k, i, { amount: n ?? 0 })} /></Field>
      </>
    ))),
    `Total ${moneyTotal(rows).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}`);

  const editMiles = (i: number, r: MileRow, patch: Partial<MileRow>) => {
    const next = { ...r, ...patch };
    edit('miles', i, { ...patch, miles: 'miles' in patch ? next.miles : milesFromOdometer(next) });
  };

  return (
    <div className="no-print">
      <datalist id="job-sheet-crew">{crew.map((t) => <option key={t} value={t} />)}</datalist>

      {/* A new clock in, clock out or break: the hours follow them, not the Hours screen's figure any more. */}
      {part('Time on site', 'time', sheet.time.map((r: TimeRow, i) => row('time', i, r, (
        <>
          <Field name="Clock in"><input aria-label={`Clock in, time row ${i + 1}`} type="time" style={box} value={r.in} onChange={(e) => edit('time', i, { in: e.target.value, hours: undefined })} /></Field>
          <Field name="Clock out"><input aria-label={`Clock out, time row ${i + 1}`} type="time" style={box} value={r.out} onChange={(e) => edit('time', i, { out: e.target.value, hours: undefined })} /></Field>
          <Field name="Break (hours)"><NumBox label={`Break, time row ${i + 1}`} value={r.brk} empty={0} onChange={(n) => edit('time', i, { brk: n ?? 0, hours: undefined })} /></Field>
          {shown('Hours', fmt(rowHours(r)))}
        </>
      ))), `Total ${fmt(hoursTotal(sheet.time))} hours`)}

      {part('Mileage', 'miles', sheet.miles.map((r, i) => row('miles', i, r, (
        <>
          <Field name="Odometer start"><NumBox label={`Odometer start, miles row ${i + 1}`} value={r.start} onChange={(n) => editMiles(i, r, { start: n })} /></Field>
          <Field name="Odometer end"><NumBox label={`Odometer end, miles row ${i + 1}`} value={r.end} onChange={(n) => editMiles(i, r, { end: n })} /></Field>
          <Field name="Miles"><NumBox label={`Miles, miles row ${i + 1}`} value={r.miles} empty={0} onChange={(n) => editMiles(i, r, { miles: n ?? 0 })} /></Field>
        </>
      ))), `Total ${fmt(milesTotal(sheet.miles))} miles`)}

      {money('meals', 'Meals', sheet.meals)}
      {money('materials', 'Materials', sheet.materials)}
      {money('other', 'Other receipts', sheet.other)}
    </div>
  );
}
