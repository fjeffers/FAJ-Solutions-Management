import { createAdminClient } from '@/lib/supabase/admin';
import { refreshAccessToken, listMessages, getMessage, getMessageForSupport } from '@/lib/gmail';
import { fileSupportTicket, htmlToText } from '@/lib/support-intake';
import { isNetviewDispatchEmail, parseNetviewDispatchEmail } from '@/lib/email-parsers/netview-smartsheet';
import { isFieldNationRoutedEmail, parseFieldNationRoutedEmail } from '@/lib/email-parsers/fieldnation';

const NETVIEW_QUERY = 'from:automation@app.smartsheet.com subject:"NETVIEW DISPATCH" newer_than:2d';
const FIELDNATION_QUERY = 'from:support@fieldnation.com subject:"Routed WO" newer_than:2d';
// Mail to support@ becomes a support ticket (migration-104). Dispatch feeds are
// handled above, and FAJ's own mail (the app's notices, Fred's replies) is not a ticket.
const SUPPORT_QUERY = 'to:support@fajsolutions.com newer_than:2d -from:fajsolutions.com -from:fieldnation.com -from:smartsheet.com';

/**
 * Scans one user's connected Gmail for both supported sources and queues new items for
 * review. Shared by the scheduled cron route and the manual "Check Now" button — same
 * logic, different trigger.
 */
export async function scanGmailConnection(conn: {
  id: string; user_id: string; access_token: string; refresh_token: string; token_expires_at: string | null;
}): Promise<number> {
  const admin = createAdminClient();

  let accessToken = conn.access_token;
  if (!conn.token_expires_at || new Date(conn.token_expires_at) <= new Date()) {
    const refreshed = await refreshAccessToken(conn.refresh_token);
    accessToken = refreshed.access_token;
    await admin.from('gmail_connections').update({
      access_token: accessToken,
      token_expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
    }).eq('id', conn.id);
  }

  let imported = 0;

  // Netview/Smartsheet
  for (const summary of await listMessages(accessToken, NETVIEW_QUERY)) {
    const { subject, from, htmlBody } = await getMessage(accessToken, summary.id);
    if (!isNetviewDispatchEmail(from, subject)) continue;
    const parsed = parseNetviewDispatchEmail(subject, htmlBody);
    if (!parsed) continue;
    const dedupeKey = `${parsed.external_wo_id || 'noticket'}-${parsed.client_reference || 'nosite'}`;
    const { error } = await admin.from('import_queue').insert({
      user_id: conn.user_id,
      source: 'netview_smartsheet',
      external_dedupe_key: dedupeKey,
      parsed_fields: parsed,
      raw_snippet: subject,
    });
    if (!error) imported++;
  }

  // FieldNation — only "Routed WO" (assigned to Frederick Jeffers), never open "New Work" postings.
  for (const summary of await listMessages(accessToken, FIELDNATION_QUERY)) {
    const { subject, from, htmlBody } = await getMessage(accessToken, summary.id);
    if (!isFieldNationRoutedEmail(from, subject, htmlBody)) continue;
    const parsed = parseFieldNationRoutedEmail(subject, htmlBody);
    if (!parsed) continue;
    const dedupeKey = `fn-${parsed.external_wo_id}`;
    const { error } = await admin.from('import_queue').insert({
      user_id: conn.user_id,
      source: 'field_nation',
      external_dedupe_key: dedupeKey,
      parsed_fields: parsed,
      raw_snippet: subject,
    });
    if (!error) imported++;
  }

  // Support tickets — sorted by the bot, waiting for Fred's approval. Messages
  // already filed are skipped before the bot runs, so none is paid for twice.
  const support = await listMessages(accessToken, SUPPORT_QUERY);
  if (support.length > 0) {
    const { data: seen } = await admin.from('support_tickets').select('gmail_message_id')
      .eq('user_id', conn.user_id).in('gmail_message_id', support.map((m) => m.id));
    const filed = new Set((seen ?? []).map((r) => r.gmail_message_id as string));
    for (const summary of support) {
      if (filed.has(summary.id)) continue;
      try {
        const m = await getMessageForSupport(accessToken, summary.id);
        const body = (m.text || htmlToText(m.html)).trim();
        if (!body && !m.subject) continue;
        const ticket = await fileSupportTicket(admin, conn.user_id, {
          from: m.from, to: m.to, subject: m.subject, date: m.date, body: body || '(empty)',
          gmailMessageId: summary.id, gmailThreadId: m.threadId || summary.threadId,
          receivedAt: m.date && !isNaN(Date.parse(m.date)) ? new Date(m.date).toISOString() : undefined,
        }, 'email');
        if (ticket) imported++;
      } catch (err) {
        console.error(`Support ticket from Gmail message ${summary.id} failed:`, err);
      }
    }
  }

  await admin.from('gmail_connections').update({ last_polled_at: new Date().toISOString() }).eq('id', conn.id);
  return imported;
}
