// AI reads a photo the tech just took (Fred, 2026-10-18: AI that reads
// receipt photos and odometer photos). The answer only fills in the form: the
// tech checks the number before it's saved, and what the AI read is kept next
// to it so the weekly bill can flag a difference.
//
// Never a guess: anything the photo doesn't show clearly comes back null.
// Pure and unit-tested (lib/photo-read.test.ts); the call is in
// app/api/tech/read-photo/route.ts.
import { EXPENSE_CATEGORIES, type ExpenseCategory } from './expenses';

export const PHOTO_READ_MODEL = 'claude-sonnet-5-5';

export type PhotoKind = 'odometer' | 'receipt';
export type OdometerRead = { reading: number | null };
/** One line on a receipt (Fred, 2026-10-22: "maybe the items ... so I know what I'm paying for"). */
export type ReceiptItem = { name: string; qty: number | null; amount: number | null };
export type ReceiptRead = {
  amount: number | null; vendor: string | null; date: string | null; category: ExpenseCategory | null; gallons: number | null;
  /** The lines on the receipt, at most RECEIPT_ITEMS_MAX (kept with the receipt in job_expenses.ai). */
  items: ReceiptItem[];
};
export const RECEIPT_ITEMS_MAX = 25;

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[$,\s]/g, '')) : NaN;
  return Number.isFinite(n) ? n : null;
};
const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;

export function sanitizeOdometer(raw: unknown): OdometerRead {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const n = num(o.reading);
  return { reading: n != null && n >= 0 && n < 10_000_000 ? round(n, 1) : null };
}

/** The lines read off a receipt, from what was stored with it ([] for older receipts). */
export function receiptItems(ai: unknown): ReceiptItem[] {
  const list = ai && typeof ai === 'object' && Array.isArray((ai as { items?: unknown }).items) ? (ai as { items: unknown[] }).items : [];
  const out: ReceiptItem[] = [];
  for (const it of list) {
    if (!it || typeof it !== 'object') continue;
    const o = it as Record<string, unknown>;
    const name = typeof o.name === 'string' ? o.name.replace(/\s+/g, ' ').trim().slice(0, 60) : '';
    if (!name) continue;
    const qty = num(o.qty);
    const amount = num(o.amount);
    out.push({
      name,
      qty: qty != null && qty > 0 && qty < 100_000 ? round(qty, 3) : null,
      amount: amount != null && Math.abs(amount) < 100_000 ? round(amount, 2) : null,
    });
    if (out.length >= RECEIPT_ITEMS_MAX) break;
  }
  return out;
}

const CATS = new Set<string>(EXPENSE_CATEGORIES.map((c) => c.key));

export function sanitizeReceipt(raw: unknown, today: string): ReceiptRead {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const amount = num(o.amount);
  const gallons = num(o.gallons);
  const date = typeof o.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.date) && Number.isFinite(Date.parse(`${o.date}T12:00:00Z`))
    // A receipt isn't from the future, or from years ago.
    && o.date <= today && o.date >= `${Number(today.slice(0, 4)) - 1}${today.slice(4)}` ? o.date : null;
  const category = typeof o.category === 'string' && CATS.has(o.category) ? (o.category as ExpenseCategory) : null;
  const vendor = typeof o.vendor === 'string' ? o.vendor.replace(/\s+/g, ' ').trim().slice(0, 80) || null : null;
  return {
    amount: amount != null && amount > 0 && amount < 100_000 ? round(amount, 2) : null,
    vendor,
    date,
    category,
    gallons: category === 'fuel' && gallons != null && gallons > 0 && gallons < 1000 ? round(gallons, 3) : null,
    items: receiptItems(o),
  };
}

const nullable = (type: string) => ({ anyOf: [{ type }, { type: 'null' }] });

/** Structured output, so the answer always parses. */
export function photoSchema(kind: PhotoKind): Record<string, unknown> {
  const properties: Record<string, unknown> = kind === 'odometer'
    ? { reading: nullable('number') }
    : {
      amount: nullable('number'), vendor: nullable('string'), date: nullable('string'),
      category: { anyOf: [{ type: 'string', enum: EXPENSE_CATEGORIES.map((c) => c.key) }, { type: 'null' }] },
      gallons: nullable('number'),
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: { name: { type: 'string' }, qty: nullable('number'), amount: nullable('number') },
          required: ['name', 'qty', 'amount'], additionalProperties: false,
        },
      },
    };
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}

export function photoPrompt(kind: PhotoKind, today: string): string {
  if (kind === 'odometer') {
    return `This is a photo of a vehicle's dashboard, taken by a field technician at the start or end of a drive.

Read the ODOMETER: the total miles the vehicle has driven. Return {"reading": number} with the digits exactly as shown, including a tenths digit if the display has one (e.g. 48213.6).

Rules:
- Do not read the trip meter (often labeled TRIP, TRIP A or TRIP B), the speed, the fuel range or the clock.
- If the odometer isn't in the photo, is blurred, or any digit is unclear, return {"reading": null}.
- Prefer null over a guess. The technician will type it in.`;
  }
  return `This is a photo of a receipt a field technician paid on the road. Today is ${today}.

Return what the receipt shows, using null for anything it does not show clearly:
- "amount": the TOTAL paid, in dollars, after tax (not the subtotal, not a tip line left blank).
- "vendor": the store or business name, short (e.g. "Shell", "Home Depot", "Marriott").
- "date": the date on the receipt as YYYY-MM-DD.
- "category": one of ${EXPENSE_CATEGORIES.map((c) => `"${c.key}" (${c.label})`).join(', ')}.
- "gallons": for fuel only, the gallons pumped.
- "items": each line item bought, in order, at most ${RECEIPT_ITEMS_MAX}: "name" short and plain (e.g. "Cat6 cable 1000ft", "Unleaded"), "qty" the quantity if shown, "amount" that line's price in dollars. Leave out tax, totals, payment and change lines. [] if no lines are readable.

Prefer null over a guess. The technician checks every value before it's sent.`;
}

/** The AI's reading differs from what the tech typed by more than a slip of a finger. */
export function odometerDiffers(typed: number, ai: number | null): boolean {
  return ai != null && Math.abs(typed - ai) >= 1;
}
export function amountDiffers(typed: number, ai: number | null): boolean {
  return ai != null && Math.abs(typed - ai) >= 0.01;
}
