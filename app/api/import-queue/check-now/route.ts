import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { scanGmailConnection } from '@/lib/email-import-scan';
import { NextResponse } from 'next/server';

// User-triggered on-demand scan — the "Check Now" button. The scheduled cron only runs
// once a day (Vercel Hobby plan limit), so this is how near-real-time checking actually
// happens: the user clicks it whenever they want the latest.
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();
  const { data: conn } = await admin.from('gmail_connections').select('*').eq('user_id', user.id).single();
  if (!conn) return NextResponse.json({ error: 'Gmail not connected' }, { status: 400 });

  try {
    const imported = await scanGmailConnection(conn);
    return NextResponse.json({ ok: true, imported });
  } catch (err) {
    console.error('Manual email check failed:', err);
    return NextResponse.json({ error: 'Check failed — see server logs' }, { status: 500 });
  }
}
