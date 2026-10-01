// Crew projects (migration-087): multi-team T&M work such as the LDS
// meetinghouse refresh FAJ runs for NetView.
//
// The money model, which is NOT the work-order model:
//   client owes FAJ  = approved team-hours × project.bill_rate
//                      + approved travel receipts, capped at travel_cap per site
//   FAJ owes a lead  = approved team-hours × team.pay_rate
//                      + that team's approved travel receipts (they fronted it)
//   FAJ margin       = labor billed − labor owed to leads
// Leads pay their own helpers out of pay_rate; FAJ does not track helper pay.
//
// Everything here is pure and unit-tested (crew.test.ts). Components call
// these rather than re-deriving money inline.

export type CrewProject = {
  id: string;
  name: string;
  client: string | null;
  bill_rate: number;
  travel_cap: number;
  start_date: string | null;
  weeks: number;
  skip_weeks: string[];
  notes: string | null;
  archived_at: string | null;
  deduct_meals?: boolean;    // meals come off paid time (default true)
  deduct_breaks?: boolean;   // short breaks come off paid time (default false)
};

export type CrewTeam = {
  id: string;
  project_id: string;
  lead_contractor_id: string | null;
  name: string;
  helper_name: string | null;
  pay_rate: number;
  sort: number;
};

export type CrewSiteStatus = 'planned' | 'scheduled' | 'in_progress' | 'done' | 'deliverables_in' | 'audited';

export type CrewSite = {
  id: string;
  project_id: string;
  team_id: string | null;
  week_start: string | null;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  property_id: string | null;   // NetView's id for the site
  survey_date: string | null;   // site survey, usually weeks before cabling
  status: CrewSiteStatus;
  notes: string | null;
};

export type CrewEntryStatus = 'submitted' | 'approved' | 'rejected';

export type CrewTimeEntry = {
  id: string;
  site_id: string;
  team_id: string;
  work_date: string;
  start_time: string | null;
  end_time: string | null;
  hours: number;
  helper_present: boolean;
  note: string | null;
  status: CrewEntryStatus;
  entered_by: string | null;
  break_minutes?: number;
  meal_minutes?: number;
  from_clock?: boolean;
  open_since?: string | null;   // still signed in
};

export type CrewReceiptCategory = 'hotel' | 'fuel' | 'meals' | 'tolls' | 'parking' | 'other';
export type CrewReceiptStatus = 'submitted' | 'approved' | 'rejected' | 'reimbursed';

export type CrewReceipt = {
  id: string;
  site_id: string;
  team_id: string;
  receipt_date: string;
  category: CrewReceiptCategory;
  vendor: string | null;
  amount: number;
  file_path: string | null;
  note: string | null;
  status: CrewReceiptStatus;
  entered_by: string | null;
};

export type CrewPayment = {
  id: string;
  project_id: string;
  team_id: string | null;
  direction: 'to_lead' | 'from_client';
  kind: 'labor' | 'travel';
  amount: number;
  paid_on: string;
  method: string | null;
  reference: string | null;
  note: string | null;
};

export const SITE_STATUS_META: Record<CrewSiteStatus, { label: string; color: string; bg: string }> = {
  planned:         { label: 'Planned',          color: '#6b7280', bg: 'rgba(107,114,128,0.12)' },
  scheduled:       { label: 'Scheduled',        color: '#1D4ED8', bg: 'rgba(59,130,246,0.12)' },
  in_progress:     { label: 'In progress',      color: '#b45309', bg: 'rgba(245,158,11,0.14)' },
  done:            { label: 'Install done',     color: '#047857', bg: 'rgba(16,185,129,0.12)' },
  deliverables_in: { label: 'Deliverables in',  color: '#047857', bg: 'rgba(16,185,129,0.20)' },
  audited:         { label: 'Audited',          color: '#065f46', bg: 'rgba(5,150,105,0.24)' },
};

export const RECEIPT_CATEGORIES: { value: CrewReceiptCategory; label: string }[] = [
  { value: 'hotel', label: 'Hotel' },
  { value: 'fuel', label: 'Fuel' },
  { value: 'meals', label: 'Meals' },
  { value: 'tolls', label: 'Tolls' },
  { value: 'parking', label: 'Parking' },
  { value: 'other', label: 'Other' },
];

const r2 = (n: number) => Math.round(n * 100) / 100;

// ── Dates ───────────────────────────────────────────────────────────────────

/** 'YYYY-MM-DD' for a local date, no timezone drift. */
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Parse 'YYYY-MM-DD' as a LOCAL date (new Date('2026-10-19') is UTC midnight). */
export function parseYmd(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** The Monday on or before the given date. */
export function mondayOf(s: string): string {
  const d = parseYmd(s);
  const dow = d.getDay(); // 0 Sun … 6 Sat
  d.setDate(d.getDate() - ((dow + 6) % 7));
  return ymd(d);
}

export type ProjectWeek = { monday: string; label: string; skipped: boolean; index: number };

/** The project's weeks, Monday to Monday, with holiday weeks flagged. */
export function projectWeeks(p: Pick<CrewProject, 'start_date' | 'weeks' | 'skip_weeks'>): ProjectWeek[] {
  if (!p.start_date) return [];
  const first = parseYmd(mondayOf(p.start_date));
  const skip = new Set((p.skip_weeks ?? []).map((s) => mondayOf(s)));
  const out: ProjectWeek[] = [];
  for (let i = 0; i < p.weeks; i++) {
    const d = new Date(first);
    d.setDate(first.getDate() + i * 7);
    const monday = ymd(d);
    out.push({
      monday,
      index: i,
      skipped: skip.has(monday),
      label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    });
  }
  return out;
}

/**
 * Hours between two 'HH:MM' times on one day. Returns null when either is
 * missing or the end is not after the start — the caller then asks for hours
 * typed directly rather than guessing across midnight.
 */
export function hoursBetween(start: string | null | undefined, end: string | null | undefined): number | null {
  if (!start || !end) return null;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return null;
  const mins = eh * 60 + em - (sh * 60 + sm);
  if (mins <= 0) return null;
  return r2(mins / 60);
}

// ── Money ───────────────────────────────────────────────────────────────────

const countsAsApproved = (s: CrewReceiptStatus) => s === 'approved' || s === 'reimbursed';

/** Approved team-hours, optionally for one team. */
export function approvedHours(entries: CrewTimeEntry[], teamId?: string): number {
  return r2(entries
    .filter((e) => e.status === 'approved' && (!teamId || e.team_id === teamId))
    .reduce((s, e) => s + Number(e.hours || 0), 0));
}

/** Travel per site, and how much of it the client will actually reimburse. */
export function siteTravel(receipts: CrewReceipt[], siteId: string, cap: number) {
  const mine = receipts.filter((r) => r.site_id === siteId && r.status !== 'rejected');
  const submitted = r2(mine.reduce((s, r) => s + Number(r.amount), 0));
  const approved = r2(mine.filter((r) => countsAsApproved(r.status)).reduce((s, r) => s + Number(r.amount), 0));
  const billable = r2(Math.min(approved, cap));
  return { submitted, approved, billable, overCap: r2(Math.max(0, submitted - cap)), remaining: r2(Math.max(0, cap - submitted)) };
}

export type TeamMoney = {
  teamId: string;
  hours: number;
  laborBilled: number;   // what the client owes for this team's hours
  laborOwed: number;     // what FAJ owes the lead for labor
  travelOwed: number;    // approved receipts the lead fronted
  paidLabor: number;
  paidTravel: number;
  balance: number;       // still owed to the lead, labor + travel
  margin: number;        // FAJ's spread on labor
};

export function teamMoney(
  team: CrewTeam, project: CrewProject,
  entries: CrewTimeEntry[], receipts: CrewReceipt[], payments: CrewPayment[],
): TeamMoney {
  const hours = approvedHours(entries, team.id);
  const laborBilled = r2(hours * Number(project.bill_rate));
  const laborOwed = r2(hours * Number(team.pay_rate));
  const travelOwed = r2(receipts
    .filter((r) => r.team_id === team.id && countsAsApproved(r.status))
    .reduce((s, r) => s + Number(r.amount), 0));
  const out = payments.filter((p) => p.direction === 'to_lead' && p.team_id === team.id);
  const paidLabor = r2(out.filter((p) => p.kind === 'labor').reduce((s, p) => s + Number(p.amount), 0));
  const paidTravel = r2(out.filter((p) => p.kind === 'travel').reduce((s, p) => s + Number(p.amount), 0));
  return {
    teamId: team.id, hours, laborBilled, laborOwed, travelOwed, paidLabor, paidTravel,
    balance: r2(laborOwed + travelOwed - paidLabor - paidTravel),
    margin: r2(laborBilled - laborOwed),
  };
}

export type ProjectMoney = {
  hours: number;
  laborBilled: number;
  travelBillable: number;
  totalBillable: number;
  receivedFromClient: number;
  clientBalance: number;
  owedToLeads: number;
  paidToLeads: number;
  leadBalance: number;
  margin: number;
};

export function projectMoney(
  project: CrewProject, teams: CrewTeam[], sites: CrewSite[],
  entries: CrewTimeEntry[], receipts: CrewReceipt[], payments: CrewPayment[],
): ProjectMoney {
  const perTeam = teams.map((t) => teamMoney(t, project, entries, receipts, payments));
  const hours = approvedHours(entries);
  const laborBilled = r2(hours * Number(project.bill_rate));
  const travelBillable = r2(sites.reduce((s, site) => s + siteTravel(receipts, site.id, Number(project.travel_cap)).billable, 0));
  const totalBillable = r2(laborBilled + travelBillable);
  const receivedFromClient = r2(payments.filter((p) => p.direction === 'from_client').reduce((s, p) => s + Number(p.amount), 0));
  const owedToLeads = r2(perTeam.reduce((s, m) => s + m.laborOwed + m.travelOwed, 0));
  const paidToLeads = r2(perTeam.reduce((s, m) => s + m.paidLabor + m.paidTravel, 0));
  return {
    hours, laborBilled, travelBillable, totalBillable, receivedFromClient,
    clientBalance: r2(totalBillable - receivedFromClient),
    owedToLeads, paidToLeads, leadBalance: r2(owedToLeads - paidToLeads),
    margin: r2(laborBilled - perTeam.reduce((s, m) => s + m.laborOwed, 0)),
  };
}

/** Plain-language reason for a tech-RPC refusal. */
export function crewReason(reason: string): string {
  switch (reason) {
    case 'not_a_tech': return 'Your login is not linked to a tech profile.';
    case 'not_your_site': return 'That site is not on your team.';
    case 'bad_date': return 'Pick a date that is not in the future.';
    case 'bad_hours': return 'Hours must be more than 0 and no more than 16.';
    case 'already_approved': return 'That day is already approved. Ask Fred to change it.';
    case 'already_reviewed': return 'That receipt was already reviewed. Ask Fred to change it.';
    case 'bad_amount': return 'Enter the receipt amount.';
    case 'bad_category': return 'Pick a category.';
    case 'bad_file': return 'The photo did not upload correctly. Try again.';
    case 'not_found': return 'That entry no longer exists.';
    case 'taken': return 'Another team already has that site.';
    case 'week_full': return 'Your team already has a site that week.';
    case 'started': return 'Work has already started there, so it can’t be changed from here. Message Fred.';
    case 'empty': return 'Type a message first.';
    case 'wrong_step': return 'That button doesn’t fit where the day is. Refresh and try again.';
    default: return reason || 'Something went wrong.';
  }
}

// ── Site upload ─────────────────────────────────────────────────────────────

export type SiteDraft = {
  name: string; address: string | null; city: string | null; state: string | null;
  zip?: string | null; property_id?: string | null;
  survey_date?: string | null; week_start?: string | null;   // 'YYYY-MM-DD'
};

const HEADER_ALIASES: Record<keyof SiteDraft, string[]> = {
  name: ['name', 'site', 'site name', 'meetinghouse', 'building', 'location', 'facility'],
  address: ['address', 'street', 'street address', 'address 1', 'address1'],
  city: ['city', 'town'],
  state: ['state', 'st'],
  zip: ['zip', 'zip code', 'zipcode', 'postal code'],
  property_id: ['property id', 'property', 'prop id', 'property #', 'site id'],
  survey_date: ['survey date', 'survey'],
  week_start: ['cabling date', 'install date', 'cabling', 'start date', 'week'],
};

/** '10/5/2026', '2026-10-05', or an Excel serial day number → 'YYYY-MM-DD'. */
export function parseSheetDate(v: string): string | null {
  const t = v.trim();
  if (!t) return null;
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  if (/^\d{5}$/.test(t)) {             // Excel serial (days since 1899-12-30)
    const d = new Date(Date.UTC(1899, 11, 30) + Number(t) * 86400000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }
  return null;
}

/**
 * Turn spreadsheet rows (or pasted lines split on tabs/commas/pipes) into
 * sites. If the first row looks like headers, columns are matched by name in
 * any order; otherwise the order is Name, Address, City, State. A single
 * "City, ST" in the last column is split. Blank and duplicate rows are dropped.
 */
export function parseSiteRows(rows: (string | number | null | undefined)[][]): SiteDraft[] {
  const clean = rows
    .map((r) => r.map((c) => (c == null ? '' : String(c).trim())))
    .filter((r) => r.some((c) => c !== ''));
  if (clean.length === 0) return [];

  let idx: Record<keyof SiteDraft, number>;
  const head = clean[0].map((c) => c.toLowerCase());
  const found = (Object.keys(HEADER_ALIASES) as (keyof SiteDraft)[])
    .map((k) => [k, head.findIndex((h) => HEADER_ALIASES[k].includes(h))] as const);
  let body = clean;
  const hit = Object.fromEntries(found) as Record<keyof SiteDraft, number>;
  // A header row names the site, or (NetView's sheets) gives a city plus a
  // Property ID with no name column at all.
  const headed = hit.name >= 0 || (hit.city >= 0 && (hit.property_id >= 0 || hit.address >= 0));
  if (headed) {
    idx = hit;
    body = clean.slice(1);
  } else {
    idx = { name: 0, address: 1, city: 2, state: 3, zip: -1, property_id: -1, survey_date: -1, week_start: -1 };
  }

  const seen = new Set<string>();
  const out: SiteDraft[] = [];
  for (const r of body) {
    const get = (i: number | undefined) => (i != null && i >= 0 && r[i] ? r[i] : null);
    let city = get(idx.city);
    let state = get(idx.state);
    // No name column: call it after the town, the way the crews talk about it.
    const name = get(idx.name) ?? (city ? `${titleCase(city)} Meetinghouse` : null);
    if (!name) continue;
    // "Wilmington, NC" in one cell
    if (city && !state) {
      const m = city.match(/^(.*?),\s*([A-Za-z]{2})$/);
      if (m) { city = m[1]; state = m[2]; }
    }
    if (city && city === city.toUpperCase()) city = titleCase(city);
    const property_id = get(idx.property_id);
    const key = property_id ? `pid|${property_id}` : `${name}|${city ?? ''}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const week = get(idx.week_start);
    out.push({
      name, address: get(idx.address), city, state: state ? state.toUpperCase() : null,
      zip: get(idx.zip), property_id,
      survey_date: (() => { const v = get(idx.survey_date); return v ? parseSheetDate(v) : null; })(),
      week_start: week ? (() => { const d = parseSheetDate(week); return d ? mondayOf(d) : null; })() : null,
    });
  }
  return out;
}

/** Pasted text → rows: tabs (from Excel) win, then pipes, then commas. */
export function splitPasted(text: string): string[][] {
  return text.split(/\r?\n/).map((line) => {
    if (line.includes('\t')) return line.split('\t');
    if (line.includes('|')) return line.split('|');
    return line.split(',');
  });
}

function titleCase(s: string): string {
  return s.toLowerCase().split(' ').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
}
