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
import { Plus, Trash2 } from 'lucide-react';
import type { SiteVisit, SiteVisitType } from '@/lib/types';
import { SITE_VISIT_TYPES } from '@/lib/types';
import { visitAmount } from '@/lib/visits';
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

const STATUS_LABEL: Record<string, string> = {
  not_invoiced: 'Not Invoiced', invoiced: 'Invoiced', na: 'N/A',
  unpaid: 'Unpaid', paid: 'Paid',
};

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

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <button className="btn btn-ghost" onClick={onAdd}><Plus size={14} /> Add Row</button>
        <span style={{ fontSize: 12.5, color: '#888' }}>
          Click any cell to edit. Changes save when you tab or click away.
        </span>
      </div>

      <div style={{ overflow: 'auto', maxHeight: '70vh', border: '1px solid #e5e7eb', borderRadius: 10, background: '#fff' }}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 0, fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ ...th, width: 34, textAlign: 'center' }} title="Include on the client statement">✓</th>
              {COLS.map((c) => <th key={String(c.key)} style={{ ...th, minWidth: c.width }}>{c.label}</th>)}
              <th style={{ ...th, minWidth: 92, textAlign: 'right' }}>Total</th>
              <th style={{ ...th, width: 40 }} />
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

                <td style={{ ...td, textAlign: 'right', padding: '7px 9px', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                  {fmtMoney(visitAmount(v))}
                </td>
                <td style={{ ...td, textAlign: 'center' }}>
                  <button className="icon-btn" title="Delete this row" onClick={() => onDelete(v)}>
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}

            {visits.length === 0 && (
              <tr><td colSpan={COLS.length + 3} style={{ padding: 30, textAlign: 'center', color: '#aaa' }}>
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
