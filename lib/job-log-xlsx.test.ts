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

  it('has every section, an empty one with a nil total, and the job total with no money; no billable total', () => {
    expect((rows[find(rows, 'Overall total meals')][3] as { v: number; f: string })).toMatchObject({ v: 0, f: '0' });
    expect(rows[find(rows, 'Paul Gibbs total materials')][3]).toMatchObject({ v: 47.48 });
    expect(rows[find(rows, 'Other receipts') + 2]).toEqual(['Paul Gibbs', { t: 'n', v: 46313, z: 'mm/dd/yyyy' }, 'Lodging', 'Quality Inn', { t: 'n', v: 350.74, z: '$#,##0.00' }]);
    const total = rows[find(rows, 'JOB TOTAL')];
    // Hours and miles only: the receipts' dollars aren't added up with them (Fred: "i dont want it mix").
    expect(total.map((c) => (c && typeof c === 'object' ? c.v : c))).toEqual(['JOB TOTAL', 29.82, 204.1]);
    expect(total.map((c) => (c && typeof c === 'object' && 'z' in c ? c.z : null))).toEqual([null, '0.00" hours"', '#,##0.0" miles"']);
    // Six columns at most, so it prints one page wide.
    expect(Math.max(...rows.map((r) => r.length))).toBeLessThanOrEqual(6);
    expect(rows.flat().some((c) => typeof c === 'string' && /billable/i.test(c))).toBe(false);
    // The time sheet, the one Fred edits; the job log is the page with the pictures (Fred, 2026-10-30).
    expect(rows[0]).toEqual(['TIME SHEET', 'Whole job']);
  });

  it('writes the hours so far of a stretch still on site as a number: the formula would make them 0 (Greptile, CodeRabbit on PR #39)', () => {
    const live = jobLogCells({ ...sheet, time: [{ tech: 'Paul Gibbs', day: '2026-10-30', in: '07:30', out: '', brk: 0, open: true, ms: 2.5 * 3_600_000 }] }, head);
    const at = find(live, 'Time on site') + 3;
    expect(live[at - 1][5]).toEqual({ t: 'n', v: 2.5, z: '0.00', f: `ROUND(MAX(0,2.5-E${at}),2)` });
    // The Hours screen's own hours too, the break typed in Excel still coming off them.
    const typed = jobLogCells({ ...sheet, time: [{ tech: 'Paul Gibbs', day: '2026-10-20', in: '', out: '', brk: 0.5, hours: 6.5 }] }, head);
    expect(typed[at - 1][5]).toEqual({ t: 'n', v: 6, z: '0.00', f: `ROUND(MAX(0,6.5-E${at}),2)` });
  });

  it("the tech's copy has no rates; the client's gives each row of the hours and miles its rate and dollars (Fred, 2026-10-30)", () => {
    expect(find(rows, 'CHARGES')).toBe(-1);
    expect(rows.flat().includes('RATE')).toBe(false);
    const client = jobLogCells(sheet, head, { 'Paul Gibbs': { hour: 65, mile: 0.7 } });
    const top = find(client, 'Time on site');
    expect(client[top + 1]).toEqual(['NAME', 'DATE', 'CLOCK IN', 'CLOCK OUT', 'BREAK', 'HOURS', 'RATE/HR', 'AMOUNT']);
    // Paul's 10/19, 10 hours × $65: the amount is the row's hours × its rate, to the cent.
    const at = top + 3;
    expect(client[top + 2].slice(6)).toEqual([{ t: 'n', v: 65, z: '$#,##0.00##' }, { t: 'n', v: 650, z: '$#,##0.00', f: `IF(G${at}="","",ROUND(F${at}*G${at},2))` }]);
    // His total: the hours as before, and his dollars added up.
    const paul = find(client, 'Paul Gibbs final hours');
    expect(client[paul].slice(6)).toEqual([null, { t: 'n', v: 1288.3, z: '$#,##0.00', f: `IF(COUNT(H${at}:H${paul})=0,"",SUM(H${at}:H${paul}))` }]);
    // Kendell has no rate: no rate and no dollars showing (not $0.00), but the formulas are there, so a rate typed in
    // Excel works his amounts out and they reach the totals (Greptile on PR #40).
    const kendell = find(client, 'Kendell Newbold final hours');
    const k = kendell; // his one row is the Excel row before his total's
    expect(client[kendell - 1].slice(6)).toEqual(['', { t: 's', v: '', f: `IF(G${k}="","",ROUND(F${k}*G${k},2))` }]);
    expect(client[kendell].slice(6)).toEqual([null, { t: 's', v: '', f: `IF(COUNT(H${k}:H${k})=0,"",SUM(H${k}:H${k}))` }]);
    const worked = find(client, 'Overall total worked');
    expect(client[worked].slice(6)).toEqual([null, { t: 'n', v: 1288.3, z: '$#,##0.00', f: `SUM(H${paul + 1},H${kendell + 1})` }]);
    // The miles, × the mileage rate.
    const m = find(client, 'Mileage');
    expect(client[m + 1]).toEqual(['NAME', 'DATE', 'ODO START', 'ODO END', 'MILES', 'RATE/MI', 'AMOUNT']);
    expect(client[m + 2].slice(5)).toEqual([{ t: 'n', v: 0.7, z: '$#,##0.00##' }, { t: 'n', v: 5.6, z: '$#,##0.00', f: `IF(F${m + 3}="","",ROUND(E${m + 3}*F${m + 3},2))` }]);
    const miles = find(client, 'Overall total miles');
    expect(client[miles].slice(5)).toEqual([null, { t: 'n', v: 142.87, z: '$#,##0.00', f: `SUM(G${find(client, 'Paul Gibbs total miles') + 1})` }]);
    // At the end: Paul's hours' dollars, the hours' and the miles' (TOTAL CHARGES), the receipts', and all of it added up
    // (Fred: "the break down total paul hours total kendal hours ... then all it all up together for an over all total").
    const c = find(client, 'CHARGES');
    expect(c).toBeGreaterThan(find(client, 'JOB TOTAL'));
    expect(client.slice(c + 1, c + 13)).toEqual([
      ['Paul Gibbs hours', null, { t: 'n', v: 1288.3, z: '$#,##0.00', f: `H${paul + 1}` }],
      // Kendell has hours and no rate yet: his line's blank, and fills in when a rate's typed (Greptile on PR #41).
      ['Kendell Newbold hours', null, { t: 's', v: '', f: `H${kendell + 1}` }],
      ['Hours total', null, { t: 'n', v: 1288.3, z: '$#,##0.00', f: `H${worked + 1}` }],
      // No miles for Kendell, so no mileage line for him.
      ['Paul Gibbs mileage', null, { t: 'n', v: 142.87, z: '$#,##0.00', f: `G${find(client, 'Paul Gibbs total miles') + 1}` }],
      ['Mileage total', null, { t: 'n', v: 142.87, z: '$#,##0.00', f: `G${miles + 1}` }],
      ['TOTAL CHARGES', null, { t: 'n', v: 1431.17, z: '$#,##0.00', f: `C${c + 4}+C${c + 6}` }],
      ['Meals', null, { t: 'n', v: 0, z: '$#,##0.00', f: `D${find(client, 'Overall total meals') + 1}` }],
      ['Materials', null, { t: 'n', v: 47.48, z: '$#,##0.00', f: `D${find(client, 'Overall total materials') + 1}` }],
      // The Quality Inn is Lodging: the hotels' line, the other receipts less it on the next (Fred: "see it hotels also").
      ['Hotels', null, { t: 'n', v: 350.74, z: '$#,##0.00', f: `SUM(E${find(client, 'Other receipts') + 3})` }],
      ['Other receipts', null, { t: 'n', v: 0, z: '$#,##0.00', f: `E${find(client, 'Overall total other receipts') + 1}-C${c + 10}` }],
      ['OVERALL TOTAL', null, { t: 'n', v: 1829.39, z: '$#,##0.00', f: `C${c + 7}+C${c + 8}+C${c + 9}+C${c + 10}+C${c + 11}` }],
    ]);
    expect(Math.max(...client.map((r) => r.length))).toBeLessThanOrEqual(8);
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
