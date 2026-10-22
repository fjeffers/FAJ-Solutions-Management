'use client';
// The expense categories for a picker (migration 136): the built-in ones, then
// the ones the office added. Before migration 136 the table isn't there, and
// the built-in list is all there is.
import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { EXPENSE_CATEGORIES, expenseReasonText, setCustomExpenseCategories, type CategoryOption } from './expenses';

/** The office's own active categories, or null before migration 136 (or with no signal). */
async function fetchOwn(): Promise<CategoryOption[] | null> {
  const { data, error } = await createClient().from('expense_categories')
    .select('key, label, builtin').eq('active', true).order('sort').order('label');
  if (error || !Array.isArray(data)) return null;
  const own = (data as { key: string; label: string; builtin: boolean }[]).filter((r) => !r.builtin).map((r) => ({ key: r.key, label: r.label }));
  setCustomExpenseCategories(own);
  return own;
}

export function useExpenseCategories() {
  const [list, setList] = useState<CategoryOption[]>(EXPENSE_CATEGORIES);
  const load = useCallback(async () => {
    const own = await fetchOwn();
    if (own) setList([...EXPENSE_CATEGORIES, ...own]);
  }, []);
  useEffect(() => {
    let live = true;
    void fetchOwn().then((own) => { if (live && own) setList([...EXPENSE_CATEGORIES, ...own]); });
    return () => { live = false; };
  }, []);

  /** The office adds one: its key, or the reason it couldn't. */
  const add = useCallback(async (label: string): Promise<{ key: string } | { error: string }> => {
    const { data, error } = await createClient().rpc('wf_owner_add_expense_category', { p_label: label });
    const r = (data ?? {}) as { ok?: boolean; key?: string; reason?: string };
    if (error?.code === 'PGRST202') return { error: 'Your own categories need the database update (migration 136) first.' };
    if (error || !r.ok || !r.key) return { error: expenseReasonText(r.reason ?? '') };
    await load();
    return { key: r.key };
  }, [load]);

  return { list, add };
}
