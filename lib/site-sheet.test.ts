import { describe, it, expect } from 'vitest';
import { sheetValue, sheetRow, sheetHeader, laborOf, localStamp } from './site-sheet';
import { toTSV, tsvCell } from './csv';
import { visitAmount } from './visits';
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

describe('labor + mileage + materials + other = total, everywhere', () => {
  // The card, the totals band, the spreadsheet and the invoice all have to
  // agree. They agree because they all derive labour from laborOf() and add
  // the same three charges — this is the test that keeps that true.
  const make = (over: Partial<SiteVisit>) => ({ ...visit, ...over } as SiteVisit);

  const rows = [
    make({ hours: 2,     rate: '$55/hr',  travel_charge: 58.7,  materials_cost: null,  other_charges: null }),
    make({ hours: 6.73,  rate: '$55/hr',  travel_charge: 69.95, materials_cost: 120,   other_charges: 15 }),
    make({ hours: 0.75,  rate: '$55/hr',  travel_charge: 56.65, materials_cost: 33.33, other_charges: 11.11 }),
    make({ hours: 19.83, rate: '$55/hr',  travel_charge: 47.6,  materials_cost: null,  other_charges: null }),
    make({ hours: 3,     rate: '$100/hr', travel_charge: 93.75, materials_cost: 7.77,  other_charges: null }),
    make({ hours: null,  rate: '$2600 flat', travel_charge: 90.3, materials_cost: null, other_charges: null }),
    make({ hours: 10.75, rate: '$55/hr',  travel_charge: 66.4,  materials_cost: null,  other_charges: null,
           total_project_price: 1500 }),
  ];

  it('holds for every visit on its own — the card', () => {
    for (const v of rows) {
      const parts = laborOf(v)
        + Number(v.travel_charge ?? 0)
        + Number(v.materials_cost ?? 0)
        + Number(v.other_charges ?? 0);
      expect(Math.round(parts * 100) / 100).toBe(visitAmount(v));
    }
  });

  it('holds across the whole list — the totals band', () => {
    const sum = (f: (v: SiteVisit) => number) =>
      Math.round(rows.reduce((s, v) => s + (f(v) || 0), 0) * 100) / 100;

    const labor     = sum((v) => laborOf(v));
    const travel    = sum((v) => Number(v.travel_charge ?? 0));
    const materials = sum((v) => Number(v.materials_cost ?? 0));
    const other     = sum((v) => Number(v.other_charges ?? 0));
    const band      = Math.round((labor + travel + materials + other) * 100) / 100;

    const cards = Math.round(rows.reduce((s, v) => s + visitAmount(v), 0) * 100) / 100;
    expect(band).toBe(cards);
  });

  it('the spreadsheet row carries the same two figures', () => {
    for (const v of rows) {
      const row = sheetRow(v, ['visit_date'] as (keyof SiteVisit)[]);
      expect(row[1]).toBe(laborOf(v));      // Labor Total
      expect(row[2]).toBe(visitAmount(v));  // Line Total
    }
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
