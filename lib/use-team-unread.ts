'use client';
import { useEffect, useState } from 'react';
import { createClient } from './supabase/client';

/** Small role-scoped count, including while the messenger itself is closed. */
export function useTeamUnread(enabled = true): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = async () => {
      if (document.visibilityState !== 'visible') return;
      const { data, error } = await createClient().rpc('messaging_unread');
      if (alive && !error) setCount(Number(data) || 0);
    };
    const check = () => { void load().catch(() => { /* keep the last count offline */ }); };
    check();
    const timer = setInterval(check, 20000);
    window.addEventListener('focus', check);
    window.addEventListener('team-messages-changed', check);
    return () => { alive = false; clearInterval(timer); window.removeEventListener('focus', check); window.removeEventListener('team-messages-changed', check); };
  }, [enabled]);
  return enabled ? count : 0;
}
