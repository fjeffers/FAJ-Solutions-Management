// The job log's time sheet as an Excel workbook (Fred, 2026-10-30: edit it "Both" in the app and in Excel; "the
// one i edit is the time sheet that reflect on the job log"), laid out like his own job-log-timesheet.xlsx: the summary at the top, then Time on site, Mileage, Meals, Materials and Other
// receipts, each tech's rows and subtotal (the lead tech first), the overall total, and the JOB TOTAL.
// Hours, miles and the totals are formulas, so a change typed in Excel adds up again: hours = MOD(out − in, 1)
// × 24 − break, a day's miles = odometer end − start. No billable total ("No, keep it off"), and the JOB TOTAL
// is hours and miles only, no dollars ("i dont want it mix"). The client's copy (Fred, 2026-10-30: "the client just
// asked for this"; lib/job-log-rates.ts) gives each row of the hours and of the miles its tech's rate and dollars
// ("in the hours should get the rate and the same for the milage gets the milages rate"), and TOTAL CHARGES at the end.
import { byTechGroups } from './job-log';
import { lineAmount, type JobRates } from './job-log-rates';
import { fixedHours, hoursTotal, milesTotal, minutesOf, moneyTotal, rowHours, type JobSheet, type MileRow, type MoneyRow } from './job-log-sheet';

/** A cell for SheetJS: text, or a number with its Excel format and, for a sum or a sum's part, its formula. */
export type XCell = string | null | { t: 'n'; v: number; z: string; f?: string };

export type JobLogHead = { title: string; lines: string[]; range: string; crew: string[] };

const DATE = 'mm/dd/yyyy', TIME = 'h:mm AM/PM', HRS = '0.00', MILES = '#,##0.0', USD = '$#,##0.00';
const num = (v: number, z: string, f?: string): XCell => ({ t: 'n', v, z, ...(f ? { f } : {}) });
/** "2026-10-19" → Excel's day number. */
const dayNumber = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86_400_000 + 25_569;
const byDay = <T extends { day: string }>(rows: T[], then?: (a: T, b: T) => number) =>
  [...rows].sort((a, b) => a.day.localeCompare(b.day) || (then ? then(a, b) : 0));

/** The six columns' widths, narrow enough with JOB_LOG_MARGINS to print one page wide (Letter or A4). */
export const JOB_LOG_WIDTHS = [19, 11, 16, 14, 10, 10];
/** The client's copy's eight (a rate and an amount after the hours), narrower so they're still one page wide. */
export const JOB_LOG_CLIENT_WIDTHS = [15, 11, 10, 9, 7, 7, 8, 10];
export const JOB_LOG_MARGINS = { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 };

/** The workbook's one sheet, row by row; `rates` for the client's copy. */
export function jobLogCells(sheet: JobSheet, head: JobLogHead, rates?: JobRates): XCell[][] {
  const rows: XCell[][] = [];
  /** The Excel row number the next row gets. */
  const next = () => rows.length + 1;

  rows.push(['TIME SHEET', head.range]);
  rows.push([head.title]);
  for (const l of head.lines) rows.push([l]);
  rows.push([]);
  rows.push(['HOURS ON SITE', 'MILES', 'MEALS', 'MATERIALS', 'OTHER RECEIPTS']);
  const summary: XCell[] = [];
  rows.push(summary);

  /**
   * A section: its title and column names, each tech's rows then the tech's subtotal, and the overall total.
   * `col` is the column of the number that's added up; `cells` makes a row's cells given its Excel row number.
   * Gives the overall total's cell, and each tech's subtotal cell. With `priced` (the client's copy), each row's rate
   * and amount follow, and each tech's and the overall amount; gives the overall amount's cell.
   */
  const section = <T extends { tech: string; day: string }>(
    title: string, columns: string[], list: T[], col: string, fmt: string,
    cells: (r: T, at: number) => XCell[], value: (rows: T[]) => number, subtotal: (tech: string) => string, overall: string,
    priced?: { qty: (r: T) => number | null; rate: (tech: string) => number | null; head: string },
  ): { total: string; amount: string | null } => {
    rows.push([]);
    rows.push([title]);
    rows.push(priced ? [...columns, priced.head, 'AMOUNT'] : columns);
    const subs: string[] = [];
    const amountSubs: string[] = [];
    // The rate and amount columns, after the one added up.
    const rateCol = String.fromCharCode(col.charCodeAt(0) + 1), amountCol = String.fromCharCode(col.charCodeAt(0) + 2);
    let amountTotal = 0;
    const pad = columns.length - 1;
    for (const g of byTechGroups(list, (r) => r.tech, head.crew)) {
      const first = next();
      const rate = priced?.rate(g.tech) ?? null;
      let techAmount = 0;
      for (const r of g.items) {
        const at = next();
        const row = cells(r, at);
        if (priced) {
          // A tech with no rate isn't charged: their rows' rate and amount are left empty.
          const amount = lineAmount(priced.qty(r), rate);
          techAmount += amount ?? 0;
          row.push(rate == null ? '' : num(rate, USD), amount == null ? '' : num(amount, USD, `ROUND(${col}${at}*${rateCol}${at},2)`));
        }
        rows.push(row);
      }
      const at = next();
      const sub: XCell[] = [subtotal(g.tech), ...Array(pad - 1).fill(null), num(value(g.items), fmt, `SUM(${col}${first}:${col}${at - 1})`)];
      if (priced && rate != null) {
        techAmount = Math.round(techAmount * 100 + 1e-9) / 100;
        sub.push(null, num(techAmount, USD, `SUM(${amountCol}${first}:${amountCol}${at - 1})`));
        amountSubs.push(`${amountCol}${at}`);
        amountTotal += techAmount;
      }
      rows.push(sub);
      subs.push(`${col}${at}`);
    }
    const at = next();
    const total: XCell[] = [overall, ...Array(pad - 1).fill(null), num(value(list), fmt, subs.length ? subs.join('+') : '0')];
    if (priced) total.push(null, num(Math.round(amountTotal * 100 + 1e-9) / 100, USD, amountSubs.length ? amountSubs.join('+') : '0'));
    rows.push(total);
    return { total: `${col}${at}`, amount: priced ? `${amountCol}${at}` : null };
  };
  const rateOf = (k: 'hour' | 'mile') => (tech: string) => rates?.[tech]?.[k] ?? null;

  const hours = section('Time on site', ['NAME', 'DATE', 'CLOCK IN', 'CLOCK OUT', 'BREAK', 'HOURS'],
    byDay(sheet.time, (a, b) => (minutesOf(a.in) ?? 0) - (minutesOf(b.in) ?? 0)), 'F', HRS,
    (r, at) => {
      const a = minutesOf(r.in), b = minutesOf(r.out);
      // The row's own hours (the Hours screen's, or a stretch still on site's so far, with no clock out for the
      // times' formula) less the break; else the times' (Greptile, CodeRabbit on PR #39).
      const fixed = fixedHours(r);
      return [r.tech, num(dayNumber(r.day), DATE), a == null ? '' : num(a / 1440, TIME), b == null ? '' : num(b / 1440, TIME),
        num(r.brk || 0, HRS), num(rowHours(r) ?? 0, HRS, fixed != null ? `ROUND(MAX(0,${fixed}-E${at}),2)`
          : `IF(OR(C${at}="",D${at}=""),0,ROUND(MAX(0,MOD(D${at}-C${at},1)*24-E${at}),2))`)];
    },
    hoursTotal, (t) => `${t} final hours`, 'Overall total worked', rates && { qty: rowHours, rate: rateOf('hour'), head: 'RATE/HR' });

  // A day's miles follow its odometer when they're the odometer's; otherwise (GPS, miles added) they're as typed.
  const odometerMiles = (r: MileRow) => r.start != null && r.end != null && Math.round((r.end - r.start) * 10) / 10 === r.miles;
  // The client's copy's narrower columns take the short names.
  const miles = section('Mileage', ['NAME', 'DATE', rates ? 'ODO START' : 'ODOMETER START', rates ? 'ODO END' : 'ODOMETER END', 'MILES'], byDay(sheet.miles), 'E', MILES,
    (r, at) => [r.tech, num(dayNumber(r.day), DATE), r.start == null ? '' : num(r.start, '#,##0'), r.end == null ? '' : num(r.end, '#,##0'),
      num(r.miles, MILES, odometerMiles(r) ? `D${at}-C${at}` : undefined)],
    milesTotal, (t) => `${t} total miles`, 'Overall total miles', rates && { qty: (r) => r.miles, rate: rateOf('mile'), head: 'RATE/MI' });

  const money = (title: string, what: string, list: MoneyRow[]) => section(title, ['NAME', 'DATE', 'STORE', 'AMOUNT'], byDay(list), 'D', USD,
    (r) => [r.tech, num(dayNumber(r.day), DATE), r.store || '—', num(r.amount, USD)],
    moneyTotal, (t) => `${t} total ${what}`, `Overall total ${what}`).total;
  const meals = money('Meals', 'meals', sheet.meals);
  const materials = money('Materials', 'materials', sheet.materials);
  const other = section('Other receipts', ['NAME', 'DATE', 'FOR', 'STORE', 'AMOUNT'], byDay(sheet.other), 'E', USD,
    (r) => [r.tech, num(dayNumber(r.day), DATE), r.for || '—', r.store || '—', num(r.amount, USD)],
    moneyTotal, (t) => `${t} total`, 'Overall total other receipts').total;

  const h = hoursTotal(sheet.time), mi = milesTotal(sheet.miles);
  summary.push(num(h, HRS, hours.total), num(mi, MILES, miles.total), num(moneyTotal(sheet.meals), USD, meals),
    num(moneyTotal(sheet.materials), USD, materials), num(moneyTotal(sheet.other), USD, other));
  rows.push([]);
  // One line that says what each number is ("72.56 hours", "458.0 miles"), so a page never splits it. Hours and
  // miles only: the receipts' dollars stay in their own sections, not added up with them (Fred: "i dont want it mix").
  rows.push(['JOB TOTAL', num(h, `${HRS}" hours"`, hours.total), num(mi, `${MILES}" miles"`, miles.total)]);

  if (rates && hours.amount && miles.amount) {
    // The client's copy: the hours' and the miles' dollars, as their overall amounts above, and the two added up.
    const amountOf = (cell: string) => rows[Number(cell.slice(1)) - 1][cell.charCodeAt(0) - 65] as { v: number };
    const labor = amountOf(hours.amount).v, mileage = amountOf(miles.amount).v;
    rows.push([]);
    rows.push(['CHARGES']);
    const first = next();
    rows.push(['Hours', num(labor, USD, hours.amount)]);
    rows.push(['Mileage', num(mileage, USD, miles.amount)]);
    rows.push(['TOTAL CHARGES', num(Math.round((labor + mileage) * 100 + 1e-9) / 100, USD, `B${first}+B${first + 1}`)]);
  }
  return rows;
}

/** Saves the workbook ("<the job log's name>.xlsx"); with `rates`, the client's copy. */
export async function downloadJobLogXlsx(filename: string, sheet: JobSheet, head: JobLogHead, rates?: JobRates) {
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.aoa_to_sheet(jobLogCells(sheet, head, rates));
  ws['!cols'] = (rates ? JOB_LOG_CLIENT_WIDTHS : JOB_LOG_WIDTHS).map((wch) => ({ wch }));
  ws['!margins'] = JOB_LOG_MARGINS;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Job Log');
  XLSX.writeFile(wb, filename);
}
