import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { Resend } from 'resend';
import { W9_EMAIL_TEMPLATE, CONTRACTOR_AGREEMENT_EMAIL } from '@/lib/document-templates';

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

    // Build links
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL;
    const w9Link = `${baseUrl}/contractor-documents?token=${token}`;
    const agreementLink = `${baseUrl}/contractor-documents?token=${token}&doc=agreement`;

    // Send combined email with both W9 and agreement
    const emailHtml = `
      <h2>Welcome to FAJ Solutions</h2>
      <p>Hi ${contractor.name},</p>
      <p>We're excited to work with you! Before we get started, we need two things:</p>

      <h3>1️⃣ IRS Form W-9 (Tax Form)</h3>
      <p>This is a standard tax form. You can:</p>
      <ul>
        <li><strong>Fill it out online:</strong> <a href="${w9Link}" style="color: #0066cc; font-weight: bold;">Complete W-9 Online</a></li>
        <li><strong>Download & email:</strong> <a href="${w9Link}&format=pdf" style="color: #0066cc;">Download W-9 PDF</a> - print, sign, and email back to fajsolutions@gmail.com</li>
      </ul>

      <h3>2️⃣ Contractor Agreement</h3>
      <p>A simple agreement outlining our working relationship.</p>
      <ul>
        <li><strong>Review & sign online:</strong> <a href="${agreementLink}" style="color: #0066cc; font-weight: bold;">Review & Sign Agreement</a></li>
        <li><strong>Download & mail:</strong> <a href="${agreementLink}&format=pdf" style="color: #0066cc;">Download Agreement PDF</a></li>
      </ul>

      <h3>Next Steps</h3>
      <p>Once we receive your W-9 and signed agreement, you'll be all set to accept work assignments. We'll upload your W-9 to QuickBooks for 1099 tax reporting.</p>

      <div style="background: #f0f0f0; padding: 15px; border-radius: 5px; margin: 20px 0;">
        <p style="margin: 0;"><strong>Quick Links:</strong></p>
        <ul style="margin: 10px 0 0 0; padding-left: 20px;">
          <li><a href="${w9Link}" style="color: #0066cc;">W-9 Form (Fill Online)</a></li>
          <li><a href="${agreementLink}" style="color: #0066cc;">Contractor Agreement (Review & Sign)</a></li>
        </ul>
      </div>

      <p style="color: #666; font-size: 0.9em;">Questions? Reply to this email or call us.</p>
      <p style="color: #666; font-size: 0.9em;">FAJ Solutions<br>Easton, Pennsylvania</p>
    `;

    await resend.emails.send({
      from: 'FAJ Solutions <noreply@fajsolutions.com>',
      to: contractor.email,
      subject: 'Complete Your W-9 & Contractor Agreement',
      html: emailHtml,
    });

    return NextResponse.json({
      ok: true,
      message: `Documents sent to ${contractor.email}`,
    });
  } catch (err) {
    console.error('Send documents error:', err);
    return NextResponse.json({ error: 'Failed to send documents' }, { status: 500 });
  }
}
