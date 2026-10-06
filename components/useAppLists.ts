'use client';
// Fred's lists (Settings -> Lists & stages): loaded from his user_settings row
// (migration 109), remembered on this device so screens don't flicker, and
// saved by itself a moment after each change — same as the menu
// (components/useAppLayout.ts). The rules are in lib/app-lists.ts.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { normalizeLists, setListsNow, STANDARD_LISTS, type AppLists } from '@/lib/app-lists';
import type { LayoutSaveState } from '@/components/useAppLayout';

const CACHE_KEY = 'faj-app-lists';

function cached(): AppLists {
  try {
    const raw = typeof window === 'undefined' ? null : localStorage.getItem(CACHE_KEY);
    return normalizeLists(raw ? JSON.parse(raw) : STANDARD_LISTS);
  } catch {
    return normalizeLists(STANDARD_LISTS);
  }
}

export function useAppLists() {
  const supabase = useMemo(() => createClient(), []);
  const [lists, setLists] = useState<AppLists>(cached);
  const [saveState, setSaveState] = useState<LayoutSaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const edited = useRef(false);

  // Every screen reads the lists through lib/app-lists; keep it on Fred's.
  setListsNow(lists);

  useEffect(() => {
    void supabase.from('user_settings').select('lists').maybeSingle().then(({ data, error }) => {
      if (error || edited.current) return;
      const l = normalizeLists(data?.lists ?? STANDARD_LISTS);
      setLists(l);
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(l)); } catch { /* private window */ }
    });
  }, [supabase]);

  const save = async (next: AppLists) => {
    const clean = normalizeLists(next);
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(clean)); } catch { /* private window */ }
    setSaveState('saving');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaveState('error'); setSaveError('You were signed out. Sign in again, then make the change again.'); return; }
    const { error } = await supabase.from('user_settings')
      .upsert({ user_id: user.id, lists: clean, updated_at: new Date().toISOString() });
    if (error) { setSaveState('error'); setSaveError(error.message); return; }
    setSaveState('saved');
    setSaveError(null);
  };

  /** Show a change at once; save it a moment later. */
  const update = (next: AppLists) => {
    edited.current = true;
    setLists(next);
    setSaveState('saving');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void save(next); }, 700);
  };

  return { lists, update, retry: () => void save(lists), saveState, saveError };
}
