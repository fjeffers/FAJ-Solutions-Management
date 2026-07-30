// Read-only bridge to the FHJ Dream Destinations database — a SEPARATE Supabase
// project from this app's (`wxvlrhiflwyvodjlpepp` vs this app's own). Used only by
// the daily-brief cron, so Fred gets ONE morning email covering both businesses
// instead of watching two dashboards.
//
// Configured by two env vars that are deliberately absent by default:
//   FHJ_SUPABASE_URL
//   FHJ_SUPABASE_SERVICE_ROLE_KEY
//
// When either is missing, every function here returns null and the brief simply
// omits the travel section. The cron must never fail because the second business
// isn't wired up — a missing FHJ key should cost Fred a section, not his email.
//
// Privacy: intake_requests also carries passport_num, dob, and emergency contacts.
// This module selects ONLY the columns below on purpose. Do not widen the select.
import { createClient } from '@supabase/supabase-js';

export type FhjLead = {
  name: string;
  destination: string | null;
  occasion: string | null;
  budget: string | null;
  daysWaiting: number;
};

export type FhjSnapshot = {
  leads: FhjLead[];
  appointments: { name: string; type: string | null; date: string | null }[];
  unreadMessages: number;
};

/** True when both FHJ env vars are present, so the caller can label the section. */
export function fhjConfigured(): boolean {
  return Boolean(process.env.FHJ_SUPABASE_URL && process.env.FHJ_SUPABASE_SERVICE_ROLE_KEY);
}

const CLOSED_LEAD = new Set(['approved', 'declined', 'closed']);
const CLOSED_APPT = new Set(['completed', 'cancelled']);

const daysSince = (iso: string | null): number => {
  if (!iso) return 0;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((Date.now() - then) / 86400000));
};

/**
 * Snapshot of what needs a human reply at FHJ. Returns null when FHJ isn't
 * configured, or when the read fails — the caller treats both the same way.
 */
export async function fetchFhjSnapshot(): Promise<FhjSnapshot | null> {
  if (!fhjConfigured()) return null;

  const db = createClient(
    process.env.FHJ_SUPABASE_URL!,
    process.env.FHJ_SUPABASE_SERVICE_ROLE_KEY!,
  );

  try {
    const [leadRes, apptRes, msgRes] = await Promise.all([
      db
        .from('intake_requests')
        .select('first_name,last_name,destination,special_occasion,budget,status,created_at'),
      db.from('appointment_requests').select('name,type,date,status'),
      db.from('messages').select('id', { count: 'exact', head: true }).eq('read', false),
    ]);

    if (leadRes.error && apptRes.error) return null;

    const leads: FhjLead[] = (leadRes.data ?? [])
      .filter((r) => !CLOSED_LEAD.has(String(r.status ?? 'Pending').toLowerCase()))
      .map((r) => ({
        name: [r.first_name, r.last_name].filter(Boolean).join(' ').trim() || 'Unnamed',
        destination: r.destination ?? null,
        occasion: r.special_occasion ?? null,
        budget: r.budget?.trim() ? r.budget : null,
        daysWaiting: daysSince(r.created_at),
      }))
      .sort((a, b) => b.daysWaiting - a.daysWaiting);

    const appointments = (apptRes.data ?? [])
      .filter((r) => !CLOSED_APPT.has(String(r.status ?? 'Pending').toLowerCase()))
      .map((r) => ({ name: r.name ?? 'Unnamed', type: r.type ?? null, date: r.date ?? null }))
      .sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'));

    return { leads, appointments, unreadMessages: msgRes.count ?? 0 };
  } catch (err) {
    console.error('FHJ snapshot failed:', err);
    return null;
  }
}
