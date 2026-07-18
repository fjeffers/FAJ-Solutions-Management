import { createAdminClient } from '@/lib/supabase/admin';
import { scanGmailConnection } from '@/lib/email-import-scan';
import { NextResponse } from 'next/server';

// Triggered by Vercel Cron (see vercel.json), not a logged-in user — auth is a shared
// secret header instead of a Supabase session. Runs once daily (Hobby plan limit) — see
// app/api/import-queue/check-now/route.ts for the user-triggered on-demand equivalent.
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
      const imported = await scanGmailConnection(conn);
      totalImported += imported;

      if (imported > 0) {
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
        try {
          await fetch(`${baseUrl}/api/notify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'import_queue_pending', count: imported }),
          });
        } catch { /* non-blocking */ }
      }
    } catch (err) {
      console.error(`Email import failed for connection ${conn.id}:`, err);
    }
  }

  return NextResponse.json({ ok: true, imported: totalImported });
}
