// Grouping, sorting and colour for the Site Sheet's board view.
//
// The grid was a flat list of every visit, which is the right shape for
// pasting into Excel and the wrong one for reading. Working a month of Wendy's
// sites, the question is never "show me all 51 rows" — it is "what does August
// come to", "what is still not invoiced", "how much is Somerset worth". Those
// are groups with a total on each.
//
// Everything here is pure and takes rows in, so the grid stays a renderer and
// the money keeps coming from visitAmount/laborOf rather than being recomputed.
import type { SiteVisit } from './types';
import { visitAmount, readPricing } from './visits';
import { laborOf } from './site-sheet';

export type GroupBy = 'none' | 'program' | 'month' | 'visit_type' | 'invoice_status' | 'site';

export const GROUP_BY_LABEL: Record<GroupBy, string> = {
  none:           'No grouping',
  program:        'Customer',
  month:          'Month',
  visit_type:     'Work type',
  invoice_status: 'Invoice status',
  site:           'Site',
};

/** Running totals shown on a group header and on the footer. */
export type BoardTotals = {
  count: number;
  hours: number;
  miles: number;
  labor: number;
  total: number;
};

export type BoardGroup = {
  /** Stable identity for React keys and for remembering what is collapsed. */
  key: string;
  label: string;
  rows: SiteVisit[];
  totals: BoardTotals;
};

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "2026-08-21" → "August 2026". Undated rows group together at the end. */
function monthLabel(date: string | null | undefined): string {
  if (!date) return 'No date';
  const m = /^(\d{4})-(\d{2})/.exec(date);
  if (!m) return 'No date';
  const monthIndex = Number(m[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) return 'No date';
  return `${MONTHS[monthIndex]} ${m[1]}`;
}

/** The sort key behind a month label, so August 2026 follows July 2026. */
function monthKey(date: string | null | undefined): string {
  if (!date) return '9999-99';
  const m = /^(\d{4})-(\d{2})/.exec(date);
  return m ? `${m[1]}-${m[2]}` : '9999-99';
}

const INVOICE_STATUS_LABEL: Record<string, string> = {
  not_invoiced: 'Not invoiced',
  invoiced:     'Invoiced',
  na:           'No charge',
};

/** What a row is filed under, and how that bucket sorts against its siblings. */
function bucketOf(v: SiteVisit, by: GroupBy): { key: string; label: string; sort: string } {
  switch (by) {
    case 'program': {
      const label = v.program?.trim() || 'No customer';
      return { key: `program:${label}`, label, sort: label.toLowerCase() };
    }
    case 'month':
      return { key: `month:${monthKey(v.visit_date)}`, label: monthLabel(v.visit_date), sort: monthKey(v.visit_date) };
    case 'visit_type': {
      const label = v.visit_type?.trim() || 'No work type';
      return { key: `type:${label}`, label, sort: label.toLowerCase() };
    }
    case 'invoice_status': {
      const raw = v.invoice_status?.trim() || 'not_invoiced';
      const label = INVOICE_STATUS_LABEL[raw] ?? raw;
      // Not invoiced first — it is the only bucket with anything to do in it.
      const order = raw === 'not_invoiced' ? '0' : raw === 'invoiced' ? '1' : '2';
      return { key: `inv:${raw}`, label, sort: order };
    }
    case 'site': {
      const label = [v.site_code, v.site_name].filter(Boolean).join(' · ') || 'No site';
      return { key: `site:${label}`, label, sort: label.toLowerCase() };
    }
    default:
      return { key: 'all', label: 'All visits', sort: '' };
  }
}

export function totalsOf(rows: SiteVisit[]): BoardTotals {
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    count: rows.length,
    hours: round(rows.reduce((s, v) => s + Number(v.hours ?? 0), 0)),
    miles: round(rows.reduce((s, v) => s + Number(v.miles ?? 0), 0)),
    labor: round(rows.reduce((s, v) => s + laborOf(v), 0)),
    total: round(rows.reduce((s, v) => s + visitAmount(v), 0)),
  };
}

/**
 * Rows into groups, each with its own totals.
 *
 * Row order inside a group is whatever came in — the caller has already sorted
 * — so grouping never quietly reorders the grid underneath a chosen sort.
 */
export function groupVisits(visits: SiteVisit[], by: GroupBy): BoardGroup[] {
  if (by === 'none') {
    return [{ key: 'all', label: 'All visits', rows: visits, totals: totalsOf(visits) }];
  }
  const buckets = new Map<string, { label: string; sort: string; rows: SiteVisit[] }>();
  for (const v of visits) {
    const b = bucketOf(v, by);
    const existing = buckets.get(b.key);
    if (existing) existing.rows.push(v);
    else buckets.set(b.key, { label: b.label, sort: b.sort, rows: [v] });
  }
  return [...buckets.entries()]
    .sort((a, z) => a[1].sort.localeCompare(z[1].sort))
    .map(([key, b]) => ({ key, label: b.label, rows: b.rows, totals: totalsOf(b.rows) }));
}

// ─── Sorting ──────────────────────────────────────────────────────────────────

export type SortDir = 'asc' | 'desc';

/** The two computed columns are not fields on the row, so they sort by name. */
export type SortKey = keyof SiteVisit | 'labor_total' | 'line_total';

function sortValue(v: SiteVisit, key: SortKey): string | number {
  if (key === 'labor_total') return laborOf(v);
  if (key === 'line_total') return visitAmount(v);
  const raw = v[key as keyof SiteVisit];
  if (raw == null) return '';
  if (typeof raw === 'number') return raw;
  if (Array.isArray(raw)) return raw.length;
  return String(raw);
}

/**
 * A copy of the rows in the chosen order. Blanks always sink to the bottom in
 * both directions — an empty date is not "earliest", it is missing, and having
 * them jump to the top when you reverse the sort just hides the real rows.
 */
export function sortVisits(visits: SiteVisit[], key: SortKey | null, dir: SortDir): SiteVisit[] {
  if (!key) return visits;
  const sign = dir === 'asc' ? 1 : -1;
  return [...visits].sort((a, b) => {
    const av = sortValue(a, key);
    const bv = sortValue(b, key);
    const aEmpty = av === '' || av == null;
    const bEmpty = bv === '' || bv == null;
    if (aEmpty && bEmpty) return 0;
    if (aEmpty) return 1;
    if (bEmpty) return -1;
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sign;
    return String(av).localeCompare(String(bv), undefined, { numeric: true }) * sign;
  });
}

// ─── Colour ───────────────────────────────────────────────────────────────────

export type Pill = { label: string; color: string; bg: string };

const PILL: Record<string, Pill> = {
  // Invoice status — red until it is billed, because that is the one that costs money.
  not_invoiced: { label: 'Not Invoiced', color: '#b91c1c', bg: 'rgba(239,68,68,0.13)' },
  invoiced:     { label: 'Invoiced',     color: '#1D4ED8', bg: 'rgba(59,130,246,0.13)' },
  // Payment status
  unpaid:       { label: 'Unpaid',       color: '#b45309', bg: 'rgba(245,158,11,0.16)' },
  paid:         { label: 'Paid',         color: '#047857', bg: 'rgba(16,185,129,0.14)' },
  na:           { label: 'N/A',          color: '#6b7280', bg: 'rgba(0,0,0,0.06)' },
  // Work type
  Project:      { label: 'Project',      color: '#6d28d9', bg: 'rgba(139,92,246,0.14)' },
  'T&M':        { label: 'T&M',          color: '#0f766e', bg: 'rgba(13,148,136,0.14)' },
  Revisit:      { label: 'Revisit',      color: '#c2410c', bg: 'rgba(249,115,22,0.14)' },
  Survey:       { label: 'Survey',       color: '#0369a1', bg: 'rgba(14,165,233,0.14)' },
  Other:        { label: 'Other',        color: '#6b7280', bg: 'rgba(0,0,0,0.06)' },
};

const EMPTY_PILL: Pill = { label: '—', color: '#9ca3af', bg: 'rgba(0,0,0,0.04)' };

/** The colour chip for a status value. Unknown values still render, in grey. */
export function pillFor(value: string | null | undefined): Pill {
  const key = (value ?? '').trim();
  if (!key) return EMPTY_PILL;
  return PILL[key] ?? { label: key, color: '#6b7280', bg: 'rgba(0,0,0,0.06)' };
}

/** A colour band per group header, so groups are told apart at a glance. */
const GROUP_COLORS = ['#0E1B2E', '#6d28d9', '#c2410c', '#1D4ED8', '#047857', '#b45309', '#be123c', '#0369a1'];

export function groupColor(index: number): string {
  return GROUP_COLORS[index % GROUP_COLORS.length];
}

// ─── Formula columns ──────────────────────────────────────────────────────────

/**
 * The row a user-written formula sees, keyed by the headings on screen.
 *
 * A formula says {Hours} or [Labor Total] because that is what the column is
 * called in the grid. The keys here are therefore the grid's own labels, and a
 * test asserts the two lists stay in step — a heading that renamed itself out
 * from under a saved formula would break it silently.
 *
 * Labor Total and Line Total are included even though they are computed, since
 * they are the two numbers most formulas want to build on.
 */
export function formulaRow(v: SiteVisit): Record<string, string | number | boolean | null> {
  const n = (x: unknown) => (x == null || x === '' ? null : Number(x));
  return {
    'Date':                  v.visit_date ?? null,
    'Customer/Brand':        v.program ?? null,
    'Site/Location':         v.site_code ?? null,
    'Site Name':             v.site_name ?? null,
    'Site Address':          v.address ?? null,
    'Scope of Work':         v.client_summary ?? null,
    'Work Type':             v.visit_type ?? null,
    'Hours':                 n(v.hours),
    'Price':                 n(readPricing(v).amount),
    'Mileage/Distance':      n(v.miles),
    'Mileage Total':         n(v.travel_charge),
    'Materials Description': v.materials_description ?? null,
    'Materials Cost':        n(v.materials_cost),
    'Other Charges':         n(v.other_charges),
    'Invoice Status':        v.invoice_status ?? null,
    'Payment Status':        v.payment_status ?? null,
    'Notes':                 v.notes ?? null,
    'Additional Details':    v.additional_details ?? null,
    'Time In':               v.time_in ?? null,
    'Time Out':              v.time_out ?? null,
    'Techs on site':         (v.tech_ids ?? []).length,
    'Labor Total':           laborOf(v),
    'Line Total':            visitAmount(v),
  };
}

/** The column names a formula may reference — for the editor to offer. */
export const FORMULA_COLUMN_NAMES = Object.keys(
  formulaRow({ tech_ids: [] } as unknown as SiteVisit),
);
