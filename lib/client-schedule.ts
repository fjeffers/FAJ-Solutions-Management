// The client's weekly schedule (Fred, 2026-10-19: "Yes, add an upload"): an
// Excel or CSV sheet with one row per site visit. Each row fills its job, found
// by Site ID: the client's ticket, the date and start time, the address, the
// lockbox and where it is, the deliverables folder and the checkout form. Only
// empty fields are filled; a date or time that differs is shown, not changed.
// A row with no job becomes a new job to assign.
//
// Pure, so the upload preview and the server read a sheet the same way
// (lib/client-schedule.test.ts).
import { CLIENT_LINKS_MAX, parseClientLinks } from './client-links';

export type ScheduleCell = string | number | boolean | Date | null | undefined;

export type ScheduleRow = {
  /** The row's number in the sheet, for the preview. */
  line: number;
  siteId: string;
  ticket: string;
  /** YYYY-MM-DD */
  date: string | null;
  /** HH:MM, 24h */
  time: string | null;
  endDate: string | null;
  /** The client's own status for the visit, e.g. "Tech Assigned" or "Cancelled". */
  status: string;
  lockboxCode: string;
  lockboxLocation: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  deliverables: string;
  floorplan: string;
  checkin: string;
  checkout: string;
};

type Field = Exclude<keyof ScheduleRow, 'line'>;

// First match wins, and a column is used once: "End Date" is taken before the
// date looks for "date", and "Lockbox Location" before the code looks for "lockbox".
const COLUMNS: { field: Field; any: string[]; not?: string[] }[] = [
  { field: 'siteId', any: ['site id', 'siteid', 'site code', 'site number', 'site no', 'store number', 'store id', 'location id'] },
  { field: 'ticket', any: ['ticket', 'work order', 'wo number', 'wo no'] },
  { field: 'endDate', any: ['end date', 'finish date', 'due date'] },
  { field: 'date', any: ['dispatch date', 'start date', 'service date', 'scheduled date', 'visit date', 'date'], not: ['created', 'updated', 'birth'] },
  { field: 'time', any: ['start time', 'arrival time', 'time'], not: ['end', 'finish', 'zone', 'timestamp', 'tracking'] },
  { field: 'status', any: ['status'] },
  { field: 'lockboxLocation', any: ['lockbox location', 'lock box location', 'keybox location', 'key box location'] },
  { field: 'lockboxCode', any: ['lockbox', 'lock box', 'keybox', 'key box', 'combination', 'gate code'] },
  { field: 'floorplan', any: ['floorplan', 'floor plan'] },
  { field: 'deliverables', any: ['deliverable', 'folder', 'upload'] },
  { field: 'checkin', any: ['checkin', 'check in'] },
  { field: 'checkout', any: ['checkout', 'check out'] },
  { field: 'zip', any: ['zip', 'postal'] },
  { field: 'city', any: ['city', 'town'] },
  { field: 'state', any: ['state', 'province'] },
  { field: 'address', any: ['address', 'street'], not: ['email', 'mac', 'ip address'] },
];

const headerKey = (v: ScheduleCell) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// At the start of a word: "Deliverables" has "deliverable", "Update" has no "date", "Vendor" no "end".
const hasWord = (key: string, w: string) => ` ${key}`.includes(` ${w}`);

function mapColumns(header: ScheduleCell[]): Map<Field, number> {
  const keys = header.map(headerKey);
  const out = new Map<Field, number>();
  const used = new Set<number>();
  for (const c of COLUMNS) {
    const i = keys.findIndex((k, idx) => k && !used.has(idx)
      && c.any.some((w) => hasWord(k, w))
      && !(c.not ?? []).some((w) => hasWord(k, w)));
    if (i >= 0) { out.set(c.field, i); used.add(i); }
  }
  return out;
}

// Cells a sheet uses for "nothing here".
const BLANK = new Set(['', '.', '-', '--', '—', 'n/a', 'na', 'none', 'tbd']);

function text(v: ScheduleCell): string {
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : ymd(v);
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return BLANK.has(s.toLowerCase()) ? '' : s.slice(0, 500);
}

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const validYmd = (y: number, m: number, d: number) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
};

/** Excel's day number (46314 = 2026-10-19), or a typed date, → YYYY-MM-DD. */
export function scheduleDate(v: ScheduleCell): string | null {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : ymd(v);
  if (typeof v === 'number') {
    if (v < 20000 || v > 80000) return null;
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const s = text(v);
  if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return validYmd(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/.exec(s);
  if (m) return validYmd(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1], +m[2]);
  if (/^\d+(\.\d+)?$/.test(s)) return scheduleDate(Number(s));
  // "Monday, October 19, 2026" or "Oct 19 2026"
  const t = Date.parse(s.replace(/^[a-z]+day,?\s*/i, ''));
  return isNaN(t) ? null : ymd(new Date(t));
}

/** "8:00 am", "1 PM", "13:30" or Excel's fraction of a day (0.5 = noon) → HH:MM. */
export function scheduleTime(v: ScheduleCell): string | null {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : `${pad(v.getHours())}:${pad(v.getMinutes())}`;
  if (typeof v === 'number') {
    const frac = v - Math.floor(v);
    if (frac === 0 && v >= 1) return null;
    const mins = Math.round(frac * 24 * 60) % (24 * 60);
    return `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
  }
  const s = text(v).toLowerCase();
  if (!s) return null;
  if (s === 'noon') return '12:00';
  if (/^0?\.\d+$/.test(s)) return scheduleTime(Number(s));
  const m = /^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(a\.?m?\.?|p\.?m?\.?)?(?:\s|$)/.exec(s);
  if (!m) return null;
  let h = +m[1];
  const min = m[2] ? +m[2] : 0;
  const ap = m[3]?.[0];
  if (!m[2] && !ap) return null; // a lone number isn't a time
  if (ap === 'p' && h < 12) h += 12;
  if (ap === 'a' && h === 12) h = 0;
  return h < 24 && min < 60 ? `${pad(h)}:${pad(min)}` : null;
}

/** The longest link a job keeps (the database's limit for the check-in and checkout links). */
export const SCHEDULE_LINK_MAX = 2000;

/**
 * The first web address in a cell, cleaned like every other client link. Never
 * shortened: a cut link (a signed one loses its signature) looks fine and fails
 * on site, so one too long to keep is dropped instead.
 */
export function scheduleLink(v: ScheduleCell): string {
  const found = /https?:\/\/[^\s<>"']+/i.exec(String(v ?? ''));
  if (!found) return '';
  const link = parseClientLinks(found[0].replace(/[.,;:!?)]+$/, ''))[0] ?? '';
  return link.length <= SCHEDULE_LINK_MAX ? link : '';
}

/**
 * A sheet (rows of cells, header first; any blank or title rows above the
 * header are skipped) → one ScheduleRow per row with a Site ID. `error` says
 * what's wrong when the sheet can't be read at all.
 */
export function parseSchedule(table: ScheduleCell[][]): { rows: ScheduleRow[]; error?: string } {
  const at = table.slice(0, 15).findIndex((r) => mapColumns(r ?? []).has('siteId'));
  if (at < 0) return { rows: [], error: 'No "Site ID" column found. The first row of the sheet should name the columns.' };
  const cols = mapColumns(table[at]);
  const cell = (r: ScheduleCell[], f: Field): ScheduleCell => {
    const i = cols.get(f);
    return i === undefined ? undefined : r[i];
  };
  const rows: ScheduleRow[] = [];
  table.slice(at + 1).forEach((r, k) => {
    if (!r) return;
    const siteId = text(cell(r, 'siteId')).slice(0, 80);
    if (!siteId) return;
    const zipRaw = cell(r, 'zip');
    rows.push({
      line: at + k + 2,
      siteId,
      ticket: text(cell(r, 'ticket')).slice(0, 80),
      date: scheduleDate(cell(r, 'date')),
      time: scheduleTime(cell(r, 'time')),
      endDate: scheduleDate(cell(r, 'endDate')),
      status: text(cell(r, 'status')).slice(0, 80),
      lockboxCode: text(cell(r, 'lockboxCode')).slice(0, 80),
      lockboxLocation: text(cell(r, 'lockboxLocation')),
      address: text(cell(r, 'address')),
      city: text(cell(r, 'city')).slice(0, 80),
      state: text(cell(r, 'state')).slice(0, 40),
      // Excel drops a zip's leading zero (07801 → 7801).
      zip: typeof zipRaw === 'number' && zipRaw < 100000 ? String(zipRaw).padStart(5, '0') : text(zipRaw).slice(0, 20),
      deliverables: scheduleLink(cell(r, 'deliverables')),
      floorplan: scheduleLink(cell(r, 'floorplan')),
      checkin: scheduleLink(cell(r, 'checkin')),
      checkout: scheduleLink(cell(r, 'checkout')),
    });
  });
  if (rows.length === 0) return { rows, error: 'The sheet has a Site ID column but no rows with a Site ID.' };
  return { rows };
}

/** Rows in one upload. A bigger sheet is turned away whole, never cut short. */
export const SCHEDULE_MAX_ROWS = 500;
export const tooManyRows = (n: number) =>
  `That sheet has ${n} rows; the most at once is ${SCHEDULE_MAX_ROWS}. Split it into smaller sheets and upload each.`;

/** Rows sent back from the browser, kept to the shape and sizes parseSchedule gives. */
export function cleanScheduleRows(input: unknown): ScheduleRow[] {
  if (!Array.isArray(input)) return [];
  const s = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const iso = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const hm = (v: unknown) => (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : null);
  const link = (v: unknown) => (typeof v === 'string' ? scheduleLink(v) : '');
  return input.slice(0, SCHEDULE_MAX_ROWS).flatMap((r): ScheduleRow[] => {
    if (!r || typeof r !== 'object') return [];
    const o = r as Record<string, unknown>;
    const siteId = s(o.siteId, 80);
    if (!siteId) return [];
    return [{
      line: typeof o.line === 'number' && Number.isFinite(o.line) ? Math.floor(o.line) : 0,
      siteId,
      ticket: s(o.ticket, 80),
      date: iso(o.date),
      time: hm(o.time),
      endDate: iso(o.endDate),
      status: s(o.status, 80),
      lockboxCode: s(o.lockboxCode, 80),
      lockboxLocation: s(o.lockboxLocation, 500),
      address: s(o.address, 500),
      city: s(o.city, 80),
      state: s(o.state, 40),
      zip: s(o.zip, 20),
      deliverables: link(o.deliverables),
      floorplan: link(o.floorplan),
      checkin: link(o.checkin),
      checkout: link(o.checkout),
    }];
  });
}

/** The client has called the visit off: flagged, and never made into a new job. */
export const isCancelled = (r: Pick<ScheduleRow, 'status'>) => /cancel|void|on hold/i.test(r.status);

/** "Lockbox code 1234. Lockbox: Rear door" — the job's Access note, the way the office writes it. */
export function accessText(r: Pick<ScheduleRow, 'lockboxCode' | 'lockboxLocation'>): string {
  return [r.lockboxCode && `Lockbox code ${r.lockboxCode}.`, r.lockboxLocation && `Lockbox: ${r.lockboxLocation}`]
    .filter(Boolean).join(' ');
}

/** The job fields a schedule row reads and fills. */
export type ScheduleJob = {
  id: string;
  wo_number: string;
  title: string | null;
  wo_status: string;
  customer_name?: string | null;
  source_platform?: string | null;
  client_reference: string | null;
  external_wo_id: string | null;
  start_date: string | null;
  start_time: string | null;
  end_date: string | null;
  site_address: string | null;
  site_city: string | null;
  site_state: string | null;
  site_zip: string | null;
  access_instructions: string | null;
  client_links: string[] | null;
  checkin_link: string | null;
  checkout_link: string | null;
};

/** The same site however it's typed: "05007927" and 5007927 match. */
export const siteKey = (v: string | null | undefined) => {
  const t = (v ?? '').trim().toLowerCase();
  return /^\d+$/.test(t) ? t.replace(/^0+(?=\d)/, '') : t;
};
/**
 * Every way a row's site might be stored on its job, for the lookup: as typed,
 * and for a number, without leading zeros and with up to three put back (Excel
 * drops them, so "05007927" on the job arrives as 5007927).
 */
export function siteLookupIds(rows: Pick<ScheduleRow, 'siteId'>[]): string[] {
  return [...new Set(rows.flatMap((r) => {
    const k = siteKey(r.siteId);
    return /^\d+$/.test(k) ? [r.siteId, k, `0${k}`, `00${k}`, `000${k}`] : [r.siteId, k];
  }))];
}

const sameText = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();
const daysApart = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000;

/** "Wed, Oct 21" */
export const dayLabel = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
/** "13:00" → "1:00 pm" */
export const timeLabel = (hm: string) => {
  const [h, m] = hm.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
};

/** A job dated further than this from the row is an earlier or later visit, not this one. */
export const MATCH_WINDOW_DAYS = 30;

/**
 * Each row's job, by Site ID. The job with the row's ticket wins; otherwise a
 * job at that site not yet approved or paid, dated nearest the row and within
 * a month, and without a ticket of its own when the row has one (a different
 * ticket is a different visit). A job is used by one row only, so two visits
 * to a site in one week stay two.
 */
export function matchSchedule<J extends ScheduleJob>(rows: ScheduleRow[], jobs: J[]): (J | null)[] {
  const taken = new Set<string>();
  const done = /^(approved|paid)$/i;
  const gap = (r: ScheduleRow, j: J) => (r.date && j.start_date ? daysApart(r.date, j.start_date) : Infinity);
  const nearest = (r: ScheduleRow, list: J[]) => list.reduce<J | null>((best, j) => (!best || gap(r, j) < gap(r, best) ? j : best), null);
  // Ticket matches first, so a ticketless row can't take a job another row names.
  const out: (J | null)[] = rows.map((r) => {
    if (!r.ticket) return null;
    const hit = nearest(r, jobs.filter((j) => !taken.has(j.id) && siteKey(j.client_reference) === siteKey(r.siteId) && sameText(j.external_wo_id, r.ticket)));
    if (hit) taken.add(hit.id);
    return hit;
  });
  rows.forEach((r, i) => {
    if (out[i]) return;
    const hit = nearest(r, jobs.filter((j) => !taken.has(j.id)
      && siteKey(j.client_reference) === siteKey(r.siteId)
      && (!r.ticket || !(j.external_wo_id ?? '').trim())
      && !done.test(j.wo_status)
      && (!r.date || !j.start_date || daysApart(r.date, j.start_date) <= MATCH_WINDOW_DAYS)));
    if (hit) taken.add(hit.id);
    out[i] = hit;
  });
  return out;
}

export type ScheduleFill = {
  /** Only the fields that change. */
  patch: Partial<Omit<ScheduleJob, 'id' | 'wo_number' | 'title' | 'wo_status'>>;
  /** What the office is told was added: "ticket", "lockbox", … */
  filled: string[];
  /** Where the sheet and the job disagree, as sentences; the job is left as it is. */
  differs: string[];
};

const blank = (v: string | null | undefined) => !(v ?? '').trim();

/** What a row adds to its job: empty fields only, and links the job doesn't have yet. */
export function planFill(r: ScheduleRow, job: ScheduleJob): ScheduleFill {
  const patch: ScheduleFill['patch'] = {};
  const filled: string[] = [];
  const differs: ScheduleFill['differs'] = [];

  if (r.ticket && blank(job.external_wo_id)) { patch.external_wo_id = r.ticket; filled.push('ticket'); }

  if (r.date && blank(job.start_date)) { patch.start_date = r.date; filled.push('date'); }
  else if (r.date && job.start_date && job.start_date !== r.date) differs.push(`The sheet says ${dayLabel(r.date)}; the job says ${dayLabel(job.start_date)}.`);
  if (r.time && blank(job.start_time)) { patch.start_time = r.time; filled.push('start time'); }
  else if (r.time && job.start_time && job.start_time.slice(0, 5) !== r.time) differs.push(`The sheet says ${timeLabel(r.time)}; the job says ${timeLabel(job.start_time.slice(0, 5))}.`);
  const end = r.endDate ?? (blank(job.start_date) ? r.date : null);
  if (end && blank(job.end_date)) {
    patch.end_date = end;
    if (!patch.start_date) filled.push('end date');
  }

  const place: [keyof ScheduleJob, string][] = [['site_address', r.address], ['site_city', r.city], ['site_state', r.state], ['site_zip', r.zip]];
  let placed = false;
  for (const [k, v] of place) {
    if (v && blank(job[k] as string | null)) { (patch as Record<string, string>)[k] = v; placed = true; }
  }
  if (placed) filled.push('address');

  const access = accessText(r);
  if (access && blank(job.access_instructions)) { patch.access_instructions = access; filled.push('lockbox'); }
  else if (r.lockboxCode && job.access_instructions && !job.access_instructions.includes(r.lockboxCode)) {
    differs.push("The sheet's lockbox code isn't in the job's Access note.");
  }

  if (r.checkout && blank(job.checkout_link)) { patch.checkout_link = r.checkout; filled.push('checkout form'); }
  if (r.checkin && blank(job.checkin_link)) { patch.checkin_link = r.checkin; filled.push('check-in link'); }

  // The folder and floor plan join the job's client links; a link it already
  // has (or has as its check-in or checkout link) isn't added twice.
  const have = parseClientLinks([...(job.client_links ?? []), job.checkout_link ?? '', job.checkin_link ?? '', patch.checkout_link ?? '', patch.checkin_link ?? ''].join('\n'));
  // A job keeps ten client links; one that won't fit is said, not promised.
  const room = CLIENT_LINKS_MAX - (job.client_links ?? []).length;
  const add: string[] = [];
  for (const [link, label] of [[r.deliverables, 'deliverables folder'], [r.floorplan, 'floor plan']] as const) {
    if (!link || have.includes(link) || add.includes(link)) continue;
    if (add.length < room) { add.push(link); filled.push(label); }
    else differs.push(`No room for the ${label}: the job already has ${CLIENT_LINKS_MAX} client links.`);
  }
  if (add.length) patch.client_links = [...(job.client_links ?? []), ...add];

  return { patch, filled, differs };
}

/** What the Import screen shows for a row before anything changes. */
export type SchedulePreviewRow = {
  line: number;
  siteId: string;
  ticket: string;
  date: string | null;
  time: string | null;
  cancelled: boolean;
  job: { id: string; wo_number: string; title: string | null } | null;
  filled: string[];
  differs: string[];
};

const titleCase = (s: string) => (s === s.toUpperCase() ? s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : s);

/**
 * A new job for a row no job matches, named like the client's other jobs in the
 * same sheet ("Site survey 5007927 — Dover, NJ" → "Site survey 5141133 — …"),
 * with their customer. `like` is one of those jobs, when the sheet matched any.
 */
export function newScheduleJob(
  r: ScheduleRow,
  like: Pick<ScheduleJob, 'title' | 'client_reference' | 'external_wo_id' | 'customer_name' | 'source_platform'> | null,
) {
  const at = like?.title && like.client_reference ? like.title.indexOf(like.client_reference) : -1;
  let lead = at > 0 ? like!.title!.slice(0, at) : 'Site ';
  // "LDS-1110-5011876-…": the other job's ticket in the name becomes this row's.
  if (like?.external_wo_id && lead.includes(like.external_wo_id)) lead = lead.replace(like.external_wo_id, r.ticket || 'Site');
  const where = [titleCase(r.city), r.state.toUpperCase()].filter(Boolean).join(', ');
  return {
    title: `${lead}${r.siteId}${where ? ` — ${where}` : ''}`.slice(0, 200),
    description: '',
    customer_name: like?.customer_name ?? '',
    source_platform: like?.source_platform ?? undefined,
    client_reference: r.siteId,
    external_wo_id: r.ticket,
    start_date: r.date,
    start_time: r.time,
    end_date: r.endDate ?? r.date,
    site_address: r.address || null,
    city: r.city ? titleCase(r.city) : undefined,
    state: r.state ? r.state.toUpperCase() : undefined,
    zip: r.zip || undefined,
    access_instructions: accessText(r) || null,
    client_links: [r.deliverables, r.floorplan].filter(Boolean),
    checkin_link: r.checkin || null,
    checkout_link: r.checkout || null,
  };
}
