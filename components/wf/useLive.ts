'use client';
// Office screens follow what techs do as it happens (Fred, 2026-10-14:
// "implement live update between admin and tech portal"). Migration 126 put
// the tables techs write to in the realtime feed; row security still decides
// who hears each change, so only the owner's own rows arrive here.
import { useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';

let seq = 0;

/**
 * Runs `reload` when rows in `table` change — for one job when `woId` is
 * given, otherwise for any job. A burst of changes reloads once.
 */
export function useLiveRows(table: string, woId: string | null, reload: () => void) {
  const fn = useRef(reload);
  useEffect(() => { fn.current = reload; });
  useEffect(() => {
    const db = createClient();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const fire = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => fn.current(), 500);
    };
    seq += 1;
    const channel = db
      .channel(`live-${table}-${woId ?? 'all'}-${seq}`)
      .on('postgres_changes', { event: '*', schema: 'public', table, ...(woId ? { filter: `wo_id=eq.${woId}` } : {}) }, fire)
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      void db.removeChannel(channel);
    };
  }, [table, woId]);
}
