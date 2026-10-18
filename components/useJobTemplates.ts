'use client';
// Fred's job templates (Settings -> Job templates): which items a kind of job
// asks the tech for (lib/capture.ts). Loaded from his user_settings row
// (migration 128), remembered on this device, saved by itself a moment after
// each change — the same as his lists (components/useAppLists.ts).
import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { parseTemplates, STARTER_TEMPLATES, type JobTemplate } from '@/lib/capture';
import type { LayoutSaveState } from '@/components/useAppLayout';

const CACHE_KEY = 'faj-job-templates';

function cached(): JobTemplate[] {
  try {
    const raw = typeof window === 'undefined' ? null : localStorage.getItem(CACHE_KEY);
    return parseTemplates(raw ? JSON.parse(raw) : null);
  } catch {
    return STARTER_TEMPLATES;
  }
}

export function useJobTemplates() {
  const supabase = useMemo(() => createClient(), []);
  const [templates, setTemplates] = useState<JobTemplate[]>(cached);
  const [saveState, setSaveState] = useState<LayoutSaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const edited = useRef(false);

  useEffect(() => {
    void supabase.from('user_settings').select('job_templates').maybeSingle().then(({ data, error }) => {
      // Before migration 128 the column isn't there: keep the starters.
      if (error || edited.current) return;
      const t = parseTemplates(data?.job_templates);
      setTemplates(t);
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(t)); } catch { /* private window */ }
    });
  }, [supabase]);

  const save = async (next: JobTemplate[]) => {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(next)); } catch { /* private window */ }
    setSaveState('saving');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaveState('error'); setSaveError('You were signed out. Sign in again, then make the change again.'); return; }
    const { error } = await supabase.from('user_settings')
      .upsert({ user_id: user.id, job_templates: next, updated_at: new Date().toISOString() });
    if (error) { setSaveState('error'); setSaveError(error.message); return; }
    setSaveState('saved');
    setSaveError(null);
  };

  /** Show a change at once; save it a moment later. */
  const update = (next: JobTemplate[]) => {
    edited.current = true;
    setTemplates(next);
    setSaveState('saving');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void save(next); }, 700);
  };

  return { templates, update, retry: () => void save(templates), saveState, saveError };
}
