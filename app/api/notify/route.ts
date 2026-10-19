import { techAppEmail, techAppInviteBlock } from '@/lib/tech-app-email';
import { onboardingEmail } from '@/lib/onboarding-email';
import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { portalInviteEmail, techJobUrl, type PortalWOSummary } from '@/lib/email-templates';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { newWorkOrderPush, pushToTech } from '@/lib/tech-push';
import { newJobNeedsEmail, newWorkOrderText, textPhone, type TextResult } from '@/lib/tech-text';

const OWNER_EMAIL = 'fajsolutions@gmail.com';

// Types that go to the owner (Fred), not the contractor
const OWNER_TYPES = new Set(['contractor_accepted', 'contractor_status_update', 'import_queue_pending', 'w9_filed']);

export async function POST(req: NextRequest) {
  const resend = new Resend(process.env.RESEND_API_KEY);
  const body = await req.json();

  // Owner-facing types are safe to leave open: the recipient is hard-coded to
  // Fred, and the portal's server actions (no session cookie) rely on them.
  // Everything else emails an arbitrary address, so it requires a signed-in
  // session — otherwise this endpoint is an open relay on a public URL.
  let signedInId: string | null = null;
  if (!OWNER_TYPES.has(body.type)) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    signedInId = user.id;
  }
  const { type, contractor_email, contractor_name, wo_number, title, status, amount, portal_url, work_orders, count,
    wo_id, portal_token, pay, reference, site, schedule } = body;

  // Contractor email only required for contractor-facing notification types
  if (!OWNER_TYPES.has(type) && !contractor_email) {
    return NextResponse.json({ error: 'No contractor email' }, { status: 400 });
  }

  const from = process.env.FROM_EMAIL || 'FAJ Solutions <support@fajsolutions.com>';
  let subject = '';
  let html = '';

  if (type === 'wo_assigned') {
    const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.fajsolutions.com';
    const canRespond = !!(portal_token && wo_id);
    const respond = canRespond ? `${base}/api/portal/respond?token=${portal_token}&wo=${wo_id}` : null;
    // The job in the tech app, not the old portal (lib/email-templates.ts techJobUrl).
    const jobUrl = wo_id ? techJobUrl(base, wo_id) : `${base}/tech`;
    subject = `Work Order #${wo_number} Assigned to You — please accept or decline`;
    html = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
        <h2 style="color:#0D7377;">New Work Order Assigned</h2>
        <p>Hi ${contractor_name},</p>
        <p>You've been assigned a new work order:</p>
        <div style="background:#f9f9f9;padding:16px;border-radius:8px;margin:16px 0;">
          <p style="margin:4px 0;"><strong>WO #:</strong> ${wo_number}</p>
          ${title ? `<p style="margin:4px 0;"><strong>Job:</strong> ${title}</p>` : ''}
          ${reference ? `<p style="margin:4px 0;"><strong>On-Site Reference:</strong> ${reference}</p>` : ''}
          ${schedule ? `<p style="margin:4px 0;"><strong>Schedule:</strong> ${schedule}</p>` : ''}
          ${site ? `<p style="margin:4px 0;"><strong>Site:</strong> ${site}</p>` : ''}
          ${pay && Number(pay) > 0 ? `<p style="margin:4px 0;"><strong>Your Pay:</strong> $${Number(pay).toFixed(2)}</p>` : ''}
        </div>
        ${canRespond ? `
        <div style="text-align:center;margin:24px 0;">
          <div style="font-size:13px;color:#555;margin-bottom:12px;font-weight:600;">Can you take this job?</div>
          <a href="${respond}&action=accept" style="display:inline-block;background:#047857;color:#fff;padding:14px 30px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;margin:0 6px 8px;">✓ Accept Job</a>
          <a href="${respond}&action=decline" style="display:inline-block;background:#fff;color:#b91c1c;border:2px solid #b91c1c;padding:12px 30px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;margin:0 6px 8px;">✗ Decline</a>
        </div>` : ''}
        <p style="text-align:center;"><a href="${jobUrl}" style="color:#0D7377;font-weight:600;">Open the job in the FAJ Tech app ↗</a></p>
        __APP_INVITE__
        <p style="color:#888;font-size:12px;">— FAJ Solutions</p>
      </div>
    `;
  } else if (type === 'status_change') {
    subject = `WO #${wo_number} Status: ${status}`;
    html = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
        <h2 style="color:#0D7377;">Work Order Status Update</h2>
        <p>Hi ${contractor_name},</p>
        <p>Work Order <strong>#${wo_number}</strong>${title ? ` (${title})` : ''} has been updated to: <strong>${status}</strong></p>
        <p>Open the FAJ Tech app for details.</p>
        <p style="color:#888;font-size:12px;">— FAJ Solutions</p>
      </div>
    `;
  } else if (type === 'payment_recorded') {
    subject = `Payment Recorded — WO #${wo_number}`;
    html = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
        <h2 style="color:#047857;">Payment Recorded</h2>
        <p>Hi ${contractor_name},</p>
        <p>A payment of <strong>$${Number(amount).toFixed(2)}</strong> has been recorded for Work Order <strong>#${wo_number}</strong>.</p>
        <p>Log in to the contractor portal to view your payment history.</p>
        <p style="color:#888;font-size:12px;">— FAJ Solutions</p>
      </div>
    `;
  } else if (type === 'portal_link') {
    const woCount = Array.isArray(work_orders) ? work_orders.length : 0;
    subject = `Your Work Orders from FAJ Solutions`;
    html = portalInviteEmail(
      contractor_name,
      portal_url ?? '',
      (work_orders ?? []) as PortalWOSummary[],
    );
    // Update subject to mention WO count if available
    if (woCount > 0) subject = `You have ${woCount} work order${woCount !== 1 ? 's' : ''} from FAJ Solutions`;
  } else if (type === 'onboarding') {
    // Asks only for what's still missing (lib/onboarding-email.ts).
    ({ subject, html } = onboardingEmail({
      name: contractor_name ?? '',
      portalUrl: portal_url ?? '',
      needsW9: body.needs_w9 !== false,
      needsAgreement: body.needs_agreement !== false,
    }));
  } else if (type === 'tech_app') {
    // The tech app and how to get in (lib/tech-app-email.ts). Tech side only.
    ({ subject, html } = techAppEmail({
      name: contractor_name ?? '',
      email: contractor_email ?? '',
      appUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.fajsolutions.com'}/tech`,
      hasLogin: body.has_login === true,
    }));
  } else if (type === 'w9_filed') {
    // Goes to Fred, not the tech — the tech already knows they filed it.
    subject = `📋 ${contractor_name ?? 'A contractor'} filed their ${status === 'contract' ? 'signed agreement' : 'W-9'}`;
    html = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
        <h2 style="color:#0D7377;">Paperwork received</h2>
        <p><strong>${contractor_name ?? 'A contractor'}</strong> just filed their
        ${status === 'contract' ? 'signed contractor agreement' : status === 'w9_details' ? 'W-9 details' : 'W-9 form'}.</p>
        ${status === 'w9_details'
          ? '<p>Their legal name, tax ID and address are now on their record, so they are ready to send to QuickBooks.</p>'
          : status === 'w9'
            ? '<p>The signed form is on file. Open their record to check the details are filled in before sending to QuickBooks.</p>'
            : ''}
        <p style="color:#888;font-size:12px;">— FAJ Business Manager</p>
      </div>
    `;
  } else if (type === 'contractor_accepted') {
    // Contractor accepted a WO — notify Fred
    subject = `✅ ${contractor_name} accepted WO #${wo_number}`;
    html = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
        <h2 style="color:#047857;">Work Order Accepted</h2>
        <p><strong>${contractor_name}</strong> has accepted Work Order <strong>#${wo_number}</strong>${title ? ` — ${title}` : ''}.</p>
        <p style="color:#888;font-size:12px;">— FAJ Solutions Contractor Portal</p>
      </div>
    `;
  } else if (type === 'contractor_status_update') {
    // Contractor updated WO status — notify Fred
    subject = `🔄 ${contractor_name} updated WO #${wo_number} → ${status}`;
    html = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
        <h2 style="color:#0D7377;">Work Order Status Update</h2>
        <p><strong>${contractor_name}</strong> updated Work Order <strong>#${wo_number}</strong>${title ? ` — ${title}` : ''} to: <strong>${status}</strong></p>
        <p style="color:#888;font-size:12px;">— FAJ Solutions Contractor Portal</p>
      </div>
    `;
  } else if (type === 'import_queue_pending') {
    subject = `📥 ${count} new Netview dispatch${count !== 1 ? 'es' : ''} awaiting review`;
    html = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
        <h2 style="color:#0D7377;">Email Import — Review Needed</h2>
        <p><strong>${count}</strong> new Netview dispatch email${count !== 1 ? 's were' : ' was'} parsed and ${count !== 1 ? 'are' : 'is'} waiting in your Import Queue for approval before becoming work orders.</p>
        <p style="color:#888;font-size:12px;">— FAJ Solutions</p>
      </div>
    `;
  } else {
    return NextResponse.json({ error: 'Unknown notification type' }, { status: 400 });
  }

  // Owner-facing types go to Fred; all others go to the contractor
  const to = OWNER_TYPES.has(type) ? OWNER_EMAIL : contractor_email;

  // New jobs (Fred, 2026-10-18): the first time, the tech gets this email with
  // their portal and the app. Once they're in the tech app, new jobs go to the
  // phone instead — the app's pop-up and, once Twilio is set up, a text to their
  // number — and the email is skipped. If neither reaches them (pop-ups off, no
  // texting yet), the email still goes, so a job is never missed.
  let pushed = 0;
  let texted: TextResult | 'not_tried' = 'not_tried';
  if (type === 'wo_assigned') {
    let inApp = false;
    if (wo_id && signedInId && contractor_name) {
      const admin = createAdminClient();
      const { data: tech } = await admin.from('contractors').select('auth_user_id, phone')
        .eq('user_id', signedInId).eq('name', contractor_name).maybeSingle();
      const t = tech as { auth_user_id?: string | null; phone?: string | null } | null;
      inApp = !!t?.auth_user_id;
      if (inApp) {
        try {
          pushed = await pushToTech(admin, signedInId, contractor_name, newWorkOrderPush({ woId: wo_id, woNumber: wo_number, title, schedule }));
        } catch { /* falls back below */ }
        const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.fajsolutions.com';
        texted = await textPhone(t?.phone, newWorkOrderText({ woNumber: wo_number, title, schedule, link: `${base}/tech?wo=${wo_id}` }));
      }
    }
    if (!newJobNeedsEmail({ inApp, pushed, texted })) {
      return NextResponse.json({ ok: true, pushed, texted, emailed: false });
    }
    // First time (not in the app yet): the email also shows how to get the app.
    html = html.replace('__APP_INVITE__', inApp ? '' : techAppInviteBlock(`${process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.fajsolutions.com'}/tech`));
  }

  try {
    await resend.emails.send({
      from,
      to,
      subject,
      html,
      replyTo: process.env.REPLY_TO_EMAIL || undefined,
    });
    return NextResponse.json({ ok: true, pushed, texted, emailed: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
