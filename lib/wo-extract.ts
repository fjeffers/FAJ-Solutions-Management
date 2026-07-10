import type { WorkOrder } from './types';

// Plain-text work order extraction — no AI required. Pulls the fields a
// dispatch blurb usually contains (address, price, dates, contacts) with
// regexes. Used as the /api/ai fallback when no ANTHROPIC_API_KEY is set or
// the API call fails, and to backfill anything the model leaves null.

const STREET_SUFFIX =
  'St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|Ct|Court|Way|Pkwy|Parkway|Hwy|Highway|Pl|Place|Cir|Circle|Ter|Terrace|Trl|Trail';

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function pad(n: number): string { return String(n).padStart(2, '0'); }

export function extractDate(text: string, now = new Date()): string | null {
  // ISO: 2026-07-15
  let m = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  // US numeric: 7/15/2026, 7/15/26, 7/15
  m = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (m) {
    const yr = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : now.getFullYear();
    return `${yr}-${pad(+m[1])}-${pad(+m[2])}`;
  }
  // Month name: July 15, Jul 15th 2026
  m = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(20\d{2}))?/i);
  if (m) {
    const yr = m[3] ? +m[3] : now.getFullYear();
    return `${yr}-${pad(MONTHS[m[1].toLowerCase()])}-${pad(+m[2])}`;
  }
  return null;
}

export function extractTime(text: string): string | null {
  const m = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (!m) return null;
  let hr = +m[1] % 12;
  if (m[3].toLowerCase() === 'pm') hr += 12;
  return `${pad(hr)}:${m[2] ?? '00'}`;
}

export function extractWorkOrderFields(text: string, now = new Date()): Partial<WorkOrder> {
  const f: Partial<WorkOrder> = {};
  const clean = text.trim();
  if (!clean) return f;

  // Title: first line/sentence, trimmed
  const firstLine = clean.split('\n')[0].split(/(?<=[.!?])\s/)[0].trim();
  f.title = (firstLine.length > 70 ? firstLine.slice(0, 67) + '...' : firstLine) || undefined;
  f.description = clean;

  // Pay: hourly / per-device / fixed
  let m = clean.match(/\$\s?([\d,]+(?:\.\d{1,2})?)\s*(?:\/|per\s*)(?:hr|hour)\b/i);
  if (m) {
    f.pay_type = 'Hourly';
    f.hourly_rate = parseFloat(m[1].replace(/,/g, ''));
  } else if ((m = clean.match(/\$\s?([\d,]+(?:\.\d{1,2})?)\s*(?:\/|per\s*)(?:device|unit|drop|site)\b/i))) {
    f.pay_type = 'Per Device';
    f.per_device_rate = parseFloat(m[1].replace(/,/g, ''));
    const dc = clean.match(/(\d{1,4})\s*(?:devices|units|drops|cameras|aps|access points)\b/i);
    if (dc) f.device_count = +dc[1];
  } else {
    // Fixed price: prefer an amount near pay/price keywords, else the largest $ amount
    const near = clean.match(/(?:pays?|price|total|budget|rate|for)\D{0,12}\$\s?([\d,]+(?:\.\d{1,2})?)/i);
    const all = [...clean.matchAll(/\$\s?([\d,]+(?:\.\d{1,2})?)/g)].map((x) => parseFloat(x[1].replace(/,/g, '')));
    const amount = near ? parseFloat(near[1].replace(/,/g, '')) : (all.length ? Math.max(...all) : null);
    if (amount != null && amount > 0) {
      f.pay_type = 'Fixed';
      f.total_amount = amount;
    }
  }

  // Address: "123 Main St" + optional ", City, ST 12345"
  const addr = clean.match(new RegExp(
    `\\b(\\d{1,6}\\s+[A-Za-z0-9 .'-]{2,40}?\\s(?:${STREET_SUFFIX})\\.?)(?:\\s*,\\s*([A-Za-z .'-]{2,30}?)\\s*,\\s*([A-Z]{2})\\b(?:\\s*(\\d{5}))?)?`,
  ));
  if (addr) {
    f.site_address = addr[1].trim();
    if (addr[2]) f.site_city = addr[2].trim();
    if (addr[3]) f.site_state = addr[3];
    if (addr[4]) f.site_zip = addr[4];
  } else {
    // City/state without street: ", Springfield, IL 62704"
    const cs = clean.match(/\b([A-Z][A-Za-z .'-]{2,25}),\s*([A-Z]{2})\s+(\d{5})\b/);
    if (cs) { f.site_city = cs[1].trim(); f.site_state = cs[2]; f.site_zip = cs[3]; }
  }

  // Schedule
  const date = extractDate(clean, now);
  if (date) f.start_date = date;
  const time = extractTime(clean);
  if (time) f.start_time = time;

  // Contact
  const phone = clean.match(/\(?\b(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})\b/);
  if (phone) f.poc_phone = `(${phone[1]}) ${phone[2]}-${phone[3]}`;
  const email = clean.match(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/);
  if (email) f.poc_email = email[0];

  return f;
}
