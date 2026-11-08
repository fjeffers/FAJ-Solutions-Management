import { NextResponse } from 'next/server';
import { isPracticeCopy } from '@/lib/practice';
import { emailClient, emailNotSetUp } from '@/lib/email-client';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildDailyBrief } from '@/lib/daily-brief';
import { billingWaiting, BILLING_SINCE, type BillingRow } from '@/lib/billing-waiting';
import { morningPush, onToday } from '@/lib/morning-push';
import { pushToUser } from '@/lib/tech-push';
import { enrichWorkOrders, todayISO } from '@/lib/utils';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Payment, WorkOrder } from '@/lib/types';

/** The 7 AM pop-up to the owner's phone (lib/morning-push.ts), every day; returns how many phones got it. */
async function sendMorningPush(admin: SupabaseClient, overdueTotal: number): Promise<number> {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [w, p, r, m, t, i] = await Promise.all([
    admin.from('work_orders').select('*').is('archived_at', null),
    admin.from('payments').select('*'),
    admin.from('job_log_rates').select('wo_id, rates, all_hours_rate, invoice, updated_at').gte('updated_at', `${BILLING_SINCE}T00:00:00`),
    admin.from('work_order_messages').select('id', { count: 'exact', head: true })
      .in('sender_role', ['contractor', 'client']).is('read_at', null).gte('created_at', since),
    admin.from('support_tickets').select('id', { count: 'exact', head: true }).eq('status', 'new'),
    admin.from('import_queue').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
  ]);
  const jobs = enrichWorkOrders((w.data ?? []) as WorkOrder[], (p.data ?? []) as Payment[]);
  const today = todayISO();
  const working = jobs.filter((j) => onToday(j, today) && !['Work Done', 'Approved', 'Paid'].includes(j.wo_status));
  const owed = jobs.filter((j) => j.remaining > 0.005);
  const msg = morningPush({
    jobsToday: working.length,
    noTech: working.filter((j) => !(j.contractor_names?.length || j.contractor_name?.trim())).length,
    unread: m.count ?? 0,
    emails: t.count ?? 0,
    imports: i.count ?? 0,
    invoicesToSend: billingWaiting((r.data ?? []) as BillingRow[], jobs).length,
    overdueTotal,
    owedTotal: owed.reduce((s, j) => s + j.remaining, 0),
  });
  if (!msg) return 0;
  const owners = [...new Set(jobs.map((j) => j.user_id).filter(Boolean))];
  let sent = 0;
  for (const uid of owners) sent += await pushToUser(admin, uid, msg);
  return sent;
}

// Morning brief — triggered by Vercel Cron (vercel.json, every day 12:00 UTC: 7am ET in winter, 8am in summer).
// Every day a short pop-up goes to the owner's phone; the email goes Tue–Fri. Monday is skipped on purpose: the fuller weekly-digest already lands
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
  const pushed = await sendMorningPush(admin, brief.stats.overdueTotal ?? 0).catch((e) => {
    console.error('Morning push failed:', e);
    return 0;
  });

  // The email stays Tue–Fri: Monday has the weekly digest, and weekends are quiet.
  const day = new Date().getUTCDay();
  if (day < 2 || day > 5) return NextResponse.json({ ok: true, pushed, skipped: 'email only Tue–Fri', stats: brief.stats });

  // A daily email that says "all clear" every day stops being read. On quiet days
  // we skip the send unless explicitly forced.
  const force = new URL(req.url).searchParams.get('force') === '1';
  if (brief.quiet && !force) {
    return NextResponse.json({ ok: true, pushed, skipped: 'nothing to report', stats: brief.stats });
  }

  const resend = emailClient();
  if (!resend) return NextResponse.json({ ok: false, error: emailNotSetUp() }, { status: 503 });
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
  return NextResponse.json({ ok: true, pushed, stats: brief.stats });
}
