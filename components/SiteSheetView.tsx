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
import { useState } from 'react';
import { Plus, Trash2, Copy, FileSpreadsheet } from 'lucide-react';
import type { SiteVisit, SiteVisitType } from '@/lib/types';
import { SITE_VISIT_TYPES } from '@/lib/types';
import { visitAmount } from '@/lib/visits';
import { laborOf, sheetRow, sheetHeader, STATUS_LABEL } from '@/lib/site-sheet';
import { toTSV } from '@/lib/csv';
import { trackerRows } from '@/lib/invoice-tracker';
import { copyToClipboard } from '@/lib/export';
import { toastSuccess, toastError } from '@/lib/toast';
import { fmtMoney } from '@/lib/utils';

type Col = {
  key: keyof SiteVisit;
  label: string;
  width: number;
  type?: 'text' | 'number' | 'date' | 'time' | 'select';
  options?: readonly string[];
  step?: string;
};

// Column order follows the Projects sheet, so the muscle memory carries over.
const COLS: Col[] = [
  { key: 'visit_date', label: 'Date',          width: 122, type: 'date' },
  { key: 'site_code',  label: 'Site #',        width: 78 },
  { key: 'site_name',  label: 'Site Name',     width: 150 },
  { key: 'address',    label: 'Address',       width: 250 },
  { key: 'time_in',    label: 'Time In',       width: 150, type: 'time' },
  { key: 'time_out',   label: 'Time Out',      width: 150, type: 'time' },
  { key: 'hours',      label: 'Total Time',    width: 88,  type: 'number', step: '0.25' },
  { key: 'rate',       label: 'Rate',          width: 96 },
  { key: 'visit_type', label: 'Project or T&M', width: 112, type: 'select', options: SITE_VISIT_TYPES },
  { key: 'invoice_status', label: 'Invoiced',  width: 116, type: 'select', options: ['not_invoiced', 'invoiced', 'na'] },
  { key: 'payment_status', label: 'Paid',      width: 96,  type: 'select', options: ['unpaid', 'paid', 'na'] },
  { key: 'miles',      label: 'Round Trip Miles', width: 108, type: 'number', step: '0.1' },
  { key: 'travel_charge', label: 'Travel Charge', width: 108, type: 'number', step: '0.01' },
  { key: 'notes',      label: 'Notes',         width: 280 },
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
  visits, picked, onTogglePicked, onSave, onDelete, onAdd,
}: {
  visits: SiteVisit[];
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

    if (String(row[col.key] ?? '') === String(next ?? '')) return; // nothing changed
    await onSave(id, { [col.key]: next } as Partial<SiteVisit>);
  };

  const total = visits.reduce((s, v) => s + visitAmount(v), 0);
  const totalHours = visits.reduce((s, v) => s + Number(v.hours ?? 0), 0);
  const totalMiles = visits.reduce((s, v) => s + Number(v.miles ?? 0), 0);

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
                <th key={String(c.key)} style={{ ...th, minWidth: c.width }}>
                  {c.label}
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
              <th style={{ ...th, minWidth: 96, textAlign: 'right' }}>
                Total Pay <span style={{ color: 'var(--teal)' }}>ƒ</span>
              </th>
              <th style={{ ...th, minWidth: 92, textAlign: 'right' }}>Total</th>
              <th style={{ ...th, width: 72 }} />
            </tr>
          </thead>
          <tbody>
            {visits.map((v) => (
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
                      {c.type === 'select' ? (
                        <select
                          value={(raw as string) ?? ''}
                          onChange={(e) => void onSave(v.id, { [c.key]: e.target.value } as Partial<SiteVisit>)}
                          style={{ ...cell, cursor: 'pointer' }}
                        >
                          {c.options!.map((o) => (
                            <option key={o} value={o}>{STATUS_LABEL[o] ?? o}</option>
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
                    {c.key === 'hours' ? totalHours.toFixed(2)
                      : c.key === 'miles' ? totalMiles.toFixed(0)
                      : c.key === 'visit_date' ? `${visits.length} site${visits.length !== 1 ? 's' : ''}`
                      : ''}
                  </td>
                ))}
                <td style={{ ...td, borderTop: '2px solid #e5e7eb', textAlign: 'right', padding: '8px 9px', fontWeight: 800, color: '#555' }}>
                  {fmtMoney(visits.reduce((s, v) => s + laborOf(v), 0))}
                </td>
                <td style={{ ...td, borderTop: '2px solid #e5e7eb', textAlign: 'right', padding: '8px 9px', fontWeight: 800, color: 'var(--teal)' }}>
                  {fmtMoney(total)}
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
