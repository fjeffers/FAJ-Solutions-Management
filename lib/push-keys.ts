// Phone pop-up (web push) keys, server side only. The app makes its own key
// pair the first time anyone asks and keeps it in app_secrets (migration 119;
// readable by the service role only), so nobody has to copy a key anywhere.
import webpush from 'web-push';
import type { SupabaseClient } from '@supabase/supabase-js';

export type VapidKeys = { publicKey: string; privateKey: string };

export async function vapidKeys(admin: SupabaseClient): Promise<VapidKeys> {
  const read = async () => {
    const { data } = await admin.from('app_secrets').select('name, value').in('name', ['vapid_public', 'vapid_private']);
    const m = new Map((data ?? []).map((r: { name: string; value: string }) => [r.name, r.value]));
    const pub = m.get('vapid_public');
    const priv = m.get('vapid_private');
    return pub && priv ? { publicKey: pub, privateKey: priv } : null;
  };
  const have = await read();
  if (have) return have;
  const made = webpush.generateVAPIDKeys();
  // Two first visits at once: the first insert wins and both read it back.
  await admin.from('app_secrets').upsert(
    [{ name: 'vapid_public', value: made.publicKey }, { name: 'vapid_private', value: made.privateKey }],
    { onConflict: 'name', ignoreDuplicates: true },
  );
  return (await read()) ?? made;
}
