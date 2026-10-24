import { NextResponse } from 'next/server';
import { isPracticeCopy } from '@/lib/practice';
import { emailClient, EMAIL_NOT_SET_UP } from '@/lib/email-client';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildWeeklyDigest } from '@/lib/weekly-digest';

// Monday money brief — triggered by Vercel Cron (vercel.json, Mondays 12:00 UTC
// ≈ 8am ET). Same shared-secret auth as the email-import cron.
export async function GET(req: Request) {
  if (isPracticeCopy) return NextResponse.json({ ok: true, skipped: 'practice copy' });
  const authHeader = req.headers.get('authorization');
  // No secret set means no scheduled run at all (a blank secret would accept "Bearer undefined").
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const digest = await buildWeeklyDigest(admin);

  const resend = emailClient();
  if (!resend) return NextResponse.json({ ok: false, error: EMAIL_NOT_SET_UP }, { status: 503 });
  const from = process.env.FROM_EMAIL || 'FAJ Solutions <support@fajsolutions.com>';
  const to = process.env.NEXT_PUBLIC_ADMIN_EMAIL || 'fajsolutions@gmail.com';

  const { error } = await resend.emails.send({
    from,
    to,
    subject: digest.subject,
    html: digest.html,
  });

  if (error) {
    console.error('Weekly digest send failed:', error);
    return NextResponse.json({ ok: false, error: JSON.stringify(error) }, { status: 500 });
  }
  return NextResponse.json({ ok: true, stats: digest.stats });
}
