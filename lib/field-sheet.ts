// The field sheet (Fred, 2026-10-24: "add it under office and i can pull it by
// the app work order number and edit whats needed"). Office → Field Sheet.
//
// One work order, one line per tech per day: when they left the hotel or home,
// got to the site, left it and got back, lunch, the odometer at the start and
// end of the day, the GPS miles. It starts from the techs' taps
// (lib/project-day.ts) and odometer photos (lib/weekly-bill.ts); the office's
// own figures sit on top (field_sheet_days, migration 136) and the taps are
// never changed. Every figure can be typed over. Clearing a figure the office
// typed goes back to the app's; clearing one that came from the app empties it.
//
// Week 1 on the LDS sites (2026-10-19) is why the guesses exist: most mornings
// the techs picked "Traveling to: Hotel" at check-in, so the app never started
// their time on site. When a day has no Start job but two drives hours apart,
// the arrival and the time leaving the site are taken from the gap between
// them and marked as a guess for the office to check.
//
// Pure and unit-tested (lib/field-sheet.test.ts). The screen is components/FieldSheetView.tsx.
import { legLabel, type DayLog } from './project-day';
import type { BillLeg } from './weekly-bill';

export const TIME_FIELDS = ['left', 'arrived', 'leftSite', 'back'] as const;
export const NUM_FIELDS = ['lunch', 'odoStart', 'odoEnd', 'gps', 'hours', 'travel', 'miles'] as const;
export type TimeField = (typeof TIME_FIELDS)[number];
export type NumField = (typeof NUM_FIELDS)[number];
export type SheetField = TimeField | NumField | 'note' | 'ask';

/** What the office changed on one line. A field set to null was emptied on purpose. */
export type Edits = { [K in TimeField]?: string | null } & { [K in NumField]?: number | null } & { note?: string | null; ask?: boolean | null };

/** One tech's day as the app recorded it. Times are HH:MM in the job's time zone. */
export type AppDay = {
  day: string; tech: string;
  left: string | null; arrived: string | null; leftSite: string | null; back: string | null;
  lunch: number | null; odoStart: number | null; odoEnd: number | null; gps: number | null;
  /** Times worked out from the gap between drives, not tapped. */
  guessed: ('arrived' | 'leftSite')[];
  /** Every drive that day, for the office to read: "7:38–7:44 AM Hotel → Hotel, 2.2 mi; …". */
  drives: string;
};

/** A field_sheet_days row. */
export type SavedDay = { id: string; day: string; tech: string; edits: Edits; added: boolean; hidden: boolean };

export type Values = { [K in TimeField]: string | null } & { [K in NumField]: number | null } & { note: string; ask: boolean };
export type Source = 'app' | 'guess' | 'office';

export type SheetRow = {
  /** day|tech — stable while the line exists. */
  key: string;
  day: string; tech: string;
  /** The field_sheet_days row, once the office has changed anything. */
  id: string | null;
  added: boolean; hidden: boolean;
  /** An assigned tech on a job day with nothing in the app, and nothing typed yet. */
  missing: boolean;
  app: AppDay | null;
  edits: Edits;
  values: Values;
  source: Partial<Record<SheetField, Source>>;
};

const MIN = 60_000;
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** "2026-10-21T11:38:00Z" → "07:38" in the time zone. */
export function hhmm(iso: string, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('hour')}:${get('minute')}`;
}

/** "07:38" → "7:38 AM". */
export function clock(t: string | null | undefined): string {
  const m = minutesOf(t);
  if (m == null) return '';
  const h = Math.floor(m / 60), mm = m % 60;
  return `${((h + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

export function minutesOf(t: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t ?? '');
  if (!m) return null;
  const h = Number(m[1]), mm = Number(m[2]);
  return h < 24 && mm < 60 ? h * 60 + mm : null;
}

/** Hours from one clock time to the next, past midnight if it has to. */
const hoursBetween = (a: number, b: number) => (((b - a) % 1440) + 1440) % 1440 / 60;

/** A "drive" over half an hour with under half a mile: the tech never tapped arriving. */
const stood = (l: BillLeg) => l.end != null && l.miles != null && l.miles < 0.5 && l.ms > 30 * MIN;

/** Each tech's day from the app: the taps (buildDayLogs) and the drives with their odometer readings (matchOdometer). */
export function appDays(logs: DayLog[], legs: BillLeg[], timeZone?: string): AppDay[] {
  const t = (iso: string | null | undefined) => (iso ? hhmm(iso, timeZone) : null);
  return logs.map((d) => {
    const mine = legs.filter((l) => l.tech === d.tech && l.day === d.day).sort((a, b) => a.start.localeCompare(b.start));
    const spans = [...d.spans].sort((a, b) => a.in.localeCompare(b.in));
    let left: string | null = null, arrived: string | null = null, leftSite: string | null = null, back: string | null = null;
    const guessed: AppDay['guessed'] = [];
    if (spans.length) {
      // The clock: Start job and Off site. The drives around them are the trip there and back.
      arrived = spans[0].in;
      leftSite = spans.at(-1)!.out;
      left = mine.find((l) => l.start <= arrived!)?.start ?? null;
      back = leftSite ? mine.filter((l) => l.start >= leftSite!).at(-1)?.end ?? null : null;
    } else if (mine.length) {
      left = mine[0].start;
      back = mine.at(-1)!.end;
      // On site is the longest stretch, two hours or more, between one drive ending and the next starting.
      let best: { gap: number; arrived: string; leftSite: string } | null = null;
      for (let i = 0; i < mine.length - 1; i++) {
        const end = stood(mine[i]) ? mine[i].start : mine[i].end;
        if (!end) continue;
        const gap = Date.parse(mine[i + 1].start) - Date.parse(end);
        if (gap >= 120 * MIN && (!best || gap > best.gap)) best = { gap, arrived: end, leftSite: mine[i + 1].start };
      }
      if (best) {
        arrived = best.arrived; leftSite = best.leftSite; guessed.push('arrived', 'leftSite');
      } else if (mine.length === 1 && (mine[0].dest === 'hotel' || mine[0].dest === 'home') && hhmm(mine[0].start, timeZone) >= '12:00') {
        // One drive, in the afternoon, back to the hotel or home: the drive from the site.
        leftSite = mine[0].start; left = null; guessed.push('leftSite');
      }
    }
    const odoStart = mine.find((l) => l.odoStart)?.odoStart?.reading ?? null;
    const odoEnd = [...mine].reverse().find((l) => l.odoEnd)?.odoEnd?.reading ?? null;
    const drives = mine.map((l) => `${clock(t(l.start))}–${l.end ? clock(t(l.end)) : '…'} ${legLabel(l)}${l.miles != null ? `, ${r1(l.miles)} mi` : ''}`).join('; ');
    return {
      day: d.day, tech: d.tech,
      left: t(left), arrived: t(arrived), leftSite: t(leftSite), back: t(back),
      lunch: d.lunchMs > 0 ? Math.round(d.lunchMs / MIN) : null,
      odoStart, odoEnd,
      gps: mine.length ? r1(d.miles) : null,
      guessed, drives,
    };
  });
}

/** The days a job runs (start to end, at most 21), for the lines of techs who have nothing in the app. */
export function jobDays(start: string | null | undefined, end: string | null | undefined): string[] {
  if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(start)) return [];
  const last = end && /^\d{4}-\d{2}-\d{2}$/.test(end) && end >= start ? end : start;
  const out: string[] = [];
  for (let d = new Date(`${start}T12:00:00Z`); out.length < 21; d = new Date(d.getTime() + 86_400_000)) {
    const iso = d.toISOString().slice(0, 10);
    if (iso > last) break;
    out.push(iso);
  }
  return out;
}

const EMPTY: Values = {
  left: null, arrived: null, leftSite: null, back: null,
  lunch: null, odoStart: null, odoEnd: null, gps: null, hours: null, travel: null, miles: null, note: '', ask: false,
};

/** The app's figure for a field, if it has one. */
export function appValue(app: AppDay | null, field: SheetField): string | number | null {
  if (!app) return null;
  if (field === 'left' || field === 'arrived' || field === 'leftSite' || field === 'back') return app[field];
  if (field === 'lunch' || field === 'odoStart' || field === 'odoEnd' || field === 'gps') return app[field];
  return null;
}

/**
 * The lines: every day in the app, every line the office added, and a line for
 * each assigned tech on each job day with nothing at all, so a missing day
 * shows. The office's edits sit on top. Oldest day first, then by tech.
 */
export function sheetRows(input: { app: AppDay[]; saved: SavedDay[]; techs: string[]; days: string[] }): SheetRow[] {
  const key = (day: string, tech: string) => `${day}|${tech}`;
  const app = new Map(input.app.map((a) => [key(a.day, a.tech), a]));
  const saved = new Map(input.saved.map((s) => [key(s.day, s.tech), s]));
  const keys = new Set<string>([...app.keys(), ...saved.keys()]);
  for (const day of input.days) for (const tech of input.techs) if (tech.trim()) keys.add(key(day, tech.trim()));
  const rows = [...keys].map((k) => {
    const [day, tech] = [k.slice(0, k.indexOf('|')), k.slice(k.indexOf('|') + 1)];
    const a = app.get(k) ?? null;
    const s = saved.get(k) ?? null;
    const edits: Edits = s?.edits ?? {};
    const values: Values = { ...EMPTY };
    const source: SheetRow['source'] = {};
    for (const f of [...TIME_FIELDS, 'lunch', 'odoStart', 'odoEnd', 'gps'] as const) {
      const v = appValue(a, f);
      if (v != null) {
        (values as Record<string, unknown>)[f] = v;
        source[f] = a!.guessed.includes(f as 'arrived' | 'leftSite') ? 'guess' : 'app';
      }
    }
    for (const [f, v] of Object.entries(edits) as [SheetField, unknown][]) {
      if (!(f in EMPTY)) continue;
      if (f === 'note') values.note = typeof v === 'string' ? v : '';
      else if (f === 'ask') values.ask = v === true;
      else if ((TIME_FIELDS as readonly string[]).includes(f)) (values as Record<string, unknown>)[f] = minutesOf(v as string) != null ? v : null;
      else (values as Record<string, unknown>)[f] = isNum(v) ? v : null;
      source[f] = 'office';
    }
    return {
      key: k, day, tech, id: s?.id ?? null, added: s?.added ?? false, hidden: s?.hidden ?? false,
      missing: !a && !s, app: a, edits, values, source,
    } satisfies SheetRow;
  });
  return rows.sort((x, y) => x.day.localeCompare(y.day) || x.tech.localeCompare(y.tech));
}

/**
 * The edits after the office changes one field to `value` (null or '' = emptied).
 * Back to the app's figure → the edit is dropped. Emptying an office figure goes
 * back to the app's; emptying the app's figure stores null (empty on purpose).
 */
export function nextEdits(row: Pick<SheetRow, 'app' | 'edits'>, field: SheetField, value: string | number | boolean | null): Edits {
  const edits: Record<string, unknown> = { ...row.edits };
  const empty = value == null || value === '' || value === false;
  const app = appValue(row.app, field);
  if (empty) {
    if (field in edits) delete edits[field];
    else if (app != null) edits[field] = null;
  } else if (app != null && value === app) {
    delete edits[field];
  } else {
    edits[field] = value;
  }
  return edits as Edits;
}

export type DayCalc = {
  hoursAuto: number; travelAuto: number; milesAuto: number;
  hours: number; travel: number; total: number; miles: number; mileage: number;
  /** Worked or travelled that day: counts for meals. */
  worked: boolean;
};

/**
 * One line's figures. Hours on site: arrived to left site, less lunch. Travel:
 * left to arrived plus left site to back (or left to back on a day with no site
 * time). Miles: the odometer when both readings are there, else GPS. Any of the
 * three typed by the office wins.
 */
export function dayCalc(v: Values, mileRate: number): DayCalc {
  const L = minutesOf(v.left), A = minutesOf(v.arrived), O = minutesOf(v.leftSite), B = minutesOf(v.back);
  const hoursAuto = A != null && O != null ? Math.max(0, hoursBetween(A, O) - (v.lunch ?? 0) / 60) : 0;
  const travelAuto = (L != null && A != null ? hoursBetween(L, A) : 0)
    + (O != null && B != null ? hoursBetween(O, B) : 0)
    + (L != null && B != null && A == null && O == null ? hoursBetween(L, B) : 0);
  const odo = v.odoStart != null && v.odoEnd != null ? v.odoEnd - v.odoStart : null;
  const milesAuto = odo != null && odo >= 0 ? odo : v.gps ?? 0;
  const hours = v.hours ?? hoursAuto;
  const travel = v.travel ?? travelAuto;
  const miles = v.miles ?? milesAuto;
  return {
    hoursAuto: r2(hoursAuto), travelAuto: r2(travelAuto), milesAuto: r1(milesAuto),
    hours: r2(hours), travel: r2(travel), total: r2(hours + travel), miles: r1(miles), mileage: r2(miles * mileRate),
    worked: hours + travel > 0 || miles > 0,
  };
}

export type SheetSettings = { mileRate: number | null; mealRate: number | null; hotelRate: number | null; nights: number | null; rooms: number | null };
export const SETTING_KEYS = ['mileRate', 'mealRate', 'hotelRate', 'nights', 'rooms'] as const;

export function parseSettings(raw: unknown): SheetSettings {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const num = (v: unknown) => (isNum(v) && v >= 0 ? v : null);
  return { mileRate: num(o.mileRate), mealRate: num(o.mealRate), hotelRate: num(o.hotelRate), nights: num(o.nights), rooms: num(o.rooms) };
}

/** A field_sheet_days.edits value from the database, keeping only known fields of the right type. */
export function parseEdits(raw: unknown): Edits {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if ((TIME_FIELDS as readonly string[]).includes(k)) { if (v === null || minutesOf(v as string) != null) out[k] = v; }
    else if ((NUM_FIELDS as readonly string[]).includes(k)) { if (v === null || isNum(v)) out[k] = v; }
    else if (k === 'note') { if (v === null || typeof v === 'string') out[k] = v; }
    else if (k === 'ask') { if (v === null || typeof v === 'boolean') out[k] = v; }
  }
  return out as Edits;
}

export type SheetReceipt = { id: string; category: string; amount: number; status: string };

export type SheetTotals = {
  hours: number; travel: number; total: number; miles: number; mileage: number; techDays: number;
  meals: { allowed: number | null; receipts: number; claim: number };
  hotel: { allowed: number | null; receipts: number; claim: number };
  bill: number;
  byCategory: Record<string, number>;
  declined: number; waiting: number;
};

/**
 * The week for the client: miles at the mileage rate, and meals and hotel from
 * the approved receipts, up to the allowance when the client sets one (NetView's
 * SOW: $50 a day for meals, the approved nightly hotel rate; paid only with
 * receipts). Fuel and materials are listed but aren't part of the bill.
 */
export function sheetTotals(rows: SheetRow[], receipts: SheetReceipt[], s: SheetSettings): SheetTotals {
  const days = rows.filter((r) => !r.hidden).map((r) => dayCalc(r.values, s.mileRate ?? 0));
  const sum = (f: (d: DayCalc) => number) => days.reduce((t, d) => t + f(d), 0);
  const approved = receipts.filter((r) => r.status === 'approved');
  const byCategory: Record<string, number> = {};
  for (const r of approved) byCategory[r.category] = r2((byCategory[r.category] ?? 0) + (isNum(r.amount) ? r.amount : 0));
  const techDays = days.filter((d) => d.worked).length;
  const mealAllowed = s.mealRate ? r2(techDays * s.mealRate) : null;
  const hotelAllowed = s.hotelRate && s.nights && s.rooms ? r2(s.hotelRate * s.nights * s.rooms) : null;
  const mealRcpt = byCategory.meals ?? 0, hotelRcpt = byCategory.hotel ?? 0;
  const meals = { allowed: mealAllowed, receipts: mealRcpt, claim: mealAllowed == null ? mealRcpt : Math.min(mealAllowed, mealRcpt) };
  const hotel = { allowed: hotelAllowed, receipts: hotelRcpt, claim: hotelAllowed == null ? hotelRcpt : Math.min(hotelAllowed, hotelRcpt) };
  const mileage = r2(sum((d) => d.mileage));
  return {
    hours: r2(sum((d) => d.hours)), travel: r2(sum((d) => d.travel)), total: r2(sum((d) => d.total)),
    miles: r1(sum((d) => d.miles)), mileage, techDays, meals, hotel,
    bill: r2(mileage + meals.claim + hotel.claim),
    byCategory,
    declined: r2(receipts.filter((r) => r.status === 'declined').reduce((t, r) => t + (isNum(r.amount) ? r.amount : 0), 0)),
    waiting: receipts.filter((r) => r.status === 'submitted').length,
  };
}

/** The sheet as spreadsheet rows (Excel download, which Smartsheet imports). */
export function fieldSheetRows(head: { title: string; wo: string; clientWo: string | null; address: string }, rows: SheetRow[], t: SheetTotals, s: SheetSettings): (string | number)[][] {
  const out: (string | number)[][] = [
    [head.title],
    [[`WO ${head.wo}`, head.clientWo ? `Client # ${head.clientWo}` : '', head.address].filter(Boolean).join(' · ')],
    [],
    ['Date', 'Technician', 'Left hotel/home', 'Arrived on site', 'Left site', 'Back hotel/home', 'Lunch (min)', 'Hours on site', 'Travel hours', 'Total hours',
      'Odometer start', 'Odometer end', 'GPS miles', 'Miles', `Mileage $ (${s.mileRate ?? 0}/mi)`, 'Notes'],
  ];
  for (const r of rows.filter((x) => !x.hidden)) {
    const v = r.values, c = dayCalc(v, s.mileRate ?? 0);
    out.push([r.day, r.tech, clock(v.left), clock(v.arrived), clock(v.leftSite), clock(v.back), v.lunch ?? '', c.hours, c.travel, c.total,
      v.odoStart ?? '', v.odoEnd ?? '', v.gps ?? '', c.miles, c.mileage, v.note]);
  }
  out.push(['Total', '', '', '', '', '', '', t.hours, t.travel, t.total, '', '', '', t.miles, t.mileage, `${t.techDays} tech-days`]);
  out.push([]);
  out.push(['Mileage', t.mileage]);
  out.push(['Meals', t.meals.claim]);
  out.push(['Hotel', t.hotel.claim]);
  out.push(['Reimbursement', t.bill]);
  return out;
}
