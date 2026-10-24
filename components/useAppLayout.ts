'use client';
// Fred's menu layout (Settings -> Menu & screens): loaded from his
// user_settings row (migration 107), remembered on this device so the menu
// doesn't flicker on load, and saved by itself a moment after each change —
// no Save button to forget (Fred, 2026-10-05, about passwords: "it doesn't take").
import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { normalizeLayout, resolveLayout, STANDARD_LAYOUT, visibleLayout, type Layout } from '@/lib/app-layout';
import { setPartsOffNow } from '@/lib/screen-parts';
import { setDesignNow } from '@/lib/screen-design';
import { setHoursLookNow } from '@/lib/hours-look';

const CACHE_KEY = 'faj-app-layout';
export type LayoutSaveState = 'idle' | 'saving' | 'saved' | 'error';

function cached(): Layout {
  try {
    const raw = typeof window === 'undefined' ? null : localStorage.getItem(CACHE_KEY);
    return normalizeLayout(raw ? JSON.parse(raw) : STANDARD_LAYOUT);
  } catch {
    return normalizeLayout(STANDARD_LAYOUT);
  }
}

export function useAppLayout() {
  const supabase = useMemo(() => createClient(), []);
  const [layout, setLayout] = useState<Layout>(cached);
  const [saveState, setSaveState] = useState<LayoutSaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const edited = useRef(false);

  // Every screen asks lib/screen-parts what to show; keep it on Fred's choices.
  setPartsOffNow(layout.off ?? []);
  setDesignNow(layout.design);
  setHoursLookNow(layout.hours);

  useEffect(() => {
    void supabase.from('user_settings').select('layout').maybeSingle().then(({ data, error }) => {
      if (error || edited.current) return; // keep what's on screen; never overwrite a change being made
      const l = normalizeLayout(data?.layout ?? STANDARD_LAYOUT);
      setLayout(l);
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(l)); } catch { /* private window */ }
    });
  }, [supabase]);

  const save = async (next: Layout) => {
    const clean = normalizeLayout(next);
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(clean)); } catch { /* private window */ }
    setSaveState('saving');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaveState('error'); setSaveError('You were signed out. Sign in again, then make the change again.'); return; }
    const { error } = await supabase.from('user_settings')
      .upsert({ user_id: user.id, layout: clean, updated_at: new Date().toISOString() });
    if (error) { setSaveState('error'); setSaveError(error.message); return; }
    setSaveState('saved');
    setSaveError(null);
  };

  /** Show a change at once; save it a moment later (typing a name saves once, not per letter). */
  const update = (next: Layout) => {
    edited.current = true;
    setLayout(next);
    setSaveState('saving');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void save(next); }, 700);
  };

  const resolved = useMemo(() => resolveLayout(layout), [layout]);
  const visible = useMemo(() => visibleLayout(resolved), [resolved]);
  return { layout, resolved, visible, update, retry: () => void save(layout), saveState, saveError };
}
