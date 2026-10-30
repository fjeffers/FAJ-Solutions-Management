// The job log as an Excel workbook (Fred, 2026-10-30: edit it "Both" in the app and in Excel), laid out like
// his own job-log-timesheet.xlsx: the summary at the top, then Time on site, Mileage, Meals, Materials and Other
// receipts, each tech's rows and subtotal (the lead tech first), the overall total, and the JOB TOTAL.
// Hours, miles and the totals are formulas, so a change typed in Excel adds up again: hours = MOD(out − in, 1)
// × 24 − break, a day's miles = odometer end − start. No billable total ("No, keep it off").
import { byTechGroups } from './job-log';
import { hoursTotal, milesTotal, minutesOf, moneyTotal, rowHours, type JobSheet, type MileRow, type MoneyRow } from './job-log-sheet';

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
export const JOB_LOG_MARGINS = { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 };

/** The workbook's one sheet, row by row. */
export function jobLogCells(sheet: JobSheet, head: JobLogHead): XCell[][] {
  const rows: XCell[][] = [];
  /** The Excel row number the next row gets. */
  const next = () => rows.length + 1;

  rows.push(['JOB LOG', head.range]);
  rows.push([head.title]);
  for (const l of head.lines) rows.push([l]);
  rows.push([]);
  rows.push(['HOURS ON SITE', 'MILES', 'MEALS', 'MATERIALS', 'OTHER RECEIPTS']);
  const summary: XCell[] = [];
  rows.push(summary);

  /**
   * A section: its title and column names, each tech's rows then the tech's subtotal, and the overall total.
   * `col` is the column of the number that's added up; `cells` makes a row's cells given its Excel row number.
   */
  const section = <T extends { tech: string; day: string }>(
    title: string, columns: string[], list: T[], col: string, fmt: string,
    cells: (r: T, at: number) => XCell[], value: (rows: T[]) => number, subtotal: (tech: string) => string, overall: string,
  ): string => {
    rows.push([]);
    rows.push([title]);
    rows.push(columns);
    const subs: string[] = [];
    const pad = columns.length - 1;
    for (const g of byTechGroups(list, (r) => r.tech, head.crew)) {
      const first = next();
      for (const r of g.items) rows.push(cells(r, next()));
      const at = next();
      rows.push([subtotal(g.tech), ...Array(pad - 1).fill(null), num(value(g.items), fmt, `SUM(${col}${first}:${col}${at - 1})`)]);
      subs.push(`${col}${at}`);
    }
    const at = next();
    rows.push([overall, ...Array(pad - 1).fill(null), num(value(list), fmt, subs.length ? subs.join('+') : '0')]);
    return `${col}${at}`;
  };

  const hours = section('Time on site', ['NAME', 'DATE', 'CLOCK IN', 'CLOCK OUT', 'BREAK', 'HOURS'],
    byDay(sheet.time, (a, b) => (minutesOf(a.in) ?? 0) - (minutesOf(b.in) ?? 0)), 'F', HRS,
    (r, at) => {
      const a = minutesOf(r.in), b = minutesOf(r.out);
      return [r.tech, num(dayNumber(r.day), DATE), a == null ? '' : num(a / 1440, TIME), b == null ? '' : num(b / 1440, TIME),
        num(r.brk || 0, HRS), num(rowHours(r) ?? 0, HRS, `IF(OR(C${at}="",D${at}=""),0,ROUND(MAX(0,MOD(D${at}-C${at},1)*24-E${at}),2))`)];
    },
    hoursTotal, (t) => `${t} final hours`, 'Overall total worked');

  // A day's miles follow its odometer when they're the odometer's; otherwise (GPS, miles added) they're as typed.
  const odometerMiles = (r: MileRow) => r.start != null && r.end != null && Math.round((r.end - r.start) * 10) / 10 === r.miles;
  const miles = section('Mileage', ['NAME', 'DATE', 'ODOMETER START', 'ODOMETER END', 'MILES'], byDay(sheet.miles), 'E', MILES,
    (r, at) => [r.tech, num(dayNumber(r.day), DATE), r.start == null ? '' : num(r.start, '#,##0'), r.end == null ? '' : num(r.end, '#,##0'),
      num(r.miles, MILES, odometerMiles(r) ? `D${at}-C${at}` : undefined)],
    milesTotal, (t) => `${t} total miles`, 'Overall total miles');

  const money = (title: string, what: string, list: MoneyRow[]) => section(title, ['NAME', 'DATE', 'STORE', 'AMOUNT'], byDay(list), 'D', USD,
    (r) => [r.tech, num(dayNumber(r.day), DATE), r.store || '—', num(r.amount, USD)],
    moneyTotal, (t) => `${t} total ${what}`, `Overall total ${what}`);
  const meals = money('Meals', 'meals', sheet.meals);
  const materials = money('Materials', 'materials', sheet.materials);
  const other = section('Other receipts', ['NAME', 'DATE', 'FOR', 'STORE', 'AMOUNT'], byDay(sheet.other), 'E', USD,
    (r) => [r.tech, num(dayNumber(r.day), DATE), r.for || '—', r.store || '—', num(r.amount, USD)],
    moneyTotal, (t) => `${t} total`, 'Overall total other receipts');

  const h = hoursTotal(sheet.time), mi = milesTotal(sheet.miles);
  const spent = Math.round((moneyTotal(sheet.meals) + moneyTotal(sheet.materials) + moneyTotal(sheet.other)) * 100) / 100;
  summary.push(num(h, HRS, hours), num(mi, MILES, miles), num(moneyTotal(sheet.meals), USD, meals),
    num(moneyTotal(sheet.materials), USD, materials), num(moneyTotal(sheet.other), USD, other));
  rows.push([]);
  // One line that says what each number is ("72.56 hours", "458.0 miles"), so a page never splits it.
  rows.push(['JOB TOTAL', num(h, `${HRS}" hours"`, hours), num(mi, `${MILES}" miles"`, miles), num(spent, USD, `${meals}+${materials}+${other}`)]);
  return rows;
}

/** Saves the workbook ("<the job log's name>.xlsx"). */
export async function downloadJobLogXlsx(filename: string, sheet: JobSheet, head: JobLogHead) {
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.aoa_to_sheet(jobLogCells(sheet, head));
  ws['!cols'] = JOB_LOG_WIDTHS.map((wch) => ({ wch }));
  ws['!margins'] = JOB_LOG_MARGINS;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Job Log');
  XLSX.writeFile(wb, filename);
}
