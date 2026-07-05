import { createAdminClient } from '@/lib/supabase/admin';
import { refreshAccessToken, listMessages, getMessage } from '@/lib/gmail';
import { isNetviewDispatchEmail, parseNetviewDispatchEmail } from '@/lib/email-parsers/netview-smartsheet';
import { NextResponse } from 'next/server';

const GMAIL_QUERY = 'from:automation@app.smartsheet.com subject:"NETVIEW DISPATCH" newer_than:2d';

// Triggered by Vercel Cron (see vercel.json), not a logged-in user — auth is a shared
// secret header instead of a Supabase session.
export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: connections } = await admin.from('gmail_connections').select('*');
  if (!connections || connections.length === 0) {
    return NextResponse.json({ ok: true, connections: 0 });
  }

  let totalImported = 0;

  for (const conn of connections) {
    try {
      let accessToken = conn.access_token as string;
      if (!conn.token_expires_at || new Date(conn.token_expires_at) <= new Date()) {
        const refreshed = await refreshAccessToken(conn.refresh_token);
        accessToken = refreshed.access_token;
        await admin.from('gmail_connections').update({
          access_token: accessToken,
          token_expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
        }).eq('id', conn.id);
      }

      const messages = await listMessages(accessToken, GMAIL_QUERY);
      let imported = 0;

      for (const summary of messages) {
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
        // Unique constraint violation just means we've already queued this dispatch — expected, not an error.
        if (!error) imported++;
      }

      await admin.from('gmail_connections').update({ last_polled_at: new Date().toISOString() }).eq('id', conn.id);
      totalImported += imported;

      if (imported > 0) {
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
        try {
          await fetch(`${baseUrl}/api/notify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'import_queue_pending',
              count: imported,
            }),
          });
        } catch { /* non-blocking */ }
      }
    } catch (err) {
      console.error(`Email import failed for connection ${conn.id}:`, err);
    }
  }

  return NextResponse.json({ ok: true, imported: totalImported });
}
