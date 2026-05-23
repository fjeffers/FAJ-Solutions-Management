import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { portalInviteEmail, type PortalWOSummary } from '@/lib/email-templates';

export async function POST(req: NextRequest) {
  const resend = new Resend(process.env.RESEND_API_KEY);
  const body = await req.json();
  const { type, contractor_email, contractor_name, wo_number, title, status, amount, portal_url, work_orders } = body;

  if (!contractor_email) {
    return NextResponse.json({ error: 'No contractor email' }, { status: 400 });
  }

  const from = process.env.FROM_EMAIL || 'FAJ Solutions <noreply@fajsolutions.com>';
  let subject = '';
  let html = '';

  if (type === 'wo_assigned') {
    subject = `Work Order #${wo_number} Assigned to You`;
    html = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
        <h2 style="color:#0D7377;">New Work Order Assigned</h2>
        <p>Hi ${contractor_name},</p>
        <p>You've been assigned a new work order:</p>
        <div style="background:#f9f9f9;padding:16px;border-radius:8px;margin:16px 0;">
          <p style="margin:4px 0;"><strong>WO #:</strong> ${wo_number}</p>
          ${title ? `<p style="margin:4px 0;"><strong>Title:</strong> ${title}</p>` : ''}
        </div>
        <p>Log in to the contractor portal to view details and get started.</p>
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
  } else {
    return NextResponse.json({ error: 'Unknown notification type' }, { status: 400 });
  }

  try {
    await resend.emails.send({
      from,
      to: contractor_email,
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
