// Site Log → FAJ_Solutions_Invoice_Tracker_2026_master_auto.xlsx
//
// Fred keeps the year in an Excel tracker and works its "Master Entry" sheet.
// This builds rows in that sheet's exact 20-column layout so a paste lands in
// the right columns and nothing has to be nudged afterwards.
//
// ── Why this file is fussy ────────────────────────────────────────────────────
// Master Entry has four CALCULATED columns sitting in the middle of the
// twenty: I, K, L and P. A twenty-wide paste writes over all four and kills
// the formulas on those rows. That has already happened to his file — 62 rows
// carry text like "Open" in Line Total and no longer calculate.
//
// So the calculated columns are rebuilt as the very same formulas, aimed at
// the row being pasted into. Paste at row 1505 and row 1505 ends up identical
// to every other row in the sheet, formulas included.
import type { SiteVisit } from './types';
import { raw, type RawCell } from './csv';
import { billableHours } from './visits';

/** Master Entry, row 4 of the sheet — the exact header text, in order. */
export const MASTER_ENTRY_HEADER = [
  'Date',                  // A
  'Customer/Brand',        // B
  'Site/Location',         // C
  'Site Address',          // D
  'Scope of Work',         // E
  'Work Type',             // F
  'Hours',                 // G
  'Labor Rate',            // H
  'Labor Total',           // I  ƒ
  'Mileage/Distance',      // J
  'Mileage Rate',          // K  ƒ
  'Mileage Total',         // L  ƒ
  'Materials Description', // M
  'Materials Cost',        // N
  'Other Charges',         // O
  'Line Total',            // P  ƒ
  'Invoice Status',        // Q
  'Payment Status',        // R
  'Notes',                 // S
  'Additional Details',    // T
] as const;

/** The four calculated columns, 0-based, for callers that need to skip them. */
export const CALCULATED_COLUMNS = [8, 10, 11, 15] as const; // I, K, L, P

/**
 * His formulas, verbatim from the workbook, aimed at one row.
 *
 * Read out of the file rather than invented, so a pasted row behaves exactly
 * like the rows above it. $K$2 is the tracker's global mileage rate cell.
 */
export function calculatedFormulas(row: number): Record<'I' | 'K' | 'L' | 'P', RawCell> {
  return {
    I: raw(`=IF(OR(G${row}="",H${row}=""),"",G${row}*H${row})`),
    K: raw(`=IF(J${row}="","",$K$2)`),
    L: raw(`=IF(OR(J${row}="",K${row}=""),"",J${row}*K${row})`),
    P: raw(`=SUM(I${row},L${row},N${row},O${row})`),
  };
}

/** His Work Type vocabulary. Anything else passes through untouched. */
const WORK_TYPE: Record<string, string> = {
  Project: 'Project',
  'T&M': 'T&M',
  Revisit: 'Revisit',
};

const INVOICE_STATUS: Record<string, string> = {
  not_invoiced: 'Not Invoiced',
  invoiced: 'Invoiced',
  na: 'N/A',
};

const PAYMENT_STATUS: Record<string, string> = {
  unpaid: 'Unpaid',
  paid: 'Paid',
  na: 'N/A',
};

/** The hourly number out of a free-text rate: "$55/hr" → 55. Flat rates → ''. */
export function hourlyRate(rate: string | null | undefined): number | '' {
  const m = (rate ?? '').trim().match(/\$?\s*(\d+(?:\.\d+)?)\s*\/\s*h/i);
  return m ? Number(m[1]) : '';
}

export interface TrackerRowOptions {
  /** Sheet row this will be pasted into — decides what the formulas point at. */
  row: number;
  /**
   * false writes the calculated numbers instead of the formulas. Simpler, but
   * the row stops recalculating if hours or the mileage rate ever change.
   */
  keepFormulas?: boolean;
}

/**
 * One visit as a Master Entry row.
 *
 * Two deliberate choices worth knowing about:
 *
 * Hours is the BILLABLE figure, so a 45-minute visit goes across as 2. That
 * keeps Labor Total in Excel equal to Total Pay in the app; sending the raw
 * 0.75 would make the two disagree the moment they are compared.
 *
 * The travel charge goes to Mileage Total (L) and nowhere else. Other Charges
 * (O) carries its own field — writing the travel charge into both would double
 * it inside Line Total, which sums I, L, N and O.
 */
export function trackerRow(v: SiteVisit, opts: TrackerRowOptions): (string | number | RawCell)[] {
  const { row, keepFormulas = true } = opts;
  const f = calculatedFormulas(row);

  const hours = billableHours(v.hours) ?? '';
  const rate  = hourlyRate(v.rate);
  const miles = v.miles == null ? '' : Number(v.miles);

  const labor        = hours !== '' && rate !== '' ? Math.round(Number(hours) * rate * 100) / 100 : '';
  const mileageTotal = v.travel_charge == null ? '' : Number(v.travel_charge);
  // The per-mile rate lives in settings, not on the visit, and the tracker's
  // own $K$2 is the authority anyway. Only derive it when the division is
  // exact and meaningful.
  const mileageRate  = miles !== '' && Number(miles) > 0 && mileageTotal !== ''
    ? Math.round((Number(mileageTotal) / Number(miles)) * 10000) / 10000
    : '';
  const materials = v.materials_cost == null ? '' : Number(v.materials_cost);
  const other     = v.other_charges  == null ? '' : Number(v.other_charges);

  // Same shape as his =SUM(I,L,N,O).
  const lineTotal = (Number(labor) || 0) + (Number(mileageTotal) || 0)
                  + (Number(materials) || 0) + (Number(other) || 0);

  return [
    v.visit_date ?? '',                                   // A Date
    v.program ?? '',                                      // B Customer/Brand
    v.site_code ?? v.site_name ?? '',                     // C Site/Location
    v.address ?? '',                                      // D Site Address
    v.client_summary ?? v.notes ?? '',                    // E Scope of Work
    WORK_TYPE[v.visit_type ?? ''] ?? v.visit_type ?? '',  // F Work Type
    hours,                                                // G Hours (billable)
    rate,                                                 // H Labor Rate
    keepFormulas ? f.I : labor,                           // I Labor Total      ƒ
    miles,                                                // J Mileage/Distance
    keepFormulas ? f.K : mileageRate,                     // K Mileage Rate     ƒ
    keepFormulas ? f.L : mileageTotal,                    // L Mileage Total    ƒ
    v.materials_description ?? '',                        // M Materials Description
    materials,                                            // N Materials Cost
    other,                                                // O Other Charges — see note above
    keepFormulas ? f.P : Math.round(lineTotal * 100) / 100, // P Line Total     ƒ
    INVOICE_STATUS[v.invoice_status ?? ''] ?? '',         // Q Invoice Status
    PAYMENT_STATUS[v.payment_status ?? ''] ?? '',         // R Payment Status
    v.notes ?? '',                                        // S Notes
    v.additional_details ?? '',                           // T Additional Details
  ];
}

/** A block of visits, each row aimed at its own destination row. */
export function trackerRows(
  visits: SiteVisit[],
  opts: TrackerRowOptions,
): (string | number | RawCell)[][] {
  return visits.map((v, i) => trackerRow(v, { ...opts, row: opts.row + i }));
}
