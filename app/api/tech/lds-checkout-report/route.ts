import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkoutPdf } from '@/lib/lds-checkout-report';
import { findSimplySubJobsBySiteNumber, SimplySubSession } from '@/lib/simplysub-sync';
import type { LdsDailyCheckout } from '@/lib/lds-daily-checkout';

export const maxDuration = 60;
const siteNumber = (v: unknown) => (typeof v === 'string' ? v.match(/\b(\d{7})\b/)?.[1] ?? '' : '');

// POST { wo_number, day }: the tech sent today's checkout. Builds the client PDF and
// files it on the SimplySub job with the same seven-digit site number, once.
export async function POST(req: Request) {
  const supabase = await createClient('field');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { wo_number?: unknown; day?: unknown };
  const woNumber = String(body.wo_number ?? ''); const day = String(body.day ?? '');
  const admin = createAdminClient();
  const { data: me } = await admin.from('contractors').select('id, name').eq('auth_user_id', user.id).maybeSingle();
  if (!me) return NextResponse.json({ ok: false }, { status: 403 });
  const { data: row } = await admin.from('lds_daily_checkouts').select('id, wo_id, data, submitted_at, simplysub_uploaded_at')
    .eq('wo_number', woNumber).eq('day', day).eq('contractor_id', me.id).maybeSingle();
  if (!row?.submitted_at) return NextResponse.json({ ok: false, error: 'Send the checkout first.' }, { status: 409 });
  if (row.simplysub_uploaded_at) return NextResponse.json({ ok: true, already: true });
  const { data: wo } = await admin.from('work_orders').select('wo_number, title, site_name, client_reference').eq('id', row.wo_id).maybeSingle();
  const site = siteNumber(wo?.client_reference) || siteNumber(wo?.site_name) || siteNumber(wo?.title);
  if (!site) return NextResponse.json({ ok: true, uploaded: false, reason: 'No site number on the job.' });

  const pdf = await checkoutPdf(row.data as LdsDailyCheckout, { woNumber, site: wo?.site_name || wo?.title || site, tech: me.name },
    async (url) => { try { const r = await fetch(url); return r.ok ? new Uint8Array(await r.arrayBuffer()) : null; } catch { return null; } });
  await admin.from('lds_daily_checkouts').update({ report_generated_at: new Date().toISOString() }).eq('id', row.id);

  const email = process.env.SIMPLYSUB_EMAIL, password = process.env.SIMPLYSUB_PASSWORD;
  if (!email || !password) return NextResponse.json({ ok: true, uploaded: false, reason: 'SimplySub login is not set.' });
  try {
    const found = await findSimplySubJobsBySiteNumber(email, password);
    const job = found.matches.find((m) => m.siteNumber === site);
    if (!job) return NextResponse.json({ ok: true, uploaded: false, reason: `No SimplySub job for site ${site}.` });
    const session = new SimplySubSession();
    await session.login(email, password);
    const d = row.data as LdsDailyCheckout;
    const label = `${d.installDay === 'return' ? 'Return visit' : `Day ${d.installDay}`} checkout - ${me.name} - ${day}`;
    await session.uploadJobFile(job.jobId, { name: `${label}.pdf`, bytes: pdf, type: 'application/pdf' },
      { label, notes: 'FAJ daily checkout with answers and labeled photos', date: day });
    await admin.from('lds_daily_checkouts').update({ simplysub_uploaded_at: new Date().toISOString(), simplysub_file_key: `${job.jobId}:${label}` }).eq('id', row.id);
    return NextResponse.json({ ok: true, uploaded: true });
  } catch (e) {
    return NextResponse.json({ ok: true, uploaded: false, reason: (e as Error).message });
  }
}
