import { createAdminClient } from '@/lib/supabase/admin';
import { refreshAccessToken, listMessages, getMessage } from '@/lib/gmail';
import { isNetviewDispatchEmail, parseNetviewDispatchEmail } from '@/lib/email-parsers/netview-smartsheet';
import { isFieldNationRoutedEmail, parseFieldNationRoutedEmail } from '@/lib/email-parsers/fieldnation';

const NETVIEW_QUERY = 'from:automation@app.smartsheet.com subject:"NETVIEW DISPATCH" newer_than:2d';
const FIELDNATION_QUERY = 'from:support@fieldnation.com subject:"Routed WO" newer_than:2d';

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

  await admin.from('gmail_connections').update({ last_polled_at: new Date().toISOString() }).eq('id', conn.id);
  return imported;
}
