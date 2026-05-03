import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import {
  workOrderEmail,
  paymentConfirmationEmail,
  w9RequestEmail,
  accountantSummaryEmail,
} from '@/lib/email-templates';
import type { WorkOrder, Payment, Contractor } from '@/lib/types';

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM    = process.env.FROM_EMAIL    ?? 'FAJ Solutions <support@fajsolutions.com>';
const REPLY_TO = process.env.REPLY_TO_EMAIL ?? 'support@fajsolutions.com';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { type, to, subject, data } = body as {
      type: 'work_order' | 'payment_confirmation' | 'w9_request' | 'accountant_summary';
      to: string;
      subject: string;
      data: Record<string, unknown>;
    };

    if (!to || !type) {
      return NextResponse.json({ error: 'Missing required fields: to, type' }, { status: 400 });
    }

    let html = '';

    switch (type) {
      case 'work_order':
        html = workOrderEmail(data.workOrder as WorkOrder, data.note as string | undefined);
        break;

      case 'payment_confirmation':
        html = paymentConfirmationEmail(
          data.payment as Payment,
          data.workOrder as WorkOrder | undefined,
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

    const { data: sent, error } = await resend.emails.send({
      from:     FROM,
      to,
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
