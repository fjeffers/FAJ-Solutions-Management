import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import {
  workOrderEmail,
  paymentConfirmationEmail,
  w9RequestEmail,
  accountantSummaryEmail,
  invoiceEmail,
} from '@/lib/email-templates';
import { techPayToShow } from '@/lib/utils';
import { createClient as createServerClient } from '@/lib/supabase/server';
import type { WorkOrder, Payment, Contractor, Invoice } from '@/lib/types';

// Techs assigned to the WO, so each address gets ITS OWN email with that
// tech's pay and personal accept/decline links (never another tech's).
type WORecipient = { name: string; email: string; portal_token: string | null };

function woEmailFor(wo: WorkOrder, note: string | undefined, recipient: WORecipient | undefined): string {
  if (!recipient?.portal_token) return workOrderEmail(wo, note);
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.fajsolutions.com';
  const respond = `${base}/api/portal/respond?token=${recipient.portal_token}&wo=${wo.id}`;
  return workOrderEmail(wo, note, {
    techPay: techPayToShow(wo, recipient.name),
    portalUrl: `${base}/portal/${recipient.portal_token}`,
    acceptUrl: `${respond}&action=accept`,
    declineUrl: `${respond}&action=decline`,
  });
}

const FROM     = process.env.FROM_EMAIL     ?? 'FAJ Solutions <support@fajsolutions.com>';
const REPLY_TO = process.env.REPLY_TO_EMAIL ?? 'support@fajsolutions.com';

export async function POST(req: NextRequest) {
  // Signed-in users only — this endpoint sends from the FAJ domain to any
  // address, so leaving it open would make it a public email relay.
  const authClient = await createServerClient('admin');
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const resend = new Resend(process.env.RESEND_API_KEY);
  try {
    const body = await req.json();
    const { type, to, subject, data } = body as {
      type: 'work_order' | 'payment_confirmation' | 'w9_request' | 'accountant_summary' | 'invoice';
      to: string;
      subject: string;
      data: Record<string, unknown>;
    };

    if (!to || !type) {
      return NextResponse.json({ error: 'Missing required fields: to, type' }, { status: 400 });
    }

    // Work order emails are personalized per tech — send one email per address
    // so accept/decline links and pay amounts never cross recipients.
    if (type === 'work_order') {
      const wo = data.workOrder as WorkOrder;
      const note = data.note as string | undefined;
      const recipients = (data.recipients ?? []) as WORecipient[];
      const toList = to.split(',').map((e) => e.trim()).filter(Boolean);

      const failures: string[] = [];
      let lastError = '';
      for (const addr of toList) {
        const match = recipients.find((r) => r.email?.toLowerCase() === addr.toLowerCase());
        const { error } = await resend.emails.send({
          from: FROM,
          to: addr,
          replyTo: REPLY_TO,
          subject,
          html: woEmailFor(wo, note, match),
        });
        if (error) {
          failures.push(addr);
          lastError = error.message;
          console.error('[send-email] work_order send failed for', addr, error);
        }
      }
      if (failures.length === toList.length) {
        return NextResponse.json({ error: `Send failed for ${failures.join(', ')}${lastError ? ` — ${lastError}` : ''}` }, { status: 500 });
      }
      return NextResponse.json({ success: true, failed: failures.length ? failures : undefined });
    }

    let html = '';

    switch (type) {

      case 'payment_confirmation':
        html = paymentConfirmationEmail(
          data.payment as Payment,
          data.workOrder as WorkOrder | undefined,
        );
        break;

      case 'invoice':
        html = invoiceEmail(
          data.invoice as Invoice,
          (data.shareUrl as string | null) ?? null,
          data.note as string | undefined,
        );
        break;

      case 'w9_request':
        html = w9RequestEmail(data.contractor as Contractor, data.note as string | undefined);
        break;

      case 'accountant_summary':
        html = accountantSummaryEmail(
          data.payments as Payment[],
          data.workOrders as WorkOrder[],
          data.year as number,
        );
        break;

      default:
        return NextResponse.json({ error: 'Unknown email type' }, { status: 400 });
    }

    const toList = to.split(',').map((e) => e.trim()).filter(Boolean);
    const { data: sent, error } = await resend.emails.send({
      from:     FROM,
      to:       toList.length === 1 ? toList[0] : toList,
      replyTo:  REPLY_TO,
      subject,
      html,
    });

    if (error) {
      console.error('[send-email] Resend error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, id: sent?.id });
  } catch (err) {
    console.error('[send-email] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
