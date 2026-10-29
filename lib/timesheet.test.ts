import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { photoGroups, timesheetFile, timesheetLines, timesheetPdf, timesheetTable, timesheetTotals, type TimesheetHead } from './timesheet';
import type { SheetRow } from './field-sheet';

const row = (day: string, tech: string, v: Partial<SheetRow['values']>, extra: Partial<SheetRow> = {}): SheetRow => ({
  key: `${day}|${tech}`, day, tech, id: null, added: false, hidden: false, missing: false, app: null, edits: {}, source: {},
  values: { left: null, arrived: null, leftSite: null, back: null, lunch: null, odoStart: null, odoEnd: null, gps: null, hours: null, travel: null, miles: null, extraMiles: null, meals: null, spend: null, note: '', ask: false, driveMiles: null, addedMiles: null, ...v },
  ...extra,
});
const head: TimesheetHead = { woNumber: '19101401', clientWo: 'LDS-5391288', site: 'LDS Site', address: '1 Main St, Dover, DE', client: 'LDS', from: '2026-10-19', to: '2026-10-21' };

// Paul Gibbs's week on WO 19101401, as the office fixed it on Hours.
const rows = [
  row('2026-10-21', 'Paul Gibbs', { arrived: '07:38', leftSite: '17:50', meals: 50, travel: 1.7, miles: 4.4 }),
  row('2026-10-19', 'Paul Gibbs', { arrived: '07:37', leftSite: '17:37', odoStart: 141865, odoEnd: 142109 }),
  row('2026-10-20', 'Kendell Newbold', { hours: 0, travel: 3.5, note: 'Travel day → home' }),
  row('2026-10-20', 'Nobody', {}, { missing: true }),
  row('2026-10-22', 'Paul Gibbs', { arrived: '08:00', leftSite: '12:00' }, { hidden: true }),
];

describe('timesheet', () => {
  it('has a line per tech per day worked, each tech’s days together, oldest first, with the hours as billed', () => {
    const lines = timesheetLines(rows);
    expect(lines.map((l) => `${l.day} ${l.tech}`)).toEqual(['2026-10-20 Kendell Newbold', '2026-10-19 Paul Gibbs', '2026-10-21 Paul Gibbs']);
    expect(lines[1]).toMatchObject({ started: '7:37 AM', finished: '5:37 PM', hours: 10, odoStart: 141865, odoEnd: 142109, miles: 244 });
    expect(lines[0]).toMatchObject({ hours: 0, travel: 3.5, total: 3.5, note: 'Travel day → home' });
    expect(timesheetTotals(lines)).toEqual({ days: 3, hours: 20.2, travel: 5.2, total: 25.4, miles: 248.4, meals: 50 });
  });

  it('adds the extra miles the office typed to the odometer miles, on the line and in the total (Fred, 2026-10-27)', () => {
    const lines = timesheetLines([
      row('2026-10-19', 'Paul Gibbs', { arrived: '07:37', leftSite: '17:37', odoStart: 141865, odoEnd: 142109, extraMiles: 56 }),
      row('2026-10-21', 'Paul Gibbs', { arrived: '07:38', leftSite: '17:50', miles: 4.4, extraMiles: 10 }),
    ]);
    expect(lines.map((l) => l.miles)).toEqual([300, 14.4]);
    expect(timesheetTotals(lines).miles).toBe(314.4);
  });

  it('makes the spreadsheet: header, the lines, the total', () => {
    const t = timesheetTable(head, timesheetLines(rows));
    expect(t[0]).toEqual(['FAJ Solutions · Timesheet']);
    expect(t[1]).toEqual(['Work order 19101401 · Client # LDS-5391288']);
    expect(t.at(-1)).toEqual(['All techs', '3 days', '', '', '', 20.2, 5.2, 25.4, '', 248.4, '$50.00', '']);
    expect(timesheetFile(head, 'pdf')).toBe('Timesheet WO 19101401 2026-10-19 to 2026-10-21.pdf');
  });

  // Fred, 2026-10-29: "each tech get their own break down ... once finish with tech one hours then same for tech 2".
  it('goes tech by tech, each tech’s days with the odometer, then their total', () => {
    const t = timesheetTable(head, timesheetLines(rows));
    const body = t.slice(t.findIndex((r) => r[0] === 'Date') + 1);
    expect(body.map((r) => [r[0], r[1]])).toEqual([
      ['Tue, Oct 20, 2026', 'Kendell Newbold'], ['Kendell Newbold total', '1 day'],
      ['Mon, Oct 19, 2026', 'Paul Gibbs'], ['Wed, Oct 21, 2026', 'Paul Gibbs'], ['Paul Gibbs total', '2 days'],
      ['All techs', '3 days'],
    ]);
    expect(body[2][8]).toBe('141,865 – 142,109');
    expect(body[4].slice(5, 10)).toEqual([20.2, 1.7, 21.9, '', 248.4]);
  });

  it('makes a PDF that opens, with a page of pictures after the hours', async () => {
    // A 1×1 JPEG.
    const jpeg = Uint8Array.from(atob('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q=='), (c) => c.charCodeAt(0));
    const photos = [
      { day: '2026-10-19', tech: 'Paul Gibbs', caption: 'Odometer start of drive: 141,865 · 7:37 AM', jpeg },
      { day: '2026-10-19', tech: 'Paul Gibbs', caption: 'Site photo · 2:14 PM', jpeg },
    ];
    expect(photoGroups(photos).map((g) => [g.title, g.list.length])).toEqual([['Mon, Oct 19, 2026 · Paul Gibbs', 2]]);
    const pdf = await PDFDocument.load(await timesheetPdf(head, timesheetLines(rows), photos));
    expect(pdf.getPageCount()).toBe(2);
    expect(pdf.getTitle()).toBe('Timesheet WO 19101401');
  });

  it('makes a PDF with no hours too', async () => {
    const pdf = await PDFDocument.load(await timesheetPdf(head, []));
    expect(pdf.getPageCount()).toBe(1);
  });
});
