// Site activity report — what was done, where, and when (migration 049).
//
// The report Fred hands a client: every visit to their sites with dates, times,
// hours and what happened. Deliberately money-free — no rates, no totals. A
// client seeing labour cost on an activity log is a different conversation.
//
// Two outputs from one shape: a CSV he can open in Excel, and a public
// read-only page at /site-report/<token>.
import type { SiteVisit, VisitSession } from './types';

export type ReportVisit = {
  visit_date: string | null;
  site_name: string | null;
  site_code: string | null;
  address: string | null;
  time_in: string | null;
  time_out: string | null;
  hours: number | null;
  visit_type: string | null;
  notes: string | null;
  /** (migration-050) the deliberate client-facing line, when one was written. */
  client_summary?: string | null;
  sessions?: VisitSession[] | null;
};

/**
 * Longest a fallback note can be and still plausibly be a work description
 * rather than a pasted email.
 *
 * Measured against production rather than guessed. Genuine notes run to 739
 * chars — "Kiosk 2 faceplate shows B9 and B10…", "Missing photos of APs…",
 * "I have no idea what is going on at this site…" — and every one of those is
 * exactly what a client should read. The one pasted assignment email is 1,789.
 *
 * An earlier 300 here was wrong: it hid six real work descriptions to suppress
 * one email. Provenance is no help either — all seven were typed by hand, so
 * "came from an import" would gate the wrong way round.
 */
const MAX_FALLBACK_NOTE = 1200;

/** How a visit is identified as "the same site" for grouping and counting. */
const siteKey = (v: ReportVisit): string =>
  (v.site_code || v.site_name || v.address || '').trim().toLowerCase();

/** Local clock time, or empty. Kept short — the date already has the day. */
export function fmtClock(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** Date-only string rendered without timezone drift (parsed at noon). */
export function fmtDay(d: string | null | undefined): string {
  if (!d) return '';
  const day = d.split('T')[0];
  const parsed = new Date(`${day}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * A visit can span several stints — "June 4th 20:15-23:45, then June 5th
 * 10:00-13:15" (migration 045). Render them so a client can see the real shape
 * of the work rather than one lump figure.
 */
export function fmtSessions(sessions: VisitSession[] | null | undefined): string {
  if (!sessions || sessions.length === 0) return '';
  return sessions
    .filter((s) => s?.in)
    .map((s) => `${fmtDay(s.in)} ${fmtClock(s.in)}–${s.out ? fmtClock(s.out) : 'open'}`)
    .join('; ');
}

/**
 * Make a visit note safe to show a client.
 *
 * `notes` is dual-use. Most of it is exactly what belongs on this report —
 * "Add BLANKS to Rack", "Kiosk 2 faceplate shows B9 and B10…". But visits
 * created from an email import can carry the whole raw email, and one real
 * Wendy's visit did: addressed to Frederick, with NetView's internal Smartsheet
 * form, a bit.ly bridge link, and a Google Drive deliverables folder. Sharing
 * that report would have handed a client FAJ's internal links.
 *
 * So on the client-facing report only: links and addresses come out, a leading
 * salutation comes off, and anything email-length is truncated. The full note is
 * untouched in the app — this only changes what a client sees.
 */
export function clientSafeNotes(notes: string | null | undefined, maxChars = 600): string {
  let s = (notes ?? '').replace(/\r\n/g, '\n').trim();
  if (!s) return '';

  // Internal links and addresses are never appropriate on a client report.
  s = s.replace(/\bhttps?:\/\/\S+/gi, '')
       .replace(/\bwww\.\S+/gi, '')
       .replace(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/gi, '');

  // "Frederick," / "Hi Fred," — an internal greeting gives away that this is
  // forwarded correspondence rather than a work description.
  s = s.replace(/^(hi|hello|hey|dear)?\s*[A-Z][a-z]+\s*,\s*\n/i, '');

  // Collapse the whitespace the stripping leaves behind.
  s = s.split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim())
       .filter((l, i, arr) => l !== '' || arr[i - 1] !== '')
       .join('\n')
       .trim();

  if (s.length > maxChars) {
    const cut = s.slice(0, maxChars);
    const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('\n'));
    s = `${(lastStop > maxChars * 0.5 ? cut.slice(0, lastStop + 1) : cut).trim()}…`;
  }

  return s;
}

/**
 * The one line a client should read for this visit.
 *
 * Order of preference:
 *   1. client_summary — written on purpose for the client, used as-is
 *   2. short notes    — genuine work descriptions, sanitised
 *   3. nothing        — a long note is an imported email; hiding it beats
 *                       truncating it into something that reads like tech
 *                       instructions on a client's report
 *
 * The full note always stays visible inside the app. This only governs the
 * shared report and the shared spreadsheet.
 */
export function clientVisibleNote(v: Pick<ReportVisit, 'notes' | 'client_summary'>): string {
  const summary = (v.client_summary ?? '').trim();
  if (summary) return clientSafeNotes(summary);

  // Sanitise without a budget, then judge the real length. Truncating first and
  // then sniffing for the ellipsis also hid genuine short notes ending in '…'.
  const safe = clientSafeNotes(v.notes, Number.MAX_SAFE_INTEGER);
  return !safe || safe.length > MAX_FALLBACK_NOTE ? '' : safe;
}

const CSV_HEADERS = [
  'Date', 'Site', 'Site ID', 'Address', 'Time In', 'Time Out', 'Hours', 'Type', 'Work Performed', 'Sessions',
] as const;

/**
 * Escape one CSV field. Leading =, +, - and @ are prefixed with a quote so a
 * value like "-2 drops" can't be interpreted as a formula when the client opens
 * the file in Excel.
 */
export function csvCell(value: unknown): string {
  const s = value == null ? '' : String(value);
  const needsGuard = /^[=+\-@]/.test(s);
  const body = needsGuard ? `'${s}` : s;
  return `"${body.replace(/"/g, '""')}"`;
}

export function siteReportCSV(visits: ReportVisit[]): string {
  const rows = [...visits]
    .sort((a, b) => (b.visit_date ?? '').localeCompare(a.visit_date ?? ''))
    .map((v) => [
      fmtDay(v.visit_date),
      v.site_name ?? '',
      v.site_code ?? '',
      v.address ?? '',
      fmtClock(v.time_in),
      fmtClock(v.time_out),
      v.hours ?? '',
      v.visit_type ?? '',
      // The CSV gets shared too, so it shows exactly what the web report shows.
      clientVisibleNote(v),
      fmtSessions(v.sessions),
    ].map(csvCell).join(','));

  return [CSV_HEADERS.map(csvCell).join(','), ...rows].join('\r\n');
}

export type SiteReportTotals = {
  visits: number;
  hours: number;
  sites: number;
  firstVisit: string | null;
  lastVisit: string | null;
};

export function siteReportTotals(visits: ReportVisit[]): SiteReportTotals {
  const dates = visits.map((v) => v.visit_date).filter((d): d is string => Boolean(d)).sort();
  const siteKeys = new Set(
    visits.map((v) => (v.site_code || v.site_name || v.address || '').trim().toLowerCase()).filter(Boolean),
  );
  return {
    visits: visits.length,
    hours: Math.round(visits.reduce((s, v) => s + Number(v.hours ?? 0), 0) * 100) / 100,
    sites: siteKeys.size,
    firstVisit: dates[0] ?? null,
    lastVisit: dates.at(-1) ?? null,
  };
}

/** Group visits under each site, newest activity first — how Fred reads it. */
export function groupBySite(visits: ReportVisit[]): { title: string; code: string | null; visits: ReportVisit[] }[] {
  const m = new Map<string, ReportVisit[]>();
  for (const v of visits) {
    const key = (v.site_code || v.site_name || v.address || 'unknown').trim().toLowerCase();
    // Push into the existing array rather than rebuilding it — spreading here
    // copies the whole group on every visit, which is quadratic as sites fill up.
    const group = m.get(key);
    if (group) group.push(v);
    else m.set(key, [v]);
  }
  return [...m.values()]
    .map((group) => {
      const sorted = [...group].sort((a, b) => (b.visit_date ?? '').localeCompare(a.visit_date ?? ''));
      const named = sorted.find((v) => v.site_name) ?? sorted[0];
      return {
        title: [named.site_name, named.site_code ? `#${named.site_code}` : null].filter(Boolean).join(' ')
          || named.address || 'Unknown site',
        code: named.site_code ?? null,
        visits: sorted,
      };
    })
    .sort((a, b) => (b.visits[0].visit_date ?? '').localeCompare(a.visits[0].visit_date ?? ''));
}

/** Rows straight from site_visits, narrowed to the report shape. */
export function toReportVisits(visits: SiteVisit[]): ReportVisit[] {
  return visits.map((v) => ({
    visit_date: v.visit_date,
    site_name: v.site_name,
    site_code: v.site_code,
    address: v.address,
    time_in: v.time_in,
    time_out: v.time_out,
    hours: v.hours,
    visit_type: v.visit_type,
    notes: v.notes,
    client_summary: v.client_summary,
    sessions: v.sessions,
  }));
}
