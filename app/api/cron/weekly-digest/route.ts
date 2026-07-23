import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildWeeklyDigest } from '@/lib/weekly-digest';

// Monday money brief — triggered by Vercel Cron (vercel.json, Mondays 12:00 UTC
// ≈ 8am ET). Same shared-secret auth as the email-import cron.
export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const digest = await buildWeeklyDigest(admin);

  const resend = new Resend(process.env.RESEND_API_KEY);
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
