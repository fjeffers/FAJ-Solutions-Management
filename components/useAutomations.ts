'use client';
// Automations (lib/automations.ts): Fred's rules, loaded from his user_settings row
// (migration 151), remembered on this device, saved a moment after each change; and
// the runner, which acts on the jobs while the office app is open.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { dueCheckoutDone, dueReminders, parseRules, type AutoRule } from '@/lib/automations';
import { techsOf } from '@/lib/job-sheet';
import { notifyContractor } from '@/lib/notify';
import { logAudit } from '@/lib/audit';
import { todayISO } from '@/lib/utils';
import type { Contractor, WorkOrder } from '@/lib/types';
import type { LayoutSaveState } from '@/components/useAppLayout';

const CACHE_KEY = 'faj-automations';
export type AutoPatch = (ids: string[], make: (w: WorkOrder) => Partial<WorkOrder> | null, by?: 'auto') => Promise<number>;

function cached(): AutoRule[] {
  try {
    const raw = typeof window === 'undefined' ? null : localStorage.getItem(CACHE_KEY);
    return parseRules(raw ? JSON.parse(raw) : null);
  } catch {
    return parseRules(null);
  }
}

const scheduleOf = (w: WorkOrder) => {
  if (!w.start_date) return null;
  const day = new Date(`${w.start_date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  return w.start_time ? `${day} at ${w.start_time}` : day;
};

export function useAutomations(workOrders: WorkOrder[], contractors: Contractor[], patch: AutoPatch, ready: boolean) {
  const supabase = useMemo(() => createClient(), []);
  const [rules, setRules] = useState<AutoRule[]>(cached);
  const [saveState, setSaveState] = useState<LayoutSaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const edited = useRef(false);
  const tried = useRef(new Set<string>());

  useEffect(() => {
    void supabase.from('user_settings').select('automations').maybeSingle().then(({ data, error }) => {
      // Before migration 151 the column isn't there: this device's rules (or the defaults) stand.
      if (error || edited.current || !data) return;
      const r = parseRules((data as { automations?: unknown }).automations);
      setRules(r);
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(r)); } catch { /* private window */ }
    });
  }, [supabase]);

  const save = async (next: AutoRule[]) => {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(next)); } catch { /* private window */ }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaveState('error'); setSaveError('You were signed out. Sign in again, then make the change again.'); return; }
    const { error } = await supabase.from('user_settings').upsert({ user_id: user.id, automations: next, updated_at: new Date().toISOString() });
    if (error) {
      setSaveState('error');
      setSaveError(/automations/.test(error.message)
        ? 'Saved on this computer only. Run the database update supabase-migration-151-automations.sql to keep it on every device.'
        : error.message);
      return;
    }
    setSaveState('saved');
    setSaveError(null);
  };

  const update = (next: AutoRule[]) => {
    edited.current = true;
    setRules(next);
    setSaveState('saving');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void save(next); }, 700);
  };

  // The runner. Each job is acted on once per opening of the app; reminders are also
  // checked against the Updates log so a second device doesn't send them again.
  useEffect(() => {
    if (!ready || workOrders.length === 0) return;
    const done = dueCheckoutDone(workOrders, rules).filter((w) => !tried.current.has(`done:${w.id}`));
    done.forEach((w) => tried.current.add(`done:${w.id}`));
    if (done.length) void patch(done.map((w) => w.id), (cur) => (cur.wo_status === 'In Progress' && cur.checked_out_at ? { wo_status: 'Work Done' } : null), 'auto');

    const due = dueReminders(workOrders, rules, todayISO()).filter((w) => !tried.current.has(`remind:${w.id}:${w.start_date}`));
    if (due.length === 0) return;
    due.forEach((w) => tried.current.add(`remind:${w.id}:${w.start_date}`));
    void (async () => {
      const since = new Date(Date.now() - 14 * 86400000).toISOString();
      const { data, error } = await supabase.from('audit_log').select('entity_id, details')
        .eq('action', 'auto').in('entity_id', due.map((w) => w.id)).gte('created_at', since);
      if (error) return;
      const sent = new Set((data ?? []).map((r) => `${r.entity_id}:${(r.details as { remind?: string } | null)?.remind ?? ''}`));
      for (const w of due) {
        if (sent.has(`${w.id}:${w.start_date}`)) continue;
        const told: string[] = [];
        for (const name of techsOf(w)) {
          const c = contractors.find((x) => x.name === name);
          if (!c || c.on_hold) continue;
          told.push(c.name);
          void notifyContractor({
            type: 'job_reminder', contractor_email: c.email ?? '', contractor_name: c.name, wo_number: w.wo_number,
            title: w.title ?? undefined, wo_id: w.id, schedule: scheduleOf(w), site: [w.site_name, w.site_city].filter(Boolean).join(', ') || null,
          });
        }
        if (told.length) logAudit({ action: 'auto', entityType: 'work_order', entityId: w.id, entityLabel: `WO#${w.wo_number} reminder sent to ${told.join(', ')}`, changes: { remind: w.start_date } });
      }
    })();
  }, [ready, workOrders, rules, contractors, patch, supabase]);

  return { rules, update, retry: () => void save(rules), saveState, saveError };
}
