import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import webpush from 'web-push';
import { createAdminClient } from '@/lib/supabase/admin';
import { vapidKeys } from '@/lib/push-keys';
import {
  alertEmailHtml, alertMessage, canOpenApp, recipientsForAlert, toE164,
  type AlertJob, type AlertPerson, type AlertRow,
} from '@/lib/project-alerts';
import { loadSheet, sheetTokenFor } from '@/lib/project-sheet-load';
import { sheetEmailHtml, type Sheet } from '@/lib/project-sheet';

// POST/GET /api/alerts/dispatch — sends the project alerts that are due
// (migration 119). The database calls it the moment an alert is added
// (pg_net) and every minute (pg_cron). It takes nothing from the caller: it
// reads the outbox itself, and project_alerts_claim() hands each alert to one
// sender only, so calling it twice never sends twice.
//
// Phone pop-ups go to the office logins on the project's list that turned
// them on; email to everyone with an email; texts only once Twilio is set up
// (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER in Vercel).
//
// Every email carries the live project sheet (migration 120): the latest lines
// on that site's page and a link anyone on the list can open without a login.
export const dynamic = 'force-dynamic';

export async function POST() { return run(); }
export async function GET() { return run(); }

type Sub = { id: string; endpoint: string; p256dh: string; auth: string };

async function run() {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('project_alerts_claim', { p_limit: 25 });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  const alerts = (data ?? []) as AlertRow[];
  if (alerts.length === 0) return NextResponse.json({ ok: true, sent: 0 });

  const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
  const from = process.env.FROM_EMAIL || 'FAJ Solutions <support@fajsolutions.com>';
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.fajsolutions.com';
  const twilio = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER
    ? { sid: process.env.TWILIO_ACCOUNT_SID, token: process.env.TWILIO_AUTH_TOKEN, from: process.env.TWILIO_FROM_NUMBER } : null;
  let vapid: { publicKey: string; privateKey: string } | null = null;

  // One sheet per project per run (several alerts often come together).
  const sheets = new Map<string, { sheet: Sheet; token: string | null } | null>();
  const sheetFor = async (a: AlertRow) => {
    const key = `${a.user_id}|${a.project_name}`;
    if (!sheets.has(key)) {
      try {
        const token = await sheetTokenFor(admin, a.user_id, a.project_name);
        sheets.set(key, { sheet: await loadSheet(admin, a.user_id, a.project_name, 3), token });
      } catch {
        sheets.set(key, null);
      }
    }
    return sheets.get(key) ?? null;
  };

  let sent = 0;
  for (const a of alerts) {
    const result: Record<string, number | string> = { email: 0, push: 0, text: 0 };
    try {
      const { data: wo } = a.wo_id
        ? await admin.from('work_orders').select('title, site_name, site_city, site_state').eq('id', a.wo_id).maybeSingle()
        : { data: null };
      const job: AlertJob | null = wo ? {
        title: String(wo.title ?? ''), site: String(wo.site_name ?? ''), city: String(wo.site_city ?? ''), state: String(wo.site_state ?? ''),
      } : null;
      const { data: people } = await admin.from('project_alert_people')
        .select('name, role, email, phone, auth_user_id, by_email, by_push, by_text')
        .eq('user_id', a.user_id).eq('project_name', a.project_name);
      const to = recipientsForAlert((people ?? []) as AlertPerson[], a.user_id, a);
      const m = alertMessage(a, job);
      const link = `${base}/admin?view=workorders&wo=${encodeURIComponent(a.wo_number)}`;
      const subject = `[${a.project_name}] ${m.title}`;
      const sh = await sheetFor(a);
      const sheetLink = sh?.token ? `${base}/sheet/${sh.token}${a.wo_number ? `?site=${encodeURIComponent(a.wo_number)}` : ''}` : null;
      // Where it happened, from the sheet's own line: "From 123 Main St, Orange, NJ".
      const line = sh?.sheet.rows.find((r) => r.siteId === a.wo_id && r.tech === (a.tech ?? '') && Date.parse(r.at) === Date.parse(a.at)
        && (r.kind === 'clock' || r.kind === 'drive' || r.kind === 'signout' || r.kind === 'start' || r.kind === 'arrive'));
      if (line?.where && !m.lines.includes(line.where)) m.lines.unshift(line.where);
      const emailHtml = (p: AlertPerson) => (sh
        ? sheetEmailHtml(sh.sheet, {
          title: m.title, where: m.where, lines: m.lines, siteId: a.wo_id, sheetLink,
          appLink: canOpenApp(p) ? link : null, receiptLink: (id) => `${base}/sheet/${sh.token}/receipt/${id}`,
        })
        : alertEmailHtml(a.project_name, m, canOpenApp(p) ? link : null));

      for (const p of to) {
        if (p.by_email && p.email && resend) {
          const r = await resend.emails.send({
            from, to: p.email, subject,
            html: emailHtml(p),
          });
          if (!r.error) result.email = Number(result.email) + 1;
        }
        if (p.by_push && p.auth_user_id) {
          const { data: subs } = await admin.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('auth_user_id', p.auth_user_id);
          if (subs && subs.length > 0) {
            vapid ??= await vapidKeys(admin);
            const payload = JSON.stringify({
              title: m.title, body: `${a.project_name} · ${m.where}${m.lines[0] ? `\n${m.lines[0]}` : ''}`,
              url: canOpenApp(p) ? link : base, tag: a.id,
            });
            for (const s of subs as Sub[]) {
              try {
                await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
                  vapidDetails: { subject: 'mailto:support@fajsolutions.com', publicKey: vapid.publicKey, privateKey: vapid.privateKey },
                  TTL: 60 * 60,
                });
                result.push = Number(result.push) + 1;
                await admin.from('push_subscriptions').update({ last_ok_at: new Date().toISOString() }).eq('id', s.id);
              } catch (e) {
                const code = (e as { statusCode?: number }).statusCode;
                // The phone turned pop-ups off or the app was removed: forget it.
                if (code === 404 || code === 410) await admin.from('push_subscriptions').delete().eq('id', s.id);
              }
            }
          }
        }
        const phone = toE164(p.phone);
        if (p.by_text && phone) {
          if (!twilio) { result.text_note = 'texts not set up yet'; continue; }
          const body = new URLSearchParams({ To: phone, From: twilio.from, Body: `${subject}\n${m.where}${m.lines[0] ? `\n${m.lines[0]}` : ''}`.slice(0, 480) + (sheetLink ? `\nLive sheet: ${sheetLink}` : '') });
          const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilio.sid}/Messages.json`, {
            method: 'POST', body,
            headers: { Authorization: `Basic ${Buffer.from(`${twilio.sid}:${twilio.token}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
          });
          if (r.ok) result.text = Number(result.text) + 1;
        }
      }
      await admin.from('project_alerts').update({ status: 'sent', sent_at: new Date().toISOString(), result }).eq('id', a.id);
      sent++;
    } catch (e) {
      await admin.from('project_alerts').update({ status: 'failed', result: { ...result, error: e instanceof Error ? e.message : String(e) } }).eq('id', a.id);
    }
  }
  return NextResponse.json({ ok: true, sent });
}
