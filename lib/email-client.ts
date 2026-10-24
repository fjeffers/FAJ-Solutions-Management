// The email sender (Resend), read from RESEND_API_KEY in Vercel.
//
// `new Resend()` throws when the key is missing, and a route that throws
// answers with an empty body, which the office saw as "Failed to execute
// 'json' on 'Response': Unexpected end of JSON input" on Send to tech (Fred,
// 2026-10-24). Routes ask for the client here and, without a key, answer
// with emailNotSetUp() instead.
import { Resend } from 'resend';

/** What the office sees when the server has no email key. Nothing was sent. */
export const EMAIL_NOT_SET_UP =
  "Email isn't set up on the server, so nothing was sent. RESEND_API_KEY is missing in Vercel (Settings → Environment Variables, Production). Add it, redeploy, then send again.";

/** The same on a Vercel preview, which has no email key on purpose: the live app has it. */
export const EMAIL_ON_PREVIEW =
  "This is a preview copy of the app, not app.fajsolutions.com, so it can't send email and nothing was sent. Open app.fajsolutions.com and send from there.";

/** What to tell the office when there is no key, for this copy of the app. */
export function emailNotSetUp(): string {
  return process.env.VERCEL_ENV === 'preview' ? EMAIL_ON_PREVIEW : EMAIL_NOT_SET_UP;
}

export function emailReady(): boolean {
  return !!process.env.RESEND_API_KEY?.trim();
}

/** The email client, or null when the server has no key. */
export function emailClient(): Resend | null {
  return emailReady() ? new Resend(process.env.RESEND_API_KEY!.trim()) : null;
}
