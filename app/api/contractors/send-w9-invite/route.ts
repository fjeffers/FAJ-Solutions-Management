import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { contractorId } = await req.json();

  if (!contractorId) {
    return NextResponse.json({ error: 'Contractor ID required' }, { status: 400 });
  }

  try {
    // Get contractor details
    const { data: contractor, error: fetchErr } = await supabase
      .from('contractors')
      .select('*')
      .eq('id', contractorId)
      .eq('user_id', user.id)
      .single();

    if (fetchErr || !contractor) {
      return NextResponse.json({ error: 'Contractor not found' }, { status: 404 });
    }

    if (!contractor.email) {
      return NextResponse.json({ error: 'Contractor email is required' }, { status: 400 });
    }

    // Generate invite token
    const token = Buffer.from(`${contractorId}:${Date.now()}`).toString('base64');

    // Update contractor with token and send timestamp
    const { error: updateErr } = await supabase
      .from('contractors')
      .update({
        w9_invite_token: token,
        w9_invite_sent_at: new Date().toISOString(),
      })
      .eq('id', contractorId);

    if (updateErr) throw updateErr;

    // Send email with W9 form link
    const w9Link = `${process.env.NEXT_PUBLIC_APP_URL}/w9-form?token=${token}`;

    await resend.emails.send({
      from: 'FAJ Solutions <noreply@fajsolutions.com>',
      to: contractor.email,
      subject: 'Please Complete Your W-9 Tax Form',
      html: `
        <h2>W-9 Tax Form Submission</h2>
        <p>Hi ${contractor.name},</p>
        <p>We need you to complete your W-9 tax form. Please click the link below to fill it out:</p>
        <p><a href="${w9Link}" style="background: #0066cc; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">Fill Out W-9 Form</a></p>
        <p>The form will only take a few minutes to complete. Once submitted, we'll upload it to QuickBooks for our records.</p>
        <p>Thank you!</p>
      `,
    });

    return NextResponse.json({
      ok: true,
      message: `W-9 invite sent to ${contractor.email}`,
    });
  } catch (err) {
    console.error('Send invite error:', err);
    return NextResponse.json({ error: 'Failed to send invite' }, { status: 500 });
  }
}
