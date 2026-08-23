'use client';
// The Site Log as an actual spreadsheet.
//
// The card list is right on a phone, standing in a parking lot. At a desk,
// working through a month of Wendy's sites, it is the wrong shape entirely —
// Fred's real workflow is a grid he tabs across. This is that grid, over the
// same site_visits rows, so nothing is duplicated or kept in sync by hand.
//
// Editing is per-cell and saves on blur: a spreadsheet has no Save button, and
// adding one here would be the sort of thing that loses an afternoon's typing.
import { Fragment, useMemo, useState } from 'react';
import { Plus, Trash2, Copy, FileSpreadsheet, ChevronDown, ChevronRight, ArrowUpDown, Layers } from 'lucide-react';
import type { SiteVisit, SiteVisitType } from '@/lib/types';
import { SITE_VISIT_TYPES } from '@/lib/types';
import { visitAmount, billableHours } from '@/lib/visits';
import { techsOn, techNames, type Tech } from '@/lib/visit-techs';
import { laborOf, sheetRow, sheetHeader, STATUS_LABEL } from '@/lib/site-sheet';
import { toTSV } from '@/lib/csv';
import { trackerRows } from '@/lib/invoice-tracker';
import { copyToClipboard } from '@/lib/export';
import { toastSuccess, toastError } from '@/lib/toast';
import { fmtMoney } from '@/lib/utils';
import {
  groupVisits, sortVisits, totalsOf, pillFor, groupColor,
  GROUP_BY_LABEL, type GroupBy, type SortKey, type SortDir,
} from '@/lib/site-board';

type Col = {
  key: keyof SiteVisit;
  label: string;
  width: number;
  type?: 'text' | 'number' | 'date' | 'time' | 'select';
  options?: readonly string[];
  step?: string;
  /** Shown but not editable in the grid — edit it in the card view instead. */
  readOnly?: boolean;
};

// Column order, labels and meaning follow Master Entry in
// FAJ_Solutions_Invoice_Tracker_2026_master_auto.xlsx, so the app and the
// spreadsheet can be read against each other line for line. The letter in each
// comment is the Excel column it corresponds to.
//
// Two of Master Entry's twenty are calculated rather than typed and so are not
// in this list: Labor Total (I) and Line Total (P) render as the Total Pay and
// Total columns at the end of the row. Mileage Rate (K) is a setting, not a
// per-visit field, and Mileage Total (L) is the travel charge below.
//
// Time In and Time Out have no Master Entry equivalent — they drive the
// check-in timer that fills Hours — so they sit at the end, out of the way.
const COLS: Col[] = [
  { key: 'visit_date',            label: 'Date',                  width: 122, type: 'date' },        // A
  { key: 'program',               label: 'Customer/Brand',        width: 130 },                      // B
  { key: 'site_code',             label: 'Site/Location',         width: 96 },                       // C
  { key: 'site_name',             label: 'Site Name',             width: 140 },                      // C
  { key: 'address',               label: 'Site Address',          width: 240 },                      // D
  { key: 'client_summary',        label: 'Scope of Work',         width: 260 },                      // E
  { key: 'visit_type',            label: 'Work Type',             width: 112, type: 'select', options: SITE_VISIT_TYPES }, // F
  { key: 'hours',                 label: 'Hours',                 width: 84,  type: 'number', step: '0.25' },  // G
  { key: 'rate',                  label: 'Labor Rate',            width: 100 },                      // H
  { key: 'miles',                 label: 'Mileage/Distance',      width: 116, type: 'number', step: '0.1' },   // J
  { key: 'travel_charge',         label: 'Mileage Total',         width: 110, type: 'number', step: '0.01' },  // L
  { key: 'materials_description', label: 'Materials Description', width: 220 },                      // M
  { key: 'materials_cost',        label: 'Materials Cost',        width: 110, type: 'number', step: '0.01' },  // N
  { key: 'other_charges',         label: 'Other Charges',         width: 106, type: 'number', step: '0.01' },  // O
  { key: 'invoice_status',        label: 'Invoice Status',        width: 122, type: 'select', options: ['not_invoiced', 'invoiced', 'na'] }, // Q
  { key: 'payment_status',        label: 'Payment Status',        width: 116, type: 'select', options: ['unpaid', 'paid', 'na'] },           // R
  { key: 'notes',                 label: 'Notes',                 width: 240 },                      // S
  { key: 'additional_details',    label: 'Additional Details',    width: 180 },                      // T
  { key: 'time_in',               label: 'Time In',               width: 150, type: 'time' },        // app only
  { key: 'time_out',              label: 'Time Out',              width: 150, type: 'time' },        // app only
  // Read-only: a crew is a list, which no single grid cell edits sanely.
  // Change it by opening the visit in the card view.
  { key: 'tech_ids',              label: 'Techs on site',         width: 180, readOnly: true },      // app only
];

/** datetime-local wants local time; the column stores an ISO instant. */
function toLocal(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

const th: React.CSSProperties = {
  position: 'sticky', top: 0, zIndex: 2, background: '#f7f7f7',
  borderBottom: '2px solid #e5e7eb', borderRight: '1px solid #eee',
  padding: '8px 9px', textAlign: 'left', fontSize: 11, fontWeight: 800,
  textTransform: 'uppercase', letterSpacing: 0.4, color: '#555', whiteSpace: 'nowrap',
};
const td: React.CSSProperties = {
  borderBottom: '1px solid #f2f2f2', borderRight: '1px solid #f7f7f7', padding: 0,
};
const cell: React.CSSProperties = {
  width: '100%', border: 'none', background: 'transparent', padding: '7px 9px',
  fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
};

export default function SiteSheetView({
  visits, picked, onTogglePicked, onSave, onDelete, onAdd, techRoster = [],
}: {
  visits: SiteVisit[];
  techRoster?: Tech[];
  picked: Set<string>;
  onTogglePicked: (id: string) => void;
  onSave: (id: string, patch: Partial<SiteVisit>) => Promise<void> | void;
  onDelete: (v: SiteVisit) => void;
  onAdd: () => void;
}) {
  // Only the cell being typed in is held locally; everything else reads from
  // the row. Keeping the whole grid in state is how a stale edit overwrites a
  // fresh one after a realtime refresh.
  const [editing, setEditing] = useState<{ id: string; key: string; value: string } | null>(null);

  // Invoice Tracker copy settings. Defaults are the safe ones: rebuild the
  // formulas rather than paste over them.
  // Board controls. Grouping and sorting are view state only — they never
  // touch the rows, so nothing here can change what a visit bills.
  const [groupBy, setGroupBy] = useState<GroupBy>('none');
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const groups = useMemo(
    () => groupVisits(sortVisits(visits, sortKey, sortDir), groupBy),
    [visits, sortKey, sortDir, groupBy],
  );
  const grand = useMemo(() => totalsOf(visits), [visits]);

  const toggleGroup = (key: string) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  // Click a heading to sort by it; click again to reverse.
  const sortOn = (key: SortKey) => {
    if (sortKey === key) { setSortDir((d) => (d === 'asc' ? 'desc' : 'asc')); return; }
    setSortKey(key);
    setSortDir('asc');
  };

  const [trackerOpen, setTrackerOpen] = useState(false);
  const [pasteRow, setPasteRow] = useState(1505);
  const [keepFormulas, setKeepFormulas] = useState(true);

  const commit = async () => {
    if (!editing) return;
    const { id, key, value } = editing;
    setEditing(null);
    const col = COLS.find((c) => c.key === key);
    const row = visits.find((v) => v.id === id);
    if (!col || !row) return;

    let next: unknown = value.trim() === '' ? null : value.trim();
    if (col.type === 'number') next = value.trim() === '' ? null : Number(value);
    if (col.type === 'time') next = value ? new Date(value).toISOString() : null;
    // Typing a short day into Hours snaps up to the two-hour minimum, the same
    // as the check-in timer does.
    if (col.key === 'hours') next = billableHours(next as number | null);

    if (String(row[col.key] ?? '') === String(next ?? '')) return; // nothing changed
    await onSave(id, { [col.key]: next } as Partial<SiteVisit>);
  };

  // ── Copy to Excel ─────────────────────────────────────────────────────────
  // Tab-separated on the clipboard: paste into Excel and the values land in
  // their own columns with no import dialog. Columns come from COLS, so the
  // copy always matches the grid.
  const KEYS   = COLS.map((c) => c.key);
  const LABELS = COLS.map((c) => c.label);

  /** Ticked rows if any are ticked, otherwise everything on screen. */
  const chosen = picked.size > 0 ? visits.filter((v) => picked.has(v.id)) : visits;

  const copyRows = async (rows: SiteVisit[], withHeader: boolean, what: string) => {
    if (rows.length === 0) { toastError('Nothing to copy.'); return; }
    const matrix = [
      ...(withHeader ? [sheetHeader(LABELS)] : []),
      ...rows.map((v) => sheetRow(v, KEYS)),
    ];
    const ok = await copyToClipboard(toTSV(matrix));
    if (ok) toastSuccess(`${what} copied — paste into Excel with Ctrl+V`);
  };

  // ── Copy for the Invoice Tracker ──────────────────────────────────────────
  // Master Entry's exact 20 columns, with its four calculated columns rebuilt
  // as the same formulas rather than pasted over. See lib/invoice-tracker.ts.
  const copyForTracker = async () => {
    if (chosen.length === 0) { toastError('Nothing to copy.'); return; }
    if (!Number.isInteger(pasteRow) || pasteRow < 2) {
      toastError('Enter the sheet row you are pasting at — the first empty row in Master Entry.');
      return;
    }
    const matrix = trackerRows(chosen, { row: pasteRow, keepFormulas });
    const ok = await copyToClipboard(toTSV(matrix));
    if (!ok) return;
    const last = pasteRow + chosen.length - 1;
    toastSuccess(
      `${chosen.length} row${chosen.length !== 1 ? 's' : ''} copied for Master Entry — ` +
      `click cell A${pasteRow} and press Ctrl+V (fills rows ${pasteRow}–${last})`
    );
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <button className="btn btn-ghost" onClick={onAdd}><Plus size={14} /> Add Row</button>

        <label
          title="Break the rows into sections, each with its own running total"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: '#555' }}
        >
          <Layers size={14} style={{ color: 'var(--teal)' }} />
          Group by
          <select
            className="input"
            value={groupBy}
            onChange={(e) => { setGroupBy(e.target.value as GroupBy); setCollapsed(new Set()); }}
            style={{ width: 'auto', padding: '5px 8px', fontSize: 12, cursor: 'pointer' }}
          >
            {(Object.keys(GROUP_BY_LABEL) as GroupBy[]).map((g) => (
              <option key={g} value={g}>{GROUP_BY_LABEL[g]}</option>
            ))}
          </select>
        </label>

        {sortKey && (
          <button
            className="btn btn-ghost"
            onClick={() => setSortKey(null)}
            title="Back to the order the rows came in"
            style={{ fontSize: 12 }}
          >
            <ArrowUpDown size={13} /> Clear sort
          </button>
        )}

        <button
          className="btn btn-ghost"
          onClick={() => copyRows(chosen, true, picked.size > 0
            ? `${chosen.length} selected row${chosen.length !== 1 ? 's' : ''}`
            : `All ${chosen.length} row${chosen.length !== 1 ? 's' : ''}`)}
          title={picked.size > 0
            ? 'Copy the ticked rows, with headers, ready to paste into Excel'
            : 'Copy every row on screen, with headers, ready to paste into Excel'}
        >
          <Copy size={14} />
          {picked.size > 0 ? `Copy ${picked.size} selected` : 'Copy all for Excel'}
        </button>

        <button
          className="btn btn-ghost"
          onClick={() => setTrackerOpen((o) => !o)}
          title="Copy in the exact 20-column layout of Master Entry in your Invoice Tracker"
        >
          <FileSpreadsheet size={14} /> Copy for Invoice Tracker {trackerOpen ? '▴' : '▾'}
        </button>

        <span style={{ fontSize: 12.5, color: '#888' }}>
          Click any cell to edit. Changes save when you tab or click away.
        </span>
      </div>

      {trackerOpen && (
        <div style={{
          border: '1px solid #e5e7eb', borderRadius: 10, background: '#fbfbfb',
          padding: '14px 16px', marginBottom: 12, maxWidth: 720,
        }}>
          <p style={{ fontSize: 12.5, color: '#555', margin: '0 0 12px', lineHeight: 1.6 }}>
            Copies <b>{picked.size > 0 ? `${chosen.length} selected` : `all ${chosen.length}`}</b>{' '}
            row{chosen.length !== 1 ? 's' : ''} in Master Entry&rsquo;s exact column order
            (A&ndash;T). Click cell <b>A{pasteRow || '?'}</b> in Excel and press Ctrl+V.
          </p>

          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <label style={{ fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 7 }}>
              Pasting at row
              <input
                className="input"
                type="number"
                min={2}
                value={pasteRow}
                onChange={(e) => setPasteRow(Number(e.target.value))}
                style={{ width: 90 }}
                title="The first empty row in Master Entry. The formulas are written to point at this row."
              />
            </label>

            <label style={{ fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={keepFormulas}
                onChange={(e) => setKeepFormulas(e.target.checked)}
                style={{ accentColor: 'var(--teal)' }}
              />
              Keep the calculated columns as formulas
            </label>

            <button className="btn btn-primary" onClick={copyForTracker}>
              <Copy size={14} /> Copy {picked.size > 0 ? `${chosen.length} selected` : 'all'}
            </button>
          </div>

          <p style={{ fontSize: 11.5, color: keepFormulas ? '#888' : '#b45309', margin: '12px 0 0', lineHeight: 1.6 }}>
            {keepFormulas
              ? 'Labor Total, Mileage Rate, Mileage Total and Line Total are written as your own formulas, aimed at the row above — so the pasted rows behave exactly like the rest of the sheet.'
              : 'Warning: the four calculated columns will be pasted as fixed numbers. Those rows will stop recalculating if you change Hours or your mileage rate later.'}
          </p>
        </div>
      )}

      {/* Tall enough to work a month without the page itself scrolling, and
          full width so the columns get the room they need. */}
      <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 230px)', width: '100%', border: '1px solid #e5e7eb', borderRadius: 10, background: '#fff' }}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 0, fontSize: 13, width: 'max-content', minWidth: '100%' }}>
          <thead>
            <tr>
              <th style={{ ...th, width: 34, textAlign: 'center' }} title="Include on the client statement">✓</th>
              {COLS.map((c) => (
                <th
                  key={String(c.key)}
                  onClick={() => sortOn(c.key as SortKey)}
                  title={`Sort by ${c.label}`}
                  style={{ ...th, minWidth: c.width, cursor: 'pointer', userSelect: 'none',
                           color: sortKey === c.key ? 'var(--teal)' : th.color }}
                >
                  {c.label}
                  {sortKey === c.key && <span style={{ marginLeft: 4 }}>{sortDir === 'asc' ? '▲' : '▼'}</span>}
                  {/* Calculated, not typed — say so in the header rather than
                      letting a number appear from nowhere. */}
                  {(c.key === 'hours' || c.key === 'travel_charge') && (
                    <span title={c.key === 'hours'
                      ? 'Fills in from Time In and Time Out. Type over it to override.'
                      : 'Miles × your mileage rate. Type over it to override.'}
                      style={{ color: 'var(--teal)', marginLeft: 3 }}>ƒ</span>
                  )}
                </th>
              ))}
              <th
                onClick={() => sortOn('labor_total')}
                title="Sort by Labor Total"
                style={{ ...th, minWidth: 96, textAlign: 'right', cursor: 'pointer', userSelect: 'none',
                         color: sortKey === 'labor_total' ? 'var(--teal)' : th.color }}
              >
                Labor Total <span style={{ color: 'var(--teal)' }} title="Hours × Labor Rate — Master Entry column I">ƒ</span>
                {sortKey === 'labor_total' && <span style={{ marginLeft: 4 }}>{sortDir === 'asc' ? '▲' : '▼'}</span>}
              </th>
              <th
                onClick={() => sortOn('line_total')}
                title="Sort by Line Total"
                style={{ ...th, minWidth: 104, textAlign: 'right', cursor: 'pointer', userSelect: 'none',
                         color: sortKey === 'line_total' ? 'var(--teal)' : th.color }}
              >
                Line Total <span style={{ color: 'var(--teal)' }} title="Labor + Mileage + Materials + Other — Master Entry column P">ƒ</span>
                {sortKey === 'line_total' && <span style={{ marginLeft: 4 }}>{sortDir === 'asc' ? '▲' : '▼'}</span>}
              </th>
              <th style={{ ...th, width: 72 }} />
            </tr>
          </thead>
          <tbody>
            {groups.map((g, gi) => (
              <Fragment key={g.key}>
                {/* A section heading that carries its own money, so "what is
                    August worth" is answered without adding anything up. */}
                {groupBy !== 'none' && (
                  <tr>
                    <td
                      colSpan={COLS.length + 4}
                      onClick={() => toggleGroup(g.key)}
                      style={{
                        position: 'sticky', left: 0,
                        background: '#fbfbfc', borderTop: '1px solid #e5e7eb',
                        borderBottom: '1px solid #e5e7eb', padding: '9px 12px',
                        cursor: 'pointer', userSelect: 'none',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        {collapsed.has(g.key) ? <ChevronRight size={15} color="#888" /> : <ChevronDown size={15} color="#888" />}
                        <span style={{ width: 4, height: 16, borderRadius: 2, background: groupColor(gi) }} />
                        <span style={{ fontWeight: 800, fontSize: 13, color: '#222' }}>{g.label}</span>
                        <span style={{ fontSize: 11, color: '#999' }}>
                          {g.totals.count} visit{g.totals.count !== 1 ? 's' : ''}
                        </span>
                        <span style={{ marginLeft: 'auto', display: 'flex', gap: 16, fontSize: 12, color: '#666', fontVariantNumeric: 'tabular-nums' }}>
                          <span>{g.totals.hours.toFixed(2)}h</span>
                          <span>{g.totals.miles.toFixed(0)} mi</span>
                          <span>Labor {fmtMoney(g.totals.labor)}</span>
                          <strong style={{ color: 'var(--teal)' }}>{fmtMoney(g.totals.total)}</strong>
                        </span>
                      </div>
                    </td>
                  </tr>
                )}
                {!collapsed.has(g.key) && g.rows.map((v) => (
              <tr key={v.id} style={{ background: picked.has(v.id) ? 'rgba(13,115,119,0.06)' : undefined }}>
                <td style={{ ...td, textAlign: 'center' }}>
                  <input type="checkbox" checked={picked.has(v.id)}
                    onChange={() => onTogglePicked(v.id)}
                    style={{ width: 15, height: 15, cursor: 'pointer', accentColor: 'var(--teal)' }} />
                </td>

                {COLS.map((c) => {
                  const isEditing = editing?.id === v.id && editing.key === c.key;
                  const raw = v[c.key];
                  const shown = c.type === 'time' ? toLocal(raw as string)
                    : raw == null ? '' : String(raw);

                  return (
                    <td key={String(c.key)} style={td}>
                      {c.readOnly ? (
                        <span
                          title={c.key === 'tech_ids' ? techNames(techsOn(v, techRoster)) : shown}
                          style={{ ...cell, display: 'block', color: '#555' }}
                        >
                          {c.key === 'tech_ids' ? (techNames(techsOn(v, techRoster)) || '—') : (shown || '—')}
                        </span>
                      ) : c.type === 'select' ? (
                        // Still a real select — one click to change — but wearing
                        // the status colour, so a screen of rows reads at a glance.
                        <select
                          value={(raw as string) ?? ''}
                          onChange={(e) => void onSave(v.id, { [c.key]: e.target.value } as Partial<SiteVisit>)}
                          style={{
                            ...cell, cursor: 'pointer', appearance: 'none',
                            margin: '4px 6px', width: 'calc(100% - 12px)', padding: '4px 8px',
                            borderRadius: 20, textAlign: 'center',
                            fontSize: 11, fontWeight: 700,
                            color: pillFor(raw as string).color,
                            background: pillFor(raw as string).bg,
                          }}
                        >
                          {c.options!.map((o) => (
                            <option key={o} value={o} style={{ color: '#222', background: '#fff', fontWeight: 500 }}>
                              {STATUS_LABEL[o] ?? o}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type={c.type === 'time' ? 'datetime-local' : c.type === 'date' ? 'date' : c.type === 'number' ? 'number' : 'text'}
                          step={c.step}
                          value={isEditing ? editing.value : shown}
                          onChange={(e) => setEditing({ id: v.id, key: String(c.key), value: e.target.value })}
                          onFocus={() => setEditing({ id: v.id, key: String(c.key), value: shown })}
                          onBlur={commit}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                            if (e.key === 'Escape') setEditing(null);
                          }}
                          style={cell}
                        />
                      )}
                    </td>
                  );
                })}

                <td style={{ ...td, textAlign: 'right', padding: '7px 9px', fontVariantNumeric: 'tabular-nums', color: '#555', background: 'rgba(13,115,119,0.03)' }}>
                  {fmtMoney(laborOf(v))}
                </td>
                <td style={{ ...td, textAlign: 'right', padding: '7px 9px', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                  {fmtMoney(visitAmount(v))}
                </td>
                <td style={{ ...td, textAlign: 'center', whiteSpace: 'nowrap' }}>
                  {/* No header on a single row — you are pasting it under rows
                      that already have one. */}
                  <button
                    className="icon-btn"
                    title="Copy this row for Excel"
                    onClick={() => copyRows([v], false, 'Row')}
                  >
                    <Copy size={13} />
                  </button>
                  <button className="icon-btn" title="Delete this row" onClick={() => onDelete(v)}>
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
                ))}
              </Fragment>
            ))}

            {visits.length === 0 && (
              <tr><td colSpan={COLS.length + 4} style={{ padding: 30, textAlign: 'center', color: '#aaa' }}>
                No sites match the current filters.
              </td></tr>
            )}
          </tbody>

          {visits.length > 0 && (
            <tfoot>
              <tr style={{ position: 'sticky', bottom: 0, background: '#fafafa' }}>
                <td style={{ ...td, borderTop: '2px solid #e5e7eb' }} />
                {COLS.map((c) => (
                  <td key={String(c.key)} style={{ ...td, borderTop: '2px solid #e5e7eb', padding: '8px 9px', fontWeight: 800, fontSize: 12 }}>
                    {c.key === 'hours' ? grand.hours.toFixed(2)
                      : c.key === 'miles' ? grand.miles.toFixed(0)
                      : c.key === 'visit_date' ? `${visits.length} site${visits.length !== 1 ? 's' : ''}`
                      : ''}
                  </td>
                ))}
                <td style={{ ...td, borderTop: '2px solid #e5e7eb', textAlign: 'right', padding: '8px 9px', fontWeight: 800, color: '#555' }}>
                  {fmtMoney(grand.labor)}
                </td>
                <td style={{ ...td, borderTop: '2px solid #e5e7eb', textAlign: 'right', padding: '8px 9px', fontWeight: 800, color: 'var(--teal)' }}>
                  {fmtMoney(grand.total)}
                </td>
                <td style={{ ...td, borderTop: '2px solid #e5e7eb' }} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
