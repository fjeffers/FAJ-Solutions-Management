// The job log's invoice, laid out as the client's own (Fred, 2026-10-30: "this how the client want the layout to
// look", their Fred_Invoice_Format.pdf; "keep it the same way they client has it mirror it exactly"). Each tech in
// turn, the lead first: their hours day by day (Total Hours), their meal allowance day by day (Total Meal
// Allowance), their mileage day by day (Total Milage) and their hotel (Total Travel), then the tech's total; at the
// end Labor, Mileage, Meals, Travel and the Total Invoice. Only those four: no materials or other receipts, as
// theirs. The hours and miles × each tech's rates (lib/job-log-rates.ts), as the client's copy charges them.
import { byTechGroups } from './job-log';
import { lineAmount, type JobRates } from './job-log-rates';
import { fixedHours, hoursTotal, isHotel, rowHours, type JobSheet, type MileRow, type MoneyRow, type TimeRow } from './job-log-sheet';
import type { XCell } from './job-log-xlsx';

/** What the office types for the invoice, kept with the rates (job_log_rates.invoice, migration 149). */
export type InvoiceMeta = {
  /** The invoice number. */
  number: string;
  /** Its date (YYYY-MM-DD); the due date is this plus `terms` days. */
  date: string;
  /** Net days. */
  terms: number;
  /** What the labor was, on each day's line ("Installation of Cabling for refresh project"). */
  labor: string;
  /** The meal allowance a day, up to which the receipts are charged; none: the receipts as they are. */
  meal: number | null;
};

export const DEFAULT_LABOR = 'Installation of Cabling for refresh project';

/** job_log_rates.invoice from the database, with `today` for a date not set yet. */
export function parseInvoiceMeta(raw: unknown, today: string): InvoiceMeta {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
  const date = text(o.date);
  return {
    number: text(o.number).slice(0, 40),
    date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : today,
    terms: Math.round(n(o.terms) ?? 30),
    labor: (text(o.labor) || DEFAULT_LABOR).slice(0, 200),
    // An allowance of null, typed as empty, is kept as no cap; one never set is the client's $50.
    meal: 'meal' in o ? n(o.meal) : 50,
  };
}

export const sameMeta = (a: InvoiceMeta, b: InvoiceMeta) => JSON.stringify(a) === JSON.stringify(b);

/** "2026-10-25" plus `days`. */
export function dueDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * One line of the invoice: Date, Item, Description, Qty, Rate, Amount (null: blank). For editing on the invoice:
 * whose it is, the sheet's row under it (a day's hours, a hotel), and a meal line's receipts before the allowance.
 */
export type InvoiceLine = {
  date: string; item: string; description: string; qty: number | null; rate: number | null; amount: number | null;
  tech?: string; row?: TimeRow | MoneyRow; spent?: number;
};
/** A section of a tech's: its title's line ("Total Meal Allowance" and its amount) and its lines. */
export type InvoiceSection = { title: string; amount: number; lines: InvoiceLine[] };
export type InvoiceTech = {
  role: 'Lead' | 'Helper';
  tech: string;
  /** Total Hours: the hours added up, the tech's rate and the dollars. */
  hours: InvoiceSection & { qty: number; rate: number | null };
  meals: InvoiceSection;
  mileage: InvoiceSection;
  travel: InvoiceSection;
  total: number;
};
export type Invoice = { techs: InvoiceTech[]; totals: { labor: number; mileage: number; meals: number; travel: number; total: number } };

const r2 = (n: number) => Math.round(n * 100 + 1e-9) / 100;
const sum = (lines: InvoiceLine[]) => r2(lines.reduce((t, l) => t + (l.amount ?? 0), 0));
const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

/**
 * The invoice for the sheet shown: each tech on it, the lead (`crew`'s first) as Lead and the rest as Helper.
 * `place` is the site's city and state ("Goldsboro NC") for the drives there and home.
 */
export function buildInvoice(sheet: JobSheet, rates: JobRates, crew: string[], meta: Pick<InvoiceMeta, 'labor' | 'meal'>, place: string): Invoice {
  const names = [...sheet.time, ...sheet.miles, ...sheet.meals, ...sheet.other.filter(isHotel)].map((r) => r.tech).filter(Boolean);
  const order = byTechGroups(names, (t) => t, crew).map((g) => g.tech);
  // What the lead has, the helpers have too (Fred, 2026-10-30: "everything the lead has the helpers has also ... 701
  // for hotels so 350 for each tech"): a helper with no drives or hotel of their own has the lead's, as the client's
  // own invoice gives the helper the lead's miles and hotel. A helper's line of the lead's is the lead's to change.
  // The crew's lead, even with no lines in the dates picked: then a helper has none of theirs, never another helper's
  // (Greptile on PR #44).
  const lead = crew[0] ?? order[0] ?? '';
  const leadDrives = sheet.miles.filter((r) => r.tech === lead), leadHotels = sheet.other.filter((r) => r.tech === lead && isHotel(r));
  const techs = order.map((tech): InvoiceTech => {
    const { hour = null, mile = null } = rates[tech] ?? {};
    const time = sheet.time.filter((r) => r.tech === tech).sort((a, b) => a.day.localeCompare(b.day));
    const laborDays = [...new Set(time.map((r) => r.day))];
    // Total Hours: a line a day worked, at the tech's rate.
    const hourLines = time.map((r): InvoiceLine => {
      const qty = rowHours(r) ?? 0;
      return { date: r.day, item: 'Labor', description: meta.labor, qty, rate: hour, amount: lineAmount(qty, hour), tech, row: r };
    });
    // Total Meal Allowance: a line a day worked (or a meal bought), the day's receipts up to the allowance; a day with
    // none has no quantity or rate and nothing charged, as theirs.
    const mealsOf = (d: string) => r2(sheet.meals.filter((r) => r.tech === tech && r.day === d).reduce((t, r) => t + (r.amount || 0), 0));
    const mealDays = [...new Set([...laborDays, ...sheet.meals.filter((r) => r.tech === tech).map((r) => r.day)])].sort();
    const allowance = meta.meal == null ? 'Meal allowance with Receipts' : `Meal allowance up to ${money(meta.meal)} with Receipts`;
    const mealLines = mealDays.map((d): InvoiceLine => {
      const spent = mealsOf(d), charged = meta.meal == null ? spent : Math.min(spent, meta.meal);
      return spent > 0 ? { date: d, item: 'Meal', description: allowance, qty: 1, rate: charged, amount: charged, tech, spent }
        : { date: d, item: 'Meal', description: allowance, qty: null, rate: null, amount: 0, tech, spent: 0 };
    });
    // Total Milage: a line a day, from the drive there to the drive home, at the tech's mileage rate; the first drive
    // is from home to the site, the last one home, when they're before and after the days worked.
    const own = sheet.miles.filter((r) => r.tech === tech);
    const drives = own.length ? own : leadDrives, driver = own.length ? tech : lead;
    const milesOf = (d: string) => Math.round(drives.filter((r) => r.day === d).reduce((t, r) => t + (r.miles || 0), 0) * 10) / 10;
    const mileDays = [...new Set([...laborDays, ...drives.map((r) => r.day)])].sort();
    const driven = mileDays.filter((d) => milesOf(d) > 0);
    const there = driven[0] && (!laborDays.length || driven[0] <= laborDays[0]) ? driven[0] : null;
    const home = driven.at(-1) && driven.at(-1) !== there && (!laborDays.length || driven.at(-1)! >= laborDays.at(-1)!) ? driven.at(-1)! : null;
    const mileLines = mileDays.map((d): InvoiceLine => {
      const miles = milesOf(d);
      const where = place || 'the site';
      const description = d === there ? `Mileage from Home to ${where}` : d === home ? `Mileage from ${where} to Home` : '';
      return { date: d, item: 'Mileage', description: miles > 0 ? description : '', qty: miles > 0 ? miles : null, rate: mile,
        amount: miles > 0 ? lineAmount(miles, mile) : mile == null ? null : 0, tech: driver };
    });
    // Total Travel: their hotel.
    const ownHotels = sheet.other.filter((r) => r.tech === tech && isHotel(r));
    const hotels = [...(ownHotels.length ? ownHotels : leadHotels)].sort((a, b) => a.day.localeCompare(b.day));
    const travelLines = hotels.map((r): InvoiceLine => ({
      date: r.day, item: 'Hotel', description: hotels.length === 1 ? 'Hotel charge for the week' : 'Hotel charge', qty: 1, rate: r.amount, amount: r2(r.amount || 0),
      tech: r.tech, row: r,
    }));
    const hours = { title: 'Total Hours', qty: hoursTotal(time), rate: hour, amount: sum(hourLines), lines: hourLines };
    const meals = { title: 'Total Meal Allowance', amount: sum(mealLines), lines: mealLines };
    const mileage = { title: 'Total Milage', amount: sum(mileLines), lines: mileLines };
    const travel = { title: 'Total Travel', amount: sum(travelLines), lines: travelLines };
    return { role: tech === crew[0] ? 'Lead' : 'Helper', tech, hours, meals, mileage, travel, total: r2(hours.amount + meals.amount + mileage.amount + travel.amount) };
  });
  const of = (k: 'hours' | 'meals' | 'mileage' | 'travel') => r2(techs.reduce((t, x) => t + x[k].amount, 0));
  const totals = { labor: of('hours'), mileage: of('mileage'), meals: of('meals'), travel: of('travel'), total: 0 };
  totals.total = r2(totals.labor + totals.mileage + totals.meals + totals.travel);
  return { techs, totals };
}

// Editing on the invoice (Fred, 2026-10-30: "the invoice need to be one ... so we edit job log it shows as an
// invoice"): each change is to the job log's time sheet under it, so the time sheet, the job log and the invoice
// stay one. A day's hours and a hotel are their own rows; a day's meals and miles are the tech's rows that day.

const swap = <T>(rows: T[], from: T, to: T | null) => rows.flatMap((r) => (r === from ? (to ? [to] : []) : [r]));
const theirs = (tech: string, day: string) => (r: { tech: string; day: string }) => r.tech === tech && r.day === day;

/** A day's meals as one amount: the one receipt changed, or the receipts made one; none takes them out. */
function dayMeals(rows: MoneyRow[], tech: string, day: string, amount: number | null): MoneyRow[] {
  const mine = rows.filter(theirs(tech, day)), rest = rows.filter((r) => !theirs(tech, day)(r));
  if (!amount) return rest;
  if (mine.length === 1) return swap(rows, mine[0], { ...mine[0], amount });
  return [...rest, { tech, day, store: mine.map((r) => r.store).filter(Boolean).join(', '), amount }];
}
/** A day's miles as one number: the one drive changed, or the drives made one; none takes them out. */
function dayMiles(rows: MileRow[], tech: string, day: string, miles: number | null): MileRow[] {
  const mine = rows.filter(theirs(tech, day)), rest = rows.filter((r) => !theirs(tech, day)(r));
  if (!miles) return rest;
  if (mine.length === 1) return swap(rows, mine[0], { ...mine[0], miles });
  return [...rest, { tech, day, start: null, end: null, miles }];
}

/**
 * A line changed on the invoice: its day; a day's hours (the break still comes off them), a day's miles, a meal's
 * receipts or a hotel's amount.
 */
export function editLine(sheet: JobSheet, l: InvoiceLine, p: { day?: string; qty?: number | null; amount?: number | null }): JobSheet {
  const tech = l.tech ?? '';
  if (l.item === 'Labor' && l.row) {
    const r = l.row as TimeRow;
    const { open: _open, ms: _ms, ...kept } = r;
    void _open; void _ms;
    // The hours typed (before the break), else the day's own: a stretch still on site keeps its hours so far when only
    // its date changes (Greptile on PR #44).
    const hours = 'qty' in p ? r2((p.qty ?? 0) + (r.brk || 0)) : fixedHours(r);
    const next: TimeRow = { ...kept, ...(p.day ? { day: p.day } : {}), ...(hours != null ? { hours } : {}) };
    return { ...sheet, time: swap(sheet.time, r, next) };
  }
  if (l.item === 'Hotel' && l.row) {
    const r = l.row as MoneyRow;
    return { ...sheet, other: swap(sheet.other, r, { ...r, ...(p.day ? { day: p.day } : {}), ...('amount' in p ? { amount: p.amount ?? 0 } : {}) }) };
  }
  if (l.item === 'Meal') {
    if (p.day) return { ...sheet, meals: sheet.meals.map((r) => (theirs(tech, l.date)(r) ? { ...r, day: p.day! } : r)) };
    return 'amount' in p ? { ...sheet, meals: dayMeals(sheet.meals, tech, l.date, p.amount ?? null) } : sheet;
  }
  if (l.item === 'Mileage') {
    if (p.day) return { ...sheet, miles: sheet.miles.map((r) => (theirs(tech, l.date)(r) ? { ...r, day: p.day! } : r)) };
    return 'qty' in p ? { ...sheet, miles: dayMiles(sheet.miles, tech, l.date, p.qty ?? null) } : sheet;
  }
  return sheet;
}

/** A line taken off the invoice: a day's hours or a hotel, or the tech's meals or miles that day. */
export function removeLine(sheet: JobSheet, l: InvoiceLine): JobSheet {
  const tech = l.tech ?? '';
  if (l.item === 'Labor' && l.row) return { ...sheet, time: swap(sheet.time, l.row as TimeRow, null) };
  if (l.item === 'Hotel' && l.row) return { ...sheet, other: swap(sheet.other, l.row as MoneyRow, null) };
  if (l.item === 'Meal') return { ...sheet, meals: sheet.meals.filter((r) => !theirs(tech, l.date)(r)) };
  if (l.item === 'Mileage') return { ...sheet, miles: sheet.miles.filter((r) => !theirs(tech, l.date)(r)) };
  return sheet;
}

/** A line added on the invoice for a tech on a day: a day worked, a drive or a hotel, to fill in. */
export function addLine(sheet: JobSheet, tech: string, item: 'Labor' | 'Mileage' | 'Hotel', day: string): JobSheet {
  if (item === 'Labor') return { ...sheet, time: [...sheet.time, { tech, day, in: '', out: '', brk: 0, hours: 0 }] };
  if (item === 'Mileage') return { ...sheet, miles: [...sheet.miles, { tech, day, start: null, end: null, miles: 0 }] };
  return { ...sheet, other: [...sheet.other, { tech, day, store: '', amount: 0, for: 'Lodging' }] };
}

/** The invoice's top: who it's from and to, and its number and dates. */
export type InvoiceHead = { billTo: string; shipTo: string[]; meta: InvoiceMeta };
export const FAJ = { name: 'F.A.J Solutions LLC', lines: ['1820 Dayton Dr', 'Easton, PA  18040 US', 'support@fajsolutions.com'] };

const DATE = 'mm/dd/yyyy', HOURS = '0.00#', MILES = '#,##0.0', QTY = '#,##0.0##';
// Excel's Accounting format, as theirs: "$ 315.95", a nought as "$ -".
const ACCT = '_($* #,##0.00_);_($* (#,##0.00);_($* "-"??_);_(@_)';
const num = (v: number, z: string, f?: string): XCell => ({ t: 'n', v, z, ...(f ? { f } : {}) });
const dayNumber = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86_400_000 + 25_569;

/** The columns: Date, Item, Description (and its totals' names), Qty, Rate, Amount. */
export const INVOICE_WIDTHS = [10, 7, 24, 13, 6, 9, 11];

/**
 * The invoice as a workbook's rows, in the client's columns. Each line's amount is its quantity × its rate, each
 * total the sum of its lines, a tech's total their four, and the Total Invoice the four totals: a rate or a quantity
 * changed in Excel adds up again.
 */
export function invoiceCells(inv: Invoice, head: InvoiceHead): XCell[][] {
  const rows: XCell[][] = [];
  const next = () => rows.length + 1;
  rows.push([FAJ.name]);
  for (const l of FAJ.lines) rows.push([l]);
  rows.push([]);
  rows.push(['INVOICE']);
  const top = next();
  const { meta } = head;
  // The number and dates in the last two columns, so the ship-to's lines have the room before them.
  rows.push(['BILL TO', null, 'SHIP TO', null, null, 'INVOICE', meta.number]);
  rows.push([head.billTo, null, head.shipTo[0] ?? '', null, null, 'DATE', num(dayNumber(meta.date), DATE)]);
  rows.push([null, null, head.shipTo[1] ?? '', null, null, 'TERMS', `Net ${meta.terms}`]);
  rows.push([null, null, null, null, null, 'DUE DATE', num(dayNumber(dueDate(meta.date, meta.terms)), DATE, `G${top + 1}+${meta.terms}`)]);
  rows.push([]);
  rows.push(['Date', 'Item', 'Description', null, 'Qty', 'Rate', 'Amount']);

  const line = (l: InvoiceLine, qtyFmt: string) => {
    const at = next();
    // With no rate yet, blank, and worked out when one's typed in Excel.
    const f = `IF(F${at}="","",IF(E${at}="",0,ROUND(E${at}*F${at},2)))`;
    rows.push([num(dayNumber(l.date), DATE), l.item, l.description || null, null,
      l.qty == null ? null : num(l.qty, qtyFmt), l.rate == null ? null : num(l.rate, ACCT),
      l.amount == null ? { t: 's', v: '', f } : num(l.amount, ACCT, f)]);
    return at;
  };
  /** A section's lines under its title's line; gives the title's row. */
  const section = (s: InvoiceSection, qtyFmt: string) => {
    const at = next();
    rows.push([null, null, null, s.title, null, null, null]);
    const first = next();
    for (const l of s.lines) line(l, qtyFmt);
    rows[at - 1][6] = num(s.amount, ACCT, s.lines.length ? `SUM(G${first}:G${next() - 1})` : '0');
    return at;
  };
  const techAt: { hours: number; meals: number; mileage: number; travel: number }[] = [];
  for (const t of inv.techs) {
    // The tech's first line: Lead or Helper, their name, Total Hours added up × their rate.
    const at = next();
    rows.push([t.role, null, t.tech, 'Total Hours', null, t.hours.rate == null ? null : num(t.hours.rate, ACCT), null]);
    const first = next();
    for (const l of t.hours.lines) line(l, HOURS);
    const last = next() - 1;
    rows[at - 1][4] = num(t.hours.qty, HOURS, t.hours.lines.length ? `SUM(E${first}:E${last})` : '0');
    rows[at - 1][6] = num(t.hours.amount, ACCT, t.hours.lines.length ? `SUM(G${first}:G${last})` : '0');
    const meals = section(t.meals, QTY), mileage = section(t.mileage, MILES), travel = section(t.travel, QTY);
    rows.push([null, null, null, `${t.role} Total`, null, null, num(t.total, ACCT, `G${at}+G${meals}+G${mileage}+G${travel}`)]);
    rows.push([]);
    techAt.push({ hours: at, meals, mileage, travel });
  }
  rows.push([null, null, 'Totals']);
  const totalsAt = next();
  const of = (k: keyof (typeof techAt)[number]) => (techAt.length ? techAt.map((t) => `G${t[k]}`).join('+') : '0');
  rows.push([null, null, null, null, 'Labor', null, num(inv.totals.labor, ACCT, of('hours'))]);
  rows.push([null, null, null, null, 'Mileage', null, num(inv.totals.mileage, ACCT, of('mileage'))]);
  rows.push([null, null, null, null, 'Meals', null, num(inv.totals.meals, ACCT, of('meals'))]);
  rows.push([null, null, null, null, 'Travel', null, num(inv.totals.travel, ACCT, of('travel'))]);
  rows.push([null, null, null, null, 'Total Invoice', null, num(inv.totals.total, ACCT, `SUM(G${totalsAt}:G${totalsAt + 3})`)]);
  return rows;
}

/** Saves the invoice workbook. */
export async function downloadInvoiceXlsx(filename: string, inv: Invoice, head: InvoiceHead) {
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.aoa_to_sheet(invoiceCells(inv, head));
  ws['!cols'] = INVOICE_WIDTHS.map((wch) => ({ wch }));
  ws['!margins'] = { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Invoice');
  XLSX.writeFile(wb, filename);
}
