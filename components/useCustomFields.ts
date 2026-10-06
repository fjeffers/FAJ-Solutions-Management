'use client';
// Fred's custom field definitions (Settings -> Custom fields): loaded from his
// user_settings row (migration 110), remembered on this device, saved by itself
// a moment after each change — same as the menu and lists. Rules and answers:
// lib/custom-fields.ts.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { EMPTY_FIELDS, normalizeFields, setFieldsNow, type FieldSets } from '@/lib/custom-fields';
import type { LayoutSaveState } from '@/components/useAppLayout';

const CACHE_KEY = 'faj-custom-fields';

function cached(): FieldSets {
  try {
    const raw = typeof window === 'undefined' ? null : localStorage.getItem(CACHE_KEY);
    return normalizeFields(raw ? JSON.parse(raw) : EMPTY_FIELDS);
  } catch {
    return normalizeFields(EMPTY_FIELDS);
  }
}

export function useCustomFields() {
  const supabase = useMemo(() => createClient(), []);
  const [fields, setFields] = useState<FieldSets>(cached);
  const [saveState, setSaveState] = useState<LayoutSaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const edited = useRef(false);

  // Every form reads the definitions through lib/custom-fields; keep it on Fred's.
  setFieldsNow(fields);

  useEffect(() => {
    void supabase.from('user_settings').select('fields').maybeSingle().then(({ data, error }) => {
      if (error || edited.current) return;
      const f = normalizeFields(data?.fields ?? EMPTY_FIELDS);
      setFields(f);
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(f)); } catch { /* private window */ }
    });
  }, [supabase]);

  const save = async (next: FieldSets) => {
    const clean = normalizeFields(next);
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(clean)); } catch { /* private window */ }
    setSaveState('saving');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaveState('error'); setSaveError('You were signed out. Sign in again, then make the change again.'); return; }
    const { error } = await supabase.from('user_settings')
      .upsert({ user_id: user.id, fields: clean, updated_at: new Date().toISOString() });
    if (error) { setSaveState('error'); setSaveError(error.message); return; }
    setSaveState('saved');
    setSaveError(null);
  };

  const update = (next: FieldSets) => {
    edited.current = true;
    setFields(next);
    setSaveState('saving');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void save(next); }, 700);
  };

  return { fields, update, retry: () => void save(fields), saveState, saveError };
}
