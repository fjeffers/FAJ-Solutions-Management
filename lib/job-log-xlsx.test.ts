// The job log as an Excel workbook, like Fred's job-log-timesheet.xlsx: the numbers are formulas, so an edit
// typed in Excel adds up again (Fred, 2026-10-30: edit "Both" in the app and in Excel).
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { jobLogCells, type XCell } from './job-log-xlsx';
import type { JobSheet } from './job-log-sheet';

const sheet: JobSheet = {
  time: [
    { tech: 'Kendell Newbold', day: '2026-10-19', in: '07:37', out: '17:37', brk: 0 },
    { tech: 'Paul Gibbs', day: '2026-10-20', in: '07:50', out: '18:09', brk: 0.5 },
    { tech: 'Paul Gibbs', day: '2026-10-19', in: '07:37', out: '17:37', brk: 0 },
  ],
  miles: [
    { tech: 'Paul Gibbs', day: '2026-10-19', start: 142109, end: 142117, miles: 8 },
    { tech: 'Paul Gibbs', day: '2026-10-22', start: null, end: null, miles: 196.1 },
  ],
  meals: [],
  materials: [{ tech: 'Paul Gibbs', day: '2026-10-20', store: "Lowe's", amount: 47.48 }],
  other: [{ tech: 'Paul Gibbs', day: '2026-10-18', store: 'Quality Inn', amount: 350.74, for: 'Lodging' }],
};
const head = { title: 'LDS Site 5011876 — Gaffney, SC', lines: ['FAJ WO 19101401'], range: 'Whole job', crew: ['Paul Gibbs', 'Kendell Newbold'] };

const text = (c: XCell) => (c && typeof c === 'object' ? (c.f ? `=${c.f}` : c.v) : c);
const find = (rows: XCell[][], label: string) => rows.findIndex((r) => r[0] === label);

describe('the job log in Excel', () => {
  const rows = jobLogCells(sheet, head);

  it('has the hours like the job log: the lead tech first, a formula on every row and total', () => {
    const top = find(rows, 'Time on site');
    expect(rows[top + 1]).toEqual(['NAME', 'DATE', 'CLOCK IN', 'CLOCK OUT', 'BREAK', 'HOURS']);
    const paul = rows[top + 2];
    expect(paul[0]).toBe('Paul Gibbs');
    expect(paul[1]).toEqual({ t: 'n', v: 46314, z: 'mm/dd/yyyy' });
    const at = top + 3;
    expect(text(paul[5])).toBe(`=IF(OR(C${at}="",D${at}=""),0,ROUND(MAX(0,MOD(D${at}-C${at},1)*24-E${at}),2))`);
    expect((paul[5] as { v: number }).v).toBe(10);
    expect(rows[top + 4][0]).toBe('Paul Gibbs final hours');
    expect(text(rows[top + 4][5])).toBe(`=SUM(F${top + 3}:F${top + 4})`);
    expect((rows[top + 4][5] as { v: number }).v).toBe(19.82);
    expect(rows[top + 5][0]).toBe('Kendell Newbold');
    const overall = rows[find(rows, 'Overall total worked')][5] as { v: number; f: string };
    expect(overall.v).toBe(29.82);
    expect(overall.f).toBe(`F${top + 5}+F${top + 7}`);
  });

  it('takes a day\'s miles from its odometer, and keeps miles with no odometer as they are', () => {
    const top = find(rows, 'Mileage');
    expect(text(rows[top + 2][4])).toBe(`=D${top + 3}-C${top + 3}`);
    expect(rows[top + 3][4]).toEqual({ t: 'n', v: 196.1, z: '#,##0.0' });
    expect((rows[find(rows, 'Overall total miles')][4] as { v: number }).v).toBe(204.1);
  });

  it('has every section, an empty one with a nil total, and the job total; no billable total', () => {
    expect((rows[find(rows, 'Overall total meals')][3] as { v: number; f: string })).toMatchObject({ v: 0, f: '0' });
    expect(rows[find(rows, 'Paul Gibbs total materials')][3]).toMatchObject({ v: 47.48 });
    expect(rows[find(rows, 'Other receipts') + 2]).toEqual(['Paul Gibbs', { t: 'n', v: 46313, z: 'mm/dd/yyyy' }, 'Lodging', 'Quality Inn', { t: 'n', v: 350.74, z: '$#,##0.00' }]);
    const total = rows[find(rows, 'JOB TOTAL')];
    expect(total.map((c) => (c && typeof c === 'object' ? c.v : c))).toEqual(['JOB TOTAL', 29.82, 204.1, 398.22]);
    expect(total.map((c) => (c && typeof c === 'object' ? c.z : null))).toEqual([null, '0.00" hours"', '#,##0.0" miles"', '$#,##0.00']);
    // Six columns at most, so it prints one page wide.
    expect(Math.max(...rows.map((r) => r.length))).toBeLessThanOrEqual(6);
    expect(rows.flat().some((c) => typeof c === 'string' && /billable/i.test(c))).toBe(false);
  });

  it('opens in Excel with its formulas and the summary pointing at the totals', () => {
    const ws = XLSX.utils.aoa_to_sheet(jobLogCells(sheet, head));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Job Log');
    const back = XLSX.read(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), { cellFormula: true }).Sheets['Job Log'];
    const summaryRow = find(rows, 'HOURS ON SITE') + 2;
    expect(back[`A${summaryRow}`]).toMatchObject({ v: 29.82, f: `F${find(rows, 'Overall total worked') + 1}` });
    expect(back[`E${summaryRow}`]).toMatchObject({ v: 350.74 });
  });
});
