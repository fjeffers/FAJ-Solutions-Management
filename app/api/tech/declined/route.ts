import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { declinedPush, pushToUser } from '@/lib/tech-push';

// POST /api/tech/declined { wo_number } — a tech turned a job down in the
// tech app (Fred, 2026-10-18: "I declined the job, it needs to go back to
// admin not disappear ... it should have gone back to Need a tech"). The
// email-link decline already told Fred; the app's decline told nobody. This
// tells the office by email and phone pop-up — only after checking, with the
// tech's own sign-in, that this tech really declined this job.
const OWNER_EMAIL = 'fajsolutions@gmail.com';

export async function POST(req: Request) {
  const supabase = await createClient('field');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { wo_number?: unknown };
  const woNumber = String(body.wo_number ?? '').slice(0, 40);
  if (!woNumber) return NextResponse.json({ ok: false }, { status: 400 });

  const admin = createAdminClient();
  const { data: me } = await admin.from('contractors').select('name, user_id').eq('auth_user_id', user.id).maybeSingle();
  const tech = me as { name?: string; user_id?: string } | null;
  if (!tech?.name || !tech.user_id) return NextResponse.json({ ok: false }, { status: 403 });

  const { data: w } = await admin.from('work_orders').select('id, wo_number, title, assignment_responses')
    .eq('user_id', tech.user_id).eq('wo_number', woNumber).maybeSingle();
  const wo = w as { id: string; wo_number: string; title: string | null; assignment_responses: Record<string, { status?: string } | null> | null } | null;
  if (!wo || wo.assignment_responses?.[tech.name]?.status !== 'declined') return NextResponse.json({ ok: false }, { status: 409 });

  let emailed = false;
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const r = await resend.emails.send({
      from: process.env.FROM_EMAIL || 'FAJ Solutions <support@fajsolutions.com>',
      to: OWNER_EMAIL,
      subject: `❌ ${tech.name} declined WO #${wo.wo_number} — needs a tech`,
      html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
        <h2 style="color:#b91c1c;">Work order declined</h2>
        <p><strong>${tech.name}</strong> declined Work Order <strong>#${wo.wo_number}</strong>${wo.title ? ` — ${wo.title}` : ''} in the tech app.</p>
        <p>It is back under <strong>Need a tech</strong> in WorkFlow.</p>
        <p style="color:#888;font-size:12px;">— FAJ Solutions</p></div>`,
      replyTo: process.env.REPLY_TO_EMAIL || undefined,
    });
    emailed = !r.error;
  } catch { /* the pop-up still goes */ }
  let pushed = 0;
  try {
    pushed = await pushToUser(admin, tech.user_id, declinedPush({ woId: wo.id, woNumber: wo.wo_number, techName: tech.name, title: wo.title }));
  } catch { /* the email went */ }
  return NextResponse.json({ ok: true, emailed, pushed });
}
