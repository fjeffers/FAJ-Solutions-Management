// The job log's invoice in the client's own layout (Fred, 2026-10-30: "this how the client want the layout to look",
// "mirror it exactly").
import { describe, it, expect } from 'vitest';
import { addLine, buildInvoice, dueDate, editLine, invoiceCells, parseInvoiceMeta, removeLine, type InvoiceHead, type InvoiceLine } from './job-log-invoice';
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
      { date: '2026-10-20', item: 'Hotel', description: 'Hotel charge for the week', qty: 1, rate: 402.5, amount: 402.5 },
    ] });
    expect(paul.total).toBe(1658.1);
    // Raja has the lead's drives there and home and his hotel, as the client's helper has (Fred: "everything the lead
    // has the helpers has also"); his own hours and meals.
    const raja = inv.techs[1];
    expect(read(raja.mileage.lines).map((l) => [l.date, l.description, l.qty, l.amount])).toEqual([
      ['2026-10-18', 'Mileage from Home to Goldsboro NC', 478, 286.8], ['2026-10-19', '', null, 0], ['2026-10-20', 'Mileage from Goldsboro NC to Home', 478, 286.8],
    ]);
    expect(raja).toMatchObject({ meals: { amount: 12.54 }, mileage: { amount: 573.6 }, travel: { amount: 402.5 }, total: 1304.64 });
    expect(inv.totals).toEqual({ labor: 948, mileage: 1147.2, meals: 62.54, travel: 805, total: 2962.74 });
  });

  it('keeps a helper\'s own drives and hotel when they have them', () => {
    const own = buildInvoice({ ...sheet, miles: [...sheet.miles, { tech: 'Raja', day: '2026-10-19', start: null, end: null, miles: 30 }],
      other: [...sheet.other, { tech: 'Raja', day: '2026-10-19', store: 'Motel 6', amount: 99, for: 'Hotel' }] }, rates, crew, meta, 'Goldsboro NC');
    expect(own.techs[1]).toMatchObject({ mileage: { amount: 18 }, travel: { amount: 99 } });
  });

  it('changes the time sheet under the line edited, added or taken off', () => {
    const [paul, raja] = inv.techs;
    // A day's hours: the break still comes off them, so the line reads what's typed.
    const withBreak = { ...sheet, time: sheet.time.map((r) => (r.tech === 'Paul Gibbs' && r.day === '2026-10-19' ? { ...r, brk: 0.5 } : r)) };
    const hours = editLine(withBreak, buildInvoice(withBreak, rates, crew, meta, '').techs[0].hours.lines[0], { qty: 8 });
    expect(hours.time.find((r) => r.tech === 'Paul Gibbs' && r.day === '2026-10-19')).toMatchObject({ hours: 8.5, brk: 0.5 });
    expect(buildInvoice(hours, rates, crew, meta, '').techs[0].hours.lines[0]).toMatchObject({ qty: 8, amount: 400 });
    const moved = editLine(sheet, paul.hours.lines[0], { day: '2026-10-21' });
    expect(buildInvoice(moved, rates, crew, meta, '').techs[0].hours.lines.map((l) => l.date)).toEqual(['2026-10-20', '2026-10-21']);
    // A day's meals as one amount: Paul's two receipts on the 19th become $45.
    const meals = editLine(sheet, paul.meals.lines[0], { amount: 45 });
    expect(meals.meals.filter((r) => r.tech === 'Paul Gibbs')).toEqual([{ tech: 'Paul Gibbs', day: '2026-10-19', store: 'Waffle House, Subway', amount: 45 }]);
    // Raja's miles are the lead's: changing them changes Paul's drive.
    const miles = editLine(sheet, raja.mileage.lines[0], { qty: 500 });
    expect(miles.miles.find((r) => r.day === '2026-10-18')).toMatchObject({ tech: 'Paul Gibbs', miles: 500 });
    // The hotel's amount; a hotel taken off; a day added to fill in.
    expect(editLine(sheet, paul.travel.lines[0], { amount: 410 }).other.find((r) => r.store === 'Quality Inn')!.amount).toBe(410);
    expect(removeLine(sheet, paul.travel.lines[0]).other.map((r) => r.store)).toEqual(['Circle K']);
    expect(removeLine(sheet, paul.mileage.lines[2]).miles.map((r) => r.day)).toEqual(['2026-10-18']);
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
    expect(parseInvoiceMeta(null, '2026-10-25')).toEqual({ number: '', date: '2026-10-25', terms: 30, labor: 'Installation of Cabling for refresh project', meal: 50 });
    expect(parseInvoiceMeta({ number: ' 1240 ', date: '2026-10-24', terms: 15, labor: 'Cabling', meal: null }, '2026-10-25'))
      .toEqual({ number: '1240', date: '2026-10-24', terms: 15, labor: 'Cabling', meal: null });
    expect(parseInvoiceMeta({ date: 'soon', terms: -2 }, '2026-10-25')).toMatchObject({ date: '2026-10-25', terms: 30 });
    expect(dueDate('2026-10-25', 30)).toBe('2026-11-24');
  });
});

describe('the invoice in Excel', () => {
  const head: InvoiceHead = {
    billTo: 'TeamNetView', shipTo: ['LDS1106 Site 5006643 — Goldsboro, NC', '1000 Eleventh Street, Goldsboro, NC 27530'],
    meta: { number: '1240', date: '2026-10-25', terms: 30, ...meta },
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
    const meals = at('Total Meal Allowance'), miles = at('Total Milage'), travel = at('Total Travel');
    expect(cell(meals, 6)).toMatchObject({ v: 50, f: `SUM(G${meals + 1}:G${meals + 2})` });
    expect(rows[miles]).toMatchObject([expect.anything(), 'Mileage', 'Mileage from Home to Goldsboro NC', null, { v: 478 }, { v: 0.6 }, { v: 286.8 }]);
    expect(cell(at('Lead Total'), 6)).toMatchObject({ v: 1658.1, f: `G${paul}+G${meals}+G${miles}+G${travel}` });
    // Raja's hours with no rate would be blank; his are $50, his total next.
    expect(cell(at('Helper Total'), 6)).toMatchObject({ v: 1304.64 });
    const labor = at('Labor', 4);
    expect(rows.slice(labor - 1).map((r) => [r[4], (r[6] as { v: number }).v])).toEqual([
      ['Labor', 948], ['Mileage', 1147.2], ['Meals', 62.54], ['Travel', 805], ['Total Invoice', 2962.74],
    ]);
    // Labor is each tech's Total Hours.
    const hoursRows = rows.flatMap((r, i) => (r[3] === 'Total Hours' ? [i + 1] : []));
    expect(hoursRows).toHaveLength(2);
    expect(cell(labor, 6)).toMatchObject({ f: hoursRows.map((n) => `G${n}`).join('+') });
    expect(cell(labor + 4, 6)).toMatchObject({ f: `SUM(G${labor}:G${labor + 3})` });
  });
});
