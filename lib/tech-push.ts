// A phone pop-up for a tech (Fred, 2026-10-18: "is there a way to push
// directly to the app ... when I add a new work order it goes directly to
// the portal"). Goes to every phone the tech turned pop-ups on for in their
// app (Profile), the same web push the office's project alerts use. Tapping it
// opens the job in the tech app. Never carries money.
import webpush from 'web-push';
import type { SupabaseClient } from '@supabase/supabase-js';
import { vapidKeys } from './push-keys';

export type TechPush = { title: string; body: string; url: string; tag?: string };

/** What a new work order pop-up says: the job, where and when — no pay. */
export function newWorkOrderPush(o: { woId: string; woNumber: string; title?: string | null; site?: string | null; schedule?: string | null }): TechPush {
  const lines = [o.title || null, o.site || null, o.schedule || null].filter(Boolean);
  return {
    title: `New work order WO ${o.woNumber}`,
    body: lines.join('\n') || 'Tap to open it.',
    url: `/tech?wo=${encodeURIComponent(o.woId)}`,
    tag: `wo-${o.woId}`,
  };
}

type Sub = { id: string; endpoint: string; p256dh: string; auth: string };

/** What the office's pop-up says when a tech turns a job down (Fred, 2026-10-18:
 *  "I declined the job, it needs to go back to admin ... back to Need a tech"). */
export function declinedPush(o: { woId: string; woNumber: string; techName: string; title?: string | null }): TechPush {
  return {
    title: `${o.techName} declined WO ${o.woNumber}`,
    body: [o.title || null, 'It needs a tech again.'].filter(Boolean).join('\n'),
    url: '/admin',
    tag: `declined-${o.woId}`,
  };
}

/** Sends to the tech's phones; returns how many got it. 0 when pop-ups are off. */
export async function pushToTech(admin: SupabaseClient, ownerId: string, contractorName: string, msg: TechPush): Promise<number> {
  const { data: c } = await admin.from('contractors').select('auth_user_id')
    .eq('user_id', ownerId).eq('name', contractorName).maybeSingle();
  const uid = (c as { auth_user_id?: string | null } | null)?.auth_user_id;
  if (!uid) return 0;
  return pushToUser(admin, uid, msg);
}

/** Sends to every phone or computer a login turned pop-ups on for (office or tech). */
export async function pushToUser(admin: SupabaseClient, uid: string, msg: TechPush): Promise<number> {
  const { data: subs } = await admin.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('auth_user_id', uid);
  if (!subs || subs.length === 0) return 0;
  const vapid = await vapidKeys(admin);
  let sent = 0;
  for (const s of subs as Sub[]) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(msg), {
        vapidDetails: { subject: 'mailto:support@fajsolutions.com', publicKey: vapid.publicKey, privateKey: vapid.privateKey },
        TTL: 24 * 60 * 60,
      });
      sent += 1;
      await admin.from('push_subscriptions').update({ last_ok_at: new Date().toISOString() }).eq('id', s.id);
    } catch (e) {
      // The phone turned pop-ups off or the app was removed: forget it.
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await admin.from('push_subscriptions').delete().eq('id', s.id);
    }
  }
  return sent;
}
