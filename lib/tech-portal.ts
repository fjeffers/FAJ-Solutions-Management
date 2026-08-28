// The tech portal's data layer (migration-067).
//
// Every read goes through a tech_* RPC. There is deliberately no direct table
// access here: RLS on contractors/work_orders/payments is keyed to Fred's
// user_id, so a tech's session gets zero rows from a plain select. The RPCs
// resolve the caller from auth.uid() and filter to that one contractor, which
// makes the database — not this file — the thing enforcing "only what's under
// their name".
//
// The grouping and totalling below is pure and unit-tested; the components
// call it rather than re-deriving money inline.
import { createClient } from '@/lib/supabase/client';
import type { TechJob, TechMessage, TechPayment, TechProfile, TechSummary } from './types';

export async function fetchTechProfile(): Promise<TechProfile | null> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('tech_me');
  if (error) throw new Error(error.message);
  return (data as TechProfile | null) ?? null;
}

export async function fetchTechJobs(): Promise<TechJob[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('tech_my_jobs');
  if (error) throw new Error(error.message);
  return (data as TechJob[] | null) ?? [];
}

export async function fetchTechPayments(): Promise<TechPayment[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('tech_my_payments');
  if (error) throw new Error(error.message);
  return (data as TechPayment[] | null) ?? [];
}

export async function fetchTechSummary(): Promise<TechSummary | null> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('tech_my_summary');
  if (error) throw new Error(error.message);
  return (data as TechSummary | null) ?? null;
}

/**
 * Bind this login to its contractor record. Safe to call on every sign-in —
 * once linked it short-circuits. Returns false when no contractor matches, which
 * is how the login page tells a tech from Fred.
 */
export async function claimTechAccount(): Promise<{ ok: boolean; reason: string }> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('tech_claim_account');
  if (error) return { ok: false, reason: error.message };
  const r = (data ?? {}) as { ok?: boolean; reason?: string };
  return { ok: !!r.ok, reason: r.reason ?? 'unknown' };
}

export async function saveTechProfile(p: {
  phone: string; address: string; city: string; state: string; zip: string;
}): Promise<boolean> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('tech_update_profile', {
    p_phone: p.phone, p_address: p.address, p_city: p.city, p_state: p.state, p_zip: p.zip,
  });
  if (error) throw new Error(error.message);
  return !!(data as { ok?: boolean } | null)?.ok;
}

// ── Pure helpers ────────────────────────────────────────────────────────────

/** Active work first, history second — the order a tech actually cares about. */
export function splitJobs(jobs: TechJob[]): { active: TechJob[]; past: TechJob[] } {
  return {
    active: jobs.filter((j) => !j.is_closed),
    past: jobs.filter((j) => j.is_closed),
  };
}

export function paymentsTotal(payments: TechPayment[]): number {
  return payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
}

/**
 * Payments bucketed by calendar year, newest year first — how a tech reads
 * their own history, and what they need at tax time.
 */
export function paymentsByYear(payments: TechPayment[]): { year: string; total: number; payments: TechPayment[] }[] {
  const buckets = new Map<string, TechPayment[]>();
  for (const p of payments) {
    // payment_date is a DATE column, so it arrives as 'YYYY-MM-DD'. Read the
    // year off the string: `new Date('2026-01-01').getFullYear()` parses as UTC
    // midnight and returns 2025 anywhere west of Greenwich, which would file a
    // New Year's Day payment under the previous tax year.
    const year = p.payment_date ? p.payment_date.slice(0, 4) : 'Undated';
    const list = buckets.get(year) ?? [];
    list.push(p);
    buckets.set(year, list);
  }
  return [...buckets.entries()]
    .map(([year, list]) => ({ year, total: paymentsTotal(list), payments: list }))
    .sort((a, b) => {
      if (a.year === 'Undated') return 1;
      if (b.year === 'Undated') return -1;
      return Number(b.year) - Number(a.year);
    });
}

/** A job's site, as one readable line. */
export function jobLocation(j: Pick<TechJob, 'site_name' | 'site_city' | 'site_state'>): string {
  return [j.site_name, [j.site_city, j.site_state].filter(Boolean).join(', ')]
    .filter((p) => p && p.trim()).join(' · ');
}

// ── Chat (migration-071) ────────────────────────────────────────────────────
// Login-based twins of the token portal's messaging. Same table, same thread:
// a message sent here and one sent from a portal link are one conversation.

export async function fetchTechMessages(woNumber: string): Promise<TechMessage[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('tech_messages', { p_wo_number: woNumber });
  if (error) throw new Error(error.message);
  return (data as TechMessage[] | null) ?? [];
}

export async function sendTechMessage(woNumber: string, content: string): Promise<boolean> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('tech_send_message', {
    p_wo_number: woNumber, p_content: content,
  });
  if (error) throw new Error(error.message);
  return !!(data as { ok?: boolean } | null)?.ok;
}

export async function fetchTechUnread(): Promise<number> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('tech_unread_count');
  if (error) return 0;
  return Number(data) || 0;
}
