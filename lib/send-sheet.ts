// "Send the sheet" (Fred, 2026-10-14: "need to send the sheet, not log into
// any app"). The project manager or client gets the live sheet's link by text
// or email — from Fred's own phone, prefilled, and he presses send. No texting
// service needed, nothing goes out on its own.
//
// Pure and unit-tested (lib/send-sheet.test.ts).
import { toE164 } from './project-alerts';

const first = (name: string) => name.trim().split(/\s+/)[0] ?? '';

/** The note that goes with the link. */
export function sheetInvite(project: string, url: string, name?: string | null): string {
  const hi = name && first(name) ? `Hi ${first(name)}, here's` : "Here's";
  return `${hi} the live project sheet for ${project}. It updates as our technicians work — no login needed:\n${url}\n\nFAJ Solutions`;
}

/** Opens the phone's Messages with the number and the note filled in ("?&body" works on iPhone and Android). */
export function smsHref(phone: string | null | undefined, body: string): string {
  const to = phone ? toE164(phone) ?? '' : '';
  return `sms:${to}?&body=${encodeURIComponent(body)}`;
}

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

/** Opens the email app with the address, subject and note filled in. */
export function mailtoHref(email: string | null | undefined, project: string, body: string): string {
  const to = email && EMAIL.test(email.trim()) ? email.trim() : '';
  return `mailto:${to}?subject=${encodeURIComponent(`Live project sheet: ${project}`)}&body=${encodeURIComponent(body)}`;
}
