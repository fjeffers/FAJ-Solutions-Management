import { describe, it, expect } from 'vitest';
import { sheetValue, sheetRow, sheetHeader, laborOf, localStamp } from './site-sheet';
import { toTSV, tsvCell } from './csv';
import type { SiteVisit } from './types';

const visit = {
  id: 'v1',
  visit_date: '2026-06-20',
  site_code: '5798',
  site_name: 'Roselle',
  address: '123 Main St',
  time_in: null,
  time_out: null,
  hours: 3,
  rate: '$55/hr',
  visit_type: 'T&M',
  invoice_status: 'not_invoiced',
  payment_status: 'unpaid',
  miles: 42.5,
  travel_charge: 29.75,
  notes: 'Swapped the switch',
  total_project_price: null,
} as unknown as SiteVisit;

describe('sheetValue', () => {
  it('keeps money, hours and miles as numbers so Excel can sum them', () => {
    expect(sheetValue(visit, 'hours')).toBe(3);
    expect(sheetValue(visit, 'miles')).toBe(42.5);
    expect(sheetValue(visit, 'travel_charge')).toBe(29.75);
    // Not "$29.75" — a formatted string pastes as text and will not add up.
    expect(typeof sheetValue(visit, 'travel_charge')).toBe('number');
  });

  it('writes the words a person sees, not the database slug', () => {
    expect(sheetValue(visit, 'invoice_status')).toBe('Not Invoiced');
    expect(sheetValue(visit, 'payment_status')).toBe('Unpaid');
  });

  it('turns blanks into empty cells rather than the text "null"', () => {
    expect(sheetValue({ ...visit, notes: null } as SiteVisit, 'notes')).toBe('');
    expect(sheetValue({ ...visit, miles: null } as SiteVisit, 'miles')).toBe('');
    expect(sheetValue(visit, 'time_in')).toBe('');
  });
});

describe('localStamp', () => {
  it('formats an instant as a readable local timestamp', () => {
    expect(localStamp('2026-06-20T14:30:00.000Z')).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it('survives a null or unparseable value', () => {
    expect(localStamp(null)).toBe('');
    expect(localStamp('not a date')).toBe('');
  });
});

describe('sheetRow', () => {
  const keys = ['visit_date', 'site_name', 'hours', 'rate'] as (keyof SiteVisit)[];

  it('follows the column order it is given and appends the computed totals', () => {
    const row = sheetRow(visit, keys);
    expect(row.slice(0, 4)).toEqual(['2026-06-20', 'Roselle', 3, '$55/hr']);
    // 3h × $55 labor, then labor + travel.
    expect(row[4]).toBe(165);
    expect(row[5]).toBe(194.75);
  });

  it('reflects the two-hour minimum, same as the grid and the invoice', () => {
    const short = { ...visit, hours: 0.75 } as SiteVisit;
    expect(laborOf(short)).toBe(110);
    expect(sheetRow(short, keys)[4]).toBe(110);
  });

  it('headers line up with the row width', () => {
    expect(sheetHeader(['Date', 'Site Name', 'Total Time', 'Rate'])).toHaveLength(
      sheetRow(visit, keys).length,
    );
  });
});

describe('clipboard TSV', () => {
  it('separates columns with tabs and rows with CRLF', () => {
    expect(toTSV([['a', 'b'], ['c', 'd']])).toBe('a\tb\r\nc\td');
  });

  it('neutralises a value Excel would run as a formula', () => {
    expect(tsvCell('=HYPERLINK("http://evil")')).toBe("'=HYPERLINK(\"http://evil\")");
    expect(tsvCell('-2 drops')).toBe("'-2 drops");
    expect(tsvCell('+1 more')).toBe("'+1 more");
    expect(tsvCell('@here')).toBe("'@here");
  });

  it('leaves ordinary values alone, quotes included', () => {
    expect(tsvCell('Roselle')).toBe('Roselle');
    expect(tsvCell('6" conduit')).toBe('6" conduit');
    expect(tsvCell(165)).toBe('165');
  });

  it('flattens tabs and newlines so a note cannot shift the columns', () => {
    expect(tsvCell('line one\nline two')).toBe('line one line two');
    expect(tsvCell('a\tb')).toBe('a b');
  });

  it('writes an empty cell for null and undefined', () => {
    expect(tsvCell(null)).toBe('');
    expect(tsvCell(undefined)).toBe('');
  });

  it('round-trips a real row into something Excel splits correctly', () => {
    const keys = ['visit_date', 'site_name', 'notes'] as (keyof SiteVisit)[];
    const tsv = toTSV([sheetRow(visit, keys)]);
    expect(tsv.split('\t')).toHaveLength(5); // 3 columns + Total Pay + Total
  });
});
