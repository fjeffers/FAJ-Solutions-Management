import type { ParsedNetviewFields } from '@/lib/types';

/**
 * Parses "NETVIEW DISPATCH FOR ... - Site: NNNN on MM/DD/YY" emails from
 * automation@app.smartsheet.com (Wendy's account, via Netview). Format is
 * machine-generated and consistent — see the sample inspected 2026-07-01:
 *
 *   Subject: NETVIEW DISPATCH FOR Wend American Group - Site:  9531 on 07/01/26
 *   Body:    You have a dispatch schedule for 07/01/26 at Wend American Group
 *            in PHILADELPHIA PA
 *            Site ID:  9531
 *            Ticket Number:  FLN5092
 *            Scope:
 *            Wendy's Work Order:
 *            Adding one new camera to the Training Room...
 *            CONFIRM YOUR VISIT by opening the request and...
 */

const SENDER = 'automation@app.smartsheet.com';
const SUBJECT_MARKER = 'NETVIEW DISPATCH';

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** MM/DD/YY -> YYYY-MM-DD (assumes 20YY). */
function toIsoDate(mmddyy: string): string | null {
  const m = mmddyy.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
  if (!m) return null;
  const [, mm, dd, yy] = m;
  return `20${yy}-${mm}-${dd}`;
}

export function isNetviewDispatchEmail(sender: string, subject: string): boolean {
  return sender.toLowerCase().includes(SENDER) && subject.toUpperCase().includes(SUBJECT_MARKER);
}

export function parseNetviewDispatchEmail(subject: string, htmlBody: string): ParsedNetviewFields | null {
  const text = stripHtml(htmlBody);

  const dateMatch = text.match(/dispatch schedule for (\d{2}\/\d{2}\/\d{2})/i);
  const locationMatch = text.match(/dispatch schedule for [\d/]+ at (.+?) in ([A-Za-z\s]+?)\s+([A-Z]{2})\b/i);
  const siteIdMatch = text.match(/Site ID:\s*(\S+)/i);
  const ticketMatch = text.match(/Ticket Number:\s*(\S+)/i);
  const scopeMatch = text.match(/Scope:\s*(?:Wendy'?s Work Order:\s*)?([\s\S]*?)(?:CONFIRM YOUR VISIT|$)/i);

  const siteId = siteIdMatch?.[1]?.trim();
  const ticketNumber = ticketMatch?.[1]?.trim();
  if (!siteId && !ticketNumber) return null; // not enough to identify/dedupe this dispatch

  const locationName = locationMatch?.[1]?.trim() ?? '';
  const city = locationMatch?.[2]?.trim() ?? '';
  const state = locationMatch?.[3]?.trim() ?? '';
  const scope = scopeMatch?.[1]?.replace(/\s+/g, ' ').trim() ?? '';
  const startDate = dateMatch ? toIsoDate(dateMatch[1]) : null;

  return {
    title: `Netview Dispatch — Site ${siteId ?? '?'}${locationName ? ` (${locationName})` : ''}`,
    description: scope || subject,
    customer_name: "Wendy's",
    client_reference: siteId ?? '',
    external_wo_id: ticketNumber ?? '',
    start_date: startDate,
    // city/state aren't part of ParsedNetviewFields's required WO-mapping shape below,
    // but are folded into the title/description above since faj-payments' work_orders
    // site_city/site_state are separate free-text fields the reviewer can fill in on
    // approval if needed — this import only pre-fills what's confidently extractable.
  };
}
