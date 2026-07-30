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
  fields: ParsedNetviewFields;
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
export function parseGenericEmail(email: PastedEmail): ParsedNetviewFields {
  const text = `${email.subject}\n${email.body}`;

  const siteId = text.match(/\bsite\s*(?:id|#|number)?\s*[:#]\s*(\S+)/i)?.[1]?.replace(/[.,;]$/, '') ?? '';
  const ticket = text.match(/\b(?:ticket|work\s*order|wo|fln|ref(?:erence)?)\s*(?:number|#)?\s*[:#]\s*(\S+)/i)?.[1]
    ?.replace(/[.,;]$/, '') ?? '';

  const dateRaw = text.match(/\bdate\s*[:#]\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i)?.[1]
    ?? text.match(/\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/)?.[1];
  const startDate = (dateRaw ? toIso(dateRaw) : null) ?? longDateToIso(text);

  const brand = text.match(/\bbrand\s*[:#]\s*(.+)/i)?.[1]?.split('\n')[0]?.trim() ?? '';
  const address = text.match(/\baddress\s*[:#]\s*(.+)/i)?.[1]?.split('\n')[0]?.trim() ?? '';
  const scope = text.match(/\bscope\s*[:#]\s*(.+)/i)?.[1]?.split('\n')[0]?.trim() ?? '';

  // Subject is the most reliable title a human wrote; fall back to the address.
  const title = email.subject.trim() || address || 'Pasted email';

  return {
    title: title.slice(0, 120),
    description: [scope, address && `Address: ${address}`, email.body.trim()]
      .filter(Boolean).join('\n\n').slice(0, 4000),
    customer_name: brand,
    client_reference: siteId,
    external_wo_id: ticket,
    start_date: startDate,
  };
}

/**
 * Parse a pasted email, preferring the specific dispatch parsers and falling
 * back to the generic scrape. Returns null only for an empty paste.
 */
export function parsePastedEmail(raw: string): PastedParse | null {
  const email = splitPastedEmail(raw);
  if (!email.subject && !email.body) return null;

  if (isNetviewDispatchEmail(email.sender, email.subject)) {
    const fields = parseNetviewDispatchEmail(email.subject, email.body);
    if (fields) return { fields, matched: 'netview', email };
  }

  if (isFieldNationRoutedEmail(email.sender, email.subject, email.body)) {
    const fields = parseFieldNationRoutedEmail(email.subject, email.body);
    if (fields) return { fields, matched: 'fieldnation', email };
  }

  return { fields: parseGenericEmail(email), matched: 'generic', email };
}
