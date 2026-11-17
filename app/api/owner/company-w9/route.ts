import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { emailClient, emailNotSetUp } from '@/lib/email-client';
import { ownerOnly } from '@/lib/security';

const BUCKET = 'contractor-docs';
const MAX_BYTES = 8 * 1024 * 1024;
const pathFor = (userId: string) => `${userId}/company/company-w9.pdf`;

async function owner() {
  const supabase = await createClient('admin');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { refusal: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  const denied = await ownerOnly(supabase);
  return denied ? { refusal: denied } : { user };
}

export async function GET() {
  const auth = await owner();
  if ('refusal' in auth) return auth.refusal;
  const admin = createAdminClient();
  const path = pathFor(auth.user.id);
  const { data } = await admin.storage.from(BUCKET).createSignedUrl(path, 300);
  return NextResponse.json({ onFile: !!data?.signedUrl, url: data?.signedUrl ?? null });
}

export async function POST(req: Request) {
  const auth = await owner();
  if ('refusal' in auth) return auth.refusal;
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File) || file.type !== 'application/pdf') {
    return NextResponse.json({ error: 'Choose the completed W-9 PDF.' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'The W-9 must be 8 MB or smaller.' }, { status: 413 });
  const admin = createAdminClient();
  const path = pathFor(auth.user.id);
  const { error } = await admin.storage.from(BUCKET).upload(path, await file.arrayBuffer(), {
    contentType: 'application/pdf',
    upsert: true,
  });
  if (error) return NextResponse.json({ error: 'Could not securely save the W-9.' }, { status: 500 });
  await admin.from('audit_log').insert({
    user_id: auth.user.id,
    action: 'upload',
    entity_type: 'company_w9',
    entity_id: auth.user.id,
    details: { label: 'Company W-9 replaced', role: 'owner' },
  });
  return NextResponse.json({ ok: true });
}

export async function PUT(req: Request) {
  const auth = await owner();
  if ('refusal' in auth) return auth.refusal;
  const { email } = await req.json().catch(() => ({ email: '' })) as { email?: string };
  const to = String(email ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return NextResponse.json({ error: 'Enter the client email.' }, { status: 400 });
  const admin = createAdminClient();
  const path = pathFor(auth.user.id);
  const { data } = await admin.storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 24 * 7);
  if (!data?.signedUrl) return NextResponse.json({ error: 'Upload the company W-9 first.' }, { status: 404 });
  const resend = emailClient();
  if (!resend) return NextResponse.json({ error: emailNotSetUp(), url: data.signedUrl }, { status: 503 });
  const { error } = await resend.emails.send({
    from: process.env.FROM_EMAIL ?? 'FAJ Solutions <support@fajsolutions.com>',
    to,
    replyTo: process.env.REPLY_TO_EMAIL ?? 'support@fajsolutions.com',
    subject: 'FAJ Solutions W-9',
    html: `<p>Hello,</p><p>Here is FAJ Solutions' current W-9. This secure link expires in 7 days.</p><p><a href="${data.signedUrl}">Open W-9</a></p><p>FAJ Solutions</p>`,
  });
  if (error) return NextResponse.json({ error: 'The W-9 email could not be sent.' }, { status: 502 });
  await admin.from('audit_log').insert({
    user_id: auth.user.id,
    action: 'share',
    entity_type: 'company_w9',
    entity_id: auth.user.id,
    details: { label: `Company W-9 sent to ${to}`, role: 'owner' },
  });
  return NextResponse.json({ ok: true });
}
