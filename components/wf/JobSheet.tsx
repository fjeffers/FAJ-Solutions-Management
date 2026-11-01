'use client';
// The Sheet (Fred, 2026-10-31: "smart sheet features in the work order or monday.com
// features" ... "you can give me all 8"): every job as a spreadsheet row. Status (a
// colored label), date, tech, price and Fred's own columns change right in the row;
// tick rows to change them together; group by status, client, tech or week with totals.
// The rules for what an edit writes: lib/job-sheet.ts.
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Columns3, Plus } from 'lucide-react';
import { WO_STATUSES, type Contractor, type EnrichedWorkOrder, type WorkOrder, type WorkOrderStatus } from '@/lib/types';
import { STATUS_COLORS, fmtMoney } from '@/lib/utils';
import { FIELD_KINDS, asValues, inputValue, setAnswer, type FieldDef, type FieldKind } from '@/lib/custom-fields';
import { SHEET_GROUPS, assignPatch, datePatch, groupSheet, techsOf, type SheetGroupBy, type SheetTotals } from '@/lib/job-sheet';

/** Write a change to these jobs; `make` gets each job as it is now (null skips it). Returns how many changed. */
export type SheetPatch = (ids: string[], make: (w: WorkOrder) => Partial<WorkOrder> | null) => Promise<number>;

type Col = { key: string; label: string; def?: FieldDef; right?: boolean };
const BUILT: Col[] = [
  { key: 'client', label: 'Client' }, { key: 'city', label: 'Where' }, { key: 'date', label: 'Date' }, { key: 'tech', label: 'Tech' },
  { key: 'status', label: 'Status' }, { key: 'pays', label: 'Client pays', right: true }, { key: 'techpay', label: 'Tech pay', right: true },
  { key: 'miles', label: 'Miles', right: true },
];
const HIDDEN_KEY = 'sheet-hidden-cols';
const GROUP_KEY = 'sheet-group';

const cell: CSSProperties = { padding: '6px 10px', borderBottom: '1px solid var(--wf-line)', fontSize: 13.5, verticalAlign: 'middle', whiteSpace: 'nowrap' };

/** A box that saves when you leave it or press Enter (Esc puts it back). Remounted by `key` when the job changes. */
function CellInput({ value, type = 'text', width = 120, onCommit, label }: {
  value: string; type?: string; width?: number; onCommit: (v: string) => void; label: string;
}) {
  const [v, setV] = useState(value);
  return (
    <input className="wf-sheet-input" type={type} value={v} aria-label={label} style={{ width }}
      onChange={(e) => setV(e.target.value)} onBlur={() => { if (v !== value) onCommit(v); }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setV(value); }} />
  );
}

function Pill({ status, onClick, wide }: { status: string; onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void; wide?: boolean }) {
  const c = STATUS_COLORS[status as WorkOrderStatus] ?? STATUS_COLORS.Open;
  return <button type="button" className="wf-sheet-pill" onClick={onClick} style={{ background: c.bg, color: c.color, width: wide ? '100%' : undefined }}>{status}</button>;
}

/** The colored status label; tap it to pick another (Monday.com's status column). */
function StatusPick({ value, onPick }: { value: WorkOrderStatus; onPick: (s: WorkOrderStatus) => void }) {
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  return (
    <>
      <Pill status={value || 'Open'} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setAt(at ? null : { top: r.bottom + 4, left: r.left }); }} />
      {at && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 60 }} onClick={() => setAt(null)} />
          <div className="wf-sheet-pop" role="listbox" aria-label="Pick a status" style={{ top: at.top, left: Math.min(at.left, window.innerWidth - 180) }}>
            {WO_STATUSES.map((s) => <Pill key={s} status={s} wide onClick={() => { setAt(null); if (s !== value) onPick(s); }} />)}
          </div>
        </>
      )}
    </>
  );
}

function CustomCell({ w, def, onSet }: { w: WorkOrder; def: FieldDef; onSet: (v: string) => void }) {
  const v = inputValue(asValues(w.custom), def);
  if (def.kind === 'yesno' || def.kind === 'choice') {
    const opts = def.kind === 'yesno' ? [['yes', 'Yes'], ['no', 'No']] : def.options.map((o) => [o, o]);
    return (
      <select className="wf-sheet-input" value={v} aria-label={def.label} onChange={(e) => onSet(e.target.value)}>
        <option value="">—</option>
        {opts.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
    );
  }
  return <CellInput key={`${w.id}:${v}`} value={v} label={def.label} type={def.kind === 'date' ? 'date' : 'text'} width={def.kind === 'date' ? 140 : 130} onCommit={onSet} />;
}

export default function JobSheet({ rows, contractors, fields, onPatch, onOpen, onReassign, onAddField }: {
  rows: WorkOrder[] | EnrichedWorkOrder[];
  contractors: Contractor[];
  /** Fred's own job fields (Settings -> Custom fields): each can be a column. */
  fields: FieldDef[];
  onPatch: SheetPatch;
  onOpen: (id: string) => void;
  /** A job that already has a tech changes hands through the reassign step (it keeps what was paid). */
  onReassign: (w: WorkOrder) => void;
  /** "Add a column": a new job field, on the job form too. */
  onAddField?: (label: string, kind: FieldKind, options: string[]) => void;
}) {
  const jobs = rows as WorkOrder[];
  const [hidden, setHidden] = useState<string[]>([]);
  const [by, setBy] = useState<SheetGroupBy>('none');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [colsOpen, setColsOpen] = useState(false);
  const [adding, setAdding] = useState<{ label: string; kind: FieldKind; options: string } | null>(null);
  useEffect(() => {
    try {
      const h = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]');
      if (Array.isArray(h)) setHidden(h.map(String));
      const g = localStorage.getItem(GROUP_KEY);
      if (SHEET_GROUPS.some((x) => x.key === g)) setBy(g as SheetGroupBy);
    } catch { /* private window */ }
  }, []);
  const keep = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private window */ } };

  const all: Col[] = [...BUILT, ...fields.map((d) => ({ key: `f:${d.id}`, label: d.label, def: d, right: d.kind === 'number' }))];
  const cols = all.filter((c) => !hidden.includes(c.key));
  const groups = useMemo(() => groupSheet(jobs, by), [jobs, by]);
  const ids = jobs.map((w) => w.id);
  const allOn = ids.length > 0 && ids.every((id) => sel.has(id));
  const names = useMemo(() => contractors.map((c) => c.name).filter(Boolean).sort((a, b) => a.localeCompare(b)), [contractors]);
  const one = (id: string, make: (w: WorkOrder) => Partial<WorkOrder> | null) => void onPatch([id], make);
  const bulk = async (make: (w: WorkOrder) => Partial<WorkOrder> | null) => { await onPatch([...sel], make); setSel(new Set()); };

  const value = (w: WorkOrder, c: Col): ReactNode => {
    const techs = techsOf(w);
    switch (c.key) {
      case 'client': return w.customer_name || <span className="wf-subtle">—</span>;
      case 'city': return [w.site_city, w.site_state].filter(Boolean).join(', ') || <span className="wf-subtle">—</span>;
      case 'date': return <CellInput key={`${w.id}:${w.start_date}`} type="date" width={140} label={`Start date for WO ${w.wo_number}`} value={w.start_date ?? ''}
        onCommit={(v) => one(w.id, (cur) => datePatch(cur, v || null))} />;
      case 'tech': return techs.length
        ? <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>{techs.join(', ')}<button type="button" className="wf-sheet-link" onClick={() => onReassign(w)}>Change</button></span>
        : (
          <select className="wf-sheet-input" value="" aria-label={`Tech for WO ${w.wo_number}`} style={{ color: 'var(--wf-danger)', fontWeight: 600 }}
            onChange={(e) => { const n = e.target.value; if (n) one(w.id, (cur) => (techsOf(cur).length ? null : assignPatch(cur, [n]))); }}>
            <option value="">No tech: pick…</option>
            {names.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        );
      case 'status': return <StatusPick value={w.wo_status} onPick={(s) => one(w.id, () => ({ wo_status: s }))} />;
      case 'pays': return !w.pay_type || w.pay_type === 'Fixed'
        ? <CellInput key={`${w.id}:${w.total_amount}`} width={96} label={`Client pays for WO ${w.wo_number}`} value={String(Number(w.total_amount) || '')}
          onCommit={(v) => { const n = Number(v.replace(/[$,\s]/g, '')); if (Number.isFinite(n) && n >= 0) one(w.id, () => ({ total_amount: n })); }} />
        : <span title={`${w.pay_type}: worked out on the job`}>{fmtMoney(Number(w.total_amount) || 0)}</span>;
      case 'techpay': return fmtMoney(Object.values(w.contractor_pay ?? {}).reduce((s, v) => s + (Number(v) || 0), 0));
      case 'miles': return w.billable_miles ? Number(w.billable_miles).toLocaleString() : <span className="wf-subtle">—</span>;
      default: return c.def ? <CustomCell w={w} def={c.def} onSet={(v) => one(w.id, (cur) => ({ custom: setAnswer(asValues(cur.custom), c.def!, v) }))} /> : null;
    }
  };
  const total = (t: SheetTotals, c: Col): ReactNode => c.key === 'pays' ? fmtMoney(t.clientPays) : c.key === 'techpay' ? fmtMoney(t.techPay) : c.key === 'miles' ? (t.miles ? t.miles.toLocaleString() : '') : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label className="wf-subtle" style={{ fontSize: 13, display: 'inline-flex', gap: 6, alignItems: 'center' }}>Group by
          <select className="wf-sheet-input" value={by} onChange={(e) => { const g = e.target.value as SheetGroupBy; setBy(g); keep(GROUP_KEY, g); }}>
            {SHEET_GROUPS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
          </select>
        </label>
        <span style={{ position: 'relative' }}>
          <button type="button" className="wf-btn wf-btn-outline wf-btn-sm" onClick={() => setColsOpen((o) => !o)}><Columns3 size={15} /> Columns</button>
          {colsOpen && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 60 }} onClick={() => { setColsOpen(false); setAdding(null); }} />
              <div className="wf-sheet-pop" style={{ position: 'absolute', top: '110%', left: 0, width: 260 }}>
                {all.map((c) => (
                  <label key={c.key} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13.5, padding: '3px 2px' }}>
                    <input type="checkbox" checked={!hidden.includes(c.key)} onChange={(e) => {
                      const next = e.target.checked ? hidden.filter((k) => k !== c.key) : [...hidden, c.key];
                      setHidden(next); keep(HIDDEN_KEY, JSON.stringify(next));
                    }} />{c.label}
                  </label>
                ))}
                {onAddField && (adding ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid var(--wf-line)', paddingTop: 8, marginTop: 4 }}>
                    <input className="wf-sheet-input" placeholder="Column name (PO #, Store #…)" value={adding.label} autoFocus
                      onChange={(e) => setAdding({ ...adding, label: e.target.value })} />
                    <select className="wf-sheet-input" value={adding.kind} onChange={(e) => setAdding({ ...adding, kind: e.target.value as FieldKind })}>
                      {FIELD_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
                    </select>
                    {adding.kind === 'choice' && <input className="wf-sheet-input" placeholder="Choices, with commas" value={adding.options}
                      onChange={(e) => setAdding({ ...adding, options: e.target.value })} />}
                    <button type="button" className="wf-btn wf-btn-gold wf-btn-sm" disabled={!adding.label.trim()}
                      onClick={() => { onAddField(adding.label.trim(), adding.kind, adding.options.split(',').map((o) => o.trim()).filter(Boolean)); setAdding(null); }}>Add column</button>
                  </div>
                ) : (
                  <button type="button" className="wf-btn wf-btn-ghost wf-btn-sm" style={{ marginTop: 4 }}
                    onClick={() => setAdding({ label: '', kind: 'text', options: '' })}><Plus size={14} /> Add a column</button>
                ))}
              </div>
            </>
          )}
        </span>
        <span className="wf-subtle" style={{ marginLeft: 'auto', fontSize: 12.5 }}>Change status, date, tech or price right in the row. Tick rows to change several.</span>
      </div>

      {sel.size > 0 && (
        <div className="wf-sheet-bulk" role="toolbar" aria-label="Change the ticked jobs">
          <b>{sel.size} ticked</b>
          <select className="wf-sheet-input" value="" aria-label="Set status" onChange={(e) => { const s = e.target.value as WorkOrderStatus; if (s) void bulk(() => ({ wo_status: s })); }}>
            <option value="">Set status…</option>
            {WO_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13 }}>Move to
            <input className="wf-sheet-input" type="date" aria-label="Move to date" onChange={(e) => { const d = e.target.value; if (d) void bulk((cur) => datePatch(cur, d)); }} />
          </label>
          <select className="wf-sheet-input" value="" aria-label="Give the jobs with no tech to" onChange={(e) => { const n = e.target.value; if (n) void bulk((cur) => (techsOf(cur).length ? null : assignPatch(cur, [n]))); }}>
            <option value="">Tech (jobs with none)…</option>
            {names.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <button type="button" className="wf-btn wf-btn-outline wf-btn-sm" onClick={() => void bulk((cur) => (cur.wo_status === 'On Hold' ? null : { wo_status: 'On Hold' }))}>Put on hold</button>
          <button type="button" className="wf-btn wf-btn-ghost wf-btn-sm" onClick={() => setSel(new Set())}>Clear</button>
        </div>
      )}

      <div className="wf-card" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="wf-sheet" style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
          <thead>
            <tr>
              <th style={{ ...cell, width: 34 }}><input type="checkbox" aria-label="Tick every job" checked={allOn} onChange={() => setSel(allOn ? new Set() : new Set(ids))} /></th>
              {['WO #', 'Job', ...cols.map((c) => c.label)].map((h, i) => (
                <th key={`${h}-${i}`} className="wf-subtle" style={{ ...cell, fontSize: 12, fontWeight: 700, textAlign: i >= 2 && cols[i - 2]?.right ? 'right' : 'left' }}>{h}</th>
              ))}
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.key}>
              {by !== 'none' && (
                <tr><td colSpan={cols.length + 3} style={{ ...cell, background: '#F4F2EC', fontWeight: 700 }}>{g.label} <span className="wf-subtle" style={{ fontWeight: 500 }}>· {g.totals.jobs} job{g.totals.jobs === 1 ? '' : 's'}</span></td></tr>
              )}
              {g.rows.map((w) => (
                <tr key={`${g.key}:${w.id}`} style={{ background: sel.has(w.id) ? 'rgba(201,162,39,0.10)' : undefined, opacity: w.wo_status === 'On Hold' ? 0.55 : 1 }}>
                  <td style={cell}><input type="checkbox" aria-label={`Tick WO ${w.wo_number}`} checked={sel.has(w.id)}
                    onChange={() => setSel((s) => { const n = new Set(s); if (n.has(w.id)) n.delete(w.id); else n.add(w.id); return n; })} /></td>
                  <td style={{ ...cell, fontWeight: 700 }}><button type="button" className="wf-sheet-link" onClick={() => onOpen(w.id)}>{w.wo_number}</button></td>
                  <td style={{ ...cell, whiteSpace: 'normal', minWidth: 200 }}><button type="button" className="wf-sheet-link" style={{ color: 'inherit', textAlign: 'left' }} onClick={() => onOpen(w.id)}>{w.title || 'Untitled job'}</button></td>
                  {cols.map((c) => <td key={c.key} style={{ ...cell, textAlign: c.right ? 'right' : 'left' }}>{value(w, c)}</td>)}
                </tr>
              ))}
              <tr className="wf-sheet-total">
                <td style={cell} />
                <td style={{ ...cell, fontWeight: 700 }} colSpan={2}>{by === 'none' ? 'Total' : `${g.label} total`} · {g.totals.jobs} job{g.totals.jobs === 1 ? '' : 's'}</td>
                {cols.map((c) => <td key={c.key} style={{ ...cell, fontWeight: 700, textAlign: c.right ? 'right' : 'left' }}>{total(g.totals, c)}</td>)}
              </tr>
            </tbody>
          ))}
        </table>
        {jobs.length === 0 && <div className="wf-subtle" style={{ padding: 16, textAlign: 'center' }}>No jobs here.</div>}
      </div>
    </div>
  );
}
