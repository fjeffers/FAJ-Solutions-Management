import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { portalInviteEmail, type PortalWOSummary } from '@/lib/email-templates';
import { createClient } from '@/lib/supabase/server';

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
  if (!OWNER_TYPES.has(body.type)) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { type, contractor_email, contractor_name, wo_number, title, status, amount, portal_url, work_orders, count,
    wo_id, portal_token, pay, reference, site, schedule } = body;

  // Contractor email only required for contractor-facing notification types
  if (!OWNER_TYPES.has(type) && !contractor_email) {
    return NextResponse.json({ error: 'No contractor email' }, { status: 400 });
  }

  const from = process.env.FROM_EMAIL || 'FAJ Solutions <support@fajsolutions.net>';
  let subject = '';
  let html = '';

  if (type === 'wo_assigned') {
    const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.fajsolutions.com';
    const canRespond = !!(portal_token && wo_id);
    const respond = canRespond ? `${base}/api/portal/respond?token=${portal_token}&wo=${wo_id}` : null;
    const portalUrl = portal_token ? `${base}/portal/${portal_token}` : null;
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
        ${portalUrl
          ? `<p style="text-align:center;"><a href="${portalUrl}" style="color:#0D7377;font-weight:600;">Open your portal for full details ↗</a></p>`
          : `<p>Log in to the contractor portal to view details and get started.</p>`}
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
        <p>Log in to the contractor portal for details.</p>
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
    subject = 'Welcome to FAJ Solutions — W-9 and contractor agreement';
    html = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
        <h2 style="color:#0D7377;">Welcome aboard, ${contractor_name}</h2>
        <p>Before your first job we need two things from you. Both are on your
        contractor portal — one link, no account to create:</p>
        <p style="margin:24px 0;">
          <a href="${portal_url}" style="background:#0D7377;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">Open your portal</a>
        </p>
        <div style="background:#f9f9f9;padding:16px;border-radius:8px;margin:16px 0;">
          <p style="margin:4px 0;"><strong>1. Your W-9.</strong> Upload a photo or PDF of your signed form. We use it for your 1099 at year end.</p>
          <p style="margin:12px 0 4px;"><strong>2. The contractor agreement.</strong> Read it and type your full legal name to sign.</p>
        </div>
        <p>Once both are in you're clear to take assignments. Anything unclear, just reply to this email.</p>
        <p style="color:#888;font-size:12px;">— FAJ Solutions</p>
      </div>
    `;
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

  try {
    await resend.emails.send({
      from,
      to,
      subject,
      html,
      replyTo: process.env.REPLY_TO_EMAIL || undefined,
    });
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
