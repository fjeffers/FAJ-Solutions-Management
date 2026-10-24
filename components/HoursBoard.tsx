'use client';
// The Board: a job's days the monday.com way (Fred, 2026-10-24: "give me a
// monday.com feature view"; "used monday features for the time sheet").
// Colored groups (a week, a month, or all the days), a colored status label on
// each day, every cell typed into and saved on the spot (no Save button), and
// each group's sums along its foot. The same day lines as the cards
// (field_sheet_days), so the Field Sheet and QuickBooks read what's typed here.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Camera } from 'lucide-react';
import { Dialog } from '@/components/wf/WfUi';
import { dayCalc, nextEdits, type SavedDay, type SheetField, type SheetRow } from '@/lib/field-sheet';
import { DAY_STATUS, dayStatus, GROUP_COLORS } from '@/lib/hours-look';
import { toastError } from '@/lib/toast';

const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

type Col = { f: Exclude<SheetField, 'ask'>; label: string; time?: boolean; text?: boolean; width: number; sum?: boolean };
const COLS: Col[] = [
  { f: 'arrived', label: 'Started', time: true, width: 104 },
  { f: 'leftSite', label: 'Finished', time: true, width: 104 },
  { f: 'lunch', label: 'Lunch min', width: 74 },
  { f: 'hours', label: 'On site h', width: 80, sum: true },
  { f: 'travel', label: 'Travel h', width: 76, sum: true },
  { f: 'miles', label: 'Miles', width: 70, sum: true },
  { f: 'meals', label: 'Meals $', width: 76, sum: true },
  { f: 'spend', label: 'Other $', width: 74, sum: true },
  { f: 'note', label: 'Note', text: true, width: 200 },
];

/** A typed number: '' → null (empty), junk → undefined. */
function num(s: string): number | null | undefined {
  const t = s.replace(/[$,\s]/g, '');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** What a cell shows: the typed value, else the worked-out one (hours, travel, miles) greyed. */
function shown(r: SheetRow, col: Col): { value: string; auto: string } {
  const v = r.values[col.f];
  const c = dayCalc(r.values, 0);
  const auto = col.f === 'hours' ? c.hoursAuto : col.f === 'travel' ? c.travelAuto : col.f === 'miles' ? c.milesAuto : null;
  return { value: v == null ? '' : String(v), auto: auto ? String(auto) : '' };
}

function Cell({ r, col, onSave }: { r: SheetRow; col: Col; onSave: (row: SheetRow, edits: SavedDay['edits']) => Promise<boolean> }) {
  const start = shown(r, col);
  const [val, setVal] = useState(start.value);
  const [busy, setBusy] = useState(false);
  // A saved or reloaded value shows, except in the cell being typed in (the row stays put, so Tab keeps going).
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setVal(start.value); }, [start.value]);
  const commit = async () => {
    if (val === start.value || busy) return;
    const v = col.time || col.text ? (val.trim() || null) : num(val);
    if (v === undefined) { toastError(`${col.label}: type a number, like 7.5`); setVal(start.value); return; }
    setBusy(true);
    const ok = await onSave(r, nextEdits({ app: r.app, edits: r.edits }, col.f, v));
    setBusy(false);
    if (!ok) setVal(start.value);
  };
  return (
    <td style={{ padding: 0, borderRight: '1px solid #E6E9EF', borderBottom: '1px solid #E6E9EF', background: busy ? '#F5F6F8' : '#fff' }}>
      <input value={val} type={col.time ? 'time' : 'text'} inputMode={col.time || col.text ? undefined : 'decimal'} placeholder={start.auto}
        aria-label={`${col.label} ${r.tech} ${r.day}`} disabled={busy}
        onChange={(e) => setVal(e.target.value)} onFocus={() => { focused.current = true; }} onBlur={() => { focused.current = false; void commit(); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setVal(start.value); }}
        style={{ width: '100%', minWidth: col.width, border: 0, outline: 'none', background: 'transparent', padding: '9px 8px', font: 'inherit', textAlign: col.text ? 'left' : 'center' }} />
    </td>
  );
}

export default function HoursBoard({ groups, onSave, pictures, picCount }: {
  /** The groups in order: a week, a month, or one group of every day. */
  groups: { key: string; label: string; rows: SheetRow[] }[];
  onSave: (row: SheetRow, edits: SavedDay['edits']) => Promise<boolean>;
  /** A day's pictures and adding more (components/DayPictures), opened from its Pictures cell. */
  pictures?: (r: SheetRow) => ReactNode;
  picCount?: (r: SheetRow) => number;
}) {
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [picsOf, setPicsOf] = useState<string | null>(null);
  const picRow = picsOf ? groups.flatMap((g) => g.rows).find((r) => r.key === picsOf) ?? null : null;
  const th: React.CSSProperties = { padding: '7px 8px', fontSize: 12, fontWeight: 500, color: '#676879', borderRight: '1px solid #E6E9EF', borderBottom: '1px solid #E6E9EF', whiteSpace: 'nowrap', background: '#fff' };
  return (
    <div style={{ display: 'grid', gap: 22, fontFamily: "'Figtree', 'Inter', -apple-system, sans-serif", fontSize: 14 }}>
      {groups.map((g, gi) => {
        const color = GROUP_COLORS[gi % GROUP_COLORS.length];
        const isFolded = folded.has(g.key);
        const sums = COLS.filter((c) => c.sum).map((c) => [c.f, g.rows.reduce((t, r) => {
          const d = dayCalc(r.values, 0);
          return t + (c.f === 'hours' ? d.hours : c.f === 'travel' ? d.travel : c.f === 'miles' ? d.miles : Number(r.values[c.f] ?? 0));
        }, 0)] as const);
        return (
          <section key={g.key} aria-label={g.label}>
            <button type="button" onClick={() => setFolded((s) => { const n = new Set(s); if (n.has(g.key)) n.delete(g.key); else n.add(g.key); return n; })}
              aria-expanded={!isFolded}
              style={{ border: 0, background: 'none', padding: '0 0 6px', display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', font: 'inherit' }}>
              <span style={{ color, fontSize: 13 }}>{isFolded ? '▶' : '▼'}</span>
              <span style={{ color, fontWeight: 600, fontSize: 17 }}>{g.label}</span>
              <span style={{ color: '#676879', fontSize: 13 }}>{g.rows.length} day{g.rows.length === 1 ? '' : 's'}</span>
            </button>
            {!isFolded && (
              <div style={{ overflowX: 'auto', borderLeft: `6px solid ${color}`, borderRadius: '6px 0 0 6px' }}>
                <table style={{ borderCollapse: 'separate', borderSpacing: 0, minWidth: '100%', borderTop: '1px solid #E6E9EF' }}>
                  <thead>
                    <tr>
                      <th style={{ ...th, textAlign: 'left', position: 'sticky', left: 0, zIndex: 1, minWidth: 190 }}>Day</th>
                      <th style={{ ...th, minWidth: 128 }}>Status</th>
                      {COLS.map((c) => <th key={c.f} style={th}>{c.label}</th>)}
                      {pictures && <th style={th}>Pictures</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map((r) => {
                      const st = DAY_STATUS[dayStatus(r)];
                      return (
                        <tr key={r.key}>
                          <td style={{ padding: '8px 10px', borderRight: '1px solid #E6E9EF', borderBottom: '1px solid #E6E9EF', background: '#fff', position: 'sticky', left: 0, whiteSpace: 'nowrap' }}>
                            <div style={{ fontWeight: 500 }}>{fmtDay(r.day)}</div>
                            <div style={{ fontSize: 12, color: '#676879' }}>{r.tech}</div>
                          </td>
                          <td style={{ padding: 0, borderRight: '1px solid #E6E9EF', borderBottom: '1px solid #E6E9EF', background: st.color, color: '#fff', textAlign: 'center', fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap' }}>
                            {st.label}
                          </td>
                          {COLS.map((c) => <Cell key={c.f} r={r} col={c} onSave={onSave} />)}
                          {pictures && (
                            <td style={{ padding: 0, borderBottom: '1px solid #E6E9EF', textAlign: 'center' }}>
                              <button type="button" onClick={() => setPicsOf(r.key)} aria-label={`Pictures ${r.tech} ${r.day}`}
                                style={{ border: 0, background: 'none', cursor: 'pointer', padding: '9px 12px', font: 'inherit', display: 'inline-flex', gap: 5, alignItems: 'center', color: '#323338' }}>
                                <Camera size={15} /> {picCount?.(r) ?? 0}
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                    <tr>
                      <td style={{ padding: '7px 10px', fontSize: 12, color: '#676879', position: 'sticky', left: 0, background: '#fff' }}>Sum</td>
                      <td />
                      {pictures && <td />}
                      {COLS.map((c) => {
                        const s = sums.find(([f]) => f === c.f);
                        return (
                          <td key={c.f} style={{ padding: '7px 8px', textAlign: 'center', fontWeight: 600, fontSize: 13 }}>
                            {s ? (c.f === 'meals' || c.f === 'spend' ? `$${s[1].toFixed(2)}` : String(Math.round(s[1] * 100) / 100)) : ''}
                          </td>
                        );
                      })}
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
      {picRow && pictures && (
        <Dialog title={`Pictures · ${fmtDay(picRow.day)} · ${picRow.tech}`} onClose={() => setPicsOf(null)} wide>
          {pictures(picRow)}
        </Dialog>
      )}
    </div>
  );
}
