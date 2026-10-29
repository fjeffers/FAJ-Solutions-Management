'use client';
// Each tech's own breakdown as tables, one heading each (Fred, 2026-10-29: "each tech get their
// own break down ... tech one day clock in - out = total ... then same for tech 2 ... odometers ...
// same with the hotels, materials and any things"). Drawn from the same rows as the Excel
// (lib/field-sheet.ts byTechRows), so the screen, the client report and the spreadsheet agree.
import type { CSSProperties, ReactNode } from 'react';
import { fmtMoney } from '@/lib/utils';

type Cell = string | number;
type Block = { title: string; head: string[]; body: Cell[][] };

/** The rows cut into their headings: a one-cell row followed by the Technician header starts one. */
export function byTechBlocks(rows: Cell[][]): Block[] {
  const out: Block[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.length === 1 && rows[i + 1]?.[0] === 'Technician') {
      out.push({ title: String(r[0]), head: rows[i + 1].map(String), body: [] });
      i++;
    } else if (r.length > 1 && out.length) out.at(-1)!.body.push(r);
  }
  return out;
}

const isTotal = (r: Cell[]) => typeof r[0] === 'string' && (r[0].endsWith(' total') || r[0] === 'All techs');

/** A cell as its column reads it: money, hours, odometer or miles. */
function show(col: string, v: Cell): string {
  if (typeof v !== 'number') return v;
  if (col === 'Amount' || col.includes('$')) return fmtMoney(v);
  if (col === 'Hours on site' || col === 'Travel hours') return v.toFixed(2);
  if (col.startsWith('Odometer start') || col.startsWith('Odometer end')) return v.toLocaleString('en-US');
  if (col.toLowerCase().includes('miles')) return v.toLocaleString('en-US', { maximumFractionDigits: 1 });
  return String(v);
}
const numeric = (col: string) => col === 'Amount' || col.includes('$') || col === 'Hours on site' || col === 'Travel hours'
  || col.startsWith('Odometer') || col.toLowerCase().includes('miles') || col === 'Lunch (min)';

export default function ByTechTables({ rows, heading, th, td, total }: {
  rows: Cell[][];
  /** The heading over each block, numbered: "1. Hours". */
  heading: (title: string) => ReactNode;
  th: CSSProperties; td: CSSProperties; total: CSSProperties;
}) {
  const blocks = byTechBlocks(rows);
  return (
    <>
      {blocks.map((b, n) => {
        // A column with nothing in it (no labor $, no notes) stays off the page.
        const keep = b.head.map((_, i) => i === 0 || b.body.some((r) => r[i] !== '' && r[i] != null));
        const cols = b.head.filter((_, i) => keep[i]);
        return (
          <div key={b.title}>
            {heading(`${n + 1}. ${b.title}`)}
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' }}>
                <thead><tr>{cols.map((c) => <th key={c} style={{ ...th, textAlign: numeric(c) ? 'right' : 'left' }}>{c}</th>)}</tr></thead>
                <tbody>
                  {b.body.map((r, i) => (
                    <tr key={i} className="jl-avoid" style={isTotal(r) ? total : undefined}>
                      {r.filter((_, k) => keep[k]).map((v, k) => (
                        <td key={k} style={{ ...td, textAlign: numeric(cols[k]) ? 'right' : 'left', whiteSpace: numeric(cols[k]) || k < 2 ? 'nowrap' : undefined }}>{show(cols[k], v)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </>
  );
}
