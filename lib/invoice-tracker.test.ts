import { describe, it, expect } from 'vitest';
import {
  MASTER_ENTRY_HEADER,
  CALCULATED_COLUMNS,
  calculatedFormulas,
  hourlyRate,
  trackerRow,
  trackerRows,
} from './invoice-tracker';
import { toTSV, isRawCell, tsvCell, raw } from './csv';
import type { SiteVisit } from './types';

const visit = {
  id: 'v1',
  visit_date: '2026-06-20',
  program: "Wendy's",
  site_code: '5798',
  site_name: 'Roselle',
  address: '401 State Rt 440 Jersey City, NJ 07305',
  hours: 3,
  rate: '$55/hr',
  visit_type: 'T&M',
  invoice_status: 'not_invoiced',
  payment_status: 'unpaid',
  miles: 50,
  travel_charge: 27.5,
  notes: 'Swapped the switch',
  total_project_price: null,
} as unknown as SiteVisit;

describe('Master Entry layout', () => {
  it('is exactly the twenty columns of the tracker, in order', () => {
    expect(MASTER_ENTRY_HEADER).toHaveLength(20);
    expect(MASTER_ENTRY_HEADER[0]).toBe('Date');
    expect(MASTER_ENTRY_HEADER[8]).toBe('Labor Total');
    expect(MASTER_ENTRY_HEADER[15]).toBe('Line Total');
    expect(MASTER_ENTRY_HEADER[19]).toBe('Additional Details');
  });

  it('emits a row of exactly twenty cells, so nothing shifts', () => {
    expect(trackerRow(visit, { row: 1505 })).toHaveLength(20);
  });

  it('names the calculated columns as I, K, L and P', () => {
    expect(CALCULATED_COLUMNS).toEqual([8, 10, 11, 15]);
    expect(CALCULATED_COLUMNS.map((i) => MASTER_ENTRY_HEADER[i])).toEqual([
      'Labor Total', 'Mileage Rate', 'Mileage Total', 'Line Total',
    ]);
  });
});

describe('calculated columns', () => {
  // Verbatim from FAJ_Solutions_Invoice_Tracker_2026_master_auto.xlsx, row 100.
  it('reproduces his formulas character for character', () => {
    const f = calculatedFormulas(100);
    expect(f.I.raw).toBe('=IF(OR(G100="",H100=""),"",G100*H100)');
    expect(f.K.raw).toBe('=IF(J100="","",$K$2)');
    expect(f.L.raw).toBe('=IF(OR(J100="",K100=""),"",J100*K100)');
    expect(f.P.raw).toBe('=SUM(I100,L100,N100,O100)');
  });

  it('aims each row of a block at its own destination row', () => {
    const rows = trackerRows([visit, visit, visit], { row: 1505 });
    expect((rows[0][8] as { raw: string }).raw).toContain('G1505');
    expect((rows[1][8] as { raw: string }).raw).toContain('G1506');
    expect((rows[2][15] as { raw: string }).raw).toBe('=SUM(I1507,L1507,N1507,O1507)');
  });

  it('survives the formula-injection guard, because they are meant literally', () => {
    const row = trackerRow(visit, { row: 1505 });
    expect(isRawCell(row[8])).toBe(true);
    expect(tsvCell(row[8])).toBe('=IF(OR(G1505="",H1505=""),"",G1505*H1505)');
    // ...while ordinary data is still guarded.
    expect(tsvCell('=cmd|calc')).toBe("'=cmd|calc");
  });

  it('writes numbers instead when the user turns formulas off', () => {
    const row = trackerRow(visit, { row: 1505, keepFormulas: false });
    expect(isRawCell(row[8])).toBe(false);
    expect(row[8]).toBe(165);       // 3h × $55
    expect(row[10]).toBe(0.55);     // 27.50 / 50 miles
    expect(row[11]).toBe(27.5);
    expect(row[15]).toBe(192.5);    // labor + mileage
  });
});

describe('values mapped into his columns', () => {
  it('uses his own vocabulary, not the database slugs', () => {
    const row = trackerRow(visit, { row: 1505 });
    expect(row[5]).toBe('T&M');
    expect(row[16]).toBe('Not Invoiced');
    expect(row[17]).toBe('Unpaid');
  });

  it('sends the billable hours, so Excel agrees with the app', () => {
    // 45 minutes on site bills at the two-hour minimum in both places.
    const short = { ...visit, hours: 0.75 } as SiteVisit;
    expect(trackerRow(short, { row: 1505 })[6]).toBe(2);
    expect(trackerRow(short, { row: 1505, keepFormulas: false })[8]).toBe(110);
  });

  it('parses the hourly rate out of the free-text rate field', () => {
    expect(hourlyRate('$55/hr')).toBe(55);
    expect(hourlyRate('100 / h')).toBe(100);
    expect(hourlyRate('$250 flat rate')).toBe('');
    expect(hourlyRate(null)).toBe('');
  });

  it('carries materials and other charges through to M, N and O', () => {
    const withExtras = {
      ...visit,
      materials_description: '2x 4U rack shelf',
      materials_cost: 120,
      other_charges: 15,
    } as SiteVisit;
    const row = trackerRow(withExtras, { row: 1505 });
    expect(row[12]).toBe('2x 4U rack shelf');
    expect(row[13]).toBe(120);
    expect(row[14]).toBe(15);
  });

  it('keeps the travel charge in Mileage Total only, never also in Other', () => {
    // Line Total sums I, L, N and O — writing travel into both L and O would
    // bill the mileage twice.
    const row = trackerRow(visit, { row: 1505 });
    expect(row[14]).toBe('');           // O — nothing set on this visit
    expect(trackerRow(visit, { row: 1505, keepFormulas: false })[11]).toBe(27.5); // L
  });

  it('sends Scope of Work from the client summary, falling back to notes', () => {
    expect(trackerRow(visit, { row: 1505 })[4]).toBe('Swapped the switch');
    const summarised = { ...visit, client_summary: 'Data line replacement' } as SiteVisit;
    expect(trackerRow(summarised, { row: 1505 })[4]).toBe('Data line replacement');
  });

  it('sends notes and additional details to S and T', () => {
    const row = trackerRow({ ...visit, additional_details: 'Gate code 4417' } as SiteVisit, { row: 1505 });
    expect(row[18]).toBe('Swapped the switch');
    expect(row[19]).toBe('Gate code 4417');
  });

  it('totals the four parts the way his Line Total does', () => {
    const withExtras = { ...visit, materials_cost: 120, other_charges: 15 } as SiteVisit;
    const row = trackerRow(withExtras, { row: 1505, keepFormulas: false });
    expect(row[15]).toBe(327.5); // 165 labor + 27.50 mileage + 120 + 15
  });

  it('handles a visit with nothing logged without shifting columns', () => {
    const empty = {
      id: 'v2', visit_date: null, program: null, site_code: null, site_name: null,
      address: null, hours: null, rate: null, visit_type: 'Revisit',
      invoice_status: 'na', payment_status: 'na', miles: null, travel_charge: null,
      notes: null, total_project_price: null,
    } as unknown as SiteVisit;
    const row = trackerRow(empty, { row: 7 });
    expect(row).toHaveLength(20);
    expect(row[6]).toBe('');
    expect(row[16]).toBe('N/A');
  });
});

describe('the clipboard payload', () => {
  it('is twenty tab-separated cells per row', () => {
    const tsv = toTSV(trackerRows([visit], { row: 1505 }));
    expect(tsv.split('\t')).toHaveLength(20);
    expect(tsv).not.toContain('\n');
  });

  it('keeps a note containing a newline on one row', () => {
    const messy = { ...visit, notes: 'line one\nline two' } as SiteVisit;
    const tsv = toTSV(trackerRows([messy], { row: 1505 }));
    expect(tsv.split('\r\n')).toHaveLength(1);
    expect(tsv.split('\t')).toHaveLength(20);
  });

  it('carries one row per visit', () => {
    const tsv = toTSV(trackerRows([visit, visit], { row: 1505 }));
    expect(tsv.split('\r\n')).toHaveLength(2);
  });

  it('does not smuggle a raw() wrapper into ordinary text', () => {
    expect(tsvCell(raw('=A1'))).toBe('=A1');
    expect(tsvCell('=A1')).toBe("'=A1");
  });
});
