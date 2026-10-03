// Turning an email into a support ticket (migration-104). Shared by the Gmail
// scan (lib/email-import-scan.ts) and the paste box (/api/support/from-email):
// sort it with the bot, then file it as a 'new' ticket for Fred to approve.
// A bot failure never loses the email - it is filed under Needs Fred with the
// error noted, and "Sort again" on the ticket retries it.
import type { SupabaseClient } from '@supabase/supabase-js';
import { triageEmail, cleanTriage, type SupportEmail, type TriageOutcome } from './support-triage';

/** Plain text from an HTML email body: tags out, line breaks kept, entities decoded. */
export function htmlToText(html: string): string {
  return (html ?? '')
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/gi, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** "Dana Ruiz <dana@example.com>" → name and address; a bare address stays an address. */
export function senderParts(from: string): { name: string; email: string } {
  const f = (from ?? '').trim();
  const m = f.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim(), email: m[2].trim().toLowerCase() };
  return /@/.test(f) ? { name: '', email: f.toLowerCase() } : { name: f, email: '' };
}

/** The ticket columns that come from the bot's answer. */
export function triageColumns(t: TriageOutcome) {
  const r = t.result;
  return {
    suggested_queue: r.queue,
    suggested_reason: r.reason,
    summary: r.summary || null,
    urgent: r.urgent,
    client_name: r.client_name || null,
    site: r.site || null,
    wo_number: r.wo_number || null,
    contact_name: r.contact_name || null,
    contact_phone: r.contact_phone || null,
    job_title: r.job_title || null,
    draft_reply: r.draft_reply || null,
    triage_model: t.model,
    triage_usage: t.usage ?? null,
    triage_error: t.error,
  };
}

/** Sort an email, or explain why it couldn't be - never throws. */
export async function sortSafely(email: SupportEmail, triage = triageEmail): Promise<TriageOutcome> {
  const failed = (why: string, error: string): TriageOutcome =>
    ({ result: cleanTriage({ queue: 'needs_fred', reason: why }), model: null, usage: null, stopReason: null, error });
  if (!process.env.ANTHROPIC_API_KEY) return failed('The bot is not set up on this server, so Fred sorts this one.', 'no_key');
  try {
    return await triage(email);
  } catch (err) {
    const status = (err as { status?: number })?.status;
    return failed('The bot could not reach the AI just now. Press "Sort again" to retry.', `api_error${status ? `_${status}` : ''}`);
  }
}

export type IncomingEmail = SupportEmail & { gmailMessageId?: string; gmailThreadId?: string; receivedAt?: string };

/** Sort and file one email as a new ticket. Returns the new ticket, or null if this email is already a ticket. */
export async function fileSupportTicket(
  db: SupabaseClient, userId: string, email: IncomingEmail, source: 'email' | 'pasted', triage = triageEmail,
): Promise<{ id: string; queue: string } | null> {
  const outcome = await sortSafely(email, triage);
  const who = senderParts(email.from);
  const { data, error } = await db.from('support_tickets').insert({
    user_id: userId,
    source,
    gmail_message_id: email.gmailMessageId ?? null,
    gmail_thread_id: email.gmailThreadId ?? null,
    from_name: who.name || null,
    from_email: who.email || null,
    subject: email.subject || null,
    body: email.body,
    received_at: email.receivedAt ?? new Date().toISOString(),
    ...triageColumns(outcome),
  }).select('id, suggested_queue').single();
  if (error) {
    if (error.code === '23505') return null; // already filed (same Gmail message)
    throw new Error(`Couldn't file the ticket: ${error.message}`);
  }
  return { id: data.id as string, queue: data.suggested_queue as string };
}
