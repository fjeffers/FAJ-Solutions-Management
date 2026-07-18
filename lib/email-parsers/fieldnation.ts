import type { ParsedNetviewFields } from '@/lib/types';

/**
 * Parses FieldNation "Routed WO" emails — jobs actually routed/assigned to Frederick Jeffers,
 * as opposed to "New Work" emails (open postings anyone nearby could pick up) or status-update
 * emails ("...has been marked incomplete..."). Only "Routed WO" is imported, per explicit
 * instruction — those are the ones that represent real assigned work.
 *
 * Sample inspected 2026-07-17, sender support@fieldnation.com:
 *   Subject: Routed WO: Freehold NJ 7728, Jul 17 8:00am
 *            (sometimes prefixed with a vendor name, e.g. "Xerox IT Solutions, LLC Routed WO: ...")
 *   Body:    ...routed work order 19559851 near Frederick Jeffers
 *            Service Title: AP Triage and Repair - INC0848425 - Replace old AP with new AP
 *            Location: Freehold, NJ 7728 ( 57 mi )
 *            Service Schedule: On Friday July 17th 2026 @ 8:00 AM
 *            Pay Rate: Fixed amount of $90 for first 2 hours. $45/hour for next 2 hours.
 *            Type of Work: Networking
 *            Service Description: ...
 */

const SENDER = 'support@fieldnation.com';

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

export function isFieldNationRoutedEmail(sender: string, subject: string, htmlBody: string): boolean {
  if (!sender.toLowerCase().includes(SENDER)) return false;
  if (!/Routed WO:/i.test(subject)) return false;
  // Belt-and-suspenders: confirm the body actually names Fred as the one it's routed to,
  // not just that the subject line says "Routed WO" (per explicit "assigned to Frederick
  // Jeffers only" requirement).
  const text = stripHtml(htmlBody);
  return /routed work order .*Frederick Jeffers/i.test(text) || /near Frederick Jeffers/i.test(text);
}

export function parseFieldNationRoutedEmail(subject: string, htmlBody: string): ParsedNetviewFields | null {
  const text = stripHtml(htmlBody);

  const woMatch = text.match(/routed work order (\d+)/i);
  const titleMatch = text.match(/Service Title:\s*(.+?)\s*\n/i);
  const locationMatch = text.match(/Location:\s*(.+?)\s*\(\s*[\d.]+\s*mi\s*\)/i);
  const payMatch = text.match(/Pay Rate:\s*(.+?)\s*\n/i);
  const typeMatch = text.match(/Type of Work:\s*(.+?)\s*\n/i);
  const descMatch = text.match(/Service Description:\s*\n?\s*([\s\S]*?)(?:View Work Order|Unsubscribe|$)/i);

  const woNumber = woMatch?.[1];
  if (!woNumber) return null; // can't dedupe/identify without the FN work order number

  const title = titleMatch?.[1]?.trim() || subject;
  const location = locationMatch?.[1]?.trim() ?? '';
  const payRate = payMatch?.[1]?.trim() ?? '';
  const typeOfWork = typeMatch?.[1]?.trim() ?? '';
  const description = descMatch?.[1]?.replace(/\s+/g, ' ').trim() ?? '';

  // Vendor/buyer name is sometimes prefixed on the subject line, e.g.
  // "Xerox IT Solutions, LLC Routed WO: Freehold NJ 7728, Jul 17 8:00am".
  const vendorMatch = subject.match(/^(.+?)\s+Routed WO:/i);
  const buyerCompany = vendorMatch?.[1]?.trim() ?? '';

  const descriptionParts = [
    description,
    typeOfWork ? `Type of Work: ${typeOfWork}` : '',
    payRate ? `Pay Rate (per FieldNation): ${payRate}` : '',
  ].filter(Boolean);

  return {
    title,
    description: descriptionParts.join('\n\n') || subject,
    customer_name: buyerCompany,
    client_reference: location,
    external_wo_id: woNumber,
    // FieldNation's "Service Schedule" is free-text ("On Friday July 17th 2026 @ 8:00 AM") —
    // left for manual entry on approval rather than risking a bad parse of varied date phrasing,
    // same call made for the Netview parser's date handling.
    start_date: null,
  };
}
