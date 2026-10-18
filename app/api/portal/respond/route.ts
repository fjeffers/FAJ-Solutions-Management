import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { Resend } from 'resend';
import { declinedPush, pushToUser } from '@/lib/tech-push';

// One-click Accept / Decline from assignment emails.
// GET so it works as a plain email link: /api/portal/respond?token=..&wo=..&action=accept
// Auth = the contractor's portal token, same trust level as the portal itself.

const OWNER_EMAIL = 'fajsolutions@gmail.com';

function page(title: string, body: string, portalUrl?: string): NextResponse {
  return new NextResponse(
    `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
    <body style="margin:0;font-family:Georgia,serif;background:#faf7ef;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;">
      <div style="background:white;border-radius:16px;max-width:440px;width:100%;padding:40px;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <div style="font-size:13px;letter-spacing:3px;color:#C9A961;font-weight:700;margin-bottom:10px;">FAJ SOLUTIONS</div>
        <h1 style="font-size:26px;margin:0 0 12px;color:#1a1a1a;">${title}</h1>
        <p style="font-size:15px;color:#555;line-height:1.6;margin:0 0 24px;">${body}</p>
        ${portalUrl ? `<a href="${portalUrl}" style="display:inline-block;background:#0D7377;color:white;padding:13px 28px;border-radius:8px;text-decoration:none;font-family:sans-serif;font-weight:700;font-size:14px;">Open My Portal</a>` : ''}
      </div>
    </body></html>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') ?? '';
  const woId = req.nextUrl.searchParams.get('wo') ?? '';
  const action = req.nextUrl.searchParams.get('action') ?? '';

  if (!token || !woId || !['accept', 'decline'].includes(action)) {
    return page('Link problem', 'This link is incomplete. Open the email again and tap the button directly, or contact FAJ Solutions.');
  }

  const supabase = createAdminClient();

  const { data: contractor } = await supabase
    .from('contractors')
    .select('id, name, portal_token')
    .eq('portal_token', token)
    .maybeSingle();
  if (!contractor) {
    return page('Link expired', 'We couldn\'t verify this link. Contact FAJ Solutions and we\'ll resend your assignment.');
  }

  const { data: wo } = await supabase
    .from('work_orders')
    .select('id, user_id, wo_number, title, contractor_name, contractor_names, wo_status, assignment_responses')
    .eq('id', woId)
    .maybeSingle();
  if (!wo) {
    return page('Job not found', 'This work order no longer exists. Contact FAJ Solutions if you think that\'s a mistake.');
  }

  const assigned: string[] = (wo.contractor_names && wo.contractor_names.length > 0)
    ? wo.contractor_names
    : (wo.contractor_name ? [wo.contractor_name] : []);
  if (!assigned.includes(contractor.name)) {
    return page('Not your assignment', `WO #${wo.wo_number} isn't assigned to you anymore. Contact FAJ Solutions with any questions.`);
  }

  const status = action === 'accept' ? 'accepted' : 'declined';
  const responses = { ...(wo.assignment_responses ?? {}), [contractor.name]: { status, at: new Date().toISOString() } };

  const patch: Record<string, unknown> = { assignment_responses: responses, updated_at: new Date().toISOString() };
  if (action === 'accept') {
    // Mirror the portal's acknowledge behavior: stamp receipt, move Open -> Assigned
    patch.acknowledged_at = new Date().toISOString();
    if (wo.wo_status === 'Open') patch.wo_status = 'Assigned';
  }

  const { error } = await supabase.from('work_orders').update(patch).eq('id', woId);
  if (error) {
    return page('Something went wrong', 'Your response didn\'t save. Try the link again in a minute, or reply to the email.');
  }

  // Tell Fred either way — a decline especially needs eyes fast so the job gets re-covered.
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const accepted = action === 'accept';
    await resend.emails.send({
      from: process.env.FROM_EMAIL || 'FAJ Solutions <support@fajsolutions.com>',
      to: OWNER_EMAIL,
      subject: accepted
        ? `✅ ${contractor.name} ACCEPTED WO #${wo.wo_number}`
        : `🚨 ${contractor.name} DECLINED WO #${wo.wo_number} — needs re-covering`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
          <h2 style="color:${accepted ? '#047857' : '#b91c1c'};">${accepted ? 'Assignment accepted' : 'Assignment DECLINED'}</h2>
          <p><strong>${contractor.name}</strong> ${accepted ? 'accepted' : 'declined'} Work Order
            <strong>#${wo.wo_number}</strong>${wo.title ? ` — ${wo.title}` : ''}.</p>
          ${accepted ? '' : '<p style="color:#b91c1c;font-weight:700;">This job needs another tech.</p>'}
          <p style="color:#888;font-size:12px;">— FAJ Business Manager</p>
        </div>`,
    });
  } catch {
    // The response is saved; the owner email is best-effort.
  }
  // A decline also pops up on the office's phone (Fred, 2026-10-18).
  if (action === 'decline' && wo.user_id) {
    try {
      await pushToUser(supabase, wo.user_id, declinedPush({ woId: wo.id, woNumber: wo.wo_number, techName: contractor.name, title: wo.title }));
    } catch { /* the email went */ }
  }

  const portalUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.fajsolutions.com'}/portal/${contractor.portal_token}`;
  return action === 'accept'
    ? page(
        `You're on it — WO #${wo.wo_number}`,
        'Thanks for confirming. All the job details, check-in, and site reference numbers are in your portal.',
        portalUrl,
      )
    : page(
        `Declined — WO #${wo.wo_number}`,
        'Got it — FAJ Solutions has been notified so the job can be reassigned. Nothing else needed from you.',
        portalUrl,
      );
}
