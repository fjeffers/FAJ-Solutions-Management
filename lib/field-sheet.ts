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
import { buildDayLogs, gapOnSite, hoursOf, legLabel, type DayEvent, type DayLog } from './project-day';
import { matchOdometer, type BillLeg, type OdoRow } from './weekly-bill';
import type { QbInvoicePayload } from './qb-invoice';
import { expenseCategoryLabel } from './expenses';

export const TIME_FIELDS = ['left', 'arrived', 'leftSite', 'back'] as const;
// meals and spend: what was spent that day, typed by the office (Fred, 2026-10-24: "each day i enter the time and miles
// travel hours and miles along with that day spending meals").
// extraMiles: miles the office adds to the day's own (Fred, 2026-10-27: "i cant add additional milage
// manually"), like a drive the app didn't log; the odometer's miles stay as they are.
export const NUM_FIELDS = ['lunch', 'odoStart', 'odoEnd', 'gps', 'hours', 'travel', 'miles', 'extraMiles', 'meals', 'spend'] as const;
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
  /**
   * Hours on site and travel as the app counted them, only on a day with more
   * than one visit to the site: the four times can't show the time away in
   * between, so the visits and every drive are added up instead.
   */
  hours: number | null; travel: number | null;
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
      const best = gapOnSite(mine);
      if (best) {
        arrived = best.arrived; leftSite = best.leftSite; guessed.push('arrived', 'leftSite');
      } else if (mine.length === 1 && (mine[0].dest === 'hotel' || mine[0].dest === 'home') && hhmm(mine[0].start, timeZone) >= '12:00') {
        // One drive, in the afternoon, back to the hotel or home: the drive from the site.
        leftSite = mine[0].start; left = null; guessed.push('leftSite');
      }
    }
    // The day's odometer is the first drive's start photo and the last drive's end photo. A photo from
    // the middle of the day would leave the other drives out of the miles, so without both the GPS counts.
    const odoStart = mine[0]?.odoStart?.reading ?? null;
    const odoEnd = mine.at(-1)?.odoEnd?.reading ?? null;
    const visits = spans.length > 1;
    const drives = mine.map((l) => `${clock(t(l.start))}–${l.end ? clock(t(l.end)) : '…'} ${legLabel(l)}${l.miles != null ? `, ${r1(l.miles)} mi` : ''}`).join('; ');
    return {
      day: d.day, tech: d.tech,
      left: t(left), arrived: t(arrived), leftSite: t(leftSite), back: t(back),
      lunch: d.lunchMs > 0 ? Math.round(d.lunchMs / MIN) : null,
      odoStart, odoEnd,
      gps: mine.length ? r1(d.miles) : null,
      hours: visits ? hoursOf(spans.reduce((t, x) => t + x.ms, 0)) : null,
      travel: visits ? hoursOf(mine.reduce((t, l) => t + l.ms, 0)) : null,
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
  lunch: null, odoStart: null, odoEnd: null, gps: null, hours: null, travel: null, miles: null, extraMiles: null, meals: null, spend: null, note: '', ask: false,
};

/** The app's figure for a field, if it has one. */
export function appValue(app: AppDay | null, field: SheetField): string | number | null {
  if (!app) return null;
  if (field === 'left' || field === 'arrived' || field === 'leftSite' || field === 'back') return app[field];
  if (field === 'lunch' || field === 'odoStart' || field === 'odoEnd' || field === 'gps' || field === 'hours' || field === 'travel') return app[field];
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
    // Once the office retimes the day, hours and travel follow its times, not the app's visit totals.
    const retimed = TIME_FIELDS.some((t) => t in edits);
    for (const f of [...TIME_FIELDS, 'lunch', 'odoStart', 'odoEnd', 'gps', 'hours', 'travel'] as const) {
      if ((f === 'hours' || f === 'travel') && retimed) continue;
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
    // A two-visit day's hours are the visit totals, already less the lunch the tech tapped:
    // a lunch the office corrects moves them by the difference.
    if (!retimed && a?.hours != null && 'lunch' in edits && !('hours' in edits)) {
      values.hours = Math.max(0, r2(a.hours + ((a.lunch ?? 0) - (values.lunch ?? 0)) / 60));
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
 * three typed by the office wins. Extra miles the office typed are added on top.
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
  const miles = (v.miles ?? milesAuto) + (v.extraMiles ?? 0);
  return {
    hoursAuto: r2(hoursAuto), travelAuto: r2(travelAuto), milesAuto: r1(milesAuto),
    // The total adds the rounded hours, so the 9.72 h + 0.52 h the client reads comes to 10.24 h.
    hours: r2(hours), travel: r2(travel), total: r2(r2(hours) + r2(travel)), miles: r1(miles), mileage: r2(miles * mileRate),
    worked: hours + travel > 0 || miles > 0,
  };
}

// ── Billing (Fred, 2026-10-24: "billing hours i can select client name ... how
// much an hour or fix or blended or per item then there milage ... and what the
// customer will pay for milage or meals or recite or hotel all broken down by
// hours and days"). One sheet per site; the dates picked are the week billed.

/** How the labor is billed: on-site hours at a rate (travel optional at its own), every hour at one blended rate, a fixed price, or by the item. */
export type LaborType = 'hourly' | 'blended' | 'fixed' | 'items';
export const LABOR_TYPES: { key: LaborType; label: string }[] = [
  { key: 'hourly', label: 'Hourly' }, { key: 'blended', label: 'Blended rate' }, { key: 'fixed', label: 'Fixed price' }, { key: 'items', label: 'Per item' },
];
export type BillItem = { desc: string; qty: number; price: number };

export type SheetSettings = {
  /** The client billed: their Customers record and the name QuickBooks knows them by. */
  customerId: string | null; client: string; email: string;
  /** The site location as it goes on the invoice. Empty: the work order's address. */
  site: string;
  labor: LaborType;
  /** Hourly: $ per hour on site. Blended: $ per hour, on site and travel alike. */
  rate: number | null;
  /** Hourly only: $ per travel hour. Empty: travel isn't billed. */
  travelRate: number | null;
  fixed: number | null;
  items: BillItem[];
  /** $ per mile the client pays. */
  mileRate: number | null;
  /** Meals: a flat amount per tech-day, or the receipts (up to that much a day when it's set). */
  mealMode: 'receipts' | 'per_day'; mealRate: number | null;
  /** Hotel: a flat nightly rate × nights × rooms, or the receipts (up to that when it's set). */
  hotelMode: 'receipts' | 'per_night'; hotelRate: number | null; nights: number | null; rooms: number | null;
  /** Bill the other approved receipts (materials, tolls, equipment, other) at cost. Fuel is in the mileage. */
  receiptsAtCost: boolean;
  /** The invoice shows each tech's day on its own line. Off: the totals (the timesheet has the days). */
  byDay: boolean;
};
export const SETTING_KEYS = ['rate', 'travelRate', 'fixed', 'mileRate', 'mealRate', 'hotelRate', 'nights', 'rooms'] as const;
export type NumSetting = (typeof SETTING_KEYS)[number];

export function parseSettings(raw: unknown): SheetSettings {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const num = (v: unknown) => (isNum(v) && v >= 0 ? v : null);
  const str = (v: unknown, max = 300) => (typeof v === 'string' ? v.slice(0, max) : '');
  const labor = LABOR_TYPES.some((t) => t.key === o.labor) ? (o.labor as LaborType) : 'hourly';
  const items = Array.isArray(o.items) ? o.items.flatMap((x) => {
    const it = x && typeof x === 'object' ? (x as Record<string, unknown>) : {};
    return isNum(it.qty) && isNum(it.price) ? [{ desc: str(it.desc, 200), qty: it.qty, price: it.price }] : [];
  }).slice(0, 50) : [];
  return {
    customerId: typeof o.customerId === 'string' && o.customerId ? o.customerId : null,
    client: str(o.client, 200), email: str(o.email, 200), site: str(o.site),
    labor, rate: num(o.rate), travelRate: num(o.travelRate), fixed: num(o.fixed), items,
    mileRate: num(o.mileRate),
    mealMode: o.mealMode === 'per_day' ? 'per_day' : 'receipts', mealRate: num(o.mealRate),
    hotelMode: o.hotelMode === 'per_night' ? 'per_night' : 'receipts', hotelRate: num(o.hotelRate), nights: num(o.nights), rooms: num(o.rooms),
    receiptsAtCost: o.receiptsAtCost === true,
    byDay: o.byDay === true,
  };
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

export type SheetReceipt = { id: string; category: string; amount: number; status: string; vendor?: string | null; date?: string | null };

/**
 * Receipts that can be billed at cost: every category but meals and lodging (their
 * own lines) and fuel and mileage (in the mileage charge). That includes Fred's
 * Travel, Labor, Rental and the office's own categories (migration 137).
 */
const NOT_AT_COST = ['meals', 'hotel', 'fuel', 'mileage'];
export const atCost = (category: string) => !NOT_AT_COST.includes(category);

export type LineKind = 'labor' | 'travel' | 'fixed' | 'item' | 'mileage' | 'meals' | 'hotel' | 'receipt';
/**
 * The QuickBooks Product/service each kind of line is booked to, from Fred's
 * own list (2026-10-25: "cabling, traveling, meals, lodging or hotel"). The
 * rest go to the general Field Services.
 */
export const QBO_ITEM: Record<LineKind, string> = {
  labor: 'Cabling', travel: 'Traveling', mileage: 'Traveling', meals: 'Meals', hotel: 'Lodging',
  fixed: 'Field Services', item: 'Field Services', receipt: 'Field Services',
};
export const qboItemFor = (kind?: string | null) => QBO_ITEM[kind as LineKind] ?? 'Field Services';
/** One line of the client's invoice. amount is qty × rate to the cent. */
export type BillLine = { kind: LineKind; date: string | null; description: string; qty: number; rate: number; amount: number };

const line = (kind: LineKind, date: string | null, description: string, qty: number, rate: number): BillLine =>
  ({ kind, date, description: description.slice(0, 4000), qty: r2(qty), rate, amount: r2(r2(qty) * rate) });
const dayWord = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

/**
 * What one line of the sheet bills for its day: labor at an hourly or blended
 * rate, its miles, its meal (the flat daily amount, or what was spent) and the
 * day's other spending. The week's meals are capped as a whole on the bill, so
 * this is the day's share before any cap.
 */
export function dayBill(c: DayCalc, s: SheetSettings, v?: Pick<Values, 'meals' | 'spend'>): number {
  const labor = s.labor === 'hourly' ? r2(c.hours * (s.rate ?? 0)) + r2(c.travel * (s.travelRate ?? 0))
    : s.labor === 'blended' ? r2(c.total * (s.rate ?? 0)) : 0;
  const meal = s.mealMode === 'per_day' ? (c.worked ? s.mealRate ?? 0 : 0) : v?.meals ?? 0;
  return r2(labor + c.mileage + meal + (v?.spend ?? 0));
}

export type SheetTotals = {
  hours: number; travel: number; total: number; miles: number; mileage: number; techDays: number;
  labor: number;
  meals: { allowed: number | null; receipts: number; claim: number };
  hotel: { allowed: number | null; receipts: number; claim: number };
  atCost: number;
  bill: number;
  lines: BillLine[];
  byCategory: Record<string, number>;
  declined: number; waiting: number;
};

/**
 * The bill for the lines shown (the week picked), broken down the way the
 * invoice is: each tech's day of labor and miles, then meals, hotel and the
 * receipts billed at cost. The bill is the sum of the invoice lines, so the
 * sheet and QuickBooks can't disagree. Hidden lines and declined receipts
 * are left out.
 */
export function sheetTotals(rows: SheetRow[], receipts: SheetReceipt[], s: SheetSettings): SheetTotals {
  const live = rows.filter((r) => !r.hidden).map((r) => ({ r, c: dayCalc(r.values, s.mileRate ?? 0) }));
  const sum = (f: (d: DayCalc) => number) => live.reduce((t, { c }) => t + f(c), 0);
  const approved = receipts.filter((r) => r.status === 'approved');
  const byCategory: Record<string, number> = {};
  for (const r of approved) byCategory[r.category] = r2((byCategory[r.category] ?? 0) + (isNum(r.amount) ? r.amount : 0));
  const techDays = live.filter(({ c }) => c.worked).length;
  let lines: BillLine[] = [];

  // Labor: each tech's day, with its note, so the client sees the hours by day.
  for (const { r, c } of live) {
    const note = r.values.note ? ` — ${r.values.note}` : '';
    const who = `${dayWord(r.day)} · ${r.tech}`;
    if (s.labor === 'hourly' && s.rate != null && c.hours > 0) lines.push(line('labor', r.day, `${who} · on site ${c.hours} h${note}`, c.hours, s.rate));
    if (s.labor === 'hourly' && s.travelRate != null && c.travel > 0) lines.push(line('travel', r.day, `${who} · travel ${c.travel} h`, c.travel, s.travelRate));
    if (s.labor === 'blended' && s.rate != null && c.total > 0) lines.push(line('labor', r.day, `${who} · ${c.hours} h on site + ${c.travel} h travel${note}`, c.total, s.rate));
  }
  const site = s.site ? ` — ${s.site}` : '';
  if (s.labor === 'fixed' && s.fixed) lines.push(line('fixed', null, `Fixed price${site}`, 1, s.fixed));
  if (s.labor === 'items') for (const it of s.items) if (it.qty && it.price) lines.push(line('item', null, it.desc || 'Item', it.qty, it.price));

  // Miles: each tech's day.
  if (s.mileRate) for (const { r, c } of live) if (c.miles > 0) lines.push({ ...line('mileage', r.day, `${dayWord(r.day)} · ${r.tech} · mileage ${c.miles} mi`, c.miles, s.mileRate), amount: c.mileage });

  // What was spent on a day, typed on its line: billed as it is, with the day's note.
  for (const { r } of live) {
    if (r.values.spend && r.values.spend > 0) lines.push(line('receipt', r.day, `${dayWord(r.day)} · ${r.tech} · spending${r.values.note ? ` — ${r.values.note}` : ''}`, 1, r.values.spend));
  }

  // Meals and hotel: the receipts in the app plus what the office typed on each day.
  // An allowance of 0 is set (bill nothing); only an empty one means no cap.
  const typedMeals = r2(live.reduce((t, { r }) => t + (r.values.meals ?? 0), 0));
  const mealRcpt = r2((byCategory.meals ?? 0) + typedMeals), hotelRcpt = byCategory.hotel ?? 0;
  const mealAllowed = s.mealRate != null ? r2(techDays * s.mealRate) : null;
  const hotelAllowed = s.hotelRate != null && s.nights != null && s.rooms != null ? r2(s.hotelRate * s.nights * s.rooms) : null;
  const meals = s.mealMode === 'per_day'
    ? { allowed: mealAllowed, receipts: mealRcpt, claim: mealAllowed ?? 0 }
    : { allowed: mealAllowed, receipts: mealRcpt, claim: mealAllowed == null ? mealRcpt : Math.min(mealAllowed, mealRcpt) };
  const hotel = s.hotelMode === 'per_night'
    ? { allowed: hotelAllowed, receipts: hotelRcpt, claim: hotelAllowed ?? 0 }
    : { allowed: hotelAllowed, receipts: hotelRcpt, claim: hotelAllowed == null ? hotelRcpt : Math.min(hotelAllowed, hotelRcpt) };
  if (meals.claim > 0) lines.push(s.mealMode === 'per_day'
    ? line('meals', null, `Meals: ${techDays} tech-days × $${s.mealRate}`, techDays, s.mealRate ?? 0)
    : line('meals', null, `Meals (receipts${mealAllowed != null ? `, up to $${s.mealRate} a tech-day` : ''})`, 1, meals.claim));
  if (hotel.claim > 0) lines.push(s.hotelMode === 'per_night'
    ? line('hotel', null, `Hotel: ${s.nights} nights × ${s.rooms} rooms × $${s.hotelRate}`, (s.nights ?? 0) * (s.rooms ?? 0), s.hotelRate ?? 0)
    : line('hotel', null, `Hotel (receipts${hotelAllowed != null ? `, up to $${s.hotelRate} a room-night` : ''})`, 1, hotel.claim));

  // Other receipts at cost, one line each.
  if (s.receiptsAtCost) {
    for (const r of approved) {
      if (!atCost(r.category) || !isNum(r.amount) || r.amount <= 0) continue;
      lines.push(line('receipt', r.date ?? null, `${expenseCategoryLabel(r.category)}${r.vendor ? ` — ${r.vendor}` : ''}${r.date ? ` (${dayWord(r.date)})` : ''}`, 1, r.amount));
    }
  }
  // By the day, the client reads each day's labor, travel, miles and spending together, then the
  // lines for the whole week (a fixed price, items, meals, hotel). The sort is stable within a day.
  // Otherwise the totals: the hours, the mileage, the meals (Fred, 2026-10-25: "i dont need the
  // days i need the total hours then the total milage and the total meals 50 a day").
  const ORDER: LineKind[] = ['labor', 'travel', 'mileage', 'receipt', 'fixed', 'item', 'meals', 'hotel'];
  if (!s.byDay) lines = totalLines(lines, s.labor);
  lines.sort((x, y) => (s.byDay ? (x.date ? 0 : 1) - (y.date ? 0 : 1) || (x.date ?? '').localeCompare(y.date ?? '') : 0) || ORDER.indexOf(x.kind) - ORDER.indexOf(y.kind));
  const of = (...k: LineKind[]) => r2(lines.filter((l) => k.includes(l.kind)).reduce((t, l) => t + l.amount, 0));
  return {
    hours: r2(sum((d) => d.hours)), travel: r2(sum((d) => d.travel)), total: r2(sum((d) => d.total)),
    miles: r1(sum((d) => d.miles)), mileage: r2(sum((d) => d.mileage)), techDays,
    labor: of('labor', 'travel', 'fixed', 'item'), meals, hotel, atCost: of('receipt'),
    bill: of('labor', 'travel', 'fixed', 'item', 'mileage', 'meals', 'hotel', 'receipt'),
    lines, byCategory,
    declined: r2(receipts.filter((r) => r.status === 'declined').reduce((t, r) => t + (isNum(r.amount) ? r.amount : 0), 0)),
    waiting: receipts.filter((r) => r.status === 'submitted').length,
  };
}

/**
 * Every tech's days of labor, travel and miles as one line each (per rate), the
 * amount worked out on the total so it is qty × rate to the cent; the rest as
 * they are.
 */
function totalLines(lines: BillLine[], labor: LaborType): BillLine[] {
  const word = { labor: labor === 'blended' ? 'Hours on site and travel' : 'Hours on site', travel: 'Travel', mileage: 'Mileage' } as Record<LineKind, string>;
  const unit = { labor: 'h', travel: 'h', mileage: 'mi' } as Record<LineKind, string>;
  const sums = new Map<string, { kind: LineKind; rate: number; qty: number }>();
  const out: BillLine[] = [];
  for (const l of lines) {
    if (!unit[l.kind]) { out.push(l); continue; }
    const k = `${l.kind}|${l.rate}`;
    const g = sums.get(k);
    if (g) g.qty += l.qty; else sums.set(k, { kind: l.kind, rate: l.rate, qty: l.qty });
  }
  const totals = [...sums.values()].map((g) => { const q = r2(g.qty); return line(g.kind, null, `${word[g.kind]}: ${q} ${unit[g.kind]}`, q, g.rate); });
  return [...totals, ...out];
}

/** The sheet as spreadsheet rows (Excel download, which Smartsheet imports): the days, then the bill line by line. */
export function fieldSheetRows(head: { title: string; wo: string; clientWo: string | null; address: string }, rows: SheetRow[], t: SheetTotals, s: SheetSettings): (string | number)[][] {
  const out: (string | number)[][] = [
    ['FAJ Solutions Field Sheet'],
    [head.title],
    [[s.client ? `Client: ${s.client}` : '', `WO ${head.wo}`, head.clientWo ? `Client # ${head.clientWo}` : '', s.site || head.address].filter(Boolean).join(' · ')],
    [],
    ['Date', 'Technician', 'Left hotel/home', 'Arrived on site', 'Left site', 'Back hotel/home', 'Lunch (min)', 'Hours on site', 'Travel hours', 'Total hours',
      'Odometer start', 'Odometer end', 'GPS miles', 'Miles', `Mileage $ (${s.mileRate ?? 0}/mi)`, 'Meals $', 'Spending $', 'Day billed $', 'Notes'],
  ];
  for (const r of rows.filter((x) => !x.hidden)) {
    const v = r.values, c = dayCalc(v, s.mileRate ?? 0);
    out.push([r.day, r.tech, clock(v.left), clock(v.arrived), clock(v.leftSite), clock(v.back), v.lunch ?? '', c.hours, c.travel, c.total,
      v.odoStart ?? '', v.odoEnd ?? '', v.gps ?? '', c.miles, c.mileage, v.meals ?? '', v.spend ?? '', dayBill(c, s, v),
      // The columns stay as Smartsheet imports them: the extra miles are in Miles, and said in the notes.
      [v.extraMiles ? `Miles include ${v.extraMiles} extra` : '', v.note].filter(Boolean).join(' · ')]);
  }
  out.push(['Week total', '', '', '', '', '', '', t.hours, t.travel, t.total, '', '', '', t.miles, t.mileage, '', '', '', `${t.techDays} tech-days`]);
  out.push([]);
  out.push(['Bill', 'Description', 'Qty', 'Rate', 'Amount']);
  for (const l of t.lines) out.push([l.date ?? '', l.description, l.qty, l.rate, l.amount]);
  out.push(['', 'Total', '', '', t.bill]);
  return out;
}

/** Every line of a site's sheet from the raw records: the screen and the invoice route build it the same way. */
export function rowsFor(input: {
  events: DayEvent[]; readings: OdoRow[]; saved: SavedDay[]; techs: string[];
  start: string | null | undefined; end: string | null | undefined; now?: Date; timeZone?: string;
}): SheetRow[] {
  const logs = buildDayLogs(input.events, input.now ?? new Date(), input.timeZone);
  const legs = matchOdometer(logs.flatMap((d) => d.legs), input.readings);
  return sheetRows({ app: appDays(logs, legs, input.timeZone), saved: input.saved, techs: input.techs, days: jobDays(input.start, input.end) });
}

/** Within the dates picked (either end may be open). */
export const inDates = (day: string, from?: string | null, to?: string | null) => (!from || day >= from) && (!to || day <= to);

/** Two date ranges share a day. */
export const overlaps = (a: { from: string; to: string }, b: { from: string; to: string }) => a.from <= b.to && b.from <= a.to;

/**
 * The dates an invoice covers: those picked, else the first to the last thing it
 * bills — the days on the sheet and the approved receipts — so a hotel receipt
 * the night before the first day is inside the dates recorded as billed.
 */
export function billRange(rows: SheetRow[], receipts: SheetReceipt[], from?: string | null, to?: string | null): { from: string; to: string } | null {
  const dated = [...rows.filter((r) => !r.hidden).map((r) => r.day), ...receipts.filter((e) => e.status === 'approved' && e.date).map((e) => e.date!)].sort();
  const f = from || dated[0];
  if (!f) return null;
  return { from: f, to: to || dated.at(-1) || f };
}

/** An invoice started this long ago and never finished: the request died, so its dates aren't held any more. */
export const HOLD_STALE_MS = 10 * 60 * 1000;

/** An invoice row that blocks billing these dates: one QuickBooks accepted, or one being created right now. */
export const blocksBilling = (i: { qbo_invoice_id: string | null; created_at: string }, now = Date.now()) =>
  !!i.qbo_invoice_id || now - Date.parse(i.created_at) < HOLD_STALE_MS;

/** A sheet with no mileage rate of its own bills at the account's (Settings), on the screen and on the invoice alike. */
export function withAccountRate(s: SheetSettings, accountRate: unknown): SheetSettings {
  const rate = accountRate == null || accountRate === '' ? NaN : Number(accountRate);
  return s.mileRate == null && Number.isFinite(rate) ? { ...s, mileRate: rate } : s;
}

/** The QuickBooks invoice for a sheet's lines: each line dated, the site and dates printed for the client. */
export function fieldSheetInvoice(lines: BillLine[], opts: {
  /** QuickBooks' item id for each Product/service name the lines use (qboItemFor). */
  customerId: string; itemIds: Record<string, string>; memo: string; note: string; email?: string | null; txnDate?: string;
}): QbInvoicePayload {
  const payload: QbInvoicePayload = {
    CustomerRef: { value: opts.customerId },
    Line: lines.map((l) => ({
      DetailType: 'SalesItemLineDetail' as const,
      Amount: l.amount,
      Description: l.description,
      SalesItemLineDetail: { ItemRef: { value: opts.itemIds[qboItemFor(l.kind)] }, Qty: l.qty, UnitPrice: l.rate, ...(l.date ? { ServiceDate: l.date } : {}) },
    })),
    CustomerMemo: { value: opts.memo.slice(0, 1000) },
    PrivateNote: opts.note.slice(0, 4000),
  };
  if (opts.email) payload.BillEmail = { Address: opts.email };
  if (opts.txnDate) payload.TxnDate = opts.txnDate;
  return payload;
}
