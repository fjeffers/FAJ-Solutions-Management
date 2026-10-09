import { NextResponse } from 'next/server';
import { isPracticeCopy } from '@/lib/practice';
import { Resend } from 'resend';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildDailyBrief } from '@/lib/daily-brief';

// Weekday morning brief — triggered by Vercel Cron (vercel.json, Tue–Fri 12:00 UTC
// ≈ 8am ET). Monday is skipped on purpose: the fuller weekly-digest already lands
// that morning and two emails in one morning trains Fred to ignore both.
//
// Same shared-secret auth as the other crons. `?force=1` sends even on a quiet day,
// which is how you test it without waiting for something to go wrong.
export async function GET(req: Request) {
  if (isPracticeCopy) return NextResponse.json({ ok: true, skipped: 'practice copy' });
  const authHeader = req.headers.get('authorization');
  // No secret set means no scheduled run at all (a blank secret would accept "Bearer undefined").
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const brief = await buildDailyBrief(admin);

  // A daily email that says "all clear" every day stops being read. On quiet days
  // we skip the send unless explicitly forced.
  const force = new URL(req.url).searchParams.get('force') === '1';
  if (brief.quiet && !force) {
    return NextResponse.json({ ok: true, skipped: 'nothing to report', stats: brief.stats });
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = process.env.FROM_EMAIL || 'FAJ Solutions <support@fajsolutions.com>';
  const to = process.env.NEXT_PUBLIC_ADMIN_EMAIL || 'fajsolutions@gmail.com';

  const { error } = await resend.emails.send({
    from,
    to,
    subject: brief.subject,
    html: brief.html,
  });

  if (error) {
    console.error('Daily brief send failed:', error);
    return NextResponse.json({ ok: false, error: JSON.stringify(error) }, { status: 500 });
  }
  return NextResponse.json({ ok: true, stats: brief.stats });
}
