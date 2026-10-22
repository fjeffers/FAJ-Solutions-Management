// The weekly bill for each site (Fred, 2026-10-18: on jobs where the client
// has their own portal, "my job is to basically make sure that the hours,
// mileage, receipts and everything like that is being stored in one place
// where I could download it on my end and basically upload it back to the
// customers in a JPEG form or some type of spreadsheet form").
//
// One bill per site, kept apart (Fred, 2026-10-18: "make sure they two site
// are separated"): each day each tech left home or the hotel, got to the site,
// left it and got back; the hours on site and on the road; every drive with
// its GPS miles and its odometer miles; the receipts. Then the problems worth
// a look before it goes to the client: odometer and GPS far apart, a missing
// odometer photo, a typed number that isn't what the photo shows, a receipt
// with no photo, more fuel than the miles explain, a day nobody tapped Off site.
//
// Only what the job asks for (lib/capture.ts). Never a price or tech pay.
// Pure and unit-tested (lib/weekly-bill.test.ts). The screen is ProjectReport
// (components/wf/ProjectOffice.tsx); the AI summary reads these numbers.
import { asks, type CaptureItem } from './capture';
import { expenseCategoryLabel, totalsByCategory } from './expenses';
import { hoursOf, legLabel, type DayLog, type Leg, type Origin } from './project-day';
import { amountDiffers, odometerDiffers } from './photo-read';
import { ACTIVITY_LABEL, activityOf } from './checkin';

export type OdoRow = {
  id?: string; wo_id: string; contractor_name: string; at: string;
  /** Taken at the start of the drive (Check in) or at its end (after arriving). */
  moment?: 'start' | 'end' | null;
  reading: number; ai_reading: number | null; photo_path: string | null;
};
export type BillReceipt = {
  id: string; wo_id: string; contractor_name?: string | null; category: string; vendor: string | null; amount: number; expense_date: string;
  note: string | null; receipt_path: string | null; gallons?: number | null; ai?: unknown;
};
export type BillLeg = Leg & { odoStart: OdoRow | null; odoEnd: OdoRow | null; odoMiles: number | null };
export type BillDay = {
  day: string; tech: string;
  /** Left home or the hotel (the day's first drive), and from where. */
  left: string | null; from: Origin | null;
  arrived: string | null; leftSite: string | null;
  /** Got back to the hotel or home (signs out for the day). */
  back: string | null;
  onSiteHours: number; travelHours: number; gpsMiles: number; odoMiles: number | null; receipts: number;
};
export type BillFlag = { kind: 'odo_gps' | 'odo_missing' | 'odo_photo' | 'odo_typed' | 'odo_backwards' | 'odo_far' | 'receipt_typed' | 'receipt_photo' | 'fuel' | 'open'; text: string };
export type SiteBill = {
  woId: string;
  shows: { travel: boolean; odometer: boolean; receipts: boolean; lunch: boolean };
  days: BillDay[];
  legs: BillLeg[];
  receipts: BillReceipt[];
  totals: {
    days: number; onSiteHours: number; travelHours: number; gpsMiles: number; odoMiles: number | null;
    receipts: number; gallons: number; byCategory: { key: string; label: string; sum: number }[];
  };
  flags: BillFlag[];
};

const MIN = 60_000;
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
export const billDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const miles = (n: number) => `${n.toLocaleString('en-US', { maximumFractionDigits: 1 })} mi`;

/**
 * The odometer readings a site's bill may use: every reading on the job, not
 * only those dated inside the report's dates. A drive that starts on the last
 * evening and ends after midnight keeps its end reading this way; matchOdometer
 * only attaches readings close to a drive that is on the bill.
 */
export const billReadings = (all: OdoRow[], woId: string): OdoRow[] => all.filter((o) => o.wo_id === woId);

/**
 * Each drive's odometer readings: the start photo, taken at Check in once the
 * drive is recorded, and the end photo, taken just after arriving
 * (components/wf/Odometer.tsx), by the same tech. A reading only goes with its
 * own end of a drive, and never reaches past the tech's drive before or after,
 * so a skipped photo leaves a gap instead of moving the next drive's readings.
 */
export function matchOdometer(legs: Leg[], readings: OdoRow[]): BillLeg[] {
  const used = new Set<OdoRow>();
  const pick = (tech: string, moment: 'start' | 'end', target: number, from: number, to: number) => {
    const hit = readings
      .filter((o) => !used.has(o) && o.contractor_name === tech && (o.moment ?? moment) === moment)
      .filter((o) => { const at = Date.parse(o.at); return at >= from && at <= to; })
      .sort((a, b) => Math.abs(Date.parse(a.at) - target) - Math.abs(Date.parse(b.at) - target))[0] ?? null;
    if (hit) used.add(hit);
    return hit;
  };
  const sorted = [...legs].sort((a, b) => a.start.localeCompare(b.start));
  return sorted.map((l, i) => {
    const start = Date.parse(l.start);
    const end = l.end ? Date.parse(l.end) : null;
    const prev = sorted.slice(0, i).filter((x) => x.tech === l.tech).at(-1);
    const next = sorted.slice(i + 1).find((x) => x.tech === l.tech);
    const after = prev ? Date.parse(prev.end ?? prev.start) : -Infinity;
    const before = next ? Date.parse(next.start) : Infinity;
    const odoStart = pick(l.tech, 'start', start, Math.max(start - 20 * MIN, after), Math.min(end ?? start + 45 * MIN, before));
    const odoEnd = end == null ? null
      : pick(l.tech, 'end', end, Math.max(end - 20 * MIN, start, odoStart ? Date.parse(odoStart.at) + 1 : -Infinity), Math.min(end + 45 * MIN, before));
    const odoMiles = odoStart && odoEnd ? r1(odoEnd.reading - odoStart.reading) : null;
    return { ...l, odoStart, odoEnd, odoMiles };
  });
}

/** The most a car covers in a time: 90 mph, with 5 miles to spare. */
const reachMiles = (ms: number) => 5 + (Math.max(0, ms) / 3_600_000) * 90;

export type OdoProblem = { kind: 'backwards' | 'far' | 'jump'; text: string };

/**
 * Odometer readings on a drive that can't be right (Fred's test, 2026-10-18:
 * 1,234,555 typed two minutes after 122,552): lower at the end, more miles
 * than the drive's time allows, or a start that doesn't follow on from the
 * tech's last end reading. Keyed by the drive.
 */
export function odoProblems(legs: BillLeg[]): Map<BillLeg, OdoProblem[]> {
  const out = new Map<BillLeg, OdoProblem[]>();
  const add = (l: BillLeg, p: OdoProblem) => out.set(l, [...(out.get(l) ?? []), p]);
  const n = (x: number) => x.toLocaleString('en-US');
  const sorted = [...legs].sort((a, b) => a.start.localeCompare(b.start));
  sorted.forEach((l, i) => {
    if (l.odoMiles != null && l.odoMiles < 0) {
      add(l, { kind: 'backwards', text: 'The odometer reads lower at the end.' });
    } else if (l.odoMiles != null && l.end && l.odoMiles > reachMiles(l.ms)) {
      add(l, { kind: 'far', text: `${n(l.odoMiles)} mi is more than this drive could cover. A reading is probably mistyped.` });
    }
    const prev = sorted.slice(0, i).filter((x) => x.tech === l.tech).at(-1);
    if (prev?.odoEnd && l.odoStart) {
      const gap = l.odoStart.reading - prev.odoEnd.reading;
      if (gap < -1 || gap > reachMiles(Date.parse(l.odoStart.at) - Date.parse(prev.odoEnd.at))) {
        add(l, { kind: 'jump', text: `Starts at ${n(l.odoStart.reading)}, but the drive before ended at ${n(prev.odoEnd.reading)}.` });
      }
    }
  });
  return out;
}

export function siteBill(input: {
  woId: string; capture: readonly CaptureItem[] | null; logs: DayLog[]; readings: OdoRow[]; receipts: BillReceipt[];
  /** Today (YYYY-MM-DD, New York): a day before it with no Off site is flagged. */
  today: string;
}): SiteBill {
  const { woId, capture, logs, receipts, today } = input;
  const shows = {
    travel: asks(capture, 'travel') || logs.some((d) => d.legs.length > 0),
    odometer: asks(capture, 'odometer') && (capture !== null || input.readings.length > 0),
    receipts: asks(capture, 'receipts') || receipts.length > 0,
    lunch: asks(capture, 'lunch'),
  };
  const legs = matchOdometer(logs.flatMap((d) => d.legs), input.readings);
  const flags: BillFlag[] = [];
  // Each receipt on one line: its tech's that day, or the day's first line.
  const lineOf = (r: BillReceipt) => {
    const that = logs.filter((d) => d.day === r.expense_date);
    return that.find((d) => d.tech === r.contractor_name) ?? that[0];
  };

  const days: BillDay[] = logs.map((d) => {
    const mine = legs.filter((l) => l.tech === d.tech && l.day === d.day);
    const first = mine[0];
    const spans = [...d.spans].sort((a, b) => a.in.localeCompare(b.in));
    const counted = mine.filter((l) => l.odoMiles != null && l.odoMiles >= 0);
    const odoMiles = counted.length ? r1(counted.reduce((t, l) => t + (l.odoMiles ?? 0), 0)) : null;
    const gps = r1(d.miles);
    const who = d.tech || 'The tech';
    if (shows.odometer && odoMiles != null) {
      // The same drives both ways. Far apart: more than 5 miles and more than a fifth of the larger.
      const gpsSame = r1(counted.reduce((t, l) => t + (l.miles ?? 0), 0));
      const gap = Math.abs(odoMiles - gpsSame);
      if (gpsSame > 0 && gap > 5 && gap > 0.2 * Math.max(odoMiles, gpsSame)) {
        flags.push({ kind: 'odo_gps', text: `${who}, ${billDay(d.day)}: ${miles(odoMiles)} by odometer, ${miles(gpsSame)} by GPS for the same drives.` });
      }
    }
    // A day that's over with no Off site, or a drive with no arrival: not counted, and flagged.
    const over = d.day < today;
    if (over && spans.some((s) => !s.out)) {
      flags.push({ kind: 'open', text: `${who}, ${billDay(d.day)}: no Off site tap, so that time on site isn't counted. Check the hours.` });
    }
    for (const l of mine) {
      if (over && !l.end) flags.push({ kind: 'open', text: `${who}, ${billDay(d.day)}, ${legLabel(l)}: no arrival tap, so that drive isn't counted. Check it.` });
    }
    const onSiteMs = spans.reduce((t, s) => t + (s.out || !over ? s.ms : 0), 0);
    const travelMs = mine.reduce((t, l) => t + (l.end || !over ? l.ms : 0), 0);
    return {
      day: d.day, tech: d.tech,
      left: first && (first.origin === 'home' || first.origin === 'hotel') ? first.start : null,
      from: first && (first.origin === 'home' || first.origin === 'hotel') ? first.origin : null,
      arrived: spans[0]?.in ?? null,
      leftSite: spans.length && spans.at(-1)!.out ? spans.at(-1)!.out : null,
      back: d.signOut,
      onSiteHours: hoursOf(onSiteMs), travelHours: hoursOf(travelMs), gpsMiles: gps, odoMiles,
      receipts: r2(receipts.filter((r) => lineOf(r) === d).reduce((t, r) => t + Number(r.amount), 0)),
    };
  });

  if (shows.odometer) {
    const problems = odoProblems(legs);
    for (const l of legs) {
      const who = l.tech || 'The tech';
      const when = `${who}, ${billDay(l.day)}, ${legLabel(l)}`;
      for (const p of problems.get(l) ?? []) {
        if (p.kind !== 'backwards') flags.push({ kind: 'odo_far', text: `${when}: ${p.text}` });
      }
      // Missing photos count only on a job that asks for them.
      if (capture !== null && (!l.odoStart || (l.end && !l.odoEnd))) {
        const which = !l.odoStart && l.end && !l.odoEnd ? 'start and end' : !l.odoStart ? 'start' : 'end';
        flags.push({ kind: 'odo_missing', text: `${when}: no odometer photo at the ${which}.` });
      }
      if (l.odoMiles != null && l.odoMiles < 0) flags.push({ kind: 'odo_backwards', text: `${when}: the odometer reads lower at the end. Check the photos.` });
      for (const o of [l.odoStart, l.odoEnd]) {
        if (o && odometerDiffers(o.reading, o.ai_reading)) {
          flags.push({ kind: 'odo_typed', text: `${when}: typed ${o.reading.toLocaleString('en-US')}, the photo reads ${o.ai_reading!.toLocaleString('en-US')}.` });
        }
      }
      // A reading typed in with no photo behind it, on a job that asks for the photos.
      if (capture !== null) {
        for (const [o, end] of [[l.odoStart, 'start'], [l.odoEnd, 'end']] as const) {
          if (o && !o.photo_path) {
            flags.push({ kind: 'odo_photo', text: `${when}: the odometer reading at the ${end} (${o.reading.toLocaleString('en-US')}) was saved with no photo.` });
          }
        }
      }
    }
  }

  for (const r of receipts) {
    const what = `${expenseCategoryLabel(r.category)}${r.vendor ? ` at ${r.vendor}` : ''}, ${billDay(r.expense_date)}`;
    const ai = r.ai && typeof r.ai === 'object' ? (r.ai as { amount?: unknown }).amount : null;
    if (typeof ai === 'number' && amountDiffers(Number(r.amount), ai)) {
      flags.push({ kind: 'receipt_typed', text: `${what}: entered as ${money(Number(r.amount))}, the photo reads ${money(ai)}.` });
    }
    if (!r.receipt_path) flags.push({ kind: 'receipt_photo', text: `${what}, ${money(Number(r.amount))}: no photo of the receipt.` });
  }

  const gallons = r1(receipts.reduce((t, r) => t + (r.category === 'fuel' && r.gallons ? Number(r.gallons) : 0), 0));
  const counted = legs.filter((l) => l.odoMiles != null && l.odoMiles >= 0);
  const odoTotal = shows.odometer && counted.length ? r1(counted.reduce((t, l) => t + (l.odoMiles ?? 0), 0)) : null;
  const gpsTotal = r1(logs.reduce((t, d) => t + d.miles, 0));
  const driven = odoTotal ?? gpsTotal;
  // More than a tank (15 gal) beyond what the drives would burn at 8 miles a gallon.
  if (gallons > driven / 8 + 15) {
    flags.push({ kind: 'fuel', text: `${gallons} gal of fuel for ${miles(driven)} of driving to this site: more than the miles explain.` });
  }

  const receiptTotal = r2(receipts.reduce((t, r) => t + Number(r.amount), 0));
  return {
    woId, shows, days, legs, receipts, flags,
    totals: {
      days: new Set(logs.map((d) => d.day)).size,
      onSiteHours: r2(days.reduce((t, d) => t + d.onSiteHours, 0)),
      travelHours: r2(days.reduce((t, d) => t + d.travelHours, 0)),
      gpsMiles: gpsTotal, odoMiles: odoTotal, receipts: receiptTotal, gallons,
      // The office's own categories too (migration 136).
      byCategory: totalsByCategory(receipts),
    },
  };
}

// ── The spreadsheet: one sheet per site, and a totals sheet ────────────────

const TZ = 'America/New_York';
const clock = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ }) : '');
const FROM_WORD: Record<Origin, string> = { home: 'Home', hotel: 'Hotel', site: 'Site', other: 'Elsewhere', fuel: 'Fuel stop', materials: 'Materials pickup' };

export type BillSite = { name: string; wo: string; clientWo?: string | null; address: string; bill: SiteBill };

/**
 * One site's sheet: the header, a line per tech per day, every drive, every
 * receipt and the totals. The Excel goes to the client, so the office-only
 * "To check before sending" list is never in it (it stays on the screen).
 */
export function siteSheetRows(site: BillSite, range: string): (string | number)[][] {
  const { bill } = site;
  const s = bill.shows;
  const rows: (string | number)[][] = [
    [site.name], [`WO ${site.wo}${site.clientWo ? ` · Client # ${site.clientWo}` : ''}`], [site.address], [range], [],
    ['Date', 'Technician',
      ...(s.travel ? ['Left from', 'Left at'] : []), 'Arrived on site', 'Left site', ...(s.travel ? ['Back at'] : []),
      'Hours on site', ...(s.travel ? ['Travel hours', 'GPS miles'] : []), ...(s.odometer ? ['Odometer miles'] : []),
      ...(s.receipts ? ['Receipts'] : [])],
    ...bill.days.map((d) => [
      d.day, d.tech,
      ...(s.travel ? [d.from ? FROM_WORD[d.from] : '', clock(d.left)] : []), clock(d.arrived), clock(d.leftSite), ...(s.travel ? [clock(d.back)] : []),
      d.onSiteHours, ...(s.travel ? [d.travelHours, d.gpsMiles] : []), ...(s.odometer ? [d.odoMiles ?? ''] : []),
      ...(s.receipts ? [d.receipts] : []),
    ]),
    ['Total', '', ...(s.travel ? ['', ''] : []), '', '', ...(s.travel ? [''] : []),
      bill.totals.onSiteHours, ...(s.travel ? [bill.totals.travelHours, bill.totals.gpsMiles] : []),
      ...(s.odometer ? [bill.totals.odoMiles ?? ''] : []), ...(s.receipts ? [bill.totals.receipts] : [])],
  ];
  if (s.travel && bill.legs.length) {
    rows.push([], ['Drives'], ['Date', 'Technician', 'Activity', 'Drive', 'Started', 'Ended', 'Hours', 'GPS miles',
      ...(s.odometer ? ['Odometer at start', 'Odometer at end', 'Odometer miles'] : [])]);
    for (const l of bill.legs) {
      // A drive with no arrival has no hours of its own, as on the printed bill.
      rows.push([l.day, l.tech, ACTIVITY_LABEL[activityOf(l.origin, l.dest)], legLabel(l), clock(l.start), clock(l.end), l.end ? hoursOf(l.ms) : '', l.miles ?? '',
        ...(s.odometer ? [l.odoStart?.reading ?? '', l.odoEnd?.reading ?? '', l.odoMiles ?? ''] : [])]);
    }
  }
  if (s.receipts && bill.receipts.length) {
    rows.push([], ['Receipts'], ['Date', 'For', 'Store', 'Note', 'Gallons', 'Amount']);
    for (const r of bill.receipts) rows.push([r.expense_date, expenseCategoryLabel(r.category), r.vendor ?? '', r.note ?? '', r.gallons ?? '', Number(r.amount)]);
    for (const c of bill.totals.byCategory) rows.push(['', c.label, '', '', '', c.sum]);
    rows.push(['', 'Total', '', '', bill.totals.gallons || '', bill.totals.receipts]);
  }
  return rows;
}

/** The first sheet: every site on its own line, then the total. */
export function totalsSheetRows(project: string, client: string, range: string, sites: BillSite[]): (string | number)[][] {
  const odo = sites.some((x) => x.bill.shows.odometer);
  const rows: (string | number)[][] = [
    [project], ...(client ? [[`Client: ${client}`]] : []), [range], [],
    ['Site', 'WO', 'Days', 'Hours on site', 'Travel hours', 'GPS miles', ...(odo ? ['Odometer miles'] : []), 'Receipts'],
  ];
  for (const x of sites) {
    const t = x.bill.totals;
    rows.push([x.name, x.wo, t.days, t.onSiteHours, t.travelHours, t.gpsMiles, ...(odo ? [t.odoMiles ?? ''] : []), t.receipts]);
  }
  const sum = (f: (b: SiteBill) => number) => r2(sites.reduce((t, x) => t + f(x.bill), 0));
  rows.push(['Total', '', '', sum((b) => b.totals.onSiteHours), sum((b) => b.totals.travelHours), sum((b) => b.totals.gpsMiles),
    ...(odo ? [sum((b) => b.totals.odoMiles ?? 0)] : []), sum((b) => b.totals.receipts)]);
  return rows;
}

/** A sheet name Excel accepts: 31 characters, none of []:*?/\, unique in the book. */
export function sheetName(name: string, taken: Set<string>): string {
  const base = (name.replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim() || 'Site').slice(0, 28);
  let out = base;
  for (let i = 2; taken.has(out.toLowerCase()); i++) out = `${base.slice(0, 27 - String(i).length)} (${i})`;
  taken.add(out.toLowerCase());
  return out;
}

/** What the AI summary is given: the numbers and the flags, nothing else. */
export function summaryFacts(project: string, range: string, sites: BillSite[]) {
  return {
    project, range,
    sites: sites.map((x) => ({
      site: x.name, wo: x.wo,
      days: x.bill.days.map((d) => ({ day: d.day, tech: d.tech, hours_on_site: d.onSiteHours, travel_hours: d.travelHours, gps_miles: d.gpsMiles, odometer_miles: d.odoMiles, receipts: d.receipts })),
      totals: x.bill.totals,
      to_check: x.bill.flags.map((f) => f.text),
    })),
  };
}

export const SUMMARY_MODEL = 'claude-sonnet-5-5';

/** The ask for the AI summary: a short note Fred can send with the bill, from the numbers only. */
export function summaryPrompt(facts: ReturnType<typeof summaryFacts>): string {
  return `You are writing the short summary at the top of a weekly bill that a field service company sends to its client. The client hired the company's technicians to work at the sites below; the bill shows time on site, travel, miles and receipts for each site.

Write 3 to 6 plain sentences for the client:
- For each site: the days worked, the hours on site, the miles, and the receipts total.
- The total across all sites.
Use only the numbers given. Never mention pay, rates or prices other than receipt totals. No headings, no bullet points, no greeting or sign-off.

Then, only if "to_check" has anything, add one line starting "For the office:" listing what to check before sending, in a few words each. That line is for the company, not the client.

The data:
${JSON.stringify(facts)}`;
}
