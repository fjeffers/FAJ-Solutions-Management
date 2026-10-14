import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import webpush from 'web-push';
import { createAdminClient } from '@/lib/supabase/admin';
import { vapidKeys } from '@/lib/push-keys';
import { loadSheetMessages, projectForToken } from '@/lib/project-sheet-load';

// Messages on the live project sheet (migration 121), for whoever has the
// sheet's link (the PM or the client; no login).
//   GET  → the project's sheet messages (the page asks every few seconds)
//   POST → a note, question or message: { site, name, body, kind, to, rowRef, parentId }
// A post goes straight to the techs on that work order (phone pop-up and
// email) unless it's for FAJ; the database trigger tells the office.
// Never a tech <-> FAJ message: only on_sheet ones are read or written here.
export const dynamic = 'force-dynamic';

const KINDS = ['message', 'question', 'note'] as const;
type Kind = typeof KINDS[number];
/** Posts from one project's sheet in ten minutes before it says slow down. */
const BURST = 40;

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();
  const p = await projectForToken(admin, token);
  if (!p) return NextResponse.json({ ok: false }, { status: 404 });
  const messages = await loadSheetMessages(admin, p.userId, p.project);
  return NextResponse.json({ ok: true, messages, now: new Date().toISOString() }, { headers: { 'Cache-Control': 'no-store' } });
}

type Job = { id: string; wo_number: string; contractor_name: string | null; contractor_names: string[] | null; lead_contractor_name: string | null; site_name: string | null; title: string | null };

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();
  const p = await projectForToken(admin, token);
  if (!p) return NextResponse.json({ ok: false, error: 'This link no longer works.' }, { status: 404 });

  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const site = clean(b.site, 80);
  const name = clean(b.name, 60);
  const body = clean(b.body, 2000);
  const kind = (KINDS as readonly string[]).includes(String(b.kind)) ? (b.kind as Kind) : 'message';
  const to = clean(b.to, 80);
  const rowRef = clean(b.rowRef, 200);
  const parentId = clean(b.parentId, 40);
  if (!name) return NextResponse.json({ ok: false, error: 'Put your name in first.' }, { status: 400 });
  if (!body) return NextResponse.json({ ok: false, error: 'Type the message first.' }, { status: 400 });

  const { data: jobs } = await admin.from('work_orders')
    .select('id, wo_number, contractor_name, contractor_names, lead_contractor_name, site_name, title')
    .eq('user_id', p.userId).eq('project_name', p.project).eq('is_project', true);
  const job = ((jobs ?? []) as Job[]).find((j) => j.wo_number === site);
  if (!job) return NextResponse.json({ ok: false, error: 'That site is not on this project.' }, { status: 400 });
  const techs = [...new Set([job.lead_contractor_name, job.contractor_name, ...(job.contractor_names ?? [])].map((n) => (n ?? '').trim()).filter(Boolean))];
  if (to && to !== 'FAJ' && !techs.includes(to)) return NextResponse.json({ ok: false, error: 'Pick who it is for again.' }, { status: 400 });
  if (rowRef && !rowRef.startsWith(`${job.id}:`)) return NextResponse.json({ ok: false, error: 'That line is not on this site.' }, { status: 400 });
  if (parentId) {
    const { data: parent } = await admin.from('work_order_messages').select('id')
      .eq('id', parentId).eq('user_id', p.userId).eq('work_order_id', job.wo_number).eq('on_sheet', true).maybeSingle();
    if (!parent) return NextResponse.json({ ok: false, error: 'That message is gone.' }, { status: 400 });
  }

  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { count } = await admin.from('work_order_messages').select('id', { count: 'exact', head: true })
    .eq('user_id', p.userId).eq('sender_role', 'client').in('work_order_id', ((jobs ?? []) as Job[]).map((j) => j.wo_number)).gte('created_at', since);
  if ((count ?? 0) >= BURST) return NextResponse.json({ ok: false, error: 'Lots of messages just now. Wait a few minutes and try again.' }, { status: 429 });

  const { data: row, error } = await admin.from('work_order_messages').insert({
    user_id: p.userId, work_order_id: job.wo_number, sender_name: name, sender_role: 'client', content: body,
    kind, to_name: to || null, on_sheet: true, row_ref: rowRef || null, parent_id: parentId || null,
  }).select('id').single();
  if (error || !row) return NextResponse.json({ ok: false, error: "Couldn't send that. Try again." }, { status: 500 });

  // Straight to the techs on the job (or the one picked), unless it's for FAJ.
  const notify = to === 'FAJ' ? [] : to ? [to] : techs;
  if (notify.length > 0) {
    try { await tellTechs(admin, p.userId, notify, { name, body, kind, wo: job.wo_number, site: job.site_name || job.title || '' }); }
    catch { /* the message is saved and shows in their app either way */ }
  }
  return NextResponse.json({ ok: true, id: (row as { id: string }).id });
}

/** A phone pop-up (if they turned them on) and an email, to each tech. */
async function tellTechs(admin: ReturnType<typeof createAdminClient>, ownerId: string, names: string[],
  m: { name: string; body: string; kind: Kind; wo: string; site: string }) {
  const { data } = await admin.from('contractors').select('name, email, auth_user_id').eq('user_id', ownerId).in('name', names);
  const people = (data ?? []) as { name: string; email: string | null; auth_user_id: string | null }[];
  const what = m.kind === 'question' ? 'asked you a question' : m.kind === 'note' ? 'added a note' : 'sent you a message';
  const title = `${m.name} ${what} · WO ${m.wo}`;
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.fajsolutions.com';
  const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
  const from = process.env.FROM_EMAIL || 'FAJ Solutions <support@fajsolutions.com>';
  let vapid: { publicKey: string; privateKey: string } | null = null;
  const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  for (const t of people) {
    if (t.auth_user_id) {
      const { data: subs } = await admin.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('auth_user_id', t.auth_user_id);
      for (const s of (subs ?? []) as { id: string; endpoint: string; p256dh: string; auth: string }[]) {
        vapid ??= await vapidKeys(admin);
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            JSON.stringify({ title, body: m.body.slice(0, 180), url: `${base}/tech`, tag: `msg-${m.wo}` }),
            { vapidDetails: { subject: 'mailto:support@fajsolutions.com', publicKey: vapid.publicKey, privateKey: vapid.privateKey }, TTL: 60 * 60 });
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) await admin.from('push_subscriptions').delete().eq('id', s.id);
        }
      }
    }
    if (t.email && resend) {
      await resend.emails.send({
        from, to: t.email, subject: title,
        html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1B1C1F">
  <div style="font-size:12px;letter-spacing:1px;color:#B8912F;font-weight:700;text-transform:uppercase">WO ${esc(m.wo)}${m.site ? ` · ${esc(m.site)}` : ''}</div>
  <h2 style="margin:6px 0;color:#0E1B2E">${esc(m.name)} ${esc(what)}</h2>
  <p style="white-space:pre-wrap;font-size:15px;background:#F6F4EF;border-radius:8px;padding:10px 12px">${esc(m.body)}</p>
  <p><a href="${esc(base)}/tech" style="background:#0E1B2E;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600">Open the app to answer</a></p>
</div>`,
      });
    }
  }
}
