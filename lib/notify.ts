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
