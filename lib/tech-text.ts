// Text messages to a tech's phone number (Fred, 2026-10-18: new jobs reach a
// tech "on their phone using the app and phone number"). Uses Twilio, the same
// account as project alert texts (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
// TWILIO_FROM_NUMBER in Vercel). Until Fred adds those, nothing is sent and the
// caller falls back to the app pop-up or the email.
import { toE164 } from './project-alerts';

export type TextResult = 'sent' | 'no_phone' | 'not_set_up' | 'failed';

export function textingReady(): boolean {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER);
}

/** The text for a new job: what, when and a link — no address, no pay. */
export function newWorkOrderText(o: { woNumber: string; title?: string | null; schedule?: string | null; link: string }): string {
  return [`FAJ Solutions: new assignment available, WO ${o.woNumber}`, o.title || null, o.schedule || null, `Open: ${o.link}`]
    .filter(Boolean).join('\n').slice(0, 480);
}

export async function textPhone(phone: string | null | undefined, body: string): Promise<TextResult> {
  const to = toE164(phone);
  if (!to) return 'no_phone';
  if (!textingReady()) return 'not_set_up';
  const sid = process.env.TWILIO_ACCOUNT_SID as string;
  const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
  try {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: to, From: process.env.TWILIO_FROM_NUMBER as string, Body: body }),
    });
    return r.ok ? 'sent' : 'failed';
  } catch {
    return 'failed';
  }
}

/** A new job's email is skipped only once the tech is in the app AND the phone
 *  pop-up or the text really reached them. Otherwise the email still goes, so a
 *  job is never missed. */
export function newJobNeedsEmail(o: { inApp: boolean; pushed: number; texted: TextResult | 'not_tried' }): boolean {
  return !(o.inApp && (o.pushed > 0 || o.texted === 'sent'));
}
