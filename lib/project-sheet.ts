// The live project sheet (Fred, 2026-10-14: "I want them to get a notification
// like a smartsheet ... of the site information and the tech with the time
// stamp plus expenses or photos, notes" ... "Smartsheet is better cause we can
// create it from scratch"). Migration 120.
//
// It reads like Fred described it, one line per thing that happened, new lines
// at the bottom:
//   Mike · 6:47 AM · Started traveling · from 123 Main St, Orange, NJ · #4454 – Orange, NJ
//   Mike · 7:50 AM · Arrived on site   · at 45 Grove St, Orange, NJ  · #4454 – Orange, NJ
//   Mike · 7:58 AM · Took a photo: Inventory · [the picture]
// The job number decides the page (Fred, 2026-10-14: "same site same page, so
// it will be decided by job number" ... "if there are two people on the job
// 4454 and Alex uploaded the pic or his time arrival under that site, the next
// line with whatever he uploads"): one page per site, everyone on it line by
// line with their name, kept until the site is closed. Coming back another day
// carries on on the same page.
// With each site's notes, answers and checklist. The same lines make the live
// page (/sheet/<token>, no login), the Excel download and every alert email.
//
// Never a job price or tech pay. A receipt's amount is the receipt. A tech's
// home shows as the town only.
// Pure and unit-tested (lib/project-sheet.test.ts).
import { buildDayLogs, dayOf, parseDayEvents, totalsOf, hoursOf, type DayEvent } from './project-day';
import { listFor, parseCloseout, skipReason, type CloseoutList } from './closeout';
import { townOf } from './places';
import { toCSV } from './csv';

type Raw = Record<string, unknown>;
const str = (v: unknown): string => (v == null ? '' : String(v).trim());

export type SheetJob = {
  id: string; wo_number: string; external_wo_id?: string | null; title?: string | null; description?: string | null;
  site_name?: string | null; site_address?: string | null; site_city?: string | null; site_state?: string | null; site_zip?: string | null;
  closeout_notes?: string | null; custom_qa?: unknown; closeout?: unknown; wo_status?: string | null;
  lead_contractor_name?: string | null; contractor_name?: string | null; contractor_names?: string[] | null;
};

export type SheetInput = {
  project: string;
  jobs: SheetJob[];
  /** job_day_events and job_punches rows: id, wo_id, contractor_name, kind, at, origin, dest, miles, place. */
  taps: Raw[];
  photos: { id: string; wo_id: string; contractor_name?: string | null; url: string; taken_at: string; label?: string | null }[];
  /** Declined receipts are left out before they get here. */
  expenses: {
    id: string; wo_id: string; contractor_name?: string | null; category?: string | null; vendor?: string | null;
    amount: number | string; expense_date?: string | null; note?: string | null; receipt_path?: string | null;
    created_at: string; paid_by?: string | null;
  }[];
  lists: CloseoutList[];
};

export type RowKind = 'clock' | 'drive' | 'arrive' | 'start' | 'lunch' | 'back' | 'off' | 'signout' | 'photo' | 'receipt' | 'signoff';

export type SheetRow = {
  id: string; at: string; day: string; time: string;
  tech: string; kind: RowKind; activity: string;
  /** "From 123 Main St, Orange, NJ" / "At 45 Grove St, Orange, NJ". */
  where: string;
  /** "#4454 – Orange, NJ". */
  site: string; siteId: string; wo: string;
  details: string; miles: number | null; photo: string | null; amount: number | null;
  /** The receipt picture, opened through /sheet/<token>/receipt/<id>. */
  receiptId: string | null;
};

export type SheetSite = {
  id: string; name: string; wo: string; clientWo: string; address: string;
  /** The office's status word, and whether the site is closed (Work Done or later). */
  status: string; closed: boolean;
  /** The techs with lines on this site, in the order they first showed up. */
  techs: string[];
  /** Everyone assigned to the work order, for "who is it for". */
  crew: string[];
  /** This site's own totals. */
  onSiteHours: number; miles: number; photos: number; receiptTotal: number;
  /** The newest line's time, to put the busiest site first. */
  lastAt: string;
  notes: string; answers: { q: string; a: string }[];
  checklist: { name: string; done: number; total: number; cant: [string, string][]; sign: string };
};

export type SheetSummary = {
  sites: number; techs: number; days: number; onSiteHours: number; travelHours: number; miles: number;
  photos: number; receipts: number; receiptTotal: number;
};

export type Sheet = {
  project: string;
  /** Oldest first: new lines go at the bottom. */
  rows: SheetRow[];
  sites: SheetSite[];
  summary: SheetSummary;
  /** Newest first, for the day filter. */
  days: string[];
  techs: string[];
};

const CATEGORY: Record<string, string> = {
  materials: 'Parts & materials', fuel: 'Fuel', tolls_parking: 'Tolls & parking', equipment: 'Equipment',
  meals: 'Meal', hotel: 'Hotel', other: 'Other',
};
const HEADING: Record<string, string> = { site: 'the site', hotel: 'the hotel', home: 'home', next_site: 'the next site' };

export const dur = (ms: number): string => {
  const m = Math.round(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
};

const nameOf = (j: SheetJob) => str(j.site_name) || str(j.title) || 'Site';
const addressOf = (j: SheetJob) => {
  const cityLine = [str(j.site_city), [str(j.site_state), str(j.site_zip)].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [str(j.site_address), cityLine].filter(Boolean).join(', ');
};
/** "#4454 – Orange, NJ": the site and its town. */
export const siteLabel = (j: SheetJob): string => {
  const town = [str(j.site_city), str(j.site_state)].filter(Boolean).join(', ');
  const name = nameOf(j);
  return town && !name.toLowerCase().includes(str(j.site_city).toLowerCase()) ? `${name} – ${town}` : name;
};

/** The office statuses that mean the site is closed. */
const CLOSED = ['Work Done', 'Approved', 'Paid', 'Closed', 'Completed'];

/** "Start job" sends arrived + started together; they show as one line. */
const SAME_MOMENT_MS = 2 * 60 * 1000;

export function buildSheet(i: SheetInput, now: Date = new Date(), timeZone = 'America/New_York'): Sheet {
  const time = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone });
  const rows: SheetRow[] = [];
  const allLogs: ReturnType<typeof buildDayLogs> = [];
  const jobTotals = new Map<string, ReturnType<typeof totalsOf>>();

  for (const j of i.jobs) {
    const base = { site: siteLabel(j), siteId: j.id, wo: str(j.wo_number) };
    const siteAt = addressOf(j) ? `At ${addressOf(j)}` : `At ${nameOf(j)}`;
    const events: DayEvent[] = parseDayEvents(i.taps.filter((t) => t.wo_id === j.id));
    const logs = buildDayLogs(events, now, timeZone);
    allLogs.push(...logs);
    jobTotals.set(j.id, totalsOf(logs));
    const spans = logs.flatMap((d) => d.spans);
    const row = (e: DayEvent, n: number, kind: RowKind, activity: string, where: string, details = '', miles: number | null = null): SheetRow => ({
      id: `${j.id}:${e.kind}:${e.tech ?? ''}:${e.at}:${n}`, at: e.at, day: dayOf(e.at, timeZone), time: time(e.at),
      tech: e.tech ?? '', kind, activity, where, ...base, details, miles, photo: null, amount: null, receiptId: null,
    });
    // Where a tech was, from the phone; their home is the town only.
    const gps = (e: DayEvent, home: boolean) => (e.place ? (home ? `Home · ${townOf(e.place)}` : e.place) : '');

    const skip = new Set<number>();
    events.forEach((e, n) => {
      if (skip.has(n)) return;
      switch (e.kind) {
        // Clocking in is often at home, so the town only, always.
        case 'day_start': rows.push(row(e, n, 'clock', 'Clocked in', e.place ? `In ${townOf(e.place)}` : '')); break;
        case 'travel_start': {
          const from = e.origin === 'site' ? addressOf(j) || nameOf(j)
            : gps(e, e.origin === 'home') || (e.origin === 'home' ? 'Home' : e.origin === 'hotel' ? 'The hotel' : '');
          rows.push(row(e, n, 'drive', 'Started traveling', from ? `From ${from}` : '', `Heading to ${HEADING[e.dest ?? 'site']}`));
          break;
        }
        case 'travel_end': {
          const miles = e.miles ?? null;
          // The arrival is stored without where to; that's on the trip's start.
          const dest = e.dest ?? [...events.slice(0, n)].reverse().find((x) => x.tech === e.tech && x.kind === 'travel_start')?.dest ?? 'site';
          if (dest === 'hotel' || dest === 'home') {
            const at = gps(e, dest === 'home') || (dest === 'home' ? 'home' : 'the hotel');
            rows.push(row(e, n, 'signout', `Arrived at ${dest === 'hotel' ? 'the hotel' : 'home'} · signed out`, `At ${at}`, '', miles));
            break;
          }
          const k = events.findIndex((x, m) => m > n && x.tech === e.tech && x.kind === 'in' && Date.parse(x.at) - Date.parse(e.at) <= SAME_MOMENT_MS);
          if (k >= 0) skip.add(k);
          const word = dest === 'next_site' ? 'Arrived at the next site' : 'Arrived on site';
          rows.push(row(e, n, k >= 0 ? 'start' : 'arrive', k >= 0 ? `${word} · started the job` : word, siteAt, '', miles));
          break;
        }
        case 'in': rows.push(row(e, n, 'start', 'Started the job', siteAt)); break;
        case 'lunch_start': rows.push(row(e, n, 'lunch', 'Lunch', siteAt)); break;
        case 'lunch_end': rows.push(row(e, n, 'back', 'Back from lunch', siteAt)); break;
        case 'out': {
          const s = spans.find((x) => x.out === e.at && x.tech === (e.tech ?? ''));
          rows.push(row(e, n, 'off', 'Left the site', siteAt, s ? `On site ${dur(s.ms)}${s.lunchMs ? ` (lunch ${dur(s.lunchMs)})` : ''}` : ''));
          break;
        }
      }
    });

    // Every photo is its own line, with what the app asked the tech it was.
    for (const p of i.photos) {
      if (p.wo_id !== j.id || !/^https:\/\//.test(str(p.url)) || !Number.isFinite(Date.parse(p.taken_at))) continue;
      const label = str(p.label);
      rows.push({
        id: `${j.id}:photo:${p.id}`, at: p.taken_at, day: dayOf(p.taken_at, timeZone), time: time(p.taken_at),
        tech: str(p.contractor_name), kind: 'photo', activity: label ? `Took a photo: ${label}` : 'Took a photo',
        where: siteAt, ...base, details: '', miles: null, photo: p.url, amount: null, receiptId: null,
      });
    }

    // Receipts.
    for (const x of i.expenses) {
      if (x.wo_id !== j.id) continue;
      const amount = Number(x.amount);
      const made = Number.isFinite(Date.parse(x.created_at)) ? x.created_at : now.toISOString();
      const day = /^\d{4}-\d{2}-\d{2}$/.test(str(x.expense_date)) ? str(x.expense_date) : dayOf(made, timeZone);
      const sameDay = dayOf(made, timeZone) === day;
      rows.push({
        id: `${j.id}:receipt:${x.id}`, at: sameDay ? made : `${day}T23:59:00Z`, day, time: sameDay ? time(made) : '',
        tech: x.paid_by === 'faj' ? 'FAJ office' : str(x.contractor_name), kind: 'receipt',
        activity: `Added a receipt: ${CATEGORY[str(x.category)] ?? 'Other'}`, where: '', ...base,
        details: [str(x.vendor), str(x.note)].filter(Boolean).join(' · '),
        miles: null, photo: null, amount: Number.isFinite(amount) ? amount : null,
        receiptId: str(x.receipt_path) ? x.id : null,
      });
    }

    // The customer's sign-off, or why there isn't one.
    const c = parseCloseout(j.closeout);
    const done = c.signoff && Number.isFinite(Date.parse(c.signoff.signedAt))
      ? { at: c.signoff.signedAt, activity: 'Customer signed off', details: c.signoff.name }
      : c.signSkip && Number.isFinite(Date.parse(c.signSkip.at))
        ? { at: c.signSkip.at, activity: 'No customer signature', details: c.signSkip.reason } : null;
    if (done) {
      rows.push({
        id: `${j.id}:signoff`, at: done.at, day: dayOf(done.at, timeZone), time: time(done.at), tech: '', kind: 'signoff',
        activity: done.activity, where: siteAt, ...base, details: done.details, miles: null, photo: null, amount: null, receiptId: null,
      });
    }
  }

  rows.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));

  const sites: SheetSite[] = i.jobs.map((j) => {
    const c = parseCloseout(j.closeout);
    const list = listFor(i.lists, str(j.title), str(j.description));
    const answers = Array.isArray(j.custom_qa)
      ? (j.custom_qa as Raw[]).filter((q) => q && typeof q === 'object' && str(q.label) && str(q.answer) && str(q.type) !== 'signature')
        .map((q) => ({ q: str(q.label), a: /^https?:\/\//.test(str(q.answer)) ? 'Attached in the app' : str(q.answer) }))
      : [];
    const status = str(j.wo_status);
    const mine = rows.filter((r) => r.siteId === j.id);
    const jt = jobTotals.get(j.id);
    return {
      id: j.id, name: siteLabel(j), wo: str(j.wo_number), clientWo: str(j.external_wo_id), address: addressOf(j),
      status, closed: CLOSED.includes(status),
      techs: [...new Set(mine.filter((r) => r.tech && r.tech !== 'FAJ office').map((r) => r.tech))],
      crew: [...new Set([j.lead_contractor_name, j.contractor_name, ...(j.contractor_names ?? [])].map((n) => str(n)).filter(Boolean))],
      onSiteHours: jt ? hoursOf(jt.onSiteMs) : 0, miles: jt?.miles ?? 0,
      photos: mine.filter((r) => r.kind === 'photo').length,
      receiptTotal: Math.round(mine.reduce((sum, r) => sum + (r.kind === 'receipt' ? r.amount ?? 0 : 0), 0) * 100) / 100,
      lastAt: mine.length ? mine[mine.length - 1].at : '',
      notes: str(j.closeout_notes), answers,
      checklist: {
        name: list.name, done: list.items.filter((x) => c.done.includes(x)).length, total: list.items.length,
        cant: list.items.filter((x) => skipReason(c, x)).map((x) => [x, skipReason(c, x)] as [string, string]),
        sign: c.signoff ? `Signed off by ${c.signoff.name}` : c.signSkip ? `No signature: ${c.signSkip.reason}` : 'Not signed off yet',
      },
    };
  });

  const t = totalsOf(allLogs);
  const receipts = rows.filter((r) => r.kind === 'receipt');
  const techs = [...new Set(rows.map((r) => r.tech).filter((x) => x && x !== 'FAJ office'))].sort();
  return {
    project: i.project, rows, sites,
    summary: {
      sites: i.jobs.length, techs: techs.length, days: t.days,
      onSiteHours: hoursOf(t.onSiteMs), travelHours: hoursOf(t.travelMs), miles: t.miles,
      photos: rows.filter((r) => r.kind === 'photo').length,
      receipts: receipts.length, receiptTotal: Math.round(receipts.reduce((s, r) => s + (r.amount ?? 0), 0) * 100) / 100,
    },
    days: [...new Set(rows.map((r) => r.day))].sort().reverse(),
    techs,
  };
}

/**
 * One page: every line on a site, everyone together. With a tech: just theirs,
 * plus the site's own lines (the customer's sign-off).
 */
export function pageRows(s: Sheet, siteId: string, tech: string | null): SheetRow[] {
  return s.rows.filter((r) => r.siteId === siteId && (!tech || r.tech === tech || (r.tech === '' && r.kind === 'signoff')));
}

export const fmtSheetDay = (day: string): string =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export const money2 = (n: number): string => `$${n.toFixed(2)}`;

/** Miles, amount and details in one short line. */
export const rowExtra = (r: SheetRow): string =>
  [r.details, r.miles != null ? `${r.miles} mi` : '', r.amount != null ? money2(r.amount) : ''].filter(Boolean).join(' · ');

/** The Excel download: a page's lines (or the whole project's), in the same order. */
export function sheetCsv(rows: SheetRow[], receiptLink: (id: string) => string): string {
  const head = ['Date', 'Time', 'Technician', 'Activity', 'Location', 'Site', 'WO', 'Miles', 'Amount', 'Details', 'Photo', 'Receipt'];
  const body = rows.map((r) => [
    r.day, r.time, r.tech, r.activity, r.where, r.site, r.wo,
    r.miles ?? '', r.amount != null ? r.amount.toFixed(2) : '', r.details, r.photo ?? '', r.receiptId ? receiptLink(r.receiptId) : '',
  ]);
  return toCSV([head, ...body]);
}

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The alert email: what just happened, then the latest lines on that site's
 * page (everyone on the site, newest at the bottom, like the sheet), then the
 * live sheet button. Everyone on the list gets the sheet link (no login); only
 * the office gets "Open the job".
 */
export function sheetEmailHtml(s: Sheet, o: {
  title: string; where: string; lines: string[]; siteId: string | null;
  sheetLink: string | null; appLink: string | null; receiptLink: (id: string) => string;
}): string {
  const site = s.sites.find((x) => x.id === o.siteId) ?? null;
  const page = site ? pageRows(s, site.id, null) : [];
  const shown = page.slice(-25);
  const heading = site ? `${site.name} · WO ${site.wo}${site.closed ? ' · Site closed' : ''}` : 'The project';
  const cell = 'padding:6px 8px;border-bottom:1px solid #ECE8DF;text-align:left;vertical-align:top;font-size:13px';
  const th = 'padding:6px 8px;text-align:left;font-size:11px;letter-spacing:.5px;text-transform:uppercase;color:#5E6470;background:#F6F4EF';
  const grid = shown.length === 0 ? '<p style="color:#5E6470;font-size:13px">Nothing recorded on this page yet.</p>' : `
  ${page.length > shown.length ? `<p style="font-size:12px;color:#5E6470;margin:4px 0">${page.length - shown.length} earlier lines are on the live sheet.</p>` : ''}
  <table style="border-collapse:collapse;width:100%;margin-top:6px">
    <tr><th style="${th}">Time</th><th style="${th}">Tech</th><th style="${th}">What</th></tr>
    ${shown.map((r, n) => {
      const extra = rowExtra(r);
      const sub = r.where;
      const dayRow = n === 0 || shown[n - 1].day !== r.day
        ? `<tr><td colspan="3" style="padding:8px 8px 4px;font-size:12px;font-weight:700;color:#0E1B2E;background:#FBF8F1">${esc(fmtSheetDay(r.day))}</td></tr>` : '';
      const pic = r.photo ? `<br><a href="${esc(r.photo)}"><img src="${esc(r.photo)}" alt="Photo" width="120" style="width:120px;height:90px;object-fit:cover;border-radius:6px;margin-top:4px;border:1px solid #E4DFD3"></a>` : '';
      const receipt = r.receiptId ? ` · <a href="${esc(o.receiptLink(r.receiptId))}">Receipt</a>` : '';
      return `${dayRow}<tr><td style="${cell};white-space:nowrap;color:#5E6470">${esc(r.time)}</td><td style="${cell}">${esc(r.tech)}</td>
        <td style="${cell}"><b>${esc(r.activity)}</b>${sub ? `<br><span style="color:#5E6470">${esc(sub)}</span>` : ''}${extra ? `<br><span style="color:#5E6470">${esc(extra)}</span>` : ''}${receipt}${pic}</td></tr>`;
    }).join('')}
  </table>`;
  const lines = o.lines.map((l) => `<p style="margin:4px 0;white-space:pre-wrap">${esc(l)}</p>`).join('');
  const btn = (href: string, label: string, dark: boolean) =>
    `<a href="${esc(href)}" style="display:inline-block;margin:0 8px 8px 0;background:${dark ? '#0E1B2E' : '#fff'};color:${dark ? '#fff' : '#0E1B2E'};border:1px solid #0E1B2E;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600">${label}</a>`;
  return `<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#1B1C1F">
  <div style="background:#0E1B2E;color:#fff;padding:14px 16px;border-radius:10px 10px 0 0">
    <div style="font-size:11px;letter-spacing:1px;color:#E3C987;font-weight:700;text-transform:uppercase">${esc(s.project)} · Live project sheet</div>
    <div style="font-size:18px;font-weight:700;margin-top:4px">${esc(o.title)}</div>
    <div style="font-size:12px;opacity:.85;margin-top:2px">${esc(o.where)}</div>
  </div>
  <div style="border:1px solid #E4DFD3;border-top:none;border-radius:0 0 10px 10px;padding:12px 16px 16px">
    ${lines}
    <div style="margin:12px 0 4px;font-size:14px;font-weight:700;color:#0E1B2E;border-bottom:2px solid #C9A24B;padding-bottom:4px">${esc(heading)}</div>
    ${grid}
    <p style="margin-top:16px">${o.sheetLink ? btn(o.sheetLink, 'Open the live sheet', true) : ''}${o.appLink ? btn(o.appLink, 'Open the job', false) : ''}</p>
    <p style="margin-top:10px;font-size:11px;color:#9AA0AA">FAJ Solutions · Bringing People and Technology Together. The live sheet needs no login and adds a line every time a technician updates the job. Times, places and miles come from the technician's phone.</p>
  </div>
</div>`;
}

// ── Messages on the sheet (migration 121) ────────────────────────────────────
// Fred, 2026-10-14: the client adds notes under a photo and asks the tech a
// question; the tech messages the PM ("No access to the building", with why);
// the clock runs "without access" until the tech says they're in. Only
// messages meant for the sheet (on_sheet) ever get here: a tech's messages to
// FAJ stay private.

export type SheetMessageKind = 'message' | 'question' | 'answer' | 'note' | 'issue' | 'resolved';
export type SheetMessage = {
  id: string; wo: string; at: string; from: string;
  /** client = someone on the sheet (the PM or the client); tech; office. */
  role: 'client' | 'tech' | 'office';
  kind: SheetMessageKind; to: string; body: string; reason: string;
  rowRef: string; parentId: string; resolvedAt: string;
};

const MESSAGE_KINDS: SheetMessageKind[] = ['message', 'question', 'answer', 'note', 'issue', 'resolved'];

/** work_order_messages rows → clean sheet messages, oldest first. */
export function parseSheetMessages(raw: unknown): SheetMessage[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Raw[])
    .filter((r) => r && typeof r === 'object' && str(r.id) && Number.isFinite(Date.parse(str(r.created_at))))
    .map((r) => {
      const kind = str(r.kind) as SheetMessageKind;
      const role = str(r.sender_role);
      return {
        id: str(r.id), wo: str(r.work_order_id), at: str(r.created_at), from: str(r.sender_name) || 'Someone',
        role: role === 'contractor' ? 'tech' as const : role === 'client' ? 'client' as const : 'office' as const,
        kind: MESSAGE_KINDS.includes(kind) ? kind : 'message', to: str(r.to_name), body: str(r.content), reason: str(r.reason),
        rowRef: str(r.row_ref), parentId: str(r.parent_id), resolvedAt: str(r.resolved_at),
      };
    })
    .sort((a, b) => a.at.localeCompare(b.at));
}

/** Minutes without access: from the tech saying so until they got in (or now). */
export function waitMinutes(issue: Pick<SheetMessage, 'at' | 'resolvedAt'>, now: Date = new Date()): number {
  const end = issue.resolvedAt && Number.isFinite(Date.parse(issue.resolvedAt)) ? Date.parse(issue.resolvedAt) : now.getTime();
  return Math.max(0, Math.round((end - Date.parse(issue.at)) / 60000));
}

/** What a message line says: "No access to the building", "Asked a question"... */
export function messageTitle(m: SheetMessage, all: SheetMessage[] = []): string {
  const to = m.to && m.to !== 'FAJ' ? ` · to ${m.to}` : m.to === 'FAJ' ? ' · to FAJ' : '';
  switch (m.kind) {
    case 'issue': return `${m.body || 'No access to the building'}${to}`;
    case 'resolved': {
      const issue = all.find((x) => x.id === m.parentId);
      return issue ? `Has access now · waited ${waitMinutes({ at: issue.at, resolvedAt: m.at })} min without access` : 'Has access now';
    }
    case 'question': return `Asked a question${to}`;
    case 'note': return `Added a note${to}`;
    case 'answer': return `Answered${to}`;
    default: return `Message${to}`;
  }
}

/** Issues still waiting (no access yet), on a site. */
export const openIssues = (all: SheetMessage[], wo: string): SheetMessage[] =>
  all.filter((m) => m.wo === wo && m.kind === 'issue' && !m.resolvedAt);
