import { scheduleLine } from './email-templates';
import type { Contractor, WorkOrder } from './types';

export async function notifyContractor(params: {
  type: 'wo_assigned' | 'status_change' | 'payment_recorded';
  contractor_email: string;
  contractor_name: string;
  wo_number: string;
  title?: string;
  status?: string;
  amount?: number;
  // wo_assigned extras: enable one-click accept/decline + portal link + job facts
  wo_id?: string;
  portal_token?: string | null;
  pay?: number;
  reference?: string | null;
  site?: string | null;
  schedule?: string | null;
}) {
  if (!params.contractor_email) return;
  try {
    await fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  } catch {
    // Non-critical — don't block the UI
  }
}

/** Asks a new tech to file their W-9 and sign the agreement, on their portal. */
export async function sendOnboarding(params: {
  contractor_email: string;
  contractor_name: string;
  portal_url: string;
  /** What the tech still owes; the email asks only for that. */
  needs_w9?: boolean;
  needs_agreement?: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  if (!params.contractor_email) return { ok: false, error: 'No email' };
  try {
    const res = await fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'onboarding', ...params }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      return { ok: false, error: json.error ?? 'Send failed' };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

/** Email a tech the tech app (app.fajsolutions.com/tech) and how to get in. */
export async function sendTechApp(params: {
  contractor_email: string;
  contractor_name: string;
  has_login: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  if (!params.contractor_email) return { ok: false, error: 'No email' };
  try {
    const res = await fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'tech_app', ...params }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      return { ok: false, error: json.error ?? 'Send failed' };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

export async function sendPortalLink(params: {
  contractor_email: string;
  contractor_name: string;
  portal_url: string;
  work_orders: Array<{
    wo_number: string;
    title?: string | null;
    start_date?: string | null;
    start_time?: string | null;
    site_address?: string | null;
    site_city?: string | null;
    site_state?: string | null;
  }>;
}): Promise<{ ok: boolean; error?: string }> {
  if (!params.contractor_email) return { ok: false, error: 'No email' };
  try {
    const res = await fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'portal_link', ...params }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      return { ok: false, error: json.error ?? 'Send failed' };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

/**
 * The new-job notice for one tech on a job that already exists — a tech added
 * in WorkFlow's "Change techs", or a job sent again to a tech who declined it
 * (Fred, 2026-10-18: "I am sending it back to me to see it in the app ...
 * nothing"). /api/notify picks the channel: email the first time, the tech's
 * phone after that. Pay only when it is the tech's own real pay.
 */
export function sendNewJobNotice(
  w: Pick<WorkOrder, 'id' | 'wo_number' | 'title' | 'external_wo_id' | 'client_reference' | 'source_platform'
    | 'site_name' | 'site_address' | 'site_city' | 'site_state' | 'start_date' | 'start_time' | 'end_date' | 'end_time'>,
  c: Pick<Contractor, 'name' | 'email' | 'portal_token'>,
  pay?: number | null,
) {
  const refId = w.external_wo_id || w.client_reference || null;
  return notifyContractor({
    type: 'wo_assigned',
    contractor_email: c.email ?? '',
    contractor_name: c.name,
    wo_number: w.wo_number,
    title: w.title ?? undefined,
    wo_id: w.id,
    portal_token: c.portal_token ?? null,
    pay: pay != null && pay > 0 ? pay : undefined,
    reference: refId ? `${w.source_platform && w.source_platform !== 'Internal' ? `${w.source_platform} ` : ''}#${refId}` : null,
    site: [w.site_name, w.site_address, w.site_city, w.site_state].filter(Boolean).join(', ') || null,
    schedule: scheduleLine(w) || null,
  });
}
