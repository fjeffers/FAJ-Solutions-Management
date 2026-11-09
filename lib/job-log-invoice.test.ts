// The job log's invoice in the client's own layout (Fred, 2026-10-30: "this how the client want the layout to look",
// "mirror it exactly").
import { describe, it, expect } from 'vitest';
import {
  addLine, buildInvoice, dueDate, editLine, inQuickBooks, invoiceCells, invoiceCharges, invoiceImportRows, jobLogInvoiceNumber, jobLogMemo, jobLogQbPayload, parseInvoiceMeta, qbLinesTotal, quickBooksLines,
  removeLine, type InvoiceHead, type InvoiceLine,
} from './job-log-invoice';
import type { JobSheet } from './job-log-sheet';
import type { XCell } from './job-log-xlsx';

const sheet: JobSheet = {
  time: [
    { tech: 'Raja', day: '2026-10-19', in: '', out: '', brk: 0, hours: 6.32 },
    { tech: 'Paul Gibbs', day: '2026-10-20', in: '', out: '', brk: 0, hours: 6.32 },
    { tech: 'Paul Gibbs', day: '2026-10-19', in: '', out: '', brk: 0, hours: 6.32 },
  ],
  miles: [
    { tech: 'Paul Gibbs', day: '2026-10-18', start: null, end: null, miles: 478 },
    { tech: 'Paul Gibbs', day: '2026-10-20', start: null, end: null, miles: 478 },
  ],
  meals: [
    { tech: 'Paul Gibbs', day: '2026-10-19', store: 'Waffle House', amount: 18.97 },
    { tech: 'Paul Gibbs', day: '2026-10-19', store: 'Subway', amount: 40 },
    { tech: 'Raja', day: '2026-10-19', store: 'Subway', amount: 12.54 },
  ],
  materials: [{ tech: 'Paul Gibbs', day: '2026-10-19', store: "Lowe's", amount: 47.48 }],
  other: [
    { tech: 'Paul Gibbs', day: '2026-10-20', store: 'Quality Inn', amount: 402.5, for: 'Lodging' },
    { tech: 'Paul Gibbs', day: '2026-10-20', store: 'Circle K', amount: 40, for: 'Fuel' },
  ],
};
const crew = ['Paul Gibbs', 'Raja'];
const rates = { 'Paul Gibbs': { hour: 50, mile: 0.6 }, Raja: { hour: 50, mile: 0.6 } };
const meta = { labor: 'Installation of Cabling for refresh project', meal: 50 };
const inv = buildInvoice(sheet, rates, crew, meta, 'Goldsboro NC');
/** A line as it reads on the invoice, without what editing it needs. */
const read = (lines: InvoiceLine[]) => lines.map(({ date, item, description, qty, rate, amount }) => ({ date, item, description, qty, rate, amount }));

describe('the invoice', () => {
  it('uses the LDS job number before falling back to the FAJ work-order number', () => {
    expect(jobLogInvoiceNumber({ number: '' }, '19101401', 'LDS1106 Site 5006643')).toBe('LDS-1106');
    expect(jobLogInvoiceNumber({ number: '' }, '19101401', 'LDS-1106 Site 5006643')).toBe('LDS-1106');
    expect(jobLogInvoiceNumber({ number: '' }, '19101401', "Wendy's Franklin")).toBe('WO-19101401');
    expect(jobLogInvoiceNumber({ number: '1240' }, '19101401', 'LDS1106')).toBe('1240');
  });

  it('has the lead then the helper, each with their hours, meals, mileage and hotel, as the client lays it out', () => {
    expect(inv.techs.map((t) => [t.role, t.tech])).toEqual([['Lead', 'Paul Gibbs'], ['Helper', 'Raja']]);
    const paul = inv.techs[0];
    expect(paul.hours).toMatchObject({ title: 'Total Hours', qty: 12.64, rate: 50, amount: 632 });
    expect(read(paul.hours.lines)).toEqual([
      { date: '2026-10-19', item: 'Labor', description: 'Installation of Cabling for refresh project', qty: 6.32, rate: 50, amount: 316 },
      { date: '2026-10-20', item: 'Labor', description: 'Installation of Cabling for refresh project', qty: 6.32, rate: 50, amount: 316 },
    ]);
    // A meal a day worked, up to the $50 allowance: $58.97 of receipts on the 19th is $50; nothing on the 20th.
    expect({ ...paul.meals, lines: read(paul.meals.lines) }).toEqual({ title: 'Total Meal Allowance', amount: 50, lines: [
      { date: '2026-10-19', item: 'Meal', description: 'Meal allowance up to $50.00 with Receipts', qty: 1, rate: 50, amount: 50 },
      { date: '2026-10-20', item: 'Meal', description: 'Meal allowance up to $50.00 with Receipts', qty: null, rate: null, amount: 0 },
    ] });
    // The drive there the day before, the days on site, and the drive home on the last day.
    expect({ ...paul.mileage, lines: read(paul.mileage.lines) }).toEqual({ title: 'Total Milage', amount: 573.6, lines: [
      { date: '2026-10-18', item: 'Mileage', description: 'Mileage from Home to Goldsboro NC', qty: 478, rate: 0.6, amount: 286.8 },
      { date: '2026-10-19', item: 'Mileage', description: '', qty: null, rate: 0.6, amount: 0 },
      { date: '2026-10-20', item: 'Mileage', description: 'Mileage from Goldsboro NC to Home', qty: 478, rate: 0.6, amount: 286.8 },
    ] });
    // The hotel only: no fuel, no materials, as theirs.
    expect({ ...paul.travel, lines: read(paul.travel.lines) }).toEqual({ title: 'Total Travel', amount: 402.5, lines: [
      { date: '2026-10-20', item: 'Hotel', description: 'Quality Inn – Hotel charge for the week', qty: 1, rate: 402.5, amount: 402.5 },
    ] });
    // The materials, once, under the lead before the hotel (Fred: "under lead tech before hotel").
    expect({ ...paul.materials!, lines: read(paul.materials!.lines) }).toEqual({ title: 'Total Materials', amount: 47.48, lines: [
      { date: '2026-10-19', item: 'Material', description: "Lowe's", qty: 1, rate: 47.48, amount: 47.48 },
    ] });
    expect(paul.total).toBe(1705.58);
    // Raja has the lead's hotel (Fred: "everything the lead has the helpers has also ... 701 for hotels"); his own
    // hours, meals and mileage, as he entered them, never the lead's drives (Fred, 2026-11-02: "i need each tech milage
    // to be individually", "all tech separately milage and hours they entered").
    const raja = inv.techs[1];
    expect(read(raja.mileage.lines).map((l) => [l.date, l.description, l.qty, l.amount])).toEqual([['2026-10-19', '', null, 0]]);
    expect(raja).toMatchObject({ meals: { amount: 12.54 }, mileage: { amount: 0 }, travel: { amount: 402.5 }, total: 731.04 });
    expect(raja.materials).toBeUndefined();
    expect(inv.totals).toEqual({ labor: 948, mileage: 573.6, meals: 62.54, materials: 47.48, travel: 805, total: 2436.62 });
  });

  it('keeps a helper\'s own drives and hotel when they have them', () => {
    const own = buildInvoice({ ...sheet, miles: [...sheet.miles, { tech: 'Raja', day: '2026-10-19', start: null, end: null, miles: 30 }],
      other: [...sheet.other, { tech: 'Raja', day: '2026-10-19', store: 'Motel 6', amount: 99, for: 'Hotel' }] }, rates, crew, meta, 'Goldsboro NC');
    expect(own.techs[1]).toMatchObject({ mileage: { amount: 18 }, travel: { amount: 99 } });
  });

  it('puts a vehicle rental under the hotel, the tech\'s own only, and in QuickBooks as Traveling', () => {
    const rented = addLine(sheet, 'Paul Gibbs', 'Vehicle', '2026-10-18');
    expect(rented.other.at(-1)).toEqual({ tech: 'Paul Gibbs', day: '2026-10-18', store: '', amount: 0, for: 'Vehicle rental' });
    const blank = buildInvoice(rented, rates, crew, meta, 'Goldsboro NC').techs[0].travel.lines.at(-1)!;
    const priced = editLine(rented, blank, { amount: 210 });
    const inv = buildInvoice(priced, rates, crew, meta, 'Goldsboro NC');
    const [paul, raja] = inv.techs;
    expect(paul.travel.lines.map((l) => [l.item, l.description, l.amount])).toEqual([
      ['Hotel', 'Quality Inn – Hotel charge for the week', 402.5], ['Vehicle', 'Vehicle rental', 210],
    ]);
    expect(paul.travel.amount).toBe(612.5);
    expect(raja.travel.lines.map((l) => l.item)).toEqual(['Hotel']);
    expect(inv.totals.travel).toBe(1015);
    expect(quickBooksLines(inv).find((l) => l.description.includes('Vehicle rental'))?.item).toBe('Traveling');
    expect(invoiceCharges(inv, null).lines.map((l) => l.what)).toContain('Paul Gibbs vehicle rental');
    const gone = removeLine(priced, paul.travel.lines[1]);
    expect(buildInvoice(gone, rates, crew, meta, '').techs[0].travel.amount).toBe(402.5);
  });

  it('names the hotel on its line: the receipt\'s, else the job\'s, and lets the office type it', () => {
    const unnamed = { ...sheet, other: sheet.other.map((r) => (r.for === 'Lodging' ? { ...r, store: '' } : r)) };
    const fromJob = buildInvoice(unnamed, rates, crew, meta, 'Goldsboro NC', 'Hampton Inn Wilmington').techs[0].travel.lines[0];
    expect(fromJob.description).toBe('Hampton Inn Wilmington – Hotel charge for the week');
    expect(buildInvoice(unnamed, rates, crew, meta, 'Goldsboro NC').techs[0].travel.lines[0].description).toBe('Hotel charge for the week');
    const typed = editLine(unnamed, fromJob, { description: 'Courtyard by Marriott' });
    expect(buildInvoice(typed, rates, crew, meta, 'Goldsboro NC', 'Hampton Inn Wilmington').techs[0].travel.lines[0].description)
      .toBe('Courtyard by Marriott – Hotel charge for the week');
  });

  it('reads a Rental receipt as a vehicle rental, not a hotel', () => {
    const inv = buildInvoice({ ...sheet, other: [...sheet.other, { tech: 'Raja', day: '2026-10-19', store: 'Enterprise', amount: 150, for: 'Rental · SUV' }] },
      rates, crew, meta, '');
    expect(inv.techs[1].travel.lines.map((l) => [l.item, l.amount])).toEqual([['Hotel', 402.5], ['Vehicle', 150]]);
  });

  it('keeps a stretch still on site\'s hours when only its date changes (Greptile on PR #44)', () => {
    const open = { ...sheet, time: [{ tech: 'Paul Gibbs', day: '2026-10-19', in: '08:00', out: '', brk: 0, open: true, ms: 3 * 3_600_000 }] };
    const line = buildInvoice(open, rates, crew, meta, '').techs[0].hours.lines[0];
    expect(line.qty).toBe(3);
    const moved = editLine(open, line, { day: '2026-10-20' });
    expect(moved.time[0]).toEqual({ tech: 'Paul Gibbs', day: '2026-10-20', in: '08:00', out: '', brk: 0, hours: 3 });
    expect(buildInvoice(moved, rates, crew, meta, '').techs[0].hours.lines[0].qty).toBe(3);
  });

  it('gives each tech their own drives only, never another tech\'s (Fred: "i need each tech milage to be individually")', () => {
    const helpers: JobSheet = { time: [{ tech: 'Raja', day: '2026-10-19', in: '', out: '', brk: 0, hours: 5 }, { tech: 'Kendell', day: '2026-10-19', in: '', out: '', brk: 0, hours: 5 }],
      miles: [{ tech: 'Raja', day: '2026-10-19', start: null, end: null, miles: 40 }], meals: [], materials: [], other: [] };
    const both = buildInvoice(helpers, { ...rates, Kendell: { hour: 50, mile: 0.6 } }, crew, meta, '');
    expect(both.techs.map((t) => [t.role, t.tech, t.mileage.amount])).toEqual([['Helper', 'Raja', 24], ['Helper', 'Kendell', 0]]);
  });

  it('changes the time sheet under the line edited, added or taken off', () => {
    const [paul, raja] = inv.techs;
    // A day's hours: the break still comes off them, so the line reads what's typed.
    const withBreak = { ...sheet, time: sheet.time.map((r) => (r.tech === 'Paul Gibbs' && r.day === '2026-10-19' ? { ...r, brk: 0.5 } : r)) };
    const hours = editLine(withBreak, buildInvoice(withBreak, rates, crew, meta, '').techs[0].hours.lines[0], { qty: 8 });
    expect(hours.time.find((r) => r.tech === 'Paul Gibbs' && r.day === '2026-10-19')).toMatchObject({ hours: 8.5, brk: 0.5 });
    expect(buildInvoice(hours, rates, crew, meta, '').techs[0].hours.lines[0]).toMatchObject({ qty: 8, amount: 400 });
    // In and out times typed: the hours are theirs, less the break (Fred: "07:00am in 09:00 am out ... total hours 2").
    const inTyped = editLine(hours, buildInvoice(hours, rates, crew, meta, '').techs[0].hours.lines[0], { in: '07:00' });
    // Only the in typed: the hours stay as they were until the out is in too.
    expect(buildInvoice(inTyped, rates, crew, meta, '').techs[0].hours.lines[0]).toMatchObject({ qty: 8 });
    const timed = editLine(inTyped, buildInvoice(inTyped, rates, crew, meta, '').techs[0].hours.lines[0], { out: '09:30' });
    expect(timed.time.find((r) => r.tech === 'Paul Gibbs' && r.day === '2026-10-19')).toEqual(expect.not.objectContaining({ hours: expect.anything() }));
    expect(buildInvoice(timed, rates, crew, meta, '').techs[0].hours.lines[0]).toMatchObject({ qty: 2, amount: 100 });
    const moved = editLine(sheet, paul.hours.lines[0], { day: '2026-10-21' });
    expect(buildInvoice(moved, rates, crew, meta, '').techs[0].hours.lines.map((l) => l.date)).toEqual(['2026-10-20', '2026-10-21']);
    // A day's meals as one amount: Paul's two receipts on the 19th become $45.
    const meals = editLine(sheet, paul.meals.lines[0], { amount: 45 });
    expect(meals.meals.filter((r) => r.tech === 'Paul Gibbs')).toEqual([{ tech: 'Paul Gibbs', day: '2026-10-19', store: 'Waffle House, Subway', amount: 45 }]);
    // Raja's miles are his own: changing them changes his, never Paul's drive.
    const miles = editLine(sheet, raja.mileage.lines[0], { qty: 30 });
    expect(miles.miles.filter((r) => r.tech === 'Raja')).toEqual([{ tech: 'Raja', day: '2026-10-19', start: null, end: null, miles: 30 }]);
    expect(miles.miles.filter((r) => r.tech === 'Paul Gibbs')).toEqual(sheet.miles.filter((r) => r.tech === 'Paul Gibbs'));
    // The hotel's amount; a hotel taken off; a day added to fill in.
    expect(editLine(sheet, paul.travel.lines[0], { amount: 410 }).other.find((r) => r.store === 'Quality Inn')!.amount).toBe(410);
    expect(removeLine(sheet, paul.travel.lines[0]).other.map((r) => r.store)).toEqual(['Circle K']);
    expect(removeLine(sheet, paul.mileage.lines[2]).miles.map((r) => r.day)).toEqual(['2026-10-18']);
    // A material: its store and amount; one added; one taken off.
    const mat = editLine(sheet, paul.materials!.lines[0], { description: 'Home Depot', amount: 50 });
    expect(mat.materials).toEqual([{ tech: 'Paul Gibbs', day: '2026-10-19', store: 'Home Depot', amount: 50 }]);
    expect(addLine(sheet, 'Paul Gibbs', 'Material', '2026-10-19').materials.at(-1)).toEqual({ tech: 'Paul Gibbs', day: '2026-10-19', store: '', amount: 0 });
    expect(removeLine(sheet, paul.materials!.lines[0]).materials).toEqual([]);
    const added = addLine(sheet, 'Raja', 'Labor', '2026-10-20');
    expect(buildInvoice(added, rates, crew, meta, '').techs[1].hours.lines.map((l) => [l.date, l.qty])).toEqual([['2026-10-19', 6.32], ['2026-10-20', 0]]);
  });

  it("charges the hours and miles of a tech with no rate as nothing, with the lines left blank", () => {
    const none = buildInvoice(sheet, { 'Paul Gibbs': rates['Paul Gibbs'] }, crew, { ...meta, meal: null }, '');
    expect(none.techs[1].hours).toMatchObject({ rate: null, amount: 0 });
    expect(none.techs[1].hours.lines[0]).toMatchObject({ rate: null, amount: null });
    // No allowance: the receipts as they are.
    expect(none.techs[0].meals.lines[0]).toMatchObject({ description: 'Meal allowance with Receipts', rate: 58.97, amount: 58.97 });
    expect(none.techs[0].mileage.lines[0].description).toBe('Mileage from Home to the site');
  });

  it('keeps what the office typed, with the client\'s defaults', () => {
    expect(parseInvoiceMeta(null, '2026-10-25')).toEqual({ number: '', date: '2026-10-25', terms: 30, labor: 'Installation of Cabling for refresh project', meal: 50, billTo: '' });
    expect(parseInvoiceMeta({ number: ' 1240 ', date: '2026-10-24', terms: 15, labor: 'Cabling', meal: null, billTo: ' TeamNetView ' }, '2026-10-25'))
      .toEqual({ number: '1240', date: '2026-10-24', terms: 15, labor: 'Cabling', meal: null, billTo: 'TeamNetView' });
    expect(parseInvoiceMeta({ date: 'soon', terms: -2 }, '2026-10-25')).toMatchObject({ date: '2026-10-25', terms: 30 });
    expect(dueDate('2026-10-25', 30)).toBe('2026-11-24');
  });
});

describe("the job log's client copy", () => {
  it('has the same lines and total as the invoice (Fred, 2026-10-31: "the job log and invoice is not matching up")', () => {
    // Raja has Paul's hotel, and only the miles he entered: none (Fred, 2026-11-02: "i need each tech milage to be
    // individually"); the meals up to $50 a day; the fuel isn't charged.
    const { lines, total } = invoiceCharges(inv, null);
    expect(lines.map((l) => [l.what, l.amount, l.counted])).toEqual([
      ['Paul Gibbs hours · 12.64 × $50.00/hr', 632, false],
      ['Raja hours · 6.32 × $50.00/hr', 316, false],
      ['Hours total', 948, true],
      ['Paul Gibbs mileage · 956 mi × $0.60/mi', 573.6, false],
      ['Mileage total', 573.6, true],
      ['Meals · up to $50.00 a day (receipts $71.51)', 62.54, true],
      ['Materials', 47.48, true],
      ['Paul Gibbs hotel', 402.5, true],
      ['Raja hotel (same as Paul Gibbs)', 402.5, true],
    ]);
    expect(total).toBe(inv.totals.total);
    expect(Math.round(lines.filter((l) => l.counted).reduce((t, l) => t + l.amount, 0) * 100) / 100).toBe(total);
  });

  it('has all the hours on one line at one rate', () => {
    const { lines } = invoiceCharges(inv, 50);
    expect(lines[0]).toEqual({ what: 'All techs’ hours · 18.96 × $50.00/hr', amount: 948, bold: true, counted: true });
    expect(lines.some((l) => l.what === 'Hours total')).toBe(false);
  });
});

describe('the invoice in Excel', () => {
  const head: InvoiceHead = {
    billTo: 'TeamNetView', shipTo: ['LDS1106 Site 5006643 — Goldsboro, NC', '1000 Eleventh Street, Goldsboro, NC 27530'],
    meta: { number: '1240', date: '2026-10-25', terms: 30, billTo: 'TeamNetView', ...meta },
  };
  const rows = invoiceCells(inv, head);
  const at = (label: string, col = 3) => rows.findIndex((r) => r[col] === label) + 1;
  const cell = (row: number, col: number) => rows[row - 1][col] as Exclude<XCell, string | null>;

  it('has F.A.J at the top, who it\'s billed and shipped to, and its number, date, terms and due date', () => {
    expect(rows[0]).toEqual(['F.A.J Solutions LLC']);
    const top = rows.findIndex((r) => r[0] === 'BILL TO') + 1;
    expect(rows[top - 1]).toEqual(['BILL TO', null, 'SHIP TO', null, null, 'INVOICE', '1240']);
    expect(rows[top].slice(0, 6)).toEqual(['TeamNetView', null, 'LDS1106 Site 5006643 — Goldsboro, NC', null, null, 'DATE']);
    expect(rows[top + 1][6]).toBe('Net 30');
    // The due date is the date + the terms, in Excel too.
    expect(cell(top + 3, 6)).toMatchObject({ f: `G${top + 1}+30` });
    expect(rows[top + 4]).toEqual(['Date', 'Item', 'Description', null, 'Qty', 'Rate', 'Amount']);
  });

  it('adds up each line, each section, each tech and the invoice in formulas', () => {
    const paul = at('Total Hours');
    expect(rows[paul - 1].slice(0, 4)).toEqual(['Lead', null, 'Paul Gibbs', 'Total Hours']);
    expect(cell(paul, 4)).toMatchObject({ v: 12.64, f: `SUM(E${paul + 1}:E${paul + 2})` });
    expect(cell(paul, 6)).toMatchObject({ v: 632, f: `SUM(G${paul + 1}:G${paul + 2})` });
    expect(cell(paul + 1, 6)).toMatchObject({ v: 316, f: `IF(F${paul + 1}="","",IF(E${paul + 1}="",0,ROUND(E${paul + 1}*F${paul + 1},2)))` });
    const meals = at('Total Meal Allowance'), miles = at('Total Milage'), mats = at('Total Materials'), travel = at('Total Travel');
    // The materials between the mileage and the hotel, the lead's only.
    expect(mats).toBeGreaterThan(miles);
    expect(travel).toBeGreaterThan(mats);
    expect(rows.filter((r) => r[3] === 'Total Materials')).toHaveLength(1);
    expect(cell(mats, 6)).toMatchObject({ v: 47.48, f: `SUM(G${mats + 1}:G${mats + 1})` });
    expect(cell(meals, 6)).toMatchObject({ v: 50, f: `SUM(G${meals + 1}:G${meals + 2})` });
    expect(rows[miles]).toMatchObject([expect.anything(), 'Mileage', 'Mileage from Home to Goldsboro NC', null, { v: 478 }, { v: 0.6 }, { v: 286.8 }]);
    expect(cell(at('Lead Total'), 6)).toMatchObject({ v: 1705.58, f: `G${paul}+G${meals}+G${miles}+G${mats}+G${travel}` });
    // Raja's hours with no rate would be blank; his are $50, his total next.
    expect(cell(at('Helper Total'), 6)).toMatchObject({ v: 731.04 });
    const labor = at('Labor', 4);
    expect(rows.slice(labor - 1).map((r) => [r[4], (r[6] as { v: number }).v])).toEqual([
      ['Labor', 948], ['Mileage', 573.6], ['Meals', 62.54], ['Materials', 47.48], ['Travel', 805], ['Total Invoice', 2436.62],
    ]);
    // Labor is each tech's Total Hours.
    const hoursRows = rows.flatMap((r, i) => (r[3] === 'Total Hours' ? [i + 1] : []));
    expect(hoursRows).toHaveLength(2);
    expect(cell(labor, 6)).toMatchObject({ f: hoursRows.map((n) => `G${n}`).join('+') });
    expect(cell(labor + 3, 6)).toMatchObject({ f: `G${mats}` });
    expect(cell(labor + 5, 6)).toMatchObject({ f: `SUM(G${labor}:G${labor + 4})` });
  });
});

// Fred, 2026-11-04: "i need to pase the invoice from INvoice to quick books invoice".
describe('the invoice into QuickBooks', () => {
  const lines = quickBooksLines(inv);
  it('has each charged line, the tech named on it, on the Field Sheet’s Products/services', () => {
    expect(lines[0]).toEqual({ date: '2026-10-19', item: 'Cabling', description: 'Paul Gibbs (Lead): Installation of Cabling for refresh project', qty: 6.32, rate: 50, amount: 316 });
    expect(lines.map((l) => l.item)).toEqual(expect.arrayContaining(['Cabling', 'Traveling', 'Meals', 'Lodging', 'Field Services']));
    expect(lines.some((l) => l.description.startsWith('Raja: '))).toBe(true);
    expect(lines.every((l) => l.amount > 0)).toBe(true);
    expect(qbLinesTotal(lines)).toBe(inv.totals.total);
  });

  it('makes the import file one row a line, numbered, dated and due as on the invoice', () => {
    const rows = invoiceImportRows(lines, { number: '1042', billTo: 'TeamNetView', meta: { date: '2026-10-25', terms: 30 }, memo: 'Site · WO 1' });
    expect(rows[0][0]).toBe('InvoiceNo');
    expect(rows).toHaveLength(lines.length + 1);
    expect(rows[1]).toEqual(['1042', 'TeamNetView', '10/25/2026', '11/24/2026', 'Net 30', 'Site · WO 1', 'Cabling',
      'Paul Gibbs (Lead): Installation of Cabling for refresh project', '6.32', '50', '316.00', '10/19/2026']);
  });

  it('makes the QuickBooks invoice with its number, date and due date', () => {
    const p = jobLogQbPayload(lines, { customerId: 'c1', itemIds: { Cabling: 'i1', Traveling: 'i2', Meals: 'i3', Lodging: 'i4', 'Field Services': 'i5' }, number: '1042', date: '2026-10-25', terms: 30, memo: 'm', note: 'n' });
    expect(p).toMatchObject({ CustomerRef: { value: 'c1' }, DocNumber: '1042', TxnDate: '2026-10-25', DueDate: '2026-11-24' });
    expect(p.Line[0]).toEqual({ DetailType: 'SalesItemLineDetail', Amount: 316, Description: lines[0].description,
      SalesItemLineDetail: { ItemRef: { value: 'i1' }, Qty: 6.32, UnitPrice: 50, ServiceDate: '2026-10-19' } });
    expect(jobLogQbPayload(lines, { customerId: 'c1', itemIds: {}, date: '2026-10-25', terms: 30, memo: '', note: '' }).DocNumber).toBeUndefined();
  });

  it('keeps the QuickBooks invoice it was sent as with its boxes, and the memo names the site and the days', () => {
    const sent = { id: '77', number: '1042', total: 10, at: '2026-11-04T17:00:00Z' };
    expect(parseInvoiceMeta({ number: '1042', qbo: sent }, '2026-11-04').qbo).toEqual(sent);
    expect(parseInvoiceMeta({ number: '1042', qbo: 'x' }, '2026-11-04').qbo).toBeUndefined();
    const marked = parseInvoiceMeta({ billed: '2026-11-08T12:00:00Z', netview: '2026-11-08T12:05:00Z' }, '2026-11-08');
    expect(marked).toMatchObject({ billed: '2026-11-08T12:00:00Z', netview: '2026-11-08T12:05:00Z' });
    expect(parseInvoiceMeta({ billed: 'yes', netview: 3 }, '2026-11-08')).not.toHaveProperty('billed');
    expect(inQuickBooks(marked)).toBe(true);
    expect(inQuickBooks({ qbo: sent })).toBe(true);
    expect(inQuickBooks({})).toBe(false);
    expect(jobLogMemo({ site_name: 'LDS Site 5006643', wo_number: '191', external_wo_id: 'LDS-1' }, lines)).toBe('LDS Site 5006643 · WO 191 · Client # LDS-1 · 10/18/2026 – 10/20/2026');
  });
});
