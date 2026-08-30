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
import type {
  TechDirectMessage, TechDirectoryEntry, TechJob, TechMessage, TechOpenJob,
  TechPayment, TechProfile, TechSummary,
} from './types';

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

/**
 * The caller's OWN portal token, so the tech portal can reuse the existing,
 * already-hardened W-9 and agreement flow instead of growing a second path
 * that handles tax IDs. Grants nothing new — this is the same token already
 * emailed to that contractor.
 */
export async function fetchTechPortalToken(): Promise<string | null> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('tech_portal_token');
  if (error) return null;
  return (data as string | null) ?? null;
}

// ── Open work (migration-073) ───────────────────────────────────────────────

/** Unassigned jobs this tech could take. Never anyone else's assigned work. */
export async function fetchTechOpenJobs(): Promise<TechOpenJob[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('tech_open_jobs');
  if (error) throw new Error(error.message);
  return (data as TechOpenJob[] | null) ?? [];
}

/**
 * Take a job or pass on it. Accepting only succeeds while the job is still
 * free — two techs tapping at once cannot both end up on it, and the second
 * gets 'already_taken' rather than a silent double-booking.
 */
export async function respondToOpenJob(
  woNumber: string, response: 'accepted' | 'declined',
): Promise<{ ok: boolean; reason: string }> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('tech_respond_to_job', {
    p_wo_number: woNumber, p_response: response,
  });
  if (error) return { ok: false, reason: error.message };
  const r = (data ?? {}) as { ok?: boolean; reason?: string };
  return { ok: !!r.ok, reason: r.reason ?? 'unknown' };
}

// ── Tech-to-tech messages (migration-075) ───────────────────────────────────
// Not tied to a job. The directory is NAMES ONLY — a tech needs to know who
// exists to pick someone, not everyone's phone number.

export async function fetchTechDirectory(): Promise<TechDirectoryEntry[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('tech_directory');
  if (error) throw new Error(error.message);
  return (data as TechDirectoryEntry[] | null) ?? [];
}

/** Opening a thread marks the other side's messages read. */
export async function fetchTechDmThread(otherId: string): Promise<TechDirectMessage[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('tech_dm_thread', { p_other_id: otherId });
  if (error) throw new Error(error.message);
  return (data as TechDirectMessage[] | null) ?? [];
}

export async function sendTechDm(otherId: string, content: string): Promise<boolean> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('tech_send_dm', {
    p_other_id: otherId, p_content: content,
  });
  if (error) throw new Error(error.message);
  return !!(data as { ok?: boolean } | null)?.ok;
}

export async function fetchTechDmUnread(): Promise<number> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('tech_dm_unread');
  if (error) return 0;
  return Number(data) || 0;
}

// ── Working the job (migration-076) ─────────────────────────────────────────
// A tech may set only 'In Progress' or 'Work Done' — never Approved or Paid,
// and never on a job that is already finished. The database enforces both.

export async function setTechJobStatus(
  woNumber: string, status: 'In Progress' | 'Work Done',
): Promise<{ ok: boolean; reason: string }> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('tech_set_job_status', {
    p_wo_number: woNumber, p_status: status,
  });
  if (error) return { ok: false, reason: error.message };
  const r = (data ?? {}) as { ok?: boolean; reason?: string };
  return { ok: !!r.ok, reason: r.reason ?? 'unknown' };
}

/** Start or stop the clock. Starting also moves an untouched job to In Progress. */
export async function techClock(
  woNumber: string, action: 'in' | 'out',
): Promise<{ ok: boolean; reason: string }> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('tech_clock', {
    p_wo_number: woNumber, p_action: action,
  });
  if (error) return { ok: false, reason: error.message };
  const r = (data ?? {}) as { ok?: boolean; reason?: string };
  return { ok: !!r.ok, reason: r.reason ?? 'unknown' };
}

export async function saveTechCloseout(woNumber: string, summary: string): Promise<boolean> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('tech_save_closeout', {
    p_wo_number: woNumber, p_summary: summary,
  });
  if (error) throw new Error(error.message);
  return !!(data as { ok?: boolean } | null)?.ok;
}
