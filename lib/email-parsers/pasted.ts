// Turning a pasted or uploaded email into a work order (no Gmail connection).
//
// The Gmail integration needs a redirect URI registered in Google Cloud Console,
// which is still pending, so the whole import pipeline was unreachable. This
// gives it a second front door: paste the email (or drop the .eml file) and it
// lands in the same import_queue, reviewed and approved exactly like a fetched
// one. Nothing here touches work_orders — approval does that.
//
// Two jobs:
//   1. pull sender / subject / body out of whatever shape the paste is in
//   2. hand it to the existing dispatch parsers, and fall back to a generic
//      scrape so an unrecognised email still produces a usable draft rather
//      than an error
import type { ParsedNetviewFields } from '@/lib/types';
import { isNetviewDispatchEmail, parseNetviewDispatchEmail } from './netview-smartsheet';
import { isFieldNationRoutedEmail, parseFieldNationRoutedEmail } from './fieldnation';

export type PastedEmail = { sender: string; subject: string; body: string };

export type PastedParse = {
  /** The first job — kept so single-job callers can ignore the list. */
  fields: ParsedNetviewFields;
  /**
   * One entry per work order in the email. A go-back list covers a run of sites
   * (the real one that prompted this had eighteen) and each is its own job.
   * Always at least one, so callers can simply iterate.
   */
  jobs: ParsedNetviewFields[];
  /** Which parser produced this — shown so Fred knows how much to trust it. */
  matched: 'netview' | 'fieldnation' | 'generic';
  email: PastedEmail;
};

/**
 * Split a pasted email into its parts.
 *
 * Handles the shapes people actually paste: a raw .eml with real headers, an
 * Outlook forward block (`From:` / `Sent:` / `To:` / `Subject:`), a Gmail
 * forward (`---------- Forwarded message ---------`), and the case where
 * someone pastes only the body with no headers at all.
 */
export function splitPastedEmail(raw: string): PastedEmail {
  const text = (raw ?? '').replace(/\r\n/g, '\n').trim();
  if (!text) return { sender: '', subject: '', body: '' };

  // Gmail's forward banner repeats the real headers underneath it; drop it so
  // the header scan below sees the originals rather than the wrapper.
  const forwarded = text.replace(/^-+\s*Forwarded message\s*-+\n/im, '');

  const header = (name: string): string => {
    const m = forwarded.match(new RegExp(`^${name}:[ \\t]*(.+)$`, 'im'));
    return m?.[1]?.trim() ?? '';
  };

  const fromLine = header('From');
  // "Dispatch <automation@app.smartsheet.com>" → the address; bare address stays.
  const sender = fromLine.match(/<([^>]+)>/)?.[1]?.trim() ?? fromLine;
  const subject = header('Subject');

  // The body starts after the last recognised header line. Without headers the
  // whole paste is the body and the first non-empty line stands in as subject.
  const headerRe = /^(from|sent|date|to|cc|bcc|subject|reply-to|importance|attachments):[ \t]*.*$/gim;
  let lastHeaderEnd = 0;
  for (const m of forwarded.matchAll(headerRe)) {
    lastHeaderEnd = Math.max(lastHeaderEnd, (m.index ?? 0) + m[0].length);
  }
  const body = (lastHeaderEnd > 0 ? forwarded.slice(lastHeaderEnd) : forwarded).trim();

  return {
    sender,
    subject: subject || forwarded.split('\n').find((l) => l.trim())?.trim() || '',
    body: body || forwarded,
  };
}

/** MM/DD/YY or MM/DD/YYYY → YYYY-MM-DD. Two-digit years are assumed 20xx. */
function toIso(d: string): string | null {
  const m = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!m) return null;
  const [, mm, dd, yy] = m;
  const year = yy.length === 2 ? `20${yy}` : yy;
  return `${year}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july',
  'august', 'september', 'october', 'november', 'december'];

/** "July 16, 2026" / "Jul 16 2026" → YYYY-MM-DD. */
function longDateToIso(text: string): string | null {
  const m = text.match(/\b([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})\b/);
  if (!m) return null;
  const idx = MONTHS.findIndex((mo) => mo.startsWith(m[1].toLowerCase()));
  if (idx < 0) return null;
  return `${m[3]}-${String(idx + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

/**
 * Last-resort scrape for an email neither dispatch parser recognises.
 *
 * Pulls only what's confidently identifiable — a labelled site number, a ticket
 * or FLN reference, a date, a brand name. Everything it isn't sure about is
 * left blank for the reviewer rather than guessed at, because a wrong customer
 * on a work order is worse than an empty field.
 */
/** First value for a labelled field, or ''. */
function field(text: string, label: string): string {
  return text.match(labelRe(label, 'im'))?.[1]?.trim().replace(/[.,;]$/, '') ?? '';
}

/**
 * Everything under "Scope" up to the next labelled field or a link — the scope
 * routinely runs over several lines and is the actual description of the work.
 */
function scopeBlock(text: string): string {
  const m = text.match(/^[ \t>]*scope[ \t]*[:#]?[ \t]*([\s\S]*)$/im);
  if (!m) return '';
  return m[1]
    .split('\n')
    .reduce<string[]>((acc, line) => {
      if (/^[ \t>]*(?:site[ \t]+)?(?:id|name|address|brand|date|fln|ticket)\b/i.test(line)) return acc;
      if (/https?:\/\//i.test(line)) return acc;
      acc.push(line.trim());
      return acc;
    }, [])
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * "410 Route 221 Hillside, NJ 07205" → city + state + zip where present.
 *
 * The city is whatever sits between the last separator and the state code.
 * Addresses here separate with a comma or a full stop and sometimes both —
 * "3600 Aramingo Ave.  Philadelphia, PA 19134" — so take the trailing segment
 * rather than everything preceding the state, which would swallow the street.
 */
export function splitAddress(address: string): { city: string; state: string; zip: string } {
  const m = address.match(/^(.*?)[,\s]+([A-Z]{2})[.,]?\s*(\d{5})?\s*$/);
  if (!m) return { city: '', state: '', zip: '' };

  const head = m[1].trim();

  // Preferred: an explicit separator — "…Ave.  Philadelphia", "…Road. West Deptford".
  const segments = head.split(/[,.]\s+|\s{2,}/).map((s) => s.trim()).filter(Boolean);
  let city = segments.at(-1) ?? '';

  // "410 Route 221 Hillside" has no separator at all. In a street address the
  // city is what follows the last number, so cut there. Best-effort: the full
  // address is always stored intact, so a miss costs a filter, not the record.
  if (segments.length === 1) {
    const words = city.split(/\s+/);
    const lastNumeric = words.map((w) => /\d/.test(w)).lastIndexOf(true);
    if (lastNumeric >= 0 && lastNumeric < words.length - 1) {
      city = words.slice(lastNumeric + 1).join(' ');
    }
  }

  return { city, state: m[2], zip: m[3] ?? '' };
}

/** Strip Re:/Fwd: and take the first path segment — "RE: Wendys / NJ" → "Wendys". */
export function customerFromSubject(subject: string): string {
  const clean = subject.replace(/^\s*(re|fw|fwd)\s*:\s*/gi, '').trim();
  const first = clean.split('/')[0].trim();
  // Only trust a short leading segment; a long one is a sentence, not a brand.
  return first && first.length <= 30 && first !== clean ? first : '';
}

export function parseGenericEmail(email: PastedEmail): ParsedNetviewFields {
  const text = `${email.subject}\n${email.body}`;

  const siteId = (field(text, 'id') || field(text, 'number') || field(text, 'store'))
    .split(/\s+/)[0] ?? '';
  const ticket = (field(text, 'fln number') || field(text, 'ticket number')
    || field(text, 'work order') || field(text, 'reference')).split(/\s+/)[0] ?? '';

  const dateRaw = field(text, 'date').match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/)?.[1]
    ?? text.match(/\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/)?.[1];
  const startDate = (dateRaw ? toIso(dateRaw) : null) ?? longDateToIso(text);

  const brand = field(text, 'brand') || customerFromSubject(email.subject);
  const address = field(text, 'address');
  const siteName = field(text, 'name');
  const scope = scopeBlock(email.body);

  // A named site is the best title — "Hillside #1331" reads correctly on a work
  // order and on the Site Log. Fall back to the subject, then the address.
  const title = siteName
    ? `${siteName}${siteId ? ` #${siteId}` : ''}`
    : (email.subject.trim() || address || 'Pasted email');

  return {
    title: title.slice(0, 120),
    description: (scope || email.body.trim()).slice(0, 4000),
    customer_name: brand,
    client_reference: siteId,
    external_wo_id: ticket,
    start_date: startDate,
    site_name: siteName || null,
    site_address: address || null,
    ...splitAddress(address),
  };
}

/**
 * Labels that begin a per-job block. Order doesn't matter — the splitter works
 * out which one actually repeats in a given email.
 */
const BLOCK_LABELS = [
  'id', 'brand', 'store', 'name', 'location',
  'address', 'fln number', 'ticket number', 'work order',
];

/**
 * Match a labelled field at the start of a line.
 *
 * The separator is optional on purpose. Real dispatch emails are typed by hand
 * and mix every variant in one message — "Site ID 1331", "Site ID: 9291",
 * "Site ID  452", "Site Name : Rising Sun", "Site Address:". Requiring a colon
 * finds one job in an email that contains eighteen.
 */
const labelRe = (label: string, flags = 'gim') =>
  // `[:#]*` not `[:#]?` — "Work Order #:" uses two separator characters.
  new RegExp(`^[ \\t>]*(?:site[ \\t]+)?${label.replace(/ /g, '[ \\t]+')}[ \\t]*[:#]*[ \\t]*(\\S.*)$`, flags);

/**
 * Split a body that carries SEVERAL jobs into one chunk per job.
 *
 * One email routinely covers a run of sites — each with its own site number and
 * address — and every one of those is a separate work order. Rather than hard-code
 * a layout, this finds the label that actually repeats and cuts on it.
 *
 * Picking the anchor: among the labels that occur most often, take the one whose
 * first occurrence is earliest. That's the label that opens each block, so
 * cutting there keeps a job's own fields with it instead of stranding them at
 * the end of the previous chunk.
 *
 * Anything before the first cut is preamble — shared instructions, a greeting —
 * and is returned separately so per-job blocks can inherit fields stated once at
 * the top (the brand or the project scope, typically).
 */
export function splitJobSections(body: string): { preamble: string; sections: string[] } {
  const text = (body ?? '').replace(/\r\n/g, '\n');
  if (!text.trim()) return { preamble: '', sections: [] };

  let best: { label: string; positions: number[] } | null = null;
  for (const label of BLOCK_LABELS) {
    const positions = [...text.matchAll(labelRe(label))].map((m) => m.index ?? 0);
    if (positions.length < 2) continue;
    if (
      !best
      || positions.length > best.positions.length
      || (positions.length === best.positions.length && positions[0] < best.positions[0])
    ) {
      best = { label, positions };
    }
  }

  // Nothing repeats → one job, the whole body.
  if (!best) return { preamble: '', sections: [text.trim()] };

  const cuts = best.positions;
  const preamble = text.slice(0, cuts[0]).trim();
  const sections = cuts
    .map((start, i) => text.slice(start, cuts[i + 1] ?? text.length).trim())
    .filter(Boolean);

  return { preamble, sections };
}

/** Fill blanks in a per-job parse from fields the email stated once, up top. */
function inherit(job: ParsedNetviewFields, shared: ParsedNetviewFields): ParsedNetviewFields {
  return {
    ...job,
    customer_name: job.customer_name || shared.customer_name,
    start_date: job.start_date ?? shared.start_date,
    description: job.description || shared.description,
  };
}

/**
 * Parse a pasted email, preferring the specific dispatch parsers and falling
 * back to the generic scrape. Returns null only for an empty paste.
 *
 * `jobs` holds one entry per work order found. A single-job email yields one, so
 * callers can always just iterate it.
 */
export function parsePastedEmail(raw: string): PastedParse | null {
  const email = splitPastedEmail(raw);
  if (!email.subject && !email.body) return null;

  if (isNetviewDispatchEmail(email.sender, email.subject)) {
    const fields = parseNetviewDispatchEmail(email.subject, email.body);
    if (fields) return { fields, jobs: [fields], matched: 'netview', email };
  }

  if (isFieldNationRoutedEmail(email.sender, email.subject, email.body)) {
    const fields = parseFieldNationRoutedEmail(email.subject, email.body);
    if (fields) return { fields, jobs: [fields], matched: 'fieldnation', email };
  }

  const { preamble, sections } = splitJobSections(email.body);

  if (sections.length <= 1) {
    const fields = parseGenericEmail(email);
    return { fields, jobs: [fields], matched: 'generic', email };
  }

  // Shared context parsed once from the preamble, then folded into each job.
  const shared = parseGenericEmail({ ...email, body: preamble });

  const jobs = sections
    .map((body) => inherit(parseGenericEmail({ ...email, body }), shared))
    // A block with neither a site nor a ticket can't be told apart from its
    // neighbours, and would dedupe into one. Drop it rather than merge jobs.
    .filter((f) => f.client_reference || f.external_wo_id);

  if (jobs.length === 0) {
    const fields = parseGenericEmail(email);
    return { fields, jobs: [fields], matched: 'generic', email };
  }

  return { fields: jobs[0], jobs, matched: 'generic', email };
}
